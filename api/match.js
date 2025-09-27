// api/match.js
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY // or SERVICE_KEY if you want private RPC access
);

export default async function handler(req, res) {
  try {
    const { query_embedding, match_count } = req.body;

    if (!query_embedding) {
      return res.status(400).json({ error: "Missing query embedding" });
    }

    // Call your custom PostgreSQL function for similarity search
    const { data, error } = await supabase.rpc("match_documents", {
      query_embedding,
      match_count: match_count || 3,
    });

    if (error) throw error;

    res.status(200).json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}
