// api/embed.js
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export default async function handler(req, res) {
  try {
    console.log("BODY RECEIVED:", req.body);

    // Make sure body is always an object
    let body = req.body;

    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch (e) {
        console.error("JSON parse failed:", e, body);
        return res.status(400).json({ error: "Invalid JSON string" });
      }
    }

    const input = body?.input || null;
    const model = body?.model || "text-embedding-3-small";

    if (!input) {
      return res.status(400).json({ error: "Missing input text" });
    }

    const response = await client.embeddings.create({
      model,
      input,
    });

    res.status(200).json({
      embedding: response.data[0].embedding,
      input,
    });
  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({ error: err.message });
  }
}
