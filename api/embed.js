// api/embed.js
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
}); 

export default async function handler(req, res) {
  try {
    // Log everything so we can see what Thunkable is sending
    console.log("METHOD:", req.method);
    console.log("HEADERS:", req.headers);
    console.log("BODY RAW:", req.body);

    // Safely pull input + model
    const { input, model } = req.body || {};

    if (!input) {
      return res.status(400).json({ error: "Missing input text", body: req.body });
    }

    const response = await client.embeddings.create({
      model: model || "text-embedding-3-small",
      input,
    });

    // Return embedding and echo input back
    res.status(200).json({
      embedding: response.data[0].embedding,
      input,
    });
  } catch (err) {
    console.error("ERROR:", err);
    res.status(500).json({ error: err.message });
  }
}

