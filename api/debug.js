// api/debug.js
// Simple test endpoint to check Vercel API routing

module.exports = async function (req, res) {
  return res.status(200).json({
    message: "Debug endpoint is working",
    method: req.method,
    url: req.url,
    body: req.body || null,
  });
};
