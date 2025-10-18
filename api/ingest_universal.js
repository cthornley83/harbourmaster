// /api/ingest_universal.js
// Universal ingestion endpoint with intelligent table routing
// Purpose: Accept transcripts from Zapier → detect table type → clean → validate → insert
// Version: 1.0
// Created: 2025-10-18
//
// FEATURES:
// ✅ Keyword prefix detection (QUESTION:, HARBOUR:, WEATHER:, MEDIA:)
// ✅ GPT-4o-mini fallback classification with confidence scoring
// ✅ Table-specific OpenAI cleaning prompts
// ✅ Ajv validation for all 4 table types
// ✅ harbour_id foreign key verification
// ✅ Error logging to validation_errors table
// ✅ Low confidence parking in qna_review_queue
// ✅ Auto-embedding trigger for applicable tables

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

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load all schemas
const qnaSchema = JSON.parse(
  readFileSync(join(__dirname, '../schemas/qna_schema_v1.json'), 'utf8')
);
const harbourSchema = JSON.parse(
  readFileSync(join(__dirname, '../schemas/harbour_schema_v1.json'), 'utf8')
);
const weatherSchema = JSON.parse(
  readFileSync(join(__dirname, '../schemas/weather_schema_v1.json'), 'utf8')
);
const mediaSchema = JSON.parse(
  readFileSync(join(__dirname, '../schemas/media_schema_v1.json'), 'utf8')
);

// Initialize Ajv validators
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

const validators = {
  harbour_questions: ajv.compile(qnaSchema),
  harbours: ajv.compile(harbourSchema),
  harbour_weather_profiles: ajv.compile(weatherSchema),
  harbour_media: ajv.compile(mediaSchema)
};

// Initialize OpenAI
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Initialize Supabase with service role key for admin operations
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

const s = (v) => (typeof v === "string" ? v.trim() : v);

const sentenceCount = (text) => {
  const trimmed = s(text);
  if (!trimmed) return 0;
  const matches = trimmed.match(/[.!?]\s/g) || [];
  const endsWithPunctuation = /[.!?]$/.test(trimmed);
  return matches.length + (endsWithPunctuation ? 1 : 0);
};

// Log validation error to database
async function logValidationError(level, title, errorType, details, transcript, attemptedPayload) {
  try {
    await supabase.from('validation_errors').insert({
      level,
      title,
      error_type: errorType,
      details,
      transcript,
      attempted_payload: attemptedPayload,
      resolved: false
    });
    console.log(`[INGEST] ✅ Logged validation error: ${title}`);
  } catch (err) {
    console.error('[INGEST] ⚠️ Failed to log validation error:', err.message);
  }
}

// Park in review queue
async function parkInReviewQueue(transcript, errorMessage, errorType, validationErrors = null) {
  try {
    const { data, error } = await supabase.from('qna_review_queue').insert({
      transcript,
      error_message: errorMessage,
      error_type: errorType,
      validation_errors: validationErrors,
      status: 'needs_review'
    }).select().single();

    if (error) throw error;

    console.log(`[INGEST] ✅ Parked in review queue: ${data.id}`);
    return data.id;
  } catch (err) {
    console.error('[INGEST] ⚠️ Failed to park in review queue:', err.message);
    return null;
  }
}

// Verify harbour exists and get harbour_id
async function verifyHarbour(harbourName) {
  try {
    const { data, error } = await supabase
      .from('harbours')
      .select('id, name')
      .ilike('name', harbourName)
      .single();

    if (error || !data) {
      console.log(`[INGEST] ⚠️ Harbour not found: ${harbourName}`);
      return null;
    }

    console.log(`[INGEST] ✅ Harbour verified: ${data.name} (${data.id})`);
    return data.id;
  } catch (err) {
    console.error('[INGEST] ⚠️ Harbour verification failed:', err.message);
    return null;
  }
}

// ============================================================================
// TABLE TYPE DETECTION
// ============================================================================

function detectTableTypeByPrefix(transcript) {
  const upper = transcript.trim().toUpperCase();

  if (upper.startsWith('QUESTION:')) {
    return { table: 'harbour_questions', confidence: 1.0, method: 'prefix' };
  }
  if (upper.startsWith('HARBOUR:')) {
    return { table: 'harbours', confidence: 1.0, method: 'prefix' };
  }
  if (upper.startsWith('WEATHER:')) {
    return { table: 'harbour_weather_profiles', confidence: 1.0, method: 'prefix' };
  }
  if (upper.startsWith('MEDIA:')) {
    return { table: 'harbour_media', confidence: 1.0, method: 'prefix' };
  }

  return null;
}

async function classifyTableTypeWithGPT(transcript) {
  try {
    console.log('[INGEST] Using GPT for table type classification...');

    const prompt = `You are a data classifier for the Harbourmaster.ai system.

Analyze the following transcript and determine which database table it should go into.

TABLES:
1. harbour_questions - Q&A about sailing, mooring, facilities, hazards at specific harbours
2. harbours - Master records for harbours (name, location, coordinates, type, general info)
3. harbour_weather_profiles - Weather patterns, shelter analysis, wind directions for harbours
4. harbour_media - Photos, videos, tutorials, diagrams related to harbours

TRANSCRIPT:
${transcript}

Respond in JSON format:
{
  "table": "harbour_questions" | "harbours" | "harbour_weather_profiles" | "harbour_media",
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation"
}`;

    const completion = await openai.chat.completions.create({
      model: process.env.CLEANER_MODEL || "gpt-4o-mini",
      temperature: 0.1,
      messages: [
        { role: "system", content: "You are a precise data classifier. Always output valid JSON." },
        { role: "user", content: prompt }
      ]
    });

    const raw = completion.choices?.[0]?.message?.content || "{}";
    const result = JSON.parse(raw);

    console.log(`[INGEST] GPT classification: ${result.table} (confidence: ${result.confidence})`);
    console.log(`[INGEST] Reasoning: ${result.reasoning}`);

    return {
      table: result.table,
      confidence: parseFloat(result.confidence),
      method: 'gpt',
      reasoning: result.reasoning
    };
  } catch (err) {
    console.error('[INGEST] ⚠️ GPT classification failed:', err.message);
    throw new Error('Table type classification failed');
  }
}

// ============================================================================
// OPENAI CLEANING PROMPTS (Table-Specific)
// ============================================================================

function getCleaningPrompt(tableType) {
  const prompts = {
    harbour_questions: {
      system: [
        "You are the Harbourmaster Cleaner for Q&A entries.",
        "Convert the input into strict JSON matching this schema:",
        JSON.stringify({
          harbour: "string",
          question: "string",
          answer: "string",
          category: "Approach & Entry | Mooring | Anchoring | Weather & Shelter | Safety & Hazards | Facilities & Services | Local Knowledge | Media Tutorials | General",
          tags: ["domain-prefixed tags like mooring:stern_to, facility:water"],
          tier: "free | pro | exclusive",
          notes: null
        }),
        "Rules:",
        "- Use domain-prefixed tags (mooring:*, facility:*, weather:*, hazard:*, anchor:*, scope:*).",
        "- Include a scope tag: scope:harbour | scope:island | scope:region | scope:global.",
        "- If tier=pro, answer must be numbered steps (1. 2. 3.). If tier=free, ≤2 sentences.",
        "- Front-load hazards when relevant.",
        "- Output ONLY the JSON object, no prose."
      ].join("\n")
    },

    harbours: {
      system: [
        "You are the Harbourmaster Cleaner for harbour master records.",
        "Convert the input into strict JSON matching this schema:",
        JSON.stringify({
          name: "string",
          region: "string (e.g., 'Ionian', 'Ithaca')",
          harbour_type: "harbour | anchorage | bay | marina",
          coordinates: { lat: "number", lng: "number" },
          description: "string (max 1000 chars)",
          facilities: ["water", "fuel", "electricity", "wifi", "showers", "restaurant", "provisions", "chandlery", "laundry", "repair"],
          capacity: "integer (number of berths)",
          depth_range: "string (e.g., '3-8m')",
          notes: null
        }),
        "Rules:",
        "- Coordinates must be valid lat/lng decimals.",
        "- harbour_type must be lowercase: harbour, anchorage, bay, or marina.",
        "- facilities must use exact enum values (lowercase).",
        "- depth_range format: 'X-Ym' (e.g., '3.5-8m').",
        "- Output ONLY the JSON object, no prose."
      ].join("\n")
    },

    harbour_weather_profiles: {
      system: [
        "You are the Harbourmaster Cleaner for weather profiles.",
        "Convert the input into strict JSON matching this schema:",
        JSON.stringify({
          harbour_name: "string",
          wind_directions: {
            sheltered_from: ["n", "ne", "e", "se", "s", "sw", "w", "nw"],
            exposed_to: ["n", "ne", "e", "se", "s", "sw", "w", "nw"]
          },
          shelter_quality: "excellent | good | moderate | poor",
          swell_surge: {
            susceptible: "boolean",
            conditions: "string (when swell/surge occurs)"
          },
          best_conditions: "string (ideal weather)",
          warnings: "string (weather warnings)",
          notes: null
        }),
        "Rules:",
        "- Wind directions must be lowercase: n, ne, e, se, s, sw, w, nw.",
        "- shelter_quality must be lowercase: excellent, good, moderate, or poor.",
        "- Output ONLY the JSON object, no prose."
      ].join("\n")
    },

    harbour_media: {
      system: [
        "You are the Harbourmaster Cleaner for media records.",
        "Convert the input into strict JSON matching this schema:",
        JSON.stringify({
          harbour_name: "string",
          media_type: "photo | video | aerial | tutorial | diagram",
          title: "string (3-200 chars)",
          url: "string (valid URL)",
          description: "string (max 1000 chars)",
          category: "Approach & Entry | Mooring | Anchoring | Weather & Shelter | Safety & Hazards | Facilities & Services | Local Knowledge | General",
          tags: ["domain-prefixed tags"],
          tier: "free | pro | exclusive",
          duration: "string (MM:SS format for videos)",
          notes: null
        }),
        "Rules:",
        "- media_type must be lowercase: photo, video, aerial, tutorial, or diagram.",
        "- tier must be lowercase: free, pro, or exclusive.",
        "- duration only for videos, format: MM:SS (e.g., '3:45').",
        "- URL must be valid and complete.",
        "- Output ONLY the JSON object, no prose."
      ].join("\n")
    }
  };

  return prompts[tableType];
}

// ============================================================================
// DATA TRANSFORMATION (Schema to DB Columns)
// ============================================================================

function transformToDbColumns(tableType, cleaned) {
  switch (tableType) {
    case 'harbour_questions':
      return {
        harbour_name: s(cleaned.harbour),
        question: s(cleaned.question),
        answer: s(cleaned.answer),
        category: s(cleaned.category),
        tags: cleaned.tags || [],
        tier: s(cleaned.tier) || "pro",
        notes: cleaned.notes || null
      };

    case 'harbours':
      return {
        name: s(cleaned.name),
        region: s(cleaned.region),
        harbour_type: s(cleaned.harbour_type),
        latitude: cleaned.coordinates?.lat,
        longitude: cleaned.coordinates?.lng,
        description: s(cleaned.description) || null,
        facilities: cleaned.facilities || [],
        capacity: cleaned.capacity || null,
        depth_range: s(cleaned.depth_range) || null,
        notes: cleaned.notes || null
      };

    case 'harbour_weather_profiles':
      return {
        harbour_name: s(cleaned.harbour_name),
        sheltered_from: cleaned.wind_directions?.sheltered_from || [],
        exposed_to: cleaned.wind_directions?.exposed_to || [],
        shelter_quality: s(cleaned.shelter_quality),
        swell_susceptible: cleaned.swell_surge?.susceptible || false,
        swell_conditions: s(cleaned.swell_surge?.conditions) || null,
        best_conditions: s(cleaned.best_conditions) || null,
        warnings: s(cleaned.warnings) || null,
        notes: cleaned.notes || null
      };

    case 'harbour_media':
      return {
        harbour_name: s(cleaned.harbour_name),
        media_type: s(cleaned.media_type),
        title: s(cleaned.title),
        url: s(cleaned.url),
        description: s(cleaned.description) || null,
        category: s(cleaned.category) || null,
        tags: cleaned.tags || [],
        tier: s(cleaned.tier) || "free",
        duration: s(cleaned.duration) || null,
        notes: cleaned.notes || null
      };

    default:
      throw new Error(`Unknown table type: ${tableType}`);
  }
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

export default async function handler(req, res) {
  try {
    console.log('[INGEST] ========================================');
    console.log('[INGEST] Starting universal ingestion...');

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { transcript, harbour_name, row_id } = req.body || {};

    if (!transcript || !transcript.trim()) {
      console.error('[INGEST] Missing transcript');
      return res.status(400).json({ error: "Missing required field: transcript" });
    }

    console.log('[INGEST] Transcript received:', transcript.substring(0, 150) + '...');
    console.log('[INGEST] Harbour name:', harbour_name);
    console.log('[INGEST] Row ID:', row_id);

    // ========================================================================
    // STEP 1: Detect Table Type (Prefix or GPT)
    // ========================================================================

    let detection = detectTableTypeByPrefix(transcript);

    if (!detection) {
      detection = await classifyTableTypeWithGPT(transcript);

      // Reject if confidence < 0.90
      if (detection.confidence < 0.90) {
        console.error(`[INGEST] ❌ Low confidence: ${detection.confidence}`);

        const queueId = await parkInReviewQueue(
          transcript,
          `Low AI confidence: ${detection.confidence}`,
          'low_confidence',
          { detection }
        );

        await logValidationError(
          'medium',
          'Low Classification Confidence',
          'low_confidence',
          { confidence: detection.confidence, suggested_table: detection.table, reasoning: detection.reasoning },
          transcript,
          null
        );

        return res.status(422).json({
          error: "Classification confidence too low",
          confidence: detection.confidence,
          suggested_table: detection.table,
          reasoning: detection.reasoning,
          parked_in_queue: queueId
        });
      }
    }

    const tableType = detection.table;
    console.log(`[INGEST] ✅ Table type detected: ${tableType} (${detection.method}, confidence: ${detection.confidence})`);

    // ========================================================================
    // STEP 2: Clean with OpenAI (Table-Specific Prompt)
    // ========================================================================

    const cleaningPrompt = getCleaningPrompt(tableType);
    const user = `Input:\n${transcript}`;

    console.log('[INGEST] Calling OpenAI for cleaning...');

    const completion = await openai.chat.completions.create({
      model: process.env.CLEANER_MODEL || "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        { role: "system", content: cleaningPrompt.system },
        { role: "user", content: user }
      ]
    });

    const raw = completion.choices?.[0]?.message?.content || "{}";
    console.log('[INGEST] OpenAI response:', raw.substring(0, 300) + '...');

    let cleaned;
    try {
      cleaned = JSON.parse(raw);
    } catch (e) {
      console.error('[INGEST] ❌ JSON parse failed:', e.message);

      await logValidationError(
        'high',
        'JSON Parse Failed',
        'json_parse_error',
        { error: e.message, raw_response: raw },
        transcript,
        null
      );

      return res.status(422).json({ error: "JSON parse failed", raw });
    }

    console.log('[INGEST] Parsed JSON:', JSON.stringify(cleaned, null, 2));

    // ========================================================================
    // STEP 3: Ajv Schema Validation
    // ========================================================================

    const validate = validators[tableType];
    const ok = validate(cleaned);

    if (!ok) {
      console.error('[INGEST] ❌ Schema validation failed:', validate.errors);

      const queueId = await parkInReviewQueue(
        transcript,
        'Schema validation failed',
        'schema_validation',
        validate.errors
      );

      await logValidationError(
        'high',
        'Schema Validation Failed',
        'schema_validation',
        { errors: validate.errors, table: tableType },
        transcript,
        cleaned
      );

      return res.status(422).json({
        error: "Validation failed",
        table: tableType,
        details: validate.errors,
        cleaned,
        parked_in_queue: queueId
      });
    }

    console.log('[INGEST] ✅ Schema validation passed');

    // ========================================================================
    // STEP 4: Extra Guardrails (Q&A Tier-Specific)
    // ========================================================================

    if (tableType === 'harbour_questions') {
      if (cleaned.tier === "pro") {
        // Accept both inline (1. ... 2. ...) and newline-separated formats
        const hasSteps = /1\.\s/.test(cleaned.answer) && /2\.\s/.test(cleaned.answer);
        if (!hasSteps) {
          console.error('[INGEST] ❌ Pro tier missing numbered steps');

          await logValidationError(
            'medium',
            'Pro Tier Format Violation',
            'tier_validation',
            { tier: 'pro', issue: 'missing_numbered_steps' },
            transcript,
            cleaned
          );

          return res.status(422).json({
            error: "Pro tier requires numbered steps (1. 2. 3.)",
            cleaned
          });
        }
      }

      if (cleaned.tier === "free") {
        const sentences = sentenceCount(cleaned.answer);
        if (sentences > 2) {
          console.error('[INGEST] ❌ Free tier answer too long:', sentences, 'sentences');

          await logValidationError(
            'medium',
            'Free Tier Length Violation',
            'tier_validation',
            { tier: 'free', sentence_count: sentences, max_allowed: 2 },
            transcript,
            cleaned
          );

          return res.status(422).json({
            error: `Free tier answer too long (${sentences} sentences, max 2)`,
            cleaned
          });
        }
      }
    }

    // ========================================================================
    // STEP 5: Verify harbour_id (Foreign Key Check)
    // ========================================================================

    const harbourFieldName = tableType === 'harbour_questions' ? 'harbour' : 'harbour_name';
    const harbourValue = cleaned[harbourFieldName] || harbour_name;

    let harbourId = null;

    // Skip harbour verification for 'harbours' table (it IS the master table)
    if (tableType !== 'harbours' && harbourValue) {
      harbourId = await verifyHarbour(harbourValue);

      if (!harbourId) {
        console.error(`[INGEST] ❌ Harbour not found: ${harbourValue}`);

        const queueId = await parkInReviewQueue(
          transcript,
          `Harbour not found: ${harbourValue}`,
          'missing_harbour',
          { harbour_name: harbourValue }
        );

        await logValidationError(
          'high',
          'Harbour Not Found',
          'missing_harbour',
          { harbour_name: harbourValue, table: tableType },
          transcript,
          cleaned
        );

        return res.status(422).json({
          error: `Harbour not found: ${harbourValue}`,
          suggestion: "Create harbour master record first",
          table: tableType,
          parked_in_queue: queueId
        });
      }
    }

    // ========================================================================
    // STEP 6: Transform to DB Column Names & Insert
    // ========================================================================

    const payload = transformToDbColumns(tableType, cleaned);

    // Add harbour_id if verified
    if (harbourId) {
      payload.harbour_id = harbourId;
    }

    // Add row_id if provided (for Coda/Zapier tracking)
    if (row_id) {
      payload.source_row_id = row_id;
    }

    console.log('[INGEST] Inserting to Supabase:', tableType);
    console.log('[INGEST] Payload:', JSON.stringify(payload, null, 2));

    const { data, error } = await supabase
      .from(tableType)
      .insert(payload)
      .select()
      .single();

    if (error) {
      console.error('[INGEST] ❌ Supabase insert failed:', error);

      await logValidationError(
        'critical',
        'Database Insert Failed',
        'db_insert_error',
        { supabase_error: error, table: tableType },
        transcript,
        payload
      );

      return res.status(500).json({
        error: "Database insert failed",
        supabase_error: error,
        table: tableType,
        cleaned
      });
    }

    console.log('[INGEST] ✅ Inserted successfully, ID:', data.id);

    // ========================================================================
    // STEP 7: Auto-trigger Embedding (for applicable tables)
    // ========================================================================

    const needsEmbedding = ['harbour_questions', 'harbour_media'].includes(tableType);
    let embeddingTriggered = false;

    if (needsEmbedding) {
      try {
        const renderUrl = process.env.RENDER_URL || process.env.VERCEL_URL || 'http://localhost:3000';
        console.log('[INGEST] Triggering embedding generation...');

        const embeddingResponse = await fetch(`${renderUrl}/api/embed`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': process.env.INTERNAL_API_KEY || 'development'
          },
          body: JSON.stringify({
            table: tableType,
            id: data.id
          })
        });

        if (!embeddingResponse.ok) {
          const errorText = await embeddingResponse.text();
          console.error('[INGEST] ⚠️ Embedding generation failed:', errorText);
        } else {
          console.log('[INGEST] ✅ Embedding generation triggered');
          embeddingTriggered = true;
        }
      } catch (embeddingError) {
        console.error('[INGEST] ⚠️ Embedding call failed:', embeddingError.message);
      }
    }

    // ========================================================================
    // STEP 8: Success Response
    // ========================================================================

    console.log('[INGEST] ✅ COMPLETE - returning success');
    console.log('[INGEST] ========================================');

    return res.status(200).json({
      status: "ok",
      table_type: tableType,
      id: data.id,
      confidence: detection.confidence,
      method: detection.method,
      harbour_id: harbourId,
      embedding_triggered: embeddingTriggered,
      cleaned,
      inserted: payload
    });

  } catch (err) {
    console.error('[INGEST] ❌ Unhandled error:', err);

    // Log critical unhandled errors
    try {
      await logValidationError(
        'critical',
        'Unhandled Error',
        'unhandled_exception',
        { error: err.message, stack: err.stack },
        req.body?.transcript || '',
        null
      );
    } catch (logErr) {
      console.error('[INGEST] ⚠️ Failed to log error:', logErr.message);
    }

    return res.status(500).json({
      error: "Unhandled error",
      message: err?.message,
      stack: process.env.NODE_ENV === 'development' ? err?.stack : undefined
    });
  }
}
