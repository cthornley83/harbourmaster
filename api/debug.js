import fs from "fs";
import path from "path";

export default async function handler(req, res) {
  const hasKey = Boolean(process.env.OPENAI_API_KEY);

  let tipsOk = false, tipsCount = 0, tipSample = null, tipsErr = null;
  try {
    const p = path.join(process.cwd(), "tips.json");
    const raw = fs.readFileSync(p, "utf8");
    const tips = JSON.parse(raw);
    tipsOk = Array.isArray(tips);
    tipsCount = tips.length || 0;
    tipSample = tips[0] || null;
  } catch (e) {
    tipsErr = e.message || String(e);
  }

  res.setHeader("Access-Control-Allow-Origin", "*");
  return res.status(200).json({
    env: { OPENAI_API_KEY_present: hasKey },
    tips: { readable: tipsOk, count: tipsCount, sample: tipSample, error: tipsErr },
    node_version: process.version
  });
}
