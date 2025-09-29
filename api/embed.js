// /api/embed.js
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Helper: parse JSON body safely (Thunkable sometimes sends strings)
function parseBody(req) {
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return req.body || {};
}

// Helper: call your internal match endpoint to get RAG context
async function fetchMatches({ host, query, topK = 5 }) {
  try {
    const matchPath = process.env.MATCH_ENDPOINT_PATH || "/api/match";
    const matchUrl = matchPath.startsWith("http") ? matchPath : `https://${host}${matchPath}`;
    const r = await fetch(matchUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        match_count: topK,
      }),
    });
    if (!r.ok) {
      return { ok: false, error: `match ${r.status}`, data: await r.text() };
    }
    const data = await r.json();
    // Expecting something like { matches: [{ id, score, content, url? }, ...] }
    const matches = data.matches || data || [];
    return { ok: true, matches };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// Helper: build a compact context string from matches
function buildContext(matches = []) {
  if (!Array.isArray(matches)) return "";
  const parts = [];
  for (const m of matches.slice(0, 8)) {
    const t =
      (m.content || m.text || m.page_content || m.chunk || m.data || "")
        .toString()
        .trim();
    if (t) parts.push(t);
  }
  return parts.join("\n\n---\n\n");
}

// CORS helper
function setCORS(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-payload-key");
}

export default async function handler(req, res) {
  setCORS(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  try {
    // --- Auth gate (optional but recommended) ---
    const expectedKey = process.env.RAG_PAYLOAD_KEY || "";
    const gotKey =
      req.headers["x-payload-key"] ||
      (req.headers["authorization"] || "").replace(/^Bearer\s+/i, "");
    if (expectedKey && gotKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // --- Parse input ---
    const body = parseBody(req);
    const prompt = body.prompt ?? body.input; // accept either
    const topK = Number(body.topK || body.match_count || 5);
    const model = body.model || process.env.OPENAI_MODEL || "gpt-4o-mini";

    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "Missing 'prompt' (string) in body" });
    }

    // --- Get RAG matches (optional; if fails, we still answer without context) ---
    const { ok: matchOK, matches, error: matchError, data: matchRaw } =
      await fetchMatches({ host: req.headers.host, query: prompt, topK });

    const context = matchOK ? buildContext(matches) : "";
    const sources =
      matchOK && Array.isArray(matches)
        ? matches.slice(0, topK).map((m) => ({
            id: m.id ?? m.document_id ?? m.uuid ?? null,
            score: m.score ?? m.similarity ?? null,
            url: m.url ?? null,
          }))
        : [];

    // --- Compose system / user messages ---
    const systemMsg =
      "You are Virtual Craig, a calm, step-by-step sailing assistant. " +
      "Answer clearly in short numbered steps when appropriate. " +
      "Prefer facts from the provided context. If the context is insufficient, say what you can confidently.";

    const userMsg =
      context
        ? `Answer the user's question using ONLY the context when relevant.\n\nContext:\n${context}\n\nQuestion:\n${prompt}`
        : `Question:\n${prompt}`;

    // --- Call OpenAI Chat ---
    const chat = await openai.chat.completions.create({
      model,
      temperature: 0.2,
      messages: [
        { role: "system", content: systemMsg },
        { role: "user", content: userMsg },
      ],
    });

    const answer =
      chat?.choices?.[0]?.message?.content?.trim() ||
      chat?.choices?.[0]?.text?.trim() ||
      "";

    if (!answer) {
      return res.status(502).json({
        error: "LLM returned empty content",
        upstream: chat,
      });
    }

    // --- Return normalized shape the normalizer can read easily ---
    return res.status(200).json({
      answer,
      sources,
      usedContext: Boolean(context),
      matchStatus: matchOK ? "ok" : `skip: ${matchError || matchRaw || "unknown"}`,
    });
  } catch (err) {
    console.error("RAG ERROR:", err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
}



