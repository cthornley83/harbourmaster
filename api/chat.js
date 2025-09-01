import tips from "../tips.json" assert { type: "json" };

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const message = req.method === "GET"
    ? (req.query.message || "")
    : (await readBody(req)).message;

  if (!message) {
    return res.status(400).json({ error: "No message given" });
  }

  // Simple keyword match search against tips
  const q = message.toLowerCase();
  const matches = tips.filter(
    t => t.q.toLowerCase().includes(q) ||
         (t.tags && t.tags.join(" ").toLowerCase().includes(q))
  );

  // Take top 1–2 tips
  const results = matches.slice(0, 2);

  if (results.length === 0) {
    return res.status(200).json({
      reply: `Virtual Craig received: "${message}". No specific tip found, but keep it simple and safe.`,
      tips: []
    });
  }

  return res.status(200).json({
    reply: `Virtual Craig received: "${message}"`,
    tips: results.map(t => ({ id: t.id, q: t.q, steps: t.a_steps }))
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
