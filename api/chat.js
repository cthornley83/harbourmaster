// /api/chat.js
import { Configuration, OpenAIApi } from "openai";

// Setup OpenAI client
const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY, // make sure this is set in Vercel
});
const openai = new OpenAIApi(configuration);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { question } = req.body;

    if (!question) {
      return res.status(400).json({ error: "Missing 'question' in request body" });
    }

    // 🔹 TODO: if you want, call your embed + match functions here
    // const context = await fetch(`${process.env.BASE_URL}/api/match`, { ... })

    // 🔹 Call OpenAI directly (simple version)
    const response = await openai.createChatCompletion({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: "You are Virtual Craig, a sailing assistant." },
        { role: "user", content: question },
      ],
    });

    const answer = response.data.choices[0].message.content.trim();

    return res.status(200).json({ answer });
  } catch (err) {
    console.error("Chat API error:", err);
    return res.status(500).json({ error: "Something went wrong", details: err.message });
  }
}





