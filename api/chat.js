export default async function handler(req, res) {
  // Allow calls from your app
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  // Read message (from GET or POST)
  const message = req.method === "GET"
    ? (req.query.message || "")
    : (await readBody(req)).message;

  if (!message) {
    return res.status(400).json({ error: "No message given" });
  }

  // Simple test reply (we’ll connect to OpenAI next)
  return res.status(200).json({
    reply: `Virtual Craig received: "${message}"`,
    tips: ["T001", "T045"]
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
