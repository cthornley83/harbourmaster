// /api/chat.js
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Helpers
function setCORS(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-payload-key");
}
function parseBody(req) {
  if (typeof req.body === "string") { try { return JSON.parse(req.body); } catch { return {}; } }
  return req.body || {};
}

export default async function handler(req, res) {
  setCORS(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  // Auth (same as /api/embed)
  const expectedKey = process.env.RAG_PAYLOAD_KEY || "";
  const gotKey =
    req.headers["x-payload-key"] ||
    (req.headers["authorization"] || "").replace(/^Bearer\s+/i, "");
  if (expectedKey && gotKey !== expectedKey) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const body = parseBody(req);

    // Accept either {messages:[...]} or {prompt:"..."} for simplicity
    const messages = Array.isArray(body.messages) ? body.messages : [
      { role: "user", content: String(body.prompt ?? body.input ?? "") }
    ];
    const model = body.model || process.env.OPENAI_MODEL || "gpt-4o-mini";
    if (!messages?.[0]?.content) return res.status(400).json({ error: "Missing prompt/messages" });

    const resp = await openai.chat.completions.create({
      model,
      temperature: 0.2,
      messages
    });

    const answer =
      resp?.choices?.[0]?.message?.content?.trim() ||
      resp?.choices?.[0]?.text?.trim() || "";

    if (!answer) return res.status(502).json({ error: "LLM returned empty content", upstream: resp });

    // Return a simple, friendly shape (and remains compatible with /api/normalize)
    return res.status(200).json({ answer });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
}




