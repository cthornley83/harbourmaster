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

    console.log("📩 RAW BODY:", req.body);

    // 🧭 Accept all possible FlutterFlow / JSON / text payloads
    let question =
      req.body?.query ||
      req.body?.question ||
      req.body?.data?.query ||
      req.body?.data?.question ||
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

    // 1️⃣ Create embedding for the query
    const embedding = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: question,
    });

    // 2️⃣ Query Supabase for relevant documents
    const { data: matches, error } = await supabase.rpc("match_documents", {
      query_embedding: embedding.data[0].embedding,
      match_threshold: 0.75,
      match_count: 3,
    });

    if (error) {
      console.error("❌ Supabase match error:", error);
      throw error;
    }

    // 3️⃣ Build the context string
    let context = "No relevant entries found.";
    if (matches && matches.length > 0) {
      context = matches
        .map((m) => `Q: ${m.question}\nA: ${m.answer}`)
        .join("\n\n");
    }

    // 4️⃣ Generate answer: concise, step-by-step, context-only
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.0, // purely factual
      max_tokens: 350,
      messages: [
        {
          role: "system",
          content:
            "You are Harbourmaster, an RYA-style Yachtmaster Instructor in the Ionian. " +
            "Answer ONLY using



