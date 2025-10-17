import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load schema
const schemaData = JSON.parse(
  readFileSync(join(__dirname, '../schemas/qna_schema_v1.json'), 'utf8')
);

const ajv = new Ajv({ allErrors: true, strict: true });
addFormats(ajv);
const validate = ajv.compile(schemaData);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function handler(req, res) {
  console.log("[CODA_INGEST] Received transcript");
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { transcript } = req.body;
  
  if (!transcript) {
    return res.status(400).json({ error: 'Missing transcript' });
  }

  try {
    // 1. Clean with GPT
    console.log("[CODA_INGEST] Calling GPT to clean...");
    const completion = await openai.chat.completions.create({
      model: process.env.CLEANER_MODEL || 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are the Harbourmaster Cleaner. Convert voice transcripts into strict JSON matching this schema:
{
  "harbour_id": "uuid-of-harbour",
  "harbour_name": "Name",
  "question": "Full question",
  "answer": "Numbered answer (1. 2. 3.)",
  "category": "Mooring|Weather|Safety|Facilities|Navigation|Anchoring|Costs",
  "tags": ["tag1", "tag2"],
  "tier": "free|pro|exclusive",
  "notes": null
}

CRITICAL RULES:
- tier must be lowercase: "free", "pro", or "exclusive"
- category must be exact: "Mooring", "Weather", "Safety", "Facilities", "Navigation", "Anchoring", or "Costs"
- answer must have numbered steps if tier is "pro" or "exclusive"
- harbour_id will be looked up separately, use placeholder for now
- Return ONLY valid JSON, no markdown`
        },
        { role: 'user', content: transcript }
      ],
      temperature: 0.3
    });

    const cleaned = JSON.parse(completion.choices[0].message.content);
    console.log("[CODA_INGEST] Cleaned:", cleaned.harbour_name);

    // 2. Lookup harbour_id
    const { data: harbour, error: harbourError } = await supabase
      .from('harbours')
      .select('id')
      .ilike('name', cleaned.harbour_name)
      .single();

    if (harbourError || !harbour) {
      return res.status(404).json({
        error: 'Harbour not found',
        harbour_name: cleaned.harbour_name
      });
    }

    cleaned.harbour_id = harbour.id;

    // 3. Validate against schema
    if (!validate(cleaned)) {
      console.error("[CODA_INGEST] Validation errors:", validate.errors);
      return res.status(422).json({
        error: 'Schema validation failed',
        details: validate.errors
      });
    }

    // 4. Insert to Supabase
    console.log("[CODA_INGEST] Inserting to Supabase...");
    const { data, error } = await supabase
      .from('harbour_qna')
      .insert(cleaned)
      .select()
      .single();

    if (error) {
      console.error("[CODA_INGEST] Supabase error:", error);
      throw error;
    }

    console.log("[CODA_INGEST] ✅ Success! ID:", data.id);

    return res.status(200).json({
      status: 'ok',
      id: data.id,
      cleaned: cleaned
    });

  } catch (err) {
    console.error("[CODA_INGEST] Error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
