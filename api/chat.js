// api/chat.js — stable version: array reply + error-safe

const tips = require("../tips.json"); // bundled at build time

async function askOpenAI(messages) {
  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.3,
        messages,
      }),
    });
    const j = await r.json();
    if (!j.choices || !j.choices[0]?.message?.content) {
      throw new Error(`OpenAI response: ${JSON.stringify(j)}`);
    }
    return j.choices[0].message.content.trim();
  } catch (err) {
    // Return text so the function never 500s
    return `⚠️ OpenAI request failed: ${err.message}`;
  }
}

export default async function handler(req, res) {
  try {
    // CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.status(200).end();

    const isGet = req.method === "GET";
    const body = isGet ? {} : await readBody(req);
    const message = String(isGet ? (req.query.message || "") : (body.message || "")).trim();
    const tier = String(isGet ? (req.query.tier || "") : (body.tier || "")).trim().toLowerCase() || "free";

    if (!message) return res.status(400).json({ error: "No message given" });
    if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: "OPENAI_API_KEY missing" });

    // tier gating
    const rank = t => (t === "exclusive" ? 2 : t === "pro" ? 1 : 0);
    const allow = rank(tier);
    const pool = (Array.isArray(tips) ? tips : []).filter(t => rank(t.tier) <= allow);

    // retrieval
    const q = message.toLowerCase();
    const matches = pool
      .filter(t =>
        (t.q || "").toLowerCase().includes(q) ||
        (t.tags || []).join(" ").toLowerCase().includes(q)
      )
      .slice(0, 3);

    const hazard = /(\b3[0-9]\b|\b30\b).*k|thunder|squall|gale|storm|lightning|MOB/i.test(message);

    const system = `
You are Virtual Craig, an Ionian sailing instructor.
- Answer in short, clear, NUMBERED STEPS only.
- Prefer the provided tips; stay within the user's tier.
- If hazardous conditions are mentioned, append a short CAUTION block.
`.trim();

    const context = matches.length
      ? "Relevant tips (use these):\n" + matches.map(t => `ID:${t.id}\nQ:${t.q}\nSTEPS:${t.a_steps}`).join("\n---\n")
      : "No matching tips; give conservative Day Skipper best practice.";

    const replyText = await askOpenAI([
      { role: "system", content: system },
      { role: "system", content: context },
      { role: "user", content: `User asks: "${message}"` },
      { role: "system", content: hazard ? "Append a short CAUTION block at the end." : "" }
    ]);

    // Convert to array of steps
    const steps = String(replyText || "")
      .split(/\n+/)
      .map(s => s.replace(/^\s*(\d+[\).:-]?|\*|-)\s*/, "")) // strip "1) ", "1. ", "-", "*"
      .map(s => s.trim())
      .filter(Boolean);

    return res.status(200).json({
      reply: steps,                                      // ARRAY of steps
      tips: matches.map(t => ({ id: t.id, q: t.q })),    // uses "matches", not "results"
      tier
    });
  } catch (err) {
    // Last-resort safety: never 500
    return res.status(200).json({ reply: [`⚠️ Server error: ${err.message}`], tips: [], tier: "unknown" });
  }
}

async function readBody(req) {
  return new Promise(resolve => {
    let data = "";
    req.on("data", c => (data += c));
    req.on("end", () => {
      try { resolve(JSON.parse(data || "{}")); } catch { resolve({}); }
    });
  });
}

