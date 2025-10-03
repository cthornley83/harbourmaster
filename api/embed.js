import { createClient } from '@supabase/supabase-js';
import OpenAI from "openai";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { text, harbour_name } = req.body;

  if (!text || !harbour_name) {
    return res.status(400).json({ error: 'Missing required fields: text and harbour_name' });
  }

  try {
    // Generate embedding
    const embedding = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: text
    });

    // Insert into harbour_questions
    const { error } = await supabase
      .from('harbour_questions')
      .insert({
        question: text,
        answer: null,
        harbour_name: harbour_name,
        embedding: embedding.data[0].embedding
      });

    if (error) throw error;

    return res.status(200).json({ message: 'Embedded and stored successfully' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}







