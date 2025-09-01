// api/chat.js — fresh, robust version
// - No fs/path; tips.json is bundled at build time
// - Works for GET (?message=...) and POST ({ message, tier })
// - Returns reply as an ARRAY OF STEPS
// - Never crashes: shows readable error text if OpenAI fails

// Load tips.json from the repo root (../tips.json)
const tips = require("../tips.json");

// ---------- helpers ----------
const tierRank = (tier) => (tier === "exclusive" ? 2 : tier === "pro" ? 1 : 0);

function extractSteps(text = "") {
  // Split on blank lines or \n and strip 1) / 1. / - / * prefixes
  return text
    .split(/\n+/)
    .map((s) => s.replace(/^\s*(\d+[\).:-]?|\*|-)\s*/, "").trim())
    .filter(Boolean);
}

async function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(data || "{}"));
      } catch {
        resolve({});
      }
    });
  });
}

async function askOpenAI(messages) {
  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
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
    // Return a readable string—API won’t 500
    return `⚠️ OpenAI request failed: ${err.message}`;
  }
}

// ---------- route handler ----------
export default async function handler(req, res) {
  // CORS (so Thunkable or any frontend can call it)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const isGet = req.method === "GET";
  const body = isGet ? {} : await readBody(req);

  const message = isGet ? (req.query.message || "") : (body.message || "");
  const tier =
    ((isGet ? req.query.tier : body.tier) || "free").toString().toLowerCase();

  if (!message) return res.status(400).json({ error: "No message given" });

  // Filter tips by tier permission
  const allow = tierRank(tier);
  const pool = (Array.isArray(tips) ? tips : []).filter(
    (t) => tierRank((t.tier || "free").toLowerCase()) <= allow
  );

  // Simple retrieval: match on question text or tags
  const q = message.toLowerCase();
  const matches = pool
    .filter(
      (t) =>
        (t.q || "").toLowerCase().includes(q) ||
        (Array.isArray(t.tags) ? t.tags.join(" ") : "")
          .toLowerCase()
          .includes(q)
    )
    .slice(0, 3);

  // Hazard flag triggers a CAUTION block
  const hazard = /(\b3[0-9]\b|\b30\b).*k|thunder|squall|gale|storm|lightning|MOB/i.test(
    message
  );

  // If we have a local tip and no OpenAI key, just format the tip cleanly
  if (matches.length > 0 && !process.env.OPENAI_API_KEY) {
    const tip = matches[0];
    const text = tip.a_steps || tip.text || "";
    const steps = extractSteps(text);
    if (hazard) steps.push("CAUTION: Consider conditions and crew safety.");
    return res.status(200).json({
      reply: steps,
      tips: matches.map((t) => ({ id: t.id, q: t.q })),
      tier,
      note: "OPENAI_API_KEY not set, returned local tip only.",
    });
  }

  // Build prompts for OpenAI (if key exists)
  const system = `
You are Virtual Craig, an Ionian sailing instructor.
- Answer in short, clear, NUMBERED STEPS only (no long paragraphs).
- Prefer the provided tips; stay within the user's tier.
- If hazardous conditions are mentioned, append a short CAUTION block at the end.
`.trim();

  const context =
    matches.length > 0
      ? "Relevant tips (use these):\n" +
        matches
          .map(
            (t) =>
              `ID:${t.id}\nQ:${t.q}\nSTEPS:${(t.a_steps || t.text || "")
                .replace(/\n+/g, " ")
                .trim()}`
          )
          .join("\n---\n")
      : "No matching tips provided. Give conservative Day Skipper best practice only.";

  let re
