import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import express from "express";

const router = express.Router();

// --- Initialize clients ---
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- Main handler ---
router.post("/", async (req, res) => {
  try {
    const { text, harbour_name } = req.body;

    if (!text || !harbour_name) {
      return res.status(400).json({
        error: "Missing required fields: text and harbour_name",
      });
    }

    // 1️⃣ Create embedding from the given text
    const embedding = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: text,
    });

    // 2️⃣ Insert into Supabase table `harbour_questions`
    const { error } = await supabase.from("harbour_questions").insert({
      question: text,
      answer: "", // placeholder for now
      harbour_name,
      embedding: embedding.data[0].embedding,
    });

    if (error) {
      console.error("Supabase insert error:", error);
      throw error;
    }

    return res
      .status(200)
      .json({ message: "Embedded and stored successfully" });
  } catch (err) {
    console.error("Embed handler error:", err);
    return res.status(500).json({ error: err.message });
  }
});

export default router;
