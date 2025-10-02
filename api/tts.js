console.log("DEBUG ELEVEN_API_KEY:", process.env.ELEVEN_API_KEY);

import { put } from "@vercel/blob";

export const config = { api: { bodyParser: true } };

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { text } = req.body;
    if (!text) return res.status(400).json({ error: "Missing text" });

    // Call ElevenLabs
    const resp = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${process.env.ELEVEN_VOICE_ID}`,
      {
        method: "POST",
        headers: {
          Accept: "audio/mpeg",
          "Content-Type": "application/json",
          "xi-api-key": process.env.ELEVEN_API_KEY,
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_multilingual_v2"
        }),
      }
    );

    if (!resp.ok) throw new Error(`ElevenLabs error: ${resp.status}`); 

    const arrayBuffer = await resp.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Upload to Blob with SDK
    const fileName = `tts-${Date.now()}.mp3`;
    const { url } = await put(fileName, buffer, {
      access: "public",
      contentType: "audio/mpeg",
    });

    res.status(200).json({ audioUrl: url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}


"// debug save" 
