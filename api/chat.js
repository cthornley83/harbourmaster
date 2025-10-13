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

    // 🧩 Log and extract safely
    console.log("📩 RAW BODY:", req.body);

    let question =
      req.body?.question ||
      req.body?.data?.question ||
      req.body?.body?.question ||
      req.body?.text ||
      (Buffer.isBuffer(req.body)
        ? req.body.toString()
        : typeof req.body === "string"
        ? req.body
        : null);

    if (!question || question.trim() === "") {
      return res.status(400).json({ error: "No question provided" });
    }

    console.log("✅ Parsed question:", question);

    // --- Embedding ---
    const embedding = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: question,
    });

    // --- Vector match ---
    const { data: matches, error } = await supabase.rpc("match_documents", {
      query_embedding: embedding.data[0].embedding,
      match_threshold: 0.75,
      match_count: 5,
    });

    if (error) {
      console.error("Supabase match error:", error);
      throw error;
    }

    // --- Build context ---
    let context = "No relevant entries found.";
    if (matches && matches.length > 0) {
      context = matches
        .map((m) => `Q: ${m.question}\nA: ${m.answer}`)
        .join("\n\n");
    }

    // --- Generate reply ---
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are Virtual Craig, a Yachtmaster Instructor with 15 years of experience in the Ionian. " +
            "You always answer clearly, step-by-step, using safe and practical seamanship based on RYA-style guidance.",
        },
        {
          role: "user",
          content: `Question: ${question}\n\nContext:\n${context}`,
        },
      ],
      temperature: 0.7,
    });

    const answer = completion.choices[0].message.content;

    return res.status(200).json({ answer, context });
  } catch (err) {
    console.error("Chat handler error:", err);
    return res.status(500).json({ error: err.message });
  }
}


