// /api/chat.js — Vercel serverless function
export default async function handler(req, res) {
  try {
    // CORS so Thunkable/web can call this
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") return res.status(200).end();

    const isGet = req.method === "GET";
    const body = isGet ? {} : await readJSON(req);
    const message = isGet ? (req.query.message || "") : (body.message || "");
    const tier = (isGet ? (req.query.tier || "") : (body.tier || "")).toLowerCase() || "free";
    if (!message) return res.status(400).json({ error: "Missing 'message'." });

    // Load tips from repo (bundled at build)
    const tips = await import("../../tips.json").then(m => m.default);

    // Simple tier check
    const rank = t => (t === "exclusive" ? 2 : t === "pro" ? 1 : 0);
    const allowed = tips.filter(t => rank(t.tier) <= rank(tier));

    // Naive retrieval (keyword bump). Good enough to launch.
    const q = message.toLowerCase();
    const top = allowed
      .map(t => {
        const hay = (t.q + " " + (t.tags || []).join(" ")).toLowerCase();
        const score = hay.includes(q) ? 2 : 1;
        return { t, score };
      })
      .sort((a,b)=>b.score-a.score)
      .slice(0, 3)
      .map(x=>x.t);

    // Hazard trigger for a short CAUTION block
    const hazard = /(\b3[0-9]\b|\b30\b).*k|thunder|squall|storm|gale/i.test(message);
    const caution = hazard
      ? "\n\nCAUTION:\n- Reef early and slow down.\n- Keep crew clipped in.\n- Avoid lee shores.\n- If unsure, do not proceed."
      : "";

    // Build prompt & call OpenAI
    const system = [
      "You are Virtual Craig, an Ionian sailing instructor.",
      "- Answer in short, clear, NUMBERED STEPS only.",
      "- Prefer the provided tips exactly; do not invent steps.",
      "- Cite used tip IDs as [T:IDs] at the end.",
      "- Respect tier: never reveal higher-tier content."
    ].join("\n");

    const context = top.length
      ? "Relevant tips:\n" + top.map(t => `ID:${t.id}\nQ:${t.q}\nSTEPS:${t.a_steps}`).join("\n---\n")
      : "No relevant tips found. Provide conservative Day Skipper guidance only.";

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) return res.status(500).json({ error: "OPENAI_API_KEY not set" });

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-5.1-mini",
        temperature: 0.3,
        messages: [
          { role: "system", content: system },
          { role: "user", content: message },
          { role: "system", content: context },
          { role: "system", content: hazard ? "Append a short CAUTION block." : "" }
        ]
      })
    });

    const j = await r.json();
    if (!j.choices) return res.status(500).json({ error: "OpenAI error", detail: j });

    const used = top.map(t=>t.id).join(",");
    const text = j.choices[0].message.content + (caution || "") + (used ? ` [T:${used}]` : "");
    return res.status(200).json({ text, citations: top.map(t=>t.id), tier });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Server error" });
  }
}

function readJSON(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", c => data += c);
    req.on("end", () => { try { resolve(JSON.parse(data || "{}")); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}
