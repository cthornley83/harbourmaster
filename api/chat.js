// api/chat.js
module.exports = async function (req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST allowed" });
  }

  return res.status(200).json({
    message: "Chat endpoint is alive",
    body: req.body || null,
  });
};

