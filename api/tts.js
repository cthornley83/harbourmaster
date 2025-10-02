export const config = {
  api: {
    bodyParser: true,
  },
};

export default async function handler(req, res) {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: "Missing text" });

    const resp = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${process.env.ELEVEN_VOICE_ID}`,
      {
        method: "POST",
        headers: {
          "Accept": "audio/mpeg",
          "Content-Type": "application/json",
          "xi-api-key": process.env.ELEVEN_API_KEY,
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_multilingual_v2",
        }),
      }
    );

    if (!resp.ok) throw new Error(`ElevenLabs error: ${resp.status}`);

    const arrayBuffer = await resp.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Save to Blob storage
    const fileName = `tts-${Date.now()}.mp3`;
    const blobResp = await fetch(`${process.env.VERCEL_BLOB_URL}/${fileName}`, {
      method: "PUT",
      headers: { "Content-Type": "audio/mpeg" },
      body: buffer,
    });

    if (!blobResp.ok) throw new Error("Blob storage upload failed");

    const audioUrl = `${process.env.VERCEL_BLOB_URL}/${fileName}`;
    return res.status(200).json({ audioUrl });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}
