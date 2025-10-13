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
   Works with JSON, raw text, or form-encoded bodies
   ────────────────────────────────────────────── */
app.use(cors());
app.options("*", cors());             // handle browser pre-flight
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));
app.use(express.text({ type: "*/*", limit: "2mb" }));

/* ──────────────────────────────────────────────
   ROUTES
   ────────────────────────────────────────────── */
app.get("/api/ping", pingHandler);
app.post("/api/chat", chatHandler);
app.post("/api/embed", embedHandler);
app.post("/api/match", matchHandler);
app.post("/api/tts", ttsHandler);

/* ──────────────────────────────────────────────
   SERVER START
   ────────────────────────────────────────────── */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
