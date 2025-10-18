# Testing /api/ingest_universal

This document provides test cases for the universal ingestion endpoint.

## Test Prerequisites

1. Ensure you have at least one harbour in the `harbours` table:
```sql
INSERT INTO harbours (name, region, harbour_type, latitude, longitude, description)
VALUES ('Kioni', 'Ithaca', 'harbour', 38.2794, 20.6486, 'Beautiful fishing village harbour');
```

2. Ensure validation_errors and qna_review_queue tables exist (see deployment docs)

## Test 1: Q&A with Prefix (Pro Tier)

```bash
curl -X POST http://localhost:3000/api/ingest_universal \
  -H "Content-Type: application/json" \
  -d '{
    "transcript": "QUESTION: Kioni mooring. How to stern-to? 1. Drop anchor 30m out. 2. Reverse slowly. 3. Crew steps ashore with lines. 4. Secure to quay cleats.",
    "harbour_name": "Kioni",
    "row_id": "test-001"
  }'
```

**Expected Response:**
```json
{
  "status": "ok",
  "table_type": "harbour_questions",
  "id": "uuid",
  "confidence": 1.0,
  "method": "prefix",
  "harbour_id": "uuid",
  "embedding_triggered": true,
  "cleaned": {
    "harbour": "Kioni",
    "question": "How to stern-to?",
    "answer": "1. Drop anchor 30m out. 2. Reverse slowly. 3. Crew steps ashore with lines. 4. Secure to quay cleats.",
    "category": "Mooring",
    "tags": ["mooring:stern_to", "scope:harbour"],
    "tier": "pro"
  }
}
```

## Test 2: Q&A with Prefix (Free Tier)

```bash
curl -X POST http://localhost:3000/api/ingest_universal \
  -H "Content-Type: application/json" \
  -d '{
    "transcript": "QUESTION: Kioni facilities. Where is water? Water available on main quay.",
    "harbour_name": "Kioni"
  }'
```

**Expected:**
- Status 200
- table_type: "harbour_questions"
- tier: "free"
- Answer ≤2 sentences

## Test 3: Harbour Master Record

```bash
curl -X POST http://localhost:3000/api/ingest_universal \
  -H "Content-Type: application/json" \
  -d '{
    "transcript": "HARBOUR: Vathi, Ithaca region, harbour type. Coordinates 38.3661 N, 20.7258 E. Charming main town harbour with all facilities. Water, fuel, electricity, wifi, showers, restaurants, provisions. Capacity 40 boats. Depth 3-6m.",
    "row_id": "test-002"
  }'
```

**Expected:**
```json
{
  "status": "ok",
  "table_type": "harbours",
  "id": "uuid",
  "confidence": 1.0,
  "method": "prefix",
  "harbour_id": null,
  "embedding_triggered": false,
  "cleaned": {
    "name": "Vathi",
    "region": "Ithaca",
    "harbour_type": "harbour",
    "coordinates": { "lat": 38.3661, "lng": 20.7258 },
    "facilities": ["water", "fuel", "electricity", "wifi", "showers", "restaurant", "provisions"],
    "capacity": 40,
    "depth_range": "3-6m"
  }
}
```

## Test 4: Weather Profile

```bash
curl -X POST http://localhost:3000/api/ingest_universal \
  -H "Content-Type: application/json" \
  -d '{
    "transcript": "WEATHER: Kioni weather profile. Sheltered from west, northwest, north winds. Exposed to east, southeast. Excellent shelter quality. Susceptible to swell from southeast in strong winds. Best in meltemi season with NW winds. Warning: avoid in strong SE."
  }'
```

**Expected:**
```json
{
  "status": "ok",
  "table_type": "harbour_weather_profiles",
  "id": "uuid",
  "confidence": 1.0,
  "method": "prefix",
  "harbour_id": "uuid",
  "cleaned": {
    "harbour_name": "Kioni",
    "wind_directions": {
      "sheltered_from": ["n", "nw", "w"],
      "exposed_to": ["e", "se"]
    },
    "shelter_quality": "excellent",
    "swell_surge": {
      "susceptible": true,
      "conditions": "Strong southeast winds"
    }
  }
}
```

## Test 5: Media Entry

```bash
curl -X POST http://localhost:3000/api/ingest_universal \
  -H "Content-Type: application/json" \
  -d '{
    "transcript": "MEDIA: Kioni approach video tutorial. Title: How to approach Kioni harbour. URL: https://youtu.be/example123. Shows aerial view of harbour entrance, depth markers, mooring area. Category: Approach & Entry. Tags: media:video, media:aerial, scope:harbour. Pro tier. Duration 4:32."
  }'
```

**Expected:**
```json
{
  "status": "ok",
  "table_type": "harbour_media",
  "id": "uuid",
  "confidence": 1.0,
  "method": "prefix",
  "harbour_id": "uuid",
  "embedding_triggered": true,
  "cleaned": {
    "harbour_name": "Kioni",
    "media_type": "video",
    "title": "How to approach Kioni harbour",
    "url": "https://youtu.be/example123",
    "tier": "pro",
    "duration": "4:32"
  }
}
```

## Test 6: GPT Classification (No Prefix)

```bash
curl -X POST http://localhost:3000/api/ingest_universal \
  -H "Content-Type: application/json" \
  -d '{
    "transcript": "Kioni is sheltered from westerly winds but exposed to southeast. Good holding in sand and mud. Depth around 4-8 meters."
  }'
```

**Expected:**
- Uses GPT for classification (method: "gpt")
- Should classify as "harbour_weather_profiles" or "harbour_questions"
- Confidence should be >= 0.90
- If confidence < 0.90, parked in review queue

## Test 7: Low Confidence (Should Park)

```bash
curl -X POST http://localhost:3000/api/ingest_universal \
  -H "Content-Type: application/json" \
  -d '{
    "transcript": "Nice place, good food."
  }'
```

**Expected:**
```json
{
  "error": "Classification confidence too low",
  "confidence": 0.65,
  "suggested_table": "harbour_questions",
  "parked_in_queue": "uuid"
}
```

## Test 8: Missing Harbour (Should Park)

```bash
curl -X POST http://localhost:3000/api/ingest_universal \
  -H "Content-Type: application/json" \
  -d '{
    "transcript": "QUESTION: NonExistentHarbour mooring. How to approach? Just sail in carefully."
  }'
```

**Expected:**
```json
{
  "error": "Harbour not found: NonExistentHarbour",
  "suggestion": "Create harbour master record first",
  "table": "harbour_questions",
  "parked_in_queue": "uuid"
}
```

## Test 9: Pro Tier without Steps (Should Fail)

```bash
curl -X POST http://localhost:3000/api/ingest_universal \
  -H "Content-Type: application/json" \
  -d '{
    "transcript": "QUESTION: Kioni mooring. How to stern-to? Just reverse in and throw lines."
  }'
```

**Expected:**
```json
{
  "error": "Pro tier requires numbered steps (1. 2. 3.)",
  "cleaned": { ... }
}
```

## Test 10: Schema Validation Error

```bash
curl -X POST http://localhost:3000/api/ingest_universal \
  -H "Content-Type: application/json" \
  -d '{
    "transcript": "HARBOUR: X coordinates 9999 N 9999 E."
  }'
```

**Expected:**
- Status 422
- Error: "Validation failed"
- Details: Ajv errors (coordinates out of range)
- Parked in review queue
- Logged to validation_errors table

## Verification Queries

After running tests, verify in Supabase:

### Check inserted records:
```sql
SELECT * FROM harbour_questions ORDER BY created_at DESC LIMIT 5;
SELECT * FROM harbours ORDER BY created_at DESC LIMIT 5;
SELECT * FROM harbour_weather_profiles ORDER BY created_at DESC LIMIT 5;
SELECT * FROM harbour_media ORDER BY created_at DESC LIMIT 5;
```

### Check validation errors:
```sql
SELECT * FROM validation_errors WHERE resolved = false ORDER BY created_at DESC;
```

### Check review queue:
```sql
SELECT * FROM qna_review_queue WHERE status = 'needs_review' ORDER BY created_at DESC;
```

### Check embeddings were created:
```sql
SELECT id, question, embedding IS NOT NULL as has_embedding
FROM harbour_questions
ORDER BY created_at DESC
LIMIT 5;
```

## Expected Behaviors

✅ **Prefix detection**: Instant table routing with 1.0 confidence
✅ **GPT fallback**: Used when no prefix, requires ≥0.90 confidence
✅ **Harbour verification**: Checks harbours table before insert
✅ **Schema validation**: Uses Ajv with table-specific schemas
✅ **Tier validation**: Pro = numbered steps, Free = ≤2 sentences
✅ **Error logging**: All failures logged to validation_errors
✅ **Review queue**: Low confidence or missing harbours parked
✅ **Embeddings**: Auto-triggered for harbour_questions and harbour_media
✅ **Column mapping**: Schema fields transformed to DB columns

## Common Error Scenarios

| Error Type | HTTP Code | Action |
|------------|-----------|---------|
| Low confidence (< 0.90) | 422 | Park in review queue |
| Missing harbour | 422 | Park in review queue |
| Schema validation failed | 422 | Park in review queue + log error |
| Pro tier without steps | 422 | Return error (not parked) |
| Free tier too long | 422 | Return error (not parked) |
| Database insert failed | 500 | Log critical error |
| JSON parse failed | 422 | Log error |
| Unhandled exception | 500 | Log critical error |

## Integration with Zapier

Zapier should send:
```json
{
  "transcript": "QUESTION: ...",
  "harbour_name": "Kioni",
  "row_id": "coda-row-uuid"
}
```

The endpoint will return the inserted record ID, which Zapier can use to update the source Coda row.

## Monitoring

Key metrics to monitor:
- Classification method distribution (prefix vs GPT)
- GPT confidence scores
- Validation error rates by table type
- Review queue size
- Embedding success rate
- Insert success rate by table type
