export default async function handler(req, res) {
  console.log("DEBUG HEADERS:", req.headers);
  console.log("DEBUG RAW BODY:", req.body);

  res.status(200).json({
    headers: req.headers,
    body: req.body
  });
}
