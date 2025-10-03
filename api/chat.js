import { createClient } from '@supabase/supabase-js';
import OpenAI from "openai";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { question } = req.body;

  if (!question) {
    return res.status(400).json({ error: 'No question provided' });
  }

  try {
    // 1. Embed the user’s question
    const embedding = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: question
    });

    // 2. Query Supabase for matches
    const { data: matches, error } = await supabase.rpc('match_documents', {
      query_embedding: embedding.data[0].embedding,
      match_threshold: 0.75,
      match_count: 5
    });

    if (error) throw error;

    // 3. Build context from matches
    let context = "No relevant entries found.";
    if (matches && matches.length > 0) {
      context = matches
        .map(m => `Q: ${m.question}\nA: ${m.answer}`)
        .join("\n\n");
    }

    // 4. Ask GPT with the context
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are Virtual Craig, a Yachtmaster Instructor with 15 years in the Ionian. Always answer in step-by-step sailing instructions." },
        { role: "user", content: `Question: ${question}\n\nContext:\n${context}` }
      ]
    });

    const answer = completion.choices[0].message.content;

    return res.status(200).json({ answer, used_context: context });
  } catch (err) {
    console.error("Chat error:", err);
    return res.status(500).json({ error: err.message });
  }
}







