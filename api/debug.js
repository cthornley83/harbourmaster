export default async function handler(req, res) {
  try {
    let body = req.body;

    // If body is a string, try to parse it
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        // leave it as string if not JSON
      }
    }

    // If still undefined, fall back to query param
    if (!body) {
      body = req.query || "No body received";
    }

    res.status(200).json({
      method: req.method,
      headers: req.headers,
      received: body
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
