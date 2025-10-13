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
    // 1️⃣ Allow only POST requests
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    // 🔍 Log the raw body for debugging
    console.log("📩 RAW BODY:", req.body);

    /* 2️⃣ Accept multiple possible FlutterFlow formats */
    let question =
      req.body?.question ||
      req.body?.data?.question ||
      req.body?.body?.question ||
      req.body?.text ||
      (typeof req.body === "string" ? req.body : null);

    if (!question || question.trim() === "") {
      return res.status(400).json({ error: "No question provided" });
    }

    console.log("✅ Parsed question:", question);

    // 3️⃣ Create embedding for the question
    const embedding = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: question,
    });

    // 4️⃣ Query Supabase for relevant matches
    const { data: matches, error } = await supabase.rpc("match_documents", {
      query_embedding: embedding.data[0].embedding,
      match_threshold: 0.75,
      match_count: 5,
    });

    if (error) {
      console.error("❌ Supabase match error:", error);
      throw error;
    }

    // 5️⃣ Build contextual prompt
    let context = "No relevant entries found.";
    if (matches && matches.length > 0) {
      context = matches
        .map((m) => `Q: ${m.question}\nA: ${m.answer}`)
        .join("\n\n");
    }

    // 6️⃣ Generate the final answer with “Virtual Craig” tone
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

    // ✅ Return AI answer and the context used
    return res.status(200).json({ answer, context });
  } catch (err) {
    console.error("❌ Chat handler error:", err);
    return res.status(500).json({ error: err.message });
  }
}

