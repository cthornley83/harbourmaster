import express from "express";
import pingHandler from "./api/ping.js"; // adjust if paths differ

const app = express();

// simple ping route (you can add /api/chat, /api/embed, etc. later)
app.get("/api/ping", (req, res) => pingHandler(req, res));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
