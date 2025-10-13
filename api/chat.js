import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";

// --- Initialize Supabase & OpenAI clients ---
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
    // ✅ Only allow POST
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    // 🔍 Log whatever was received
    console.log("📩 RAW BODY:", req.body);

    /* ──────────────────────────────────────────────
       Accept all possible body formats
       (JSON, text, form, or FlutterFlow-specific)
    ────────────────────────────────────────────── */
    let question =
      req.body?.question ||
      req.body?.query || // FlutterFlow
      req.body?.data?.question ||
      req.body?.body?.question ||
      req.body?.text ||
      (Buffer.isBuffer(req.body)
        ? req.body.toString()
        : typeof req.body === "string"
        ? req.body
        : null);

    if (!question || question.trim() === "") {
      console.warn("⚠️ No question provided:", req.body);
      return res.status(400).json({ error: "No question provided" });
    }

    console.log("✅ Parsed question:", question);

    // 1️⃣ Create embedding for the question
    const embedding = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: question,
    });

    // 2️⃣ Query Supabase for relevant matches
    const { data: matches, error } = await supabase.rpc("match_documents", {
      query_embedding: embedding.data[0].embedding,
      match_threshold: 0.75,
      match_count: 3, // focused context (kept)
    });

    if (error) {
      console.error("❌ Supabase match error:", error);
      throw error;
    }

    // 3️⃣ Build contextual prompt
    let context = "No relevant entries found.";
    if (matches && matches.length > 0) {
      context = matches
        .map((m) => `Q: ${m.question}\nA: ${m.answer}`)
        .join("\n\n");
    }

    // 4️⃣ Generate the final answer — concise, context-only
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.0,        // strictly factual, no fluff
      max_tokens: 320,         // keep it tight
      messages: [
        {
          role: "system",
          content: [
            "You are Harbourmaster, an RYA-style Yachtmaster Instructor in the Ionian.",
            "Answer ONLY using the factual information in the provided context.",
            "If the context does not contain the answer, reply exactly: 'No data available for that question.'",
            "Format: numbered steps (max 8, each ≤ 20 words) OR 1–3 short factual sentences.",
            "No introductions, no summaries, no extra commentary."
          ].join(" ")
        },
        {
          role: "user",
          content:
            `Question: ${question}\n\n` +
            `Context (use only this information):\n${context}`
        },
      ],
    });

    const answer = completion.choices?.[0]?.message?.content?.trim() ?? "";

    // ✅ Return AI answer and the context used
    return res.status(200).json({
      sender: "Harbourmaster",
      answer,
      context,
    });
  } catch (err) {
    console.error("❌ Chat handler error:", err);
    return res.status(500).json({ error: err.message });
  }
}



