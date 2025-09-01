// /api/chat.js  — CommonJS version (safe on Vercel), uses your OPENAI_API_KEY
const tips = require("../tips.json");

module.exports = async (req, res) => {
  // CORS for your app calls
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  const message = req.method === "GET"
    ? (req.query.message || "")
    : (await readBody(req)).message;

  if (!message) return res.status(400).json({ error: "No message given" });

  // ---- simple retrieval from tips.json
  const q = String(message).toLowerCase();
  const ranked = tips
    .map(t => {
      const hay = ((t.q || "") + " " + (t.tags || []).join(" ")).toLowerCase();
      const score =
        (hay.includes(q) ? 2 : 0) +
        (q.split(/\s+/).some(w => hay.includes(w)) ? 1 : 0);
      return { t, score };
    })
    .sort((a, b) => b.score - a.score)
    .filter(x => x.score > 0)
    .slice(0, 3)
    .map(x => x.t);

  const hazard = /\b(3[0-9]|30)\s*k?n?ts?\b|thunder|squall|gale|storm/i.test(message);

  // ---- build prompt for OpenAI
  const system =
    "You are Virtual Craig, an Ionian sailing instructor. " +
    "Answer in short, clear, NUMBERED STEPS only. If conditions are hazardous, add a short CAUTION block.";

  const context = ranked.length
    ? "Use ONLY this material:\n" +
      ranked
        .map(
          (t) => `ID:${t.id}\nQ:${t.q}\nSTEPS:\n${t.a_steps}`
        )
        .join("\n---\n")
    : "No specific tip matched. Give conservative Day Skipper guidance only.";

  // ---- call OpenAI
  const key = process.env.OPENAI_API_KEY;
  if (!key) return res.status(500).json({ error: "OPENAI_API_KEY not set" });

  const payload = {
    model: "gpt-4o-mini",
    temperature: 0.3,
    messages: [
      { role: "system", content: system },
      { role: "user", content: String(message) },
      { role: "system", content: context },
      { role: "system", content: hazard ? "Append a short CAUTION block." : "" }
    ]
  };

  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${key}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const j = await r.json();
  if (!j.choices || !j.choices[0]) {
    return res.status(502).json({ error: "OpenAI error", detail: j });
  }

  const reply = j.choices[0].message.content;
  return res.status(200).json({
    reply,
    tips: ranked.map(t => ({ id: t.id, q: t.q }))
  });
};

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(data || "{}"));
      } catch {
        resolve({});
      }
    });
  });
}
