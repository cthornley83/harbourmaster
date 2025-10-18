# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Harbourmaster.ai is a serverless backend API powering "Virtual Craig," an AI sailing instructor specializing in Ionian harbour knowledge. The system uses RAG (Retrieval Augmented Generation) to provide context-aware sailing instructions with text-to-speech output.

**Tech Stack**: Vercel Functions (Node.js 22.x), Supabase (PostgreSQL + pgvector), OpenAI (embeddings + GPT-4o-mini), ElevenLabs (TTS)

## Commands

### Development
```bash
npm run dev        # Start Vercel dev server (http://localhost:3000)
npm start          # Alias for npm run dev
```

### Deployment
```bash
vercel deploy      # Deploy to preview environment
vercel --prod      # Deploy to production
```

### Testing Endpoints Locally
```bash
# Health check
curl http://localhost:3000/api/ping

# Test chat with RAG
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"question": "How to moor in Kioni?"}'

# Test embedding generation
curl -X POST http://localhost:3000/api/embed \
  -H "Content-Type: application/json" \
  -d '{"text": "Sample Q&A text", "harbour_name": "Test Harbour"}'

# Test TTS
curl -X POST http://localhost:3000/api/test-tts \
  -H "Content-Type: application/json" \
  -d '{"text": "Welcome to Virtual Craig"}' \
  --output test.mp3
```

## Architecture

### API Endpoints (`/api/*.js`)

All endpoints are Vercel serverless functions following the pattern:
```javascript
export default async function handler(req, res) {
  // Method validation, input validation, business logic
}
```

**Core Endpoints**:
- **`POST /api/chat`**: Main RAG chatbot (question → embedding → vector search → GPT-4o-mini → answer)
- **`POST /api/embed`**: Generate OpenAI embeddings and store in `harbour_questions` table
- **`POST /api/match`**: Raw semantic search using pgvector similarity
- **`POST /api/tts`**: Convert text to MP3 using ElevenLabs
- **`POST /api/ingest_universal`**: Universal ingestion endpoint with intelligent table routing (NEW)
- **`POST /api/clean_and_tag`**: Transform voice transcripts into validated JSON (currently `api_clean_and_tag_corrected.js`, needs to be moved to `/api/`)
- **`GET /api/ping`**: Health check endpoint

### RAG Pipeline Flow

```
User Question
    ↓
[/api/chat] Embed question (text-embedding-3-small)
    ↓
Supabase RPC: match_documents(embedding, threshold=0.75, limit=5)
    ↓
Build context from top matches
    ↓
GPT-4o-mini (System: "Virtual Craig, Yachtmaster Instructor", temp=0.2)
    ↓
Return answer + context sources
    ↓
[/api/tts] Convert to audio (ElevenLabs)
```

### Universal Ingestion Endpoint (`/api/ingest_universal`)

**Purpose**: Intelligent multi-table ingestion from Zapier with auto-classification and validation.

**Features**:
- Keyword prefix detection (`QUESTION:`, `HARBOUR:`, `WEATHER:`, `MEDIA:`)
- GPT-4o-mini fallback classification with confidence scoring
- Table-specific OpenAI cleaning prompts
- Ajv validation for all 4 table types
- harbour_id foreign key verification
- Auto-embedding for applicable tables
- Error logging to `validation_errors` table
- Low confidence parking in `qna_review_queue`

**Request Body**:
```json
{
  "transcript": "QUESTION: Kioni mooring. How to stern-to? 1. Drop anchor...",
  "harbour_name": "Kioni",
  "row_id": "optional-coda-id"
}
```

**Response**:
```json
{
  "status": "ok",
  "table_type": "harbour_questions",
  "id": "uuid",
  "confidence": 1.0,
  "method": "prefix",
  "harbour_id": "uuid",
  "embedding_triggered": true,
  "cleaned": { ... }
}
```

**Table Routing**:
- `QUESTION:` prefix → `harbour_questions`
- `HARBOUR:` prefix → `harbours`
- `WEATHER:` prefix → `harbour_weather_profiles`
- `MEDIA:` prefix → `harbour_media`
- No prefix → GPT classification (requires ≥0.90 confidence)

**Validation Rules**:
- harbour_questions: Pro tier = numbered steps, Free tier = ≤2 sentences
- All tables: Lowercase enums (tier: 'free', not 'Free')
- All tables: Arrays for tags/facilities (not strings)
- All foreign keys verified before insert
- additionalProperties: false in schemas

**Error Handling**:
- Confidence < 0.90 → Park in review queue (422)
- Missing harbour → Park in review queue (422)
- Schema validation failed → Park in review queue + log error (422)
- Tier violations → Return error (422)
- Database errors → Log critical error (500)

See `/api/ingest_universal.test.md` for comprehensive test cases.

### Database Schema

**All Database Tables** (4 total):

1. **`harbour_questions`** - Q&A knowledge base with RAG
```sql
harbour_questions (
  id uuid PRIMARY KEY,
  harbour_id uuid REFERENCES harbours(id),
  harbour_name TEXT,
  question TEXT,
  answer TEXT,
  category TEXT,           -- 9 categories: Mooring, Anchoring, Weather, etc.
  tags TEXT[],             -- Domain-prefixed: mooring:stern_to, facility:water
  tier TEXT,               -- free, pro, exclusive (lowercase)
  embedding vector(1536),  -- OpenAI embedding dimension
  source_row_id TEXT,      -- Optional Coda/Zapier tracking
  created_at timestamptz,
  updated_at timestamptz
)
```

2. **`harbours`** - Master harbour registry
```sql
harbours (
  id uuid PRIMARY KEY,
  name TEXT UNIQUE,
  region TEXT,
  harbour_type TEXT,       -- harbour, anchorage, bay, marina (lowercase)
  latitude DECIMAL,
  longitude DECIMAL,
  description TEXT,
  facilities TEXT[],       -- water, fuel, electricity, wifi, etc.
  capacity INTEGER,
  depth_range TEXT,        -- e.g., '3-8m'
  notes TEXT,
  source_row_id TEXT,
  created_at timestamptz,
  updated_at timestamptz
)
```

3. **`harbour_weather_profiles`** - Weather and shelter analysis
```sql
harbour_weather_profiles (
  id uuid PRIMARY KEY,
  harbour_id uuid REFERENCES harbours(id),
  harbour_name TEXT,
  sheltered_from TEXT[],   -- n, ne, e, se, s, sw, w, nw (lowercase)
  exposed_to TEXT[],       -- n, ne, e, se, s, sw, w, nw (lowercase)
  shelter_quality TEXT,    -- excellent, good, moderate, poor (lowercase)
  swell_susceptible BOOLEAN,
  swell_conditions TEXT,
  best_conditions TEXT,
  warnings TEXT,
  notes TEXT,
  source_row_id TEXT,
  created_at timestamptz,
  updated_at timestamptz
)
```

4. **`harbour_media`** - Photos, videos, tutorials
```sql
harbour_media (
  id uuid PRIMARY KEY,
  harbour_id uuid REFERENCES harbours(id),
  harbour_name TEXT,
  media_type TEXT,         -- photo, video, aerial, tutorial, diagram (lowercase)
  title TEXT,
  url TEXT,
  description TEXT,
  category TEXT,
  tags TEXT[],
  tier TEXT,               -- free, pro, exclusive (lowercase)
  duration TEXT,           -- MM:SS format for videos
  embedding vector(1536),  -- For media with descriptions
  notes TEXT,
  source_row_id TEXT,
  created_at timestamptz,
  updated_at timestamptz
)
```

**Supporting Tables**:

5. **`validation_errors`** - Error tracking and alerts
```sql
validation_errors (
  id uuid PRIMARY KEY,
  level TEXT,              -- critical, high, medium
  title TEXT,
  error_type TEXT,
  details JSONB,
  transcript TEXT,
  attempted_payload JSONB,
  resolved BOOLEAN DEFAULT false,
  resolved_at timestamptz,
  resolved_by TEXT,
  resolution_notes TEXT,
  created_at timestamptz DEFAULT now()
)
```

6. **`qna_review_queue`** - Human review workflow
```sql
qna_review_queue (
  id uuid PRIMARY KEY,
  transcript TEXT,
  error_message TEXT,
  error_type TEXT,
  validation_errors JSONB,
  status TEXT,             -- needs_review, in_progress, fixed, discarded
  corrected_data JSONB,
  reviewed_by TEXT,
  reviewed_at timestamptz,
  notes TEXT,
  created_at timestamptz DEFAULT now()
)
```

**Critical RPC Function**: `match_documents(query_embedding, match_threshold, match_count)`
- Uses pgvector cosine similarity
- Returns matching Q&As sorted by similarity score
- Must be created in Supabase (see deployment docs)

### Q&A Schema (v1.1)

Located at: `Qna schema v1.1 optimized · JSON.txt`

**Key Constraints**:
- **Categories**: 9 fixed values (Approach & Entry, Mooring, Anchoring, Weather & Shelter, Safety & Hazards, Facilities & Services, Local Knowledge, Media Tutorials, General)
- **Tags**: 96 controlled vocabulary terms with domain prefixes (`mooring:`, `anchor:`, `weather:`, `hazard:`, `facility:`, `scope:`)
- **Tier Validation**:
  - `free`: Max 2 sentences
  - `pro`: Must use numbered steps (1. 2. 3.)
  - `exclusive`: Requires booking prompts

**Validation**: All Q&As validated using Ajv JSON Schema before database insertion

### Environment Variables

Required in `.env` or Vercel environment settings:

```bash
# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key  # Falls back to ANON_KEY if missing

# OpenAI
OPENAI_API_KEY=sk-xxx
CLEANER_MODEL=gpt-4o-mini  # Model for /api/clean_and_tag

# ElevenLabs TTS
ELEVEN_API_KEY=your-elevenlabs-key
ELEVEN_VOICE_ID=voice-id-for-craig

# Optional
INTERNAL_API_KEY=random-32-char-key  # For service-to-service auth
NODE_ENV=production
```

## Important Patterns & Conventions

### Error Handling

All endpoints follow this pattern:
```javascript
// 1. Method validation
if (req.method !== 'POST') {
  return res.status(405).json({ error: 'Method not allowed' });
}

// 2. Input validation
if (!req.body.question) {
  return res.status(400).json({ error: 'Missing required field: question' });
}

// 3. Business logic with try-catch
try {
  // OpenAI/Supabase calls
} catch (err) {
  return res.status(500).json({ error: err.message });
}
```

### OpenAI Integration

**Embeddings** (used in `/api/chat`, `/api/embed`, `/api/match`):
```javascript
const response = await openai.embeddings.create({
  model: "text-embedding-3-small",
  input: textToEmbed
});
const embedding = response.data[0].embedding; // Float32Array of 1536 dimensions
```

**Chat Completions** (used in `/api/chat`):
```javascript
const completion = await openai.chat.completions.create({
  model: "gpt-4o-mini",
  temperature: 0.2,
  messages: [
    { role: "system", content: "You are Virtual Craig, a Yachtmaster Instructor..." },
    { role: "user", content: `Context:\n${context}\n\nQuestion: ${question}` }
  ]
});
```

### Supabase Client Initialization

```javascript
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);
```

**Always use SERVICE_ROLE_KEY for admin operations** (insert, update, delete) to bypass Row-Level Security.

### Critical Bug Fixes (Production Version)

When working with `/api/clean_and_tag`:

1. **Schema Import**: Use `fs.readFileSync()` instead of experimental `import assertion` syntax
2. **Embedding Trigger**: MUST call `/api/embed` after successful insertion (commented out in some versions)
3. **Supabase Key Fallback**: Always provide fallback to ANON_KEY if SERVICE_ROLE_KEY missing

## File Structure

```
D:\harbourmaster\
├── api/                          # Active Vercel serverless functions
│   ├── chat.js                   # Main RAG chatbot endpoint
│   ├── embed.js                  # Embedding generation
│   ├── match.js                  # Vector similarity search
│   ├── tts.js                    # Text-to-speech (ElevenLabs)
│   ├── test-tts.js              # TTS testing endpoint
│   ├── ping.js                   # Health check
│   ├── ingest_universal.js      # Universal multi-table ingestion (NEW)
│   └── ingest_universal.test.md # Test cases for universal ingestion
├── schemas/                      # Ajv JSON schemas for validation
│   ├── qna_schema_v1.json       # harbour_questions schema
│   ├── harbour_schema_v1.json   # harbours schema
│   ├── weather_schema_v1.json   # harbour_weather_profiles schema
│   └── media_schema_v1.json     # harbour_media schema
├── api_clean_and_tag_corrected.js # Needs to be moved to /api/
├── Qna schema v1.1 optimized · JSON.txt  # JSON Schema definition
├── # 📋 HARBOURMASTER.AI — DEPLOYMENT.txt # Deployment guide
├── Optimization summary v1.1 · MD.txt    # Bug fixes & improvements
├── package.json                  # Node.js 22.x, Vercel dev scripts
├── vercel.json                   # Routes: /api/* → /api/*.js
└── schema_dump.sql              # Database schema (empty in this project)
```

## Development Workflow

### Adding a New Endpoint

1. Create `/api/your-endpoint.js` with default export handler
2. Validate request method and inputs
3. Initialize Supabase/OpenAI clients using environment variables
4. Implement business logic with try-catch error handling
5. Test locally with `npm run dev`
6. Deploy with `vercel deploy`

### Modifying Q&A Schema

1. Update `Qna schema v1.1 optimized · JSON.txt`
2. Update Ajv validation in `/api/clean_and_tag`
3. Update database table schema in Supabase
4. Test with sample payloads
5. Update documentation

### Testing RAG Pipeline

1. Insert test Q&A via `/api/embed` (auto-generates embedding)
2. Query via `/api/match` to verify vector search works
3. Test end-to-end via `/api/chat`
4. Verify context relevance and answer quality
5. Adjust `match_threshold` (currently 0.75) if needed

## Common Issues

### Embeddings Not Working
- Verify `OPENAI_API_KEY` is set
- Check embedding dimension matches vector column (1536)
- Ensure pgvector extension enabled in Supabase
- Verify `match_documents` RPC function exists

### TTS Failures
- Verify `ELEVEN_API_KEY` and `ELEVEN_VOICE_ID` are set
- Check ElevenLabs API quota
- Test with `/api/test-tts` for debugging

### Schema Validation Errors
- Load schema using `fs.readFileSync()` not import assertions
- Validate against schema at: `Qna schema v1.1 optimized · JSON.txt`
- Check tier-specific constraints (sentence count for free, numbered steps for pro)

### Supabase RLS Issues
- Use `SUPABASE_SERVICE_ROLE_KEY` for admin operations
- Check RLS policies on `harbour_questions` table
- Verify fallback logic: `SERVICE_ROLE_KEY || ANON_KEY`

## Key Principles

- **Always generate embeddings**: After inserting Q&As, call `/api/embed` or RAG will break
- **Validate before insert**: Use Ajv + JSON Schema to prevent malformed data
- **Deterministic responses**: Use `temperature: 0.2` for consistent sailing instructions
- **Graceful degradation**: TTS/embedding failures should not block main operations
- **Domain expertise**: Virtual Craig is a Yachtmaster with 15 years Ionian experience—answers must reflect this authority

## References

- **Deployment Guide**: `# 📋 HARBOURMASTER.AI — DEPLOYMENT.txt`
- **Schema Definition**: `Qna schema v1.1 optimized · JSON.txt`
- **Bug Fixes**: `Optimization summary v1.1 · MD.txt`
- **Vercel Docs**: https://vercel.com/docs/functions
- **Supabase pgvector**: https://supabase.com/docs/guides/ai/vector-columns
- **OpenAI Embeddings**: https://platform.openai.com/docs/guides/embeddings
