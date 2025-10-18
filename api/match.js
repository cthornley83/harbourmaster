import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";

// --- Initialize clients ---
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// --- Main handler ---
export default async function handler(req, res) {
  try {
    // Allow POST only
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { query } = req.body;
    if (!query || query.trim() === "") {
      return res.status(400).json({ error: "Missing or empty query" });
    }

    // 1️⃣ Create embedding for the query (1536-dim)
    const embeddingResponse = await openai.embeddings.create({
      model: "text-embedding-3-small", // ✅ matches your stored embeddings
      input: query,
    });

    const queryEmbedding = embeddingResponse.data[0].embedding;
    console.log("Embedding length:", queryEmbedding.length); // should log 1536 in Render logs

    // 2️⃣ Query Supabase for nearest matches
    const { data: matches, error } = await supabase.rpc("match_documents", {
      query_embedding: queryEmbedding,
      match_threshold: 0.3, // relaxed threshold for good recall
      match_count: 3,       // return top 3 most similar rows
    });

    if (error) {
      console.error("Supabase match error:", error);
      return res.status(500).json({
        error: "Supabase RPC error",
        details: error.message || error,
      });
    }

    // 3️⃣ Return matches (empty array if none found)
    return res.status(200).json({
      matches: matches || [],
      count: matches ? matches.length : 0,
    });
  } catch (err) {
    console.error("Match handler error:", err);
    return res.status(500).json({ error: err.message });
  }
}

