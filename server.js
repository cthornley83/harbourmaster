import express from "express";
import cors from "cors";

import pingHandler from "./api/ping.js";
import chatHandler from "./api/chat.js";
import embedHandler from "./api/embed.js";
import matchHandler from "./api/match.js";
import ttsHandler from "./api/tts.js";

const app = express();

/* ──────────────────────────────────────────────
   UNIVERSAL MIDDLEWARE
   Parses every possible format FlutterFlow might send
   ────────────────────────────────────────────── */
app.use(cors());
app.options("*", cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));
app.use(express.text({ type: "*/*", limit: "2mb" }));
app.use(express.raw({ type: "*/*", limit: "2mb" }));

/* ──────────────────────────────────────────────
   NORMAL ROUTES
   ────────────────────────────────────────────── */
app.get("/api/ping", pingHandler);
app.post("/api/chat", chatHandler);
app.post("/api/embed", embedHandler);
app.post("/api/match", matchHandler);
app.post("/api/tts", ttsHandler);

/* ──────────────────────────────────────────────
   TEST ENDPOINT (for FlutterFlow debugging)
   ────────────────────────────────────────────── */
app.post("/api/testbody", (req, res) => {
  console.log("🧪 TEST BODY RECEIVED:", req.body);

  // Mirror back what was received so you can see it in FlutterFlow's response
  res.status(200).json({
    message: "Body received successfully!",
    received: req.body,
    headers: req.headers["content-type"] || "none",
  });
});

/* ──────────────────────────────────────────────
   SERVER START
   ────────────────────────────────────────────── */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
