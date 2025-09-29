// /api/embed.js
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// CORS helper
function setCORS(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-payload-key");
}

function parseBody(req) {
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return req.body || {};
}

// Fetch matches from /api/match
async function fetchMatches({ host, query, topK = 5 }) {
  try {
    const matchPath = process.env.MATCH_ENDPOINT_PATH || "/api/match";
    const matchUrl = matchPath.startsWith("http") ? matchPath : `https://${host}${matchPath}`;
    const r = await fetch(matchUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-payload-key": process.env.RAG_PAYLOAD_KEY || "",
        "Authorization": `Bearer ${process.env.RAG_PAYLOAD_KEY || ""}`
      },
      body: JSON.stringify({ query, match_count: topK })
    });
    if (!r.ok) {
      return { ok: false, error: `match ${r.status}`, data: await r.text() };
    }
    const data = await r.json();
    return { ok: true, matches: data.matches || [] };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// Build context string from matches
function buildContext(matches = []) {
  if (!Array.isArray(matches)) return "";
  return matches
    .map(m => m.content || "")
    .filter(Boolean)
    .join("\n---\n");
}

export default async function handler(req, res) {
  setCORS(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  try {
    // --- Auth check ---
    const expectedKey = process.env.RAG_PAYLOAD_KEY || "";
    const gotKey =
      req.headers["x-payload-key"] ||
      (req.headers["authorization"] || "").replace(/^Bearer\s+/i, "");
    if (expectedKey && gotKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // --- Parse input ---
    const body = parseBody(req);
    const prompt = body.prompt ?? body.input;
    const topK = 5; // fixed default for richest pipeline
    const model = body.model || process.env.OPENAI_MODEL || "gpt-4o-mini";

    if (!prompt) {
      return res.status(400).json({ error: "Missing 'prompt' (string)" });
    }

    // --- Fetch matches ---
    const { ok: matchOK, matches, error: matchError, data: matchRaw } =
      await fetchMatches({ host: req.headers.host, query: prompt, topK });

    const context = matchOK ? buildContext(matches) : "";
    const sources = matchOK ? matches.map(m => ({ id: m.id, score: m.score })) : [];

    // --- Build system/user messages ---
    const systemMsg =
      "You are Virtual Craig, a calm, step-by-step sailing assistant. " +
      "Answer clearly in numbered steps when appropriate. Prefer facts from the provided context. " +
      "If context is insufficient, say what you can with confidence.";

    const userMsg = context
      ? `Use the context below to answer the user's question.\n\nContext:\n${context}\n\nQuestion:\n${prompt}`
      : `Question:\n${prompt}`;

    // --- Call OpenAI ---
    const chat = await openai.chat.completions.create({
      model,
      temperature: 0.2,
      messages: [
        { role: "system", content: systemMsg },
        { role: "user", content: userMsg }
      ]
    });

    const answer =
      chat?.choices?.[0]?.message?.content?.trim() ||
      chat?.choices?.[0]?.text?.trim() ||
      "";

    if (!answer) {
      return res.status(502).json({
        error: "LLM returned empty content",
        upstream: chat
      });
    }

    // --- Return normalized shape ---
    return res.status(200).json({
      answer,
      sources,
      usedContext: Boolean(context),
      matchStatus: matchOK ? "ok" : `skip: ${matchError || matchRaw || "unknown"}`
    });
  } catch (err) {
    console.error("RAG ERROR:", err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
}




