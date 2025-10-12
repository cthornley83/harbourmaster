import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";

// --- Initialize clients ---
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- Main handler ---
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { query } = req.body; 

    if (!query) {
      return res.status(400).json({ error: "Missing query" });
    }

    // 1️⃣ Create embedding of the query text
    const embedding = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: query,
    });

    // 2️⃣ Call Supabase RPC to get vector matches
    const { data: matches, error } = await supabase.rpc("match_documents", {
      query_embedding: embedding.data[0].embedding,
      match_threshold: 0.75,
      match_count: 5,
    });

    if (error) {
      console.error("Supabase match error:", error);
      throw error;
    }

    // 3️⃣ Return results
    return res.status(200).json({ matches });
  } catch (err) {
    console.error("Match handler error:", err);
    return res.status(500).json({ error: err.message });
  }
}
