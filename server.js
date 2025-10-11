import express from "express";
import pingHandler from "./api/ping.js";
import chatHandler from "./api/chat.js";
import embedHandler from "./api/embed.js";
import matchHandler from "./api/match.js";
import ttsHandler from "./api/tts.js";

const app = express();
app.use(express.json());

// Wire up all routes
app.get("/api/ping", pingHandler);
app.post("/api/chat", chatHandler);
app.post("/api/embed", embedHandler);
app.post("/api/match", matchHandler);
app.post("/api/tts", ttsHandler);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
