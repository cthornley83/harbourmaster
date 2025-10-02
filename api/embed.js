import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { text, metadata } = req.body;
    if (!text) {
      return res.status(400).json({ error: "Missing text" });
    }

    // Get embedding from OpenAI
    const embeddingResponse = await openai.embeddings.create({
      model: "text-embedding-ada-002",
      input: text,
    });

    const embedding = embeddingResponse.data[0].embedding;

    // Save to Supabase
    const { error } = await supabase
      .from("documents")
      .insert([{ content: text, embedding, metadata }]);

    if (error) throw error;

    res.status(200).json({ success: true, message: "Embedding stored" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Internal Server Error" });
  }
}






