// /api/normalize.js

// find the first non-empty answer string in common shapes
function extractAnswer(obj) {
  const paths = [
    ['answer'], ['content'], ['result'], ['output'],
    ['data','answer'], ['data','content'],
    ['choices',0,'message','content'], ['choices',0,'text'],
    ['message','content'], ['response','answer'], ['response','content'],
  ];
  for (const p of paths) {
    let cur = obj;
    for (const k of p) cur = Array.isArray(cur) && typeof k === 'number' ? cur[k] : cur?.[k];
    if (typeof cur === 'string' && cur.trim()) return cur.trim();
  }
  const q = [obj];
  while (q.length) {
    const x = q.shift();
    if (typeof x === 'string' && x.trim()) return x.trim();
    if (x && typeof x === 'object') {
      if (Array.isArray(x)) q.push(...x);
      else for (const k in x) q.push(x[k]);
    }
  }
  return null;
}

export default async function handler(req, res) {
  // CORS for Thunkable
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ status: 'error', error: 'Use POST' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});

    // Decide where to call: prefer env var you already set; else default to your chat route
    const ragPath = process.env.RAG_ENDPOINT_PATH || '/api/chat';
    const base = `https://${req.headers.host}`;
    const ragUrl = ragPath.startsWith('http') ? ragPath : `${base}${ragPath}`;

    let data = body;

    // If client sends {prompt}, call your RAG route; otherwise just normalize the given JSON
    if (!('answer' in body) && ('prompt' in body)) {
      const r = await fetch(ragUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: body.prompt })
      });
      if (!r.ok) {
        return res.json({ status: 'error', error: `RAG ${r.status}`, sample: await r.text() });
      }
      try { data = await r.json(); }
      catch { data = { raw: await r.text() }; }
    }

    const answer = extractAnswer(data);
    if (!answer) {
      return res.json({ status: 'error', error: 'No answer field found', sample: JSON.stringify(data).slice(0, 600) });
    }
    return res.json({ status: 'ok', answer: String(answer) });
  } catch (e) {
    return res.json({ status: 'error', error: String(e) });
  }
}

