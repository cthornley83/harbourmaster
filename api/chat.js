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

    const { question } = req.body;
    if (!question) {
      return res.status(400).json({ error: "No question provided" });
    }

    // 1️⃣ Create embedding for the question
    const embedding = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: question,
    });

    // 2️⃣ Query Supabase for matches
    const { data: matches, error } = await supabase.rpc("match_documents", {
      query_embedding: embedding.data[0].embedding,
      match_threshold: 0.75,
      match_count: 5,
    });

    if (error) {
      console.error("Supabase match error:", error);
      throw error;
    }

    // 3️⃣ Build contextual prompt
    let context = "No relevant entries found.";
    if (matches && matches.length > 0) {
      context = matches
        .map((m) => `Q: ${m.question}\nA: ${m.answer}`)
        .join("\n\n");
    }

    // 4️⃣ Generate the final answer
