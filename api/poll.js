// api/poll.js
// Reads hm_debug from Firebase -> calls your RAG endpoint (chat/embed/match) -> writes hm_answer

const admin = require("firebase-admin");

// ---------- Firebase Admin singleton ----------
let app;
function getApp() {
  if (app) return app;
  const svc = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "{}");
  if (!svc.project_id) throw new Error("Missing FIREBASE_SERVICE_ACCOUNT env var (JSON).");
  const dbURL = process.env.FIREBASE_DB_URL;
  if (!dbURL) throw new Error("Missing FIREBASE_DB_URL env var.");
  app = admin.initializeApp({ credential: admin.credential.cert(svc), databaseURL: dbURL });
  return app;
}

// ---------- Helpers ----------
function baseUrl() {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL;             // e.g. https://harbourmaster-ashen.vercel.app
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "https://harbourmaster-ashen.vercel.app";                                 // fallback
}

// Try a POST to a given path with a given payload key, return parsed text if it works
async function tryRagPath(path, payloadKey, question) {
  const body = {}; body[payloadKey] = question;
  const res = await fetch(`${baseUrl()}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  const json = await res.json().catch(() => ({}));

  // Common shapes: {answer}, {text}, OpenAI chat {choices[0].message.content}, or string
  const txt =
    json.answer ??
    json.text ??
    (json.output && (typeof json.output === "string" ? json.output : json.output.text)) ??
    (json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content) ??
    (typeof json === "string" ? json : JSON.stringify(json));
  return String(txt || "").trim();
}

async function callRag(question) {
  // 1) If user specified, honor it
  const explicitPath = process.env.RAG_ENDPOINT_PATH;   // e.g. "/api/chat" | "/api/embed" | "/api/match"
  const explicitKey  = process.env.RAG_PAYLOAD_KEY || "q";
  if (explicitPath) {
    return await tryRagPath(explicitPath, explicitKey, question);
  }

  // 2) Otherwise try sensible defaults in order:
  //    /api/chat expects {q}, /api/embed expects {input}, /api/match expects {q}
  const tries = [
    { path: "/api/chat",  key: "q"     },
    { path: "/api/embed", key: "input" },
    { path: "/api/match", key: "q"     },
  ];

  let lastError;
  for (const t of tries) {
    try {
      return await tryRagPath(t.path, t.key, question);
    } catch (e) {
      lastError = e;
      // keep trying next
    }
  }
  throw new Error(`All RAG paths failed. Last error: ${lastError}`);
}

// ---------- Handler ----------
module.exports = async (req, res) => {
  try {
    const db = getApp().database();

    // Read question from Firebase
    const snap = await db.ref("hm_debug").once("value");
    const questionRaw = snap.val();
    const question = (questionRaw ?? "").toString().trim();
    if (!question) return res.status(200).json({ status: "idle" });

    // Call RAG (chat/embed/match)
    const ragText = await callRag(question);
    const answer = ragText.startsWith("Virtual Craig:") ? ragText : `Virtual Craig: ${ragText}`;

    // Write back
    await db.ref("hm_answer").set(answer);
    await db.ref("hm_debug").set(null); // clear to avoid reprocessing

    return res.status(200).json({ status: "ok", question, answer });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ status: "error", error: String(err) });
  }
};
