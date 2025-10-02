import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { query, matchCount = 3 } = req.body;
    if (!query) {
      return res.status(400).json({ error: "Missing query" });
    }

    // Call the SQL function in Supabase
    const { data, error } = await supabase.rpc("match_documents", {
      query_embedding: query,      // your function embeds inside SQL
      match_count: matchCount
    });

    if (error) throw error;

    // Map only the fields FlutterFlow needs
    const matches = data.map(row => ({
      harbour_name: row.harbour_name,
      question: row.question,
      answer: row.answer,
      similarity: row.similarity
    }));

    res.status(200).json({
      success: true,
      matches
    });
  } catch (err) {
    console.error("Match API error:", err);


