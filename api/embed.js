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

    const { text, harbour_name, category, tags, tier } = req.body;
    if (!text || !harbour_name) {
      return res
        .status(400)
        .json({ error: "Missing required fields: text and harbour_name" });
    }

    // Create embedding with OpenAI
    const embeddingResponse = await openai.embeddings.create({
      model: "text-embedding-ada-002",
      input: text,
    });

    const embedding = embeddingResponse.data[0].embedding;

    // Insert into Supabase
    const { error } = await supabase.from("harbour_questions").insert([
      {
        question: text,
        harbour_name,
        category,
        tags,
        tier,
        embedding,
      },
    ]);

    if (error) throw error;

    // ✅ Clean response for FlutterFlow
    res.status(200).json({
      success: true,
      message: "Embedding stored successfully",
    });
  } catch (err) {
    console.error("Embed API error:", err);
    res.status(500).json({ error: err.message || "Internal Server Error" });
  }
}







