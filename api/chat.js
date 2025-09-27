// api/chat.js
// Endpoint for OpenAI chat completions

module.exports = async function (req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST allowed" });
  }

  try {
    const { messages } = req.body;

    if (!messages) {
      return res.status(400).json({ error: "Missing messages in request body" });
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.2,
        messages,
      }),
    });

    const data = await response.json();

    if (response.ok) {
      return res.status(200).json(data);
    } else {
      return res.status(response.status).json({ error: data });
    }
  } catch (err) {
    console.error("Chat API error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
