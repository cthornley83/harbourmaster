import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { query } = req.body;
    const matchCount = 3; // default for FlutterFlow

    if (!query) {
      return res.status(400).json({ error: "Missing query" });
    }

    // Create embedding for the query
    const embeddingResponse = await openai.embeddings.create({
      model: "text-embedding-ada-002",
      input: query,
    });

    const queryEmbedding = embeddingResponse.data[0].embedding;

    // Call Supabase match function
    const { data, error } = await supabase.rpc("match_documents", {
      query_embedding: queryEmbedding,
      match_count: matchCount,
    });

    if (error) throw error;

    // Return clean JSON for FlutterFlow
    const matches = data.map((row) => ({
      harbour_name: row.harbour_name,
      question: row.question,
      answer: row.answer,
      similarity: row.similarity,
    }));

    res.status(200).json({
      success: true,
      matches,
    });
  } catch (err) {
    console.error("Match API error:", err);
    res.status(500).json({ error: err.message || "Internal Server Error" });
  }
}


