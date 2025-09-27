// api/embed.js
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export default async function handler(req, res) {
  try {
    const { input } = req.body;

    if (!input) {
      return res.status(400).json({ error: "Missing input text" });
    }

    const response = await client.embeddings.create({
      model: "text-embedding-3-small",
      input
    });

    // Return just the embedding vector
    res.status(200).json({
      embedding: response.data[0].embedding,
      input
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}
