// api/embed.js
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export default async function handler(req, res) {
  try {
    console.log("BODY RECEIVED:", req.body);

    // Handle both string and object bodies (Thunkable sends as string if Body type = String)
    let body = req.body;

    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch (e) {
        console.error("JSON parse failed:", e, body);
        return res.status(400).json({ error: "Invalid JSON string" });
      }
    }

    const { input, model } = body;

    if (!input) {
      return res.status(400).json({ error: "Missing input text" });
    }

    const response = await client.embeddings.create({
      model: model || "text-embedding-3-small",
      input,
    });

    // Return just the embedding + original input
    res.status(200).json({
      embedding: response.data[0].embedding,
      input,
    });
  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({ error: err.message });
  }
}

