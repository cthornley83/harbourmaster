import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
import Ajv from 'ajv';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Load schema
const schemaPath = join(__dirname, '../schemas/qna_schema_v1.json');
const qnaSchema = JSON.parse(readFileSync(schemaPath, 'utf8'));
const ajv = new Ajv({ allErrors: true, strict: true });
const validateSchema = ajv.compile(qnaSchema);

export default async (req, res) => {
  console.log('[CODA_INGEST] Received transcript');

  try {
    const { transcript, coda_row_id } = req.body;

    if (!transcript || transcript.trim() === '') {
      return res.status(400).json({
        status: 'error',
        error_type: 'missing_transcript',
        message: 'Transcript is required'
      });
    }

    // === STEP 1: GPT Cleaning ===
    const cleaningPrompt = `You are the Harbourmaster Cleaner+Tagger.
Convert this voice transcript into strict JSON.

Required JSON structure:
{
  "harbour_name": "string",
  "question": "string", 
  "answer": "string (numbered steps if procedural)",
  "category": "one of: Mooring, Navigation, Amenities, Services, Weather, Costs, Safety, General",
  "tags": ["array", "of", "lowercase-hyphenated-tags"],
  "tier": "free" or "pro" or "exclusive" (lowercase only),
  "notes": "string or null"
}

Rules:
- Extract harbour name exactly as mentioned
- Question should be clear and complete
- Answer must be detailed
- If answer has steps, number them
- Tags: 2-6 relevant keywords, lowercase, hyphenated
- Tier: default to "free"

Transcript:
${transcript}

Return ONLY valid JSON, no markdown.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: cleaningPrompt }],
      temperature: 0.1,
      response_format: { type: 'json_object' }
    });

    const cleaned = JSON.parse(completion.choices[0].message.content);
    console.log('[CODA_INGEST] Cleaned:', cleaned.harbour_name);

    // === STEP 2: Harbour Lookup ===
    const { data: harbours } = await supabase
      .from('harbours')
      .select('id, name')
      .ilike('name', cleaned.harbour_name.trim());

    if (!harbours || harbours.length === 0) {
      return res.status(404).json({
        status: 'error',
        error_type: 'harbour_not_found',
        harbour_name: cleaned.harbour_name,
        message: 'Harbour not found in database'
      });
    }

    const harbour_id = harbours[0].id;

    // === STEP 3: Build Payload ===
    const payload = {
      harbour_id,
      question: cleaned.question.trim(),
      answer: cleaned.answer.trim(),
      category: cleaned.category.trim(),
      tags: cleaned.tags.map(t => t.trim().toLowerCase()),
      tier: (cleaned.tier || 'free').toLowerCase(),
      notes: cleaned.notes || null,
      source: 'coda_import',
      metadata: { coda_row_id }
    };

    // === STEP 4: Validate Schema ===
    const isValid = validateSchema(payload);
    if (!isValid) {
      return res.status(400).json({
        status: 'error',
        error_type: 'schema_validation',
        errors: validateSchema.errors
      });
    }

    // === STEP 5: Insert to Supabase ===
    const { data: inserted, error: insertError } = await supabase
      .from('harbour_qna')
      .insert(payload)
      .select()
      .single();

    if (insertError) {
      throw insertError;
    }

    // === SUCCESS ===
    return res.status(200).json({
      status: 'success',
      id: inserted.id,
      harbour_name: cleaned.harbour_name,
      question: cleaned.question,
      answer: cleaned.answer,
      category: cleaned.category,
      tags: cleaned.tags,
      tier: cleaned.tier,
      coda_row_id
    });

  } catch (error) {
    console.error('[CODA_INGEST] Error:', error);
    return res.status(500).json({
      status: 'error',
      error_type: 'system_error',
      message: error.message
    });
  }
};
