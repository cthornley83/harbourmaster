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

// Initialize Supabase with secret key for admin operations
// New format (post Oct 2025): SUPABASE_SECRET_KEY
// Legacy fallbacks: SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
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

/**
 * Hybrid table type detection with three priority levels:
 *
 * Priority 1: Strict prefixes (HARBOUR:, WEATHER:, MEDIA:) → confidence 1.0
 * Priority 2: Q&A keywords (question: + answer: anywhere) → confidence 0.99
 * Priority 3: Return null for GPT classification
 */
function detectTableTypeByPrefix(transcript) {
  const upper = transcript.trim().toUpperCase();

  // PRIORITY 1: Strict prefixes (confidence: 1.0)
  if (upper.startsWith('HARBOUR:')) {
    return { table: 'harbours', confidence: 1.0, method: 'prefix' };
  }
  if (upper.startsWith('WEATHER:')) {
    return { table: 'harbour_weather_profiles', confidence: 1.0, method: 'prefix' };
  }
  if (upper.startsWith('MEDIA:')) {
    return { table: 'harbour_media', confidence: 1.0, method: 'prefix' };
  }

  // PRIORITY 2: Q&A keyword detection (confidence: 0.99)
  // Check if both "question" and "answer" appear anywhere in the text
  const hasQuestion = /\bQUESTION\s*[:.]?\s*/i.test(transcript);
  const hasAnswer = /\bANSWER\s*[:.]?\s*/i.test(transcript);

  if (hasQuestion && hasAnswer) {
    return { table: 'harbour_questions', confidence: 0.99, method: 'keyword' };
  }

  // PRIORITY 3: No match - use GPT classification
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

function getCleaningPrompt(tableType, tier = 'pro') {
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
        `- IMPORTANT: Set tier to "${tier}" (this was pre-detected from the input).`,
        "- Output ONLY the JSON object, no prose."
      ].join("\n")
    },

    harbours: {
      system: [
        "You are the Harbourmaster Cleaner for harbour master records.",
        "Convert the input into strict JSON matching this schema:",
        JSON.stringify({
          name: "string",
          region: "string (maps to island field)",
          coordinates: { lat: 38.1234, lng: 20.5678 },
          depth_range: "3-8m",
          facilities: ["water", "fuel", "electricity", "wifi", "showers", "restaurant", "provisions", "chandlery", "laundry", "repair"],
          mooring_info: "string (mooring details)",
          approach_info: "string (approach guidance)",
          shelter_info: "string (shelter quality)",
          hazards: "string (warnings/hazards)",
          holding: "string (anchor holding quality)",
          seabed: "string (seabed type: sand, mud, rock, etc.)",
          atmosphere: "string (harbour character)",
          best_arrival: "string (best arrival time/conditions)",
          crowding_risk: "string (crowding information)",
          notes: null
        }),
        "Rules:",
        "- IMPORTANT: lat and lng must be NUMBERS (not strings). Example: {lat: 38.4231, lng: 20.6583}",
        "- Extract mooring, approach, shelter, hazards, holding, seabed, atmosphere if mentioned",
        "- facilities must be an array of lowercase strings",
        "- depth_range format: 'X-Ym' or 'X-Y.Zm' (e.g., '3-8m', '3.5-12m')",
        "- Output ONLY the JSON object, no prose."
      ].join("\n")
    },

    harbour_weather_profiles: {
      system: [
        "You are the Harbourmaster Cleaner for weather profiles.",
        "Convert the input into strict JSON matching this schema:",
        JSON.stringify({
          wind_directions: {
            sheltered_from: ["n", "ne", "e", "se", "s", "sw", "w", "nw"],
            exposed_to: ["n", "ne", "e", "se", "s", "sw", "w", "nw"]
          },
          safety_summary: "string (brief safety overview)",
          holding_quality: "string (anchor holding quality)",
          surge_notes: "string (swell/surge information)",
          depth_notes: "string (depth-related notes)",
          fallback_options: "string (alternative harbours if conditions poor)",
          mooring_difficulty: "string (difficulty level/notes)",
          safe_wind_knots: 15,
          caution_wind_knots: 25,
          unsafe_wind_knots: 35
        }),
        "Rules:",
        "- Wind directions must be lowercase arrays: n, ne, e, se, s, sw, w, nw",
        "- Wind knots must be INTEGERS (numbers, not strings)",
        "- safe_wind_knots: max safe wind strength",
        "- caution_wind_knots: caution threshold",
        "- unsafe_wind_knots: unsafe threshold",
        "- Output ONLY the JSON object, no prose."
      ].join("\n")
    },

    harbour_media: {
      system: [
        "You are the Harbourmaster Cleaner for media records.",
        "Convert the input into strict JSON matching this schema:",
        JSON.stringify({
          media_type: "tutorial",
          url: "https://example.com/video.mp4",
          description: "string (brief description of media)",
          tier: "free"
        }),
        "Rules:",
        "- media_type: use 'tutorial' for instructional videos (other types may be added later)",
        "- url: must be a valid complete URL to the media file",
        "- description: brief description of what the media shows",
        "- tier must be lowercase: free, pro, or exclusive",
        "- Output ONLY the JSON object, no prose."
      ].join("\n")
    }
  };

  return prompts[tableType];
}

// ============================================================================
// DATA TRANSFORMATION (Schema to DB Columns)
// ============================================================================

function transformToDbColumns(tableType, cleaned, harbourId = null) {
  switch (tableType) {
    case 'harbour_questions':
      // Actual columns: answer, category, created_at, embedding, harbour_id, harbour_name, id, notes, question, source, tags, tier
      return {
        harbour_name: s(cleaned.harbour),
        question: s(cleaned.question),
        answer: s(cleaned.answer),
        category: s(cleaned.category),
        tags: cleaned.tags || [],
        tier: s(cleaned.tier) || "pro",
        notes: cleaned.notes || null
        // source field added conditionally after transformation
      };

    case 'harbours':
      // Actual columns: approach, atmosphere, best_arrival, created_at, crowding_risk, depth_range, facilities, hazards, holding, id, island, island_id, lat, lon, mooring, name, notes, seabed, shelter
      // NOTE: Many text columns are actually TEXT[] in DB, so we convert strings to arrays
      const toArray = (val) => val ? (Array.isArray(val) ? val : [s(val)]) : null;

      return {
        name: s(cleaned.name),  // Fixed: was harbour_name
        island: s(cleaned.region) || null,  // Map region to island
        lat: cleaned.coordinates?.lat || null,
        lon: cleaned.coordinates?.lng || null,
        depth_range: s(cleaned.depth_range) || null,
        facilities: cleaned.facilities || [],
        mooring: toArray(cleaned.mooring_info),
        approach: toArray(cleaned.approach_info),
        shelter: toArray(cleaned.shelter_info),  // Fix: DB expects array
        hazards: toArray(cleaned.hazards),
        holding: toArray(cleaned.holding),
        seabed: toArray(cleaned.seabed),
        atmosphere: toArray(cleaned.atmosphere),  // Fix: DB expects array
        best_arrival: toArray(cleaned.best_arrival),
        crowding_risk: toArray(cleaned.crowding_risk),
        notes: cleaned.notes || null
      };

    case 'harbour_weather_profiles':
      // Actual columns: caution_wind_knots, created_at, depth_notes, expose_mask, exposed_to, fallback_options, harbour_id, holding_quality, id, mooring_difficulty, safe_wind_knots, safety_summary, score_version, shelter_mask, sheltered_from, surge_notes, unsafe_wind_knots
      return {
        harbour_id: harbourId,  // Fixed: was harbour_name
        sheltered_from: cleaned.wind_directions?.sheltered_from || [],
        exposed_to: cleaned.wind_directions?.exposed_to || [],
        safety_summary: s(cleaned.safety_summary) || null,
        holding_quality: s(cleaned.holding_quality) || null,
        surge_notes: s(cleaned.surge_notes) || null,
        depth_notes: s(cleaned.depth_notes) || null,
        fallback_options: s(cleaned.fallback_options) || null,
        mooring_difficulty: s(cleaned.mooring_difficulty) || null,
        safe_wind_knots: cleaned.safe_wind_knots || null,
        caution_wind_knots: cleaned.caution_wind_knots || null,
        unsafe_wind_knots: cleaned.unsafe_wind_knots || null
        // Note: shelter_mask, expose_mask, score_version are likely auto-generated
      };

    case 'harbour_media':
      // Actual columns: created_at, description, file_url, harbour_id, id, media_type, tier
      return {
        harbour_id: harbourId,  // Fixed: was harbour_name
        media_type: s(cleaned.media_type),
        file_url: s(cleaned.url),  // Fixed: map url to file_url
        description: s(cleaned.description) || null,
        tier: s(cleaned.tier) || "free"
        // Removed fields that don't exist: title, category, tags, duration, notes
      };

    default:
      throw new Error(`Unknown table type: ${tableType}`);
  }
}

// ============================================================================
// TIER DETECTION HELPER
// ============================================================================

/**
 * Detects tier prefix (TIER: FREE | TIER: PRO | TIER: EXCLUSIVE) in transcript
 * Returns { tier, cleanedTranscript }
 */
function detectTier(transcript) {
  const tierMatch = transcript.match(/^TIER:\s*(FREE|PRO|EXCLUSIVE)[.\s]*/i);

  if (tierMatch) {
    const tier = tierMatch[1].toLowerCase();
    const cleanedTranscript = transcript.replace(/^TIER:\s*(FREE|PRO|EXCLUSIVE)[.\s]*/i, '').trim();
    console.log(`[INGEST] ✓ Detected tier: ${tier}`);
    return { tier, cleanedTranscript };
  }

  // Default to "pro" if no tier specified
  console.log('[INGEST] No tier specified, defaulting to: pro');
  return { tier: 'pro', cleanedTranscript: transcript };
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
    // STEP 0.5: Detect and Extract Tier (if specified)
    // ========================================================================

    const { tier: detectedTier, cleanedTranscript } = detectTier(transcript);
    const workingTranscript = cleanedTranscript;

    // ========================================================================
    // STEP 1: Detect Table Type (Prefix or GPT)
    // ========================================================================

    let detection = detectTableTypeByPrefix(workingTranscript);

    if (!detection) {
      detection = await classifyTableTypeWithGPT(workingTranscript);

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

    const cleaningPrompt = getCleaningPrompt(tableType, detectedTier);
    const user = `Input:\n${workingTranscript}`;

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

    const payload = transformToDbColumns(tableType, cleaned, harbourId);

    // Add source row_id if provided (for Coda/Zapier tracking)
    // Only harbour_questions table has "source" column
    if (row_id && tableType === 'harbour_questions') {
      payload.source = row_id;
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

    if (needsEmbedding && tableType === 'harbour_questions') {
      try {
        console.log('[INGEST] Generating embedding for Q&A...');

        // Generate embedding from question + answer
        const embeddingText = `${cleaned.question} ${cleaned.answer}`;

        const embeddingResult = await openai.embeddings.create({
          model: "text-embedding-3-small",
          input: embeddingText
        });

        // Update the record with the embedding
        const { error: updateError } = await supabase
          .from('harbour_questions')
          .update({ embedding: embeddingResult.data[0].embedding })
          .eq('id', data.id);

        if (updateError) {
          console.error('[INGEST] ⚠️ Embedding update failed:', updateError.message);
        } else {
          console.log('[INGEST] ✅ Embedding generated and updated');
          embeddingTriggered = true;
        }
      } catch (embeddingError) {
        console.error('[INGEST] ⚠️ Embedding generation failed:', embeddingError.message);
      }
    } else if (needsEmbedding && tableType === 'harbour_media') {
      // harbour_media embeddings (if description exists)
      try {
        if (cleaned.description) {
          console.log('[INGEST] Generating embedding for media description...');

          const embeddingResult = await openai.embeddings.create({
            model: "text-embedding-3-small",
            input: cleaned.description
          });

          const { error: updateError } = await supabase
            .from('harbour_media')
            .update({ embedding: embeddingResult.data[0].embedding })
            .eq('id', data.id);

          if (!updateError) {
            console.log('[INGEST] ✅ Media embedding generated');
            embeddingTriggered = true;
          }
        }
      } catch (embeddingError) {
        console.error('[INGEST] ⚠️ Media embedding failed:', embeddingError.message);
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
