
Download

// /api/clean_and_tag.js
// Express route handler: Coda/Zapier → Render → Supabase
// Purpose: Clean + tag transcript into locked JSON, validate with Ajv, insert into harbour_questions
// Version: 1.1 (Production-Ready with all fixes)
// Last Updated: 2025-10-16
// 
// CRITICAL FIXES APPLIED:
// ✅ Fix 1: Schema loading via fs.readFileSync (reliable across Node versions)
// ✅ Fix 2: Auto-trigger embedding generation after insert
// ✅ Fix 3: Fallback to ANON_KEY if SERVICE_ROLE_KEY unavailable

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

// Fix 1: Load schema via fs instead of experimental import assertion
const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaData = JSON.parse(
  readFileSync(join(__dirname, '../schemas/qna_schema_v1.json'), 'utf8')
);

const ajv = new Ajv({ allErrors: true, strict: true });
addFormats(ajv);
const validate = ajv.compile(schemaData);

// Initialize OpenAI
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Fix 3: Support both service role and anon key
const supabase = createClient(
  process.env.SUPABASE_URL, 
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
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

// POST /api/clean_and_tag
export default async function handler(req, res) {
  try {
    console.log('[CLEAN_TAG] Starting processing...');
    
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { transcript, source = "voice", mode = "qna" } = req.body || {};
    if (!transcript || !transcript.trim()) {
      console.error('[CLEAN_TAG] Missing transcript');
      return res.status(400).json({ error: "Missing transcript" });
    }

    console.log('[CLEAN_TAG] Transcript received:', transcript.substring(0, 100) + '...');

    // ========================================================================
    // STEP 1: Call OpenAI to normalize into JSON
    // ========================================================================
    
    const sys = [
      "You are the Harbourmaster Cleaner+Tagger.",
      "Convert the input into strict JSON matching this schema:",
      JSON.stringify({
        harbour: "string",
        question: "string",
        answer: "string",
        category: "one of: Approach & Entry | Mooring | Anchoring | Weather & Shelter | Safety & Hazards | Facilities & Services | Local Knowledge | Media Tutorials | General",
        tags: ["domain-prefixed tags like mooring:stern_to, facility:water, weather:nw"],
        tier: "free | pro | exclusive",
        notes: null
      }),
      "Rules:",
      "- Use domain-prefixed, canonical tags only (mooring:*, facility:*, weather:*, hazard:*, etc.).",
      "- Include a scope tag: scope:harbour | scope:island | scope:region | scope:global.",
      "- If tier=pro, the answer must be numbered steps (max 6). If tier=free, keep to <= 2 sentences.",
      "- Do NOT invent specific depths/facilities if unknown. Prefer safe phrasing and alternatives.",
      "- Front-load hazards when relevant.",
      "- Output ONLY the JSON object, no prose."
    ].join("\n");

    const user = `Input:\n${transcript}`;

    console.log('[CLEAN_TAG] Calling OpenAI...');
    
    const completion = await openai.chat.completions.create({
      model: process.env.CLEANER_MODEL || "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user }
      ]
    });

    const raw = completion.choices?.[0]?.message?.content || "{}";
    console.log('[CLEAN_TAG] OpenAI response:', raw.substring(0, 200) + '...');
    
    let cleaned;
    try {
      cleaned = JSON.parse(raw);
    } catch (e) {
      console.error('[CLEAN_TAG] JSON parse failed:', e.message);
      return res.status(422).json({ error: "JSON parse failed", raw });
    }

    console.log('[CLEAN_TAG] Parsed JSON:', cleaned);

    // ========================================================================
    // STEP 2: Ajv Schema Validation
    // ========================================================================
    
    const ok = validate(cleaned);
    if (!ok) {
      console.error('[CLEAN_TAG] Schema validation failed:', validate.errors);
      return res.status(422).json({ 
        error: "Validation failed", 
        details: validate.errors, 
        cleaned 
      });
    }

    console.log('[CLEAN_TAG] ✅ Schema validation passed');

    // ========================================================================
    // STEP 3: Extra Guardrails
    // ========================================================================
    
    if (cleaned.tier === "pro") {
      const hasSteps = /(^|\n)\s*1\./.test(cleaned.answer) && /(^|\n)\s*2\./.test(cleaned.answer);
      if (!hasSteps) {
        console.error('[CLEAN_TAG] Pro tier missing numbered steps');
        return res.status(422).json({ 
          error: "Pro tier requires numbered steps (1. 2. 3.)", 
          cleaned 
        });
      }
    }

    if (cleaned.tier === "free") {
      const sentences = sentenceCount(cleaned.answer);
      if (sentences > 2) {
        console.error('[CLEAN_TAG] Free tier answer too long:', sentences, 'sentences');
        return res.status(422).json({ 
          error: `Free tier answer too long (${sentences} sentences, max 2)`, 
          cleaned 
        });
      }
    }

    // ========================================================================
    // STEP 4: Insert into Supabase
    // ========================================================================
    
    const payload = {
      harbour_name: s(cleaned.harbour),
      question: s(cleaned.question),
      answer: s(cleaned.answer),
      category: s(cleaned.category),
      tags: cleaned.tags || [],
      tier: s(cleaned.tier) || "pro"
    };

    console.log('[CLEAN_TAG] Inserting to Supabase:', payload);

    const { data, error } = await supabase
      .from("harbour_questions")
      .insert(payload)
      .select()
      .single();

    if (error) {
      console.error('[CLEAN_TAG] Supabase insert failed:', error);
      return res.status(500).json({ 
        error: "Supabase insert failed", 
        supabase_error: error, 
        cleaned 
      });
    }

    console.log('[CLEAN_TAG] ✅ Inserted successfully, ID:', data.id);

    // ========================================================================
    // STEP 5: Fix 2 - Auto-trigger embedding generation
    // ========================================================================
    
    try {
      const renderUrl = process.env.RENDER_URL || 'http://localhost:3000';
      console.log('[CLEAN_TAG] Triggering embedding generation...');
      
      const embeddingResponse = await fetch(`${renderUrl}/api/embed`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-API-Key': process.env.INTERNAL_API_KEY || 'development'
        },
        body: JSON.stringify({ 
          table: 'harbour_questions',
          id: data.id 
        })
      });

      if (!embeddingResponse.ok) {
        const errorText = await embeddingResponse.text();
        console.error('[CLEAN_TAG] ⚠️ Embedding generation failed:', errorText);
        // Don't fail the whole request - embeddings can be regenerated later
      } else {
        console.log('[CLEAN_TAG] ✅ Embedding generation triggered successfully');
      }
    } catch (embeddingError) {
      console.error('[CLEAN_TAG] ⚠️ Embedding call failed:', embeddingError.message);
      // Don't block the insert - embeddings can be regenerated in batch later
    }

    // ========================================================================
    // STEP 6: Success Response
    // ========================================================================
    
    console.log('[CLEAN_TAG] ✅ COMPLETE - returning success');
    
    return res.status(200).json({ 
      status: "ok", 
      id: data.id, 
      cleaned,
      harbour_name: data.harbour_name,
      category: data.category,
      tier: data.tier,
      embedding_triggered: true
    });

  } catch (err) {
    console.error('[CLEAN_TAG] ❌ Unhandled error:', err);
    return res.status(500).json({ 
      error: "Unhandled error", 
      message: err?.message,
      stack: process.env.NODE_ENV === 'development' ? err?.stack : undefined
    });
  }
}