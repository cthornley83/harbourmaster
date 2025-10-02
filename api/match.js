import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { query } = req.body || {};
    if (!query) {
      return res.status(400).json({ error: "Missing query" });
    }

    const embeddingResponse = await openai.embeddings.create({
      model: "text-embedding-ada-002",
      input: query,
    });
    const queryEmbedding = embeddingResponse.data[0].embedding;

    const { data, error } = await supabase.rpc("match_documents", {
      query_embedding: queryEmbedding,
      match_count: 3,
    });

    if (error) throw error;

    const matches = data.map(row => ({
      harbour_name: row.harbour_name,
      question: row.question,
      answer: row.answer,
      similarity: row.similarity,
    }));

    res.status(200).json({ success: true, matches });
  } catch (err) {
    res.status(500).json({ error: err.message || "Something went wrong" });
  }
}


