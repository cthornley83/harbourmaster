// api/debug.js
module.exports = async function (req, res) {
  return res.status(200).json({
    message: "Debug endpoint is alive",
    timestamp: new Date().toISOString(),
  });
};
