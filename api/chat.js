// /api/chat.js  (reads tips.json and returns matching tips)
import fs from "fs";
import path from "path";

function loadTips() {
  const tipsPath = path.join(process.cwd(), "tips.json"); // tips.json at repo root
  const raw = fs.readFileSync(tipsPath, "utf8");
  return JSON.parse(raw);
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const message = req.method === "GET"
    ? (req.query.message || "")
    : (await readBody(req)).message;

  if (!message) return res.status(400).json({ error: "No message given" });

  const tips = loadTips();
  const q = message.toLowerCase();
  const matches = tips.filter(t =>
    (t.q || "").toLowerCase().includes(q) ||
    (t.tags || []).join(" ").toLowerCase().includes(q)
  ).slice(0, 2);

  return res.status(200).json({
    reply: `Virtual Craig received: "${message}"`,
    tips: matches.map(t => ({ id: t.id, q: t.q, steps: t.a_steps }))
  });
}

async function readBody(req) {
  return new Promise(resolve => {
    let data = "";
    req.on("data", chunk => data += chunk);
    req.on("end", () => {
      try { resolve(JSON.parse(data || "{}")); }
      catch { resolve({}); }
    });
  });
}
