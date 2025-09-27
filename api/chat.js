// api/chat.js
const OpenAI = require("openai");

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

module.exports = async (req, res) => {
  try {
    const { userMessage, contextMatches } = req.body;

    if (!userMessage) {
      return res.status(400).json({ error: "Missing userMessage" });
    }
    if (!contextMatches || !Array.isArray(contextMatches)) {
      return res.status(400).json({ error: "Missing or invalid contextMatches" });
    }

    // Build context string from Supabase matches
    const contextString = contextMatches
      .map(
        (match, i) =>
          `Match ${i + 1} (similarity ${match.similarity.toFixed(2)}):\nQ: ${match.question}\nA: ${match.answer}`
      )
      .join("\n\n");

    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: `You are a sailing assistant. Use the context below to answer user questions clearly and concisely:\n\n${contextString}`,
        },
        { role: "user", content: userMessage },
      ],
    });

    const answer = response?.choices?.[0]?.message?.content || "No response from model.";

    res.status(200).json({ answer, contextUsed: contextString });
  } catch (err) {
    console.error("Chat API error:", err);
    res.status(500).json({ error: err.message });
  }
};


