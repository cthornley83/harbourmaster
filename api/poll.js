// api/poll.js
const admin = require("firebase-admin");

let app;
function getApp() {
  if (app) return app;
  const svc = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  app = admin.initializeApp({
    credential: admin.credential.cert(svc),
    databaseURL: process.env.FIREBASE_DB_URL,
  });
  return app;
}

module.exports = async (req, res) => {
  try {
    const db = getApp().database();

    // 1) Read the question Thunkable wrote
    const snap = await db.ref("hm_debug").once("value");
    const question = snap.val();
    if (!question) return res.status(200).json({ status: "idle" });

    // 2) Placeholder answer (swap with your RAG later)
    const answer = `Virtual Craig: ${question}`;

    // 3) Write back to Firebase for Thunkable to display
    await db.ref("hm_answer").set(answer);
    // optional: clear the question after processing
    // await db.ref("hm_debug").set(null);

    res.status(200).json({ status: "ok", question, answer });
  } catch (e) {
    console.error(e);
    res.status(500).json({ status: "error", error: String(e) });
  }
};
