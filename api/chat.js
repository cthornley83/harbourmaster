// /api/chat.js
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- helpers ---
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

export default async function handler(req, res) {
  setCORS(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  // --- Auth (accept x-payload-key OR Bearer). If a key is configured, require it.
  const expectedKey = process.env.RAG_PAYLOAD_KEY || "";
  const gotKeyHeader = req.headers["x-payload-key"];
  const gotBearer = (req.headers["authorization"] || "").replace(/^Bearer\s+/i, "");
  const gotKey = gotKeyHeader || gotBearer;

  // Minimal visibility in logs (no secrets)
  console.log("CHAT auth", { hasExpected: Boolean(expectedKey), hasGot: Boolean(gotKey) });

  if (expectedKey) {
    if (!gotKey || gotKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  }

  try {
    const body = parseBody(req);

    // Accept either {messages:[...]} or {prompt:"..."} for simplicity
    const model = body.model || process.env.OPENAI_MODEL || "gpt-4o-mini";
    const messages = Array.isArray(body.messages) && body.messages.length
      ? body.messages
      : [{ role: "user", content: String(body.prompt ?? body.input ?? "") }];

    if (!messages?.[0]?.content) {
      return res.status(400).json({ error: "Missing prompt/messages" });
    }

    const resp = await openai.chat.completions.create({
      model,
      temperature: 0.2,
      messages
    });

    const answer =
      resp?.choices?.[0]?.message?.content?.trim() ||
      resp?.choices?.[0]?.text?.trim() ||
      "";

    if (!answer) {
      return res.status(502).json({ error: "LLM returned empty content", upstream: resp });
    }

    // Keep it simple for the normalizer/Thunkable
    return res.status(200).json({ answer });
  } catch (e) {
    console.error("CHAT error:", e);
    return res.status(500).json({ error: String(e?.message || e) });
  }
}




