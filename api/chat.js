// /api/chat.js
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { question } = req.body || {};

    if (!question) {
      return res.status(400).json({ error: "Missing 'question' in request body" });
    }

    // Call GPT for a chat completion
    const completion = await client.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: "You are Virtual Craig, a sailing assistant for Ionian sailors. Always be clear, concise, and safety-focused." },
        { role: "user", content: question },
      ],
    });

    const answer = completion.choices[0]?.message?.content?.trim();

    if (!answer) {
      return res.status(500).json({ error: "No answer generated" });
    }

    // ✅ Clean JSON for FlutterFlow
    return res.status(200).json({
      success: true,
      question,
      answer,
    });
  } catch (err) {
    console.error("Chat API error:", err);
    return res.status(500).json({ error: err.message || "Something went wrong" });
  }
}







