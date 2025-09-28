export default async function handler(req, res) {
  try {
    let rawBody = req.body;

    // If body is empty, use query params
    if (!rawBody) {
      return res.status(200).json({
        note: "No body received — falling back to query params",
        query: req.query,
        method: req.method,
        headers: req.headers
      });
    }

    // If body is a string, try parsing
    let parsedBody = rawBody;
    if (typeof rawBody === "string") {
      try {
        parsedBody = JSON.parse(rawBody);
      } catch {
        parsedBody = { raw: rawBody };
      }
    }

    res.status(200).json({
      received: parsedBody,
      method: req.method,
      headers: req.headers
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
