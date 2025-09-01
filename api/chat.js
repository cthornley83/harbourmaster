// api/chat.js – uses tips.json + OpenAI

import fs from "fs";
import path from "path";

function loadTips() {
  const tipsPath = path.join(process.cwd(), "tips.json");
  const raw = fs.readFileSync(tipsPath, "utf8");
  return JSON.parse(raw);
}

async function askOpenAI(messages) {
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
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

  const j = await resp.json();
  if (!j.choices) throw new Error("OpenAI error: " + JSON.stringify(j));
  return j.choices[0].message.content.trim();
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const message = req.query.message || (await readBody(req)).message;
  if (!message) return res.status(400).json({ error: "No message" });

  const tips = loadTips();

  // Find matching tips
  const matches = tips.filter(t =>
    t.question.toLowerCase().includes(message.toLowerCase()) ||
    (t.tags && t.tags.join(" ").toLowerCase().includes(message.toLowerCase()))
  );

  // Pick up to 2 tips
  const selected = matches.slice(0, 2);

  let systemPrompt = "You are Virtual Craig, an Ionian sailing instructor. Answer clearly, in numbered steps, like a practical sailing checklist.";

  let userPrompt = "The user asked: " + message + "\n\n";
  if (selected.length > 0) {
    userPrompt += "Here are reference tips:\n";
    selected.forEach((t, i) => {
      userPrompt += `${i + 1}. ${t.answer}\n`;
    });
  } else {
    userPrompt += "No specific tips found. Give your best sailing advice.";
  }

  const reply = await askOpenAI([
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ]);

  res.status(200).json({ reply, tips: selected.map(t => t.id) });
}

async function readBody(req) {
  return new Promise(resolve => {
    let data = "";
    req.on("data", chunk => data += chunk);
    req.on("end", () => resolve(JSON.parse(data || "{}")));
  });
}
