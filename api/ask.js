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
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { question } = req.body || {};
    if (!question) {
      return res.status(400).json({ error: "Missing 'question' in request body" });
    }

    // Step 1: Create embedding for the question
    const embeddingResponse = await openai.embeddings.create({
      model: "text-embedding-ada-002",
      input: question,
    });

    const queryEmbedding = embeddingResponse.data[0].embedding;

    // Step 2: Query Supabase for context
    const { data: matches, error } = await supabase.rpc("match_documents", {
      query_embedding: queryEmbedding,
      match_count: 3,
    });

    if (error) throw error;

    const contextText = matches
      .map((row) => `Q: ${row.question}\nA: ${row.answer}`)
      .join("\n\n");

    // Step 3: Feed context + user question into GPT
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: "You are Virtual Craig, an Ionian sailing assistant. Always provide clear, accurate, safety-focused answers based on the provided harbour data. If you are unsure, say so honestly.",
        },
        {
          role: "user",
          content: `Here is context from the knowledge base:\n\n${contextText}\n\nUser question: ${question}\n\nAnswer as Virtual Craig:`,
        },
      ],
    });

    const answer = completion.choices[0]?.message?.content?.trim();

    return res.status(200).json({
      success: true,
      question,
      answer,
      context: matches.map((m) => ({
        harbour_name: m.harbour_name,
        question: m.question,
        answer: m.answer,
        similarity: m.similarity,
      })),
    });
  } catch (err) {
    console.error("Ask API error:", err);
    return res.status(500).json({ error: err.message || "Something went wrong" });
  }
}
