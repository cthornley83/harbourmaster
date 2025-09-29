// /api/match.js
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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

  // --- Auth (consistent with chat & embed) ---
  const expectedKey = process.env.RAG_PAYLOAD_KEY || "";
  const gotKeyHeader = req.headers["x-payload-key"];
  const gotBearer = (req.headers["authorization"] || "").replace(/^Bearer\s+/i, "");
  const gotKey = gotKeyHeader || gotBearer;
  if (expectedKey && gotKey !== expectedKey) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const body = parseBody(req);
    const query = body.query ?? body.query_text ?? body.prompt ?? body.input;
    const match_count = Number(body.match_count ?? body.topK ?? 3);
    const similarity_threshold = Number(body.similarity_threshold ?? 0.0);

    if (!query) {
      return res.status(400).json({ error: "Missing 'query' string" });
    }

    // 1. Embed the query
    const emb = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: query
    });
    const query_embedding = emb.data[0].embedding;

    // 2. Call Supabase RPC
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
    const { data, error } = await supabase.rpc("match_documents", {
      query_embedding,
      match_count,
      similarity_threshold
    });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    // 3. Normalize output
    const matches = (data || []).map(r => ({
      id: r.id ?? r.document_id ?? r.uuid ?? null,
      content: r.content ?? r.page_content ?? r.chunk ?? "",
      score: r.similarity ?? r.score ?? null,
      url: r.metadata?.url ?? null,
      metadata: r.metadata ?? {}
    }));

    return res.status(200).json({ matches });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
}

