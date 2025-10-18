# Supabase Schema vs ingest_universal.js - Complete Comparison

## Table 1: harbour_questions

### Actual Supabase Columns (12 total):
```
1.  id             (UUID, auto-generated)
2.  harbour_id     (UUID, foreign key, nullable)
3.  question       (TEXT)
4.  answer         (TEXT)
5.  category       (TEXT)
6.  tags           (ARRAY/JSONB)
7.  tier           (TEXT)
8.  created_at     (TIMESTAMP)
9.  harbour_name   (TEXT)
10. embedding      (VECTOR)
11. notes          (TEXT/NULL)
12. source         (TEXT)
```

### Current ingest_universal.js Transformation:
```javascript
{
  harbour_name: s(cleaned.harbour),        // ✓ CORRECT
  question: s(cleaned.question),            // ✓ CORRECT
  answer: s(cleaned.answer),                // ✓ CORRECT
  category: s(cleaned.category),            // ✓ CORRECT
  tags: cleaned.tags || [],                 // ✓ CORRECT
  tier: s(cleaned.tier) || "pro",           // ✓ CORRECT
  notes: cleaned.notes || null              // ✓ CORRECT
  // source: added conditionally after transformation
}
```

### Status: ✅ **CORRECT**
- All fields map correctly
- `source` field added conditionally via `row_id` parameter
- `harbour_id` populated separately after harbour verification
- `embedding` auto-generated via trigger

---

## Table 2: harbours

### Actual Supabase Columns (19 total):
```
1.  id              (UUID, auto-generated)
2.  name            (TEXT, NOT NULL) ⚠️
3.  island          (TEXT, nullable)
4.  lat             (NUMERIC, nullable)
5.  lon             (NUMERIC, nullable)
6.  seabed          (TEXT, nullable)
7.  holding         (TEXT, nullable)
8.  mooring         (TEXT, nullable)
9.  depth_range     (TEXT, nullable)
10. shelter         (TEXT, nullable)
11. approach        (TEXT, nullable)
12. hazards         (TEXT, nullable)
13. crowding_risk   (TEXT, nullable)
14. best_arrival    (TEXT, nullable)
15. facilities      (ARRAY, nullable)
16. atmosphere      (TEXT, nullable)
17. notes           (TEXT, nullable)
18. created_at      (TIMESTAMP)
19. island_id       (UUID, foreign key, nullable)
```

### Current ingest_universal.js Transformation:
```javascript
{
  name: s(cleaned.name),                     // ✓ CORRECT (FIXED)
  island: s(cleaned.region) || null,         // ✓ CORRECT
  lat: cleaned.coordinates?.lat || null,     // ✓ CORRECT
  lon: cleaned.coordinates?.lng || null,     // ✓ CORRECT
  depth_range: s(cleaned.depth_range) || null,  // ✓ CORRECT
  facilities: cleaned.facilities || [],      // ✓ CORRECT
  mooring: s(cleaned.mooring_info) || null,  // ✓ CORRECT
  approach: s(cleaned.approach_info) || null,  // ✓ CORRECT
  shelter: s(cleaned.shelter_info) || null,  // ✓ CORRECT
  hazards: s(cleaned.hazards) || null,       // ✓ CORRECT
  holding: s(cleaned.holding) || null,       // ✓ CORRECT
  seabed: s(cleaned.seabed) || null,         // ✓ CORRECT
  atmosphere: s(cleaned.atmosphere) || null, // ✓ CORRECT
  best_arrival: s(cleaned.best_arrival) || null,  // ✓ CORRECT
  crowding_risk: s(cleaned.crowding_risk) || null,  // ✓ CORRECT
  notes: cleaned.notes || null               // ✓ CORRECT
}
```

### Status: ✅ **CORRECT (AFTER FIXES)**
- Fixed: `harbour_name` → `name`
- All required fields present
- `island_id` is nullable (can be populated later)

### Missing from GPT Cleaning Prompt:
- ⚠️ GPT prompt doesn't include: `mooring_info`, `approach_info`, `shelter_info`, `hazards`, `holding`, `seabed`, `atmosphere`, `best_arrival`, `crowding_risk`
- These fields will be NULL unless GPT prompt is updated

---

## Table 3: harbour_weather_profiles

### Actual Supabase Columns (17 total - from earlier test):
```
1.  id                   (UUID, auto-generated)
2.  harbour_id           (UUID, foreign key, NOT NULL) ⚠️
3.  sheltered_from       (ARRAY)
4.  exposed_to           (ARRAY)
5.  safety_summary       (TEXT, nullable)
6.  holding_quality      (TEXT, nullable)
7.  surge_notes          (TEXT, nullable)
8.  depth_notes          (TEXT, nullable)
9.  fallback_options     (TEXT, nullable)
10. mooring_difficulty   (TEXT, nullable)
11. safe_wind_knots      (INTEGER, nullable)
12. caution_wind_knots   (INTEGER, nullable)
13. unsafe_wind_knots    (INTEGER, nullable)
14. shelter_mask         (INTEGER, auto-generated?)
15. expose_mask          (INTEGER, auto-generated?)
16. score_version        (INTEGER, auto-generated?)
17. created_at           (TIMESTAMP)
```

### Current ingest_universal.js Transformation:
```javascript
{
  harbour_id: harbourId,                     // ✓ CORRECT (FIXED)
  sheltered_from: cleaned.wind_directions?.sheltered_from || [],  // ✓ CORRECT
  exposed_to: cleaned.wind_directions?.exposed_to || [],  // ✓ CORRECT
  safety_summary: s(cleaned.safety_summary) || null,  // ✓ CORRECT
  holding_quality: s(cleaned.holding_quality) || null,  // ✓ CORRECT
  surge_notes: s(cleaned.surge_notes) || null,  // ✓ CORRECT
  depth_notes: s(cleaned.depth_notes) || null,  // ✓ CORRECT
  fallback_options: s(cleaned.fallback_options) || null,  // ✓ CORRECT
  mooring_difficulty: s(cleaned.mooring_difficulty) || null,  // ✓ CORRECT
  safe_wind_knots: cleaned.safe_wind_knots || null,  // ✓ CORRECT
  caution_wind_knots: cleaned.caution_wind_knots || null,  // ✓ CORRECT
  unsafe_wind_knots: cleaned.unsafe_wind_knots || null  // ✓ CORRECT
  // shelter_mask, expose_mask, score_version likely auto-generated
}
```

### Status: ✅ **CORRECT (AFTER FIXES)**
- Fixed: `harbour_name` → `harbour_id`
- All fields map correctly
- Auto-generated fields excluded

### Missing from GPT Cleaning Prompt:
- ⚠️ Current prompt uses old field names from CLAUDE.md
- Needs update to match actual DB schema

---

## Table 4: harbour_media

### Actual Supabase Columns (7 total - from earlier test):
```
1. id             (UUID, auto-generated)
2. harbour_id     (UUID, foreign key, NOT NULL) ⚠️
3. media_type     (TEXT, NOT NULL, enum check constraint) ⚠️
4. file_url       (TEXT, NOT NULL) ⚠️
5. description    (TEXT, nullable)
6. tier           (TEXT, nullable)
7. created_at     (TIMESTAMP)
```

**media_type allowed values**: `tutorial` (confirmed), possibly others

### Current ingest_universal.js Transformation:
```javascript
{
  harbour_id: harbourId,                 // ✓ CORRECT (FIXED)
  media_type: s(cleaned.media_type),     // ✓ CORRECT
  file_url: s(cleaned.url),              // ✓ CORRECT (FIXED: url → file_url)
  description: s(cleaned.description) || null,  // ✓ CORRECT
  tier: s(cleaned.tier) || "free"        // ✓ CORRECT
}
```

### Status: ✅ **CORRECT (AFTER FIXES)**
- Fixed: `harbour_name` → `harbour_id`
- Fixed: `url` → `file_url`
- Removed non-existent fields: `title`, `category`, `tags`, `duration`, `notes`

### Missing from GPT Cleaning Prompt:
- ⚠️ Prompt still references old CLAUDE.md schema
- Prompt should use actual enum values for `media_type`

---

## Summary of Fixes Applied

| Table | Issue | Fix Applied | Status |
|-------|-------|-------------|--------|
| harbour_questions | Missing source field | ✅ Added conditionally | FIXED |
| harbours | Used `harbour_name` instead of `name` | ✅ Changed to `name` | FIXED |
| harbours | Missing many optional fields | ✅ Added all 19 columns | FIXED |
| harbour_weather_profiles | Used `harbour_name` instead of `harbour_id` | ✅ Changed to `harbour_id` | FIXED |
| harbour_weather_profiles | Column names didn't match DB | ✅ Updated all fields | FIXED |
| harbour_media | Used `harbour_name` instead of `harbour_id` | ✅ Changed to `harbour_id` | FIXED |
| harbour_media | Used `url` instead of `file_url` | ✅ Changed to `file_url` | FIXED |
| harbour_media | Included non-existent fields | ✅ Removed invalid fields | FIXED |

---

## Remaining Issues

### 1. GPT Cleaning Prompts Need Updates

**harbours prompt** currently doesn't extract:
- `mooring_info` (should extract mooring details)
- `approach_info` (approach guidance)
- `shelter_info` (shelter quality)
- `hazards` (warnings/hazards)
- `holding` (anchor holding quality)
- `seabed` (seabed type)
- `atmosphere` (harbour atmosphere)
- `best_arrival` (best arrival time/conditions)
- `crowding_risk` (crowding information)

**harbour_weather_profiles prompt** uses old schema from CLAUDE.md

**harbour_media prompt** uses old schema from CLAUDE.md

### 2. media_type Enum Values

Need to discover all allowed values for `media_type` constraint. Confirmed:
- ✅ `tutorial` works
- ❌ `photo`, `video`, `image`, `aerial`, `diagram`, `document`, `link` all fail

---

## Code Changes Status

✅ **transformToDbColumns()** - All 4 tables fixed
✅ **Function signature** - Added `harbourId` parameter
✅ **Function calls** - Updated to pass `harbourId`
✅ **source field** - Added conditionally for harbour_questions

⚠️ **GPT Prompts** - Need updates to match actual DB schema

---

## Testing Recommendations

1. ✅ Test harbour insertion (minimal fields)
2. ⚠️ Test harbour insertion with full GPT cleaning (will have NULLs for missing prompt fields)
3. ⚠️ Test weather_profiles insertion (need updated prompt)
4. ⚠️ Test harbour_media insertion (need correct media_type enum)
5. ✅ Test Q&A insertion (should work now that harbour exists)
