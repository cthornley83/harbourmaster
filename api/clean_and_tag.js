// /api/clean_and_tag.js
// Express route handler: Wispr Flow/Zapier → Render → Supabase
// Purpose: Clean + tag transcript into locked JSON, validate with Ajv, insert into harbour_questions
// Version: 1.1 (Production-Ready)
// Last Updated: 2025-10-16

import Ajv from "ajv";
import addFormats from "ajv-formats";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// ============================================================================
// INITIALIZATION
// ============================================================================

// Load schema via fs (not experimental import assertion)
const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaData = JSON.parse(
  readFileSync(join(__dirname, '../schemas/qna_schema_v1.json'), 'utf8')
);

const ajv = new Ajv({ allErrors: true, strict: true });
addFormats(ajv);
const validate = ajv.compile(schemaData);

// Initialize OpenAI
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Initialize Supabase (supports both service role and anon key)
const supabase = createClient(
  process.env.SUPABASE_URL, 
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.service_role || process.env.SUPABASE_ANON_KEY
);

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

// Helper: safe string trim
const s = (v) => (typeof v === "string" ? v.trim() : v);

// Helper: count sentences (naive but sufficient)
const sentenceCount = (text) => {
  const trimmed = s(text);
  if (!trimmed) return 0;
  const matches = trimmed.match(/[.!?]\s/g) || [];
  const endsWithPunctuation = /[.!?]$/.test(trimmed);
  return matches.length + (endsWithPunctuation ? 1 : 0);
};

// ============================================================================
// MAIN HANDLER
// ============================================================================

async function handler(req, res) {
  const startTime = Date.now();
  
  console.log('[CLEAN_TAG] Starting processing...');
  
  try {
    // ========================================================================
    // STEP 1: VALIDATE INPUT
    // ========================================================================
    
    const { transcript, source = "unknown" } = req.body;
    
    if (!transcript || typeof transcript !== "string") {
      console.log('[CLEAN_TAG] ❌ Missing or invalid transcript');
      return res.status(400).json({ 
        error: "Missing or invalid 'transcript' field" 
      });
    }
    
    console.log('[CLEAN_TAG] Transcript received:', transcript.substring(0, 100) + '...');

    // ========================================================================
    // STEP 2: CALL OPENAI TO CLEAN & STRUCTURE
    // ========================================================================
    
    console.log('[CLEAN_TAG] Calling OpenAI...');
    
    const systemPrompt = `You are the Harbourmaster Q&A Cleaner.
Convert the following spoken transcript into strict JSON matching this schema:

{
  "harbour": "string (harbour name, e.g., 'Kioni')",
  "question": "string (clear question)",
  "answer": "string (detailed answer, numbered steps for pro/exclusive tier)",
  "category": "string (EXACTLY one of: Mooring, Anchoring, Facilities & Services, Navigation & Approach, Weather & Conditions, Safety & Regulations, Provisioning & Supplies, Local Knowledge, Emergency & Support)",
  "tags": ["array of strings with domain:value format, e.g., 'mooring:stern_to', 'anchor:depth_3_6m'"],
  "tier": "string (lowercase: 'free', 'pro', or 'exclusive')",
  "notes": null
}

CRITICAL RULES:
1. Category MUST match exactly (case-sensitive)
2. Tags MUST have domain prefix (e.g., 'mooring:stern_to', NOT 'stern-to')
3. Tier MUST be lowercase ('free', 'pro', 'exclusive')
4. If tier is 'pro' or 'exclusive', answer MUST have numbered steps (1. 2. 3. etc.)
5. If tier is 'free', simple answer is OK
6. Do not add any fields not in schema
7. Return ONLY valid JSON, no markdown, no explanations

Transcript:`;

    const completion = await openai.chat.completions.create({
      model: process.env.CLEANER_MODEL || "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: transcript }
      ],
      temperature: 0.3,
      max_tokens: 1000
    });

    const rawResponse = completion.choices[0]?.message?.content || "{}";
    const tokensUsed = completion.usage?.total_tokens || 0;
    
    console.log('[CLEAN_TAG] OpenAI response received, tokens used:', tokensUsed);

    // ========================================================================
    // STEP 3: PARSE JSON
    // ========================================================================
    
    let cleaned;
    try {
      // Remove markdown code blocks if present
      const jsonText = rawResponse.replace(/```json\s*/g, '').replace(/```\s*/g, '');
      cleaned = JSON.parse(jsonText);
      console.log('[CLEAN_TAG] JSON parsed successfully');
    } catch (parseErr) {
      console.error('[CLEAN_TAG] ❌ JSON parse error:', parseErr.message);
      return res.status(500).json({ 
        error: "Failed to parse OpenAI response as JSON",
        raw: rawResponse.substring(0, 200)
      });
    }

    // ========================================================================
    // STEP 4: SCHEMA VALIDATION
    // ========================================================================
    
    console.log('[CLEAN_TAG] Validating against schema...');
    
    const valid = validate(cleaned);
    
    if (!valid) {
      console.error('[CLEAN_TAG] ❌ Schema validation failed');
      console.error('[CLEAN_TAG] Errors:', JSON.stringify(validate.errors, null, 2));
      
      return res.status(422).json({ 
        error: "Schema validation failed",
        validation_errors: validate.errors,
        cleaned: cleaned
      });
    }
    
    console.log('[CLEAN_TAG] ✅ Schema validation passed');

    // ========================================================================
    // STEP 5: ADDITIONAL VALIDATION (Pro Tier Steps)
    // ========================================================================
    
    if ((cleaned.tier === "pro" || cleaned.tier === "exclusive")) {
      const hasNumberedSteps = /\d+\.\s/.test(cleaned.answer);
      if (!hasNumberedSteps) {
        console.error('[CLEAN_TAG] ❌ Pro tier missing numbered steps');
        return res.status(422).json({
          error: "Pro tier requires numbered steps (1. 2. 3. etc.)",
          cleaned: cleaned
        });
      }
    }

    // ========================================================================
    // STEP 6: INSERT TO SUPABASE
    // ========================================================================
    
    console.log('[CLEAN_TAG] Inserting to Supabase...');
    
    const { data, error: insertError } = await supabase
  .from('harbour_questions')
  .insert({
    harbour_name: cleaned.harbour, 
    question: cleaned.question,
    answer: cleaned.answer,
    category: cleaned.category,
    tags: cleaned.tags,
    tier: cleaned.tier,
    notes: cleaned.notes,
    source: source
  })
      .select('id')
      .single();

    if (insertError) {
      console.error('[CLEAN_TAG] ❌ Supabase insert error:', insertError);
      return res.status(500).json({ 
        error: "Database insert failed",
        details: insertError.message 
      });
    }

    console.log('[CLEAN_TAG] ✅ Inserted successfully, ID:', data.id);

    // ========================================================================
    // STEP 6.5: TRIGGER EMBEDDING GENERATION (Non-blocking)
    // ========================================================================
    
    console.log('[CLEAN_TAG] Triggering embedding generation...');
    
    try {
      const embeddingResponse = await fetch(`${process.env.RENDER_URL}/api/embed`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-API-Key': process.env.INTERNAL_API_KEY
        },
        body: JSON.stringify({ 
          text: `${cleaned.question} ${cleaned.answer}`,
          harbour_name: cleaned.harbour
        })
      });

      if (!embeddingResponse.ok) {
        console.error('[CLEAN_TAG] ⚠️ Embedding generation failed (non-fatal)');
      } else {
        console.log('[CLEAN_TAG] ✅ Embedding generation triggered');
      }
    } catch (embErr) {
      console.error('[CLEAN_TAG] ⚠️ Embedding trigger error:', embErr.message);
      // Don't fail - embedding can be regenerated via /api/embed endpoint or cron job
    }

    // ========================================================================
    // STEP 7: RETURN SUCCESS RESPONSE
    // ========================================================================

    const duration = Date.now() - startTime;
    
    console.log('[CLEAN_TAG] ✅ COMPLETE - Duration:', duration, 'ms');

    return res.status(200).json({ 
      status: "ok", 
      id: data.id, 
      cleaned: {
        harbour: cleaned.harbour,
        question: cleaned.question,
        answer: cleaned.answer,
        category: cleaned.category,
        tags: cleaned.tags,
        tier: cleaned.tier
      },
      metadata: {
        tokens_used: tokensUsed,
        duration_ms: duration,
        source: source
      }
    });

  } catch (err) {
    // Catch-all error handler
    const duration = Date.now() - startTime;
    
    console.error('[CLEAN_TAG] ❌ UNHANDLED ERROR');
    console.error('[CLEAN_TAG] Error:', err);
    console.error('[CLEAN_TAG] Stack:', err.stack);
    
    return res.status(500).json({ 
      error: "Unhandled server error", 
      message: err?.message,
      duration_ms: duration
    });
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export default handler;
