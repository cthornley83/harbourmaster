export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { text } = req.body;
    if (!text) return res.status(400).json({ error: "Missing text" });

    const resp = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${process.env.ELEVEN_VOICE_ID}`,
      {
        method: "POST",
        headers: {
          Accept: "audio/mpeg",
          "Content-Type": "application/json",
          "xi-api-key": process.env.ELEVEN_API_KEY,
        },
        body: JSON.stringify({ text, model_id: "eleven_multilingual_v2" }),
      }
    );

    if (!resp.ok) throw new Error(`ElevenLabs error: ${resp.status}`);

    const arrayBuffer = await resp.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Disposition", "inline; filename=output.mp3");
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}


