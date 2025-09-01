// /api/chat.js — uses tips.json + OpenAI (no extra packages needed)
import fs from "fs";
import path from "path";

function loadTips() {
  const tipsPath = path.join(process.cwd(), "tips.json"); // tips.json at repo root
  const raw = fs.readFileSync(tipsPath, "utf8");
  return JSON.parse(raw);
}

async function askOpenAI(messages) {
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-5.1-mini",
      temperature: 0.3,
      messages
    })
  });
  const j = await r.json();
  if (!j.choices) throw new Error("OpenAI error: " + JSON.stringify(j));
  return j.choices[0].message.content.trim();
}

export default async function handler(req, res) {
  // CORS so Thunkable can call this
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const message = req.method === "GET"
    ? (req.query.message || "")
    : (await readBody(req)).message;

  const tier = (req.method === "GET"
    ? (req.query.tier || "")
    : (await readBody(req)).tier) || "free";

  if (!message) return res.status(400).json({ error: "No message given" });
  if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: "OPENAI_API_KEY missing" });

  // 1) Simple retrieval from tips.json
  const tips = loadTips();
  const q = message.toLowerCase();
  const rank = t => (t.tier === "exclusive" ? 2 : t.tier === "pro" ? 1 : 0);
  const allow = rank(tier);
  const pool = tips.filter(t => rank(t.tier) <= allow);

  const matches = pool.filter(
    t => (t.q || "").toLowerCase().includes(q) ||
         (t.tags || []).join(" ").toLowerCase().includes(q)
  ).slice(0, 3);

  // Hazard flag for CAUTION
  const hazard = /(\b3[0-9]\b|\b30\b).*k|thunder|squall|gale|storm|lightning|MOB/i.test(message);

  // 2) Build prompt for OpenAI
  const system = `
You are Virtual Craig, an Ionian sailing instructor.
Rules:
- Answer in short, clear, NUMBERED STEPS only.
- Be practical and concise.
- If hazardous conditions (≥30 kts, thunderstorms, MOB, poor visibility) are mentioned, append a short "CAUTION" block with 2–4 bullets.
- Prefer the provided tips; do not invent advanced content above the user's tier.
`;

  const context = matches.length
    ? "Relevant tips (use these):\n" + matches.map(t => `ID:${t.id}\nQ:${t.q}\nSTEPS:${t.a_steps}`).join("\n---\n")
    : "No matching tips provided. Give conservative Day Skipper best practice only.";

  const user = `User asks: "${message}"`;

  // 3) Ask OpenAI
  const reply = await askOpenAI([
    { role: "system", content: system },
    { role: "system", content: context },
    { role: "user", content: user },
    { role: "system", content: hazard ? "Append a short CAUTION block at the end." : "" }
  ]);

  res.status(200).json({
    reply,
    tips: matches.map(t => ({ id: t.id, q: t.q })),
    tier
  });
}

async function readBody(req) {
  return new Promise(resolve => {
    let data = "";
    req.on("data", c => data += c);
    req.on("end", () => {
      try { resolve(JSON.parse(data || "{}")); }
      catch { resolve({}); }
    });
  });
}
