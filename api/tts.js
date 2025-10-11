// api/tts.js
import fetch from "node-fetch";

export default async function handler(req, res) {
  try {
    const { text } = req.body;
    if (!text) {
      return res.status(400).json({ error: "Missing 'text' field" });
    }

    const apiKey = process.env.ELEVEN_API_KEY;
    const voiceId = process.env.ELEVEN_VOICE_ID || "21m00Tcm4TlvDq8ikWAM"; // fallback voice

    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg"
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
        voice_settings: {
          stability: 0.4,
          similarity_boost: 0.7
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("ElevenLabs error:", errorText);
      return res.status(response.status).json({ error: "TTS request failed", details: errorText });
    }

    const audioBuffer = await response.arrayBuffer();
    const audioData = Buffer.from(audioBuffer);

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Disposition", "inline; filename=output.mp3");
    res.send(audioData);

  } catch (err) {
    console.error("TTS Handler Error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}
