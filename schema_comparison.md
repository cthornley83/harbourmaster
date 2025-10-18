# Schema Comparison: Actual DB vs ingest_universal.js

## 1. harbour_questions

### Actual DB Columns:
```
answer, category, created_at, embedding, harbour_id, harbour_name, id, notes, question, source, tags, tier
```

### Current Transformation:
```javascript
{
  harbour_name: s(cleaned.harbour),     // ✓ Correct
  question: s(cleaned.question),         // ✓ Correct
  answer: s(cleaned.answer),            // ✓ Correct
  category: s(cleaned.category),        // ✓ Correct
  tags: cleaned.tags || [],             // ✓ Correct
  tier: s(cleaned.tier) || "pro",       // ✓ Correct
  notes: cleaned.notes || null          // ✓ Correct
}
```

### Issues:
- ❌ Missing `source` field (should map from `row_id` parameter)

---

## 2. harbours

### Actual DB Columns:
```
approach, atmosphere, best_arrival, created_at, crowding_risk, depth_range,
facilities, hazards, holding, id, island, island_id, lat, lon, mooring, name,
notes, seabed, shelter
```

### Current Transformation:
```javascript
{
  harbour_name: s(cleaned.name),  // ❌ WRONG - should be "name"
  notes: cleaned.notes || null    // ✓ Correct
}
```

### Issues:
- ❌ Uses `harbour_name` but DB uses `name`
- ❌ Missing many available fields: island, lat, lon, depth_range, facilities, mooring, etc.

### Recommended Fix:
```javascript
{
  name: s(cleaned.name),                  // Fixed: use "name" not "harbour_name"
  island: s(cleaned.region),              // Map region to island
  lat: cleaned.coordinates?.lat,
  lon: cleaned.coordinates?.lng,
  depth_range: s(cleaned.depth_range),
  facilities: cleaned.facilities || [],
  mooring: s(cleaned.mooring_info),
  approach: s(cleaned.approach_info),
  shelter: s(cleaned.shelter_info),
  hazards: s(cleaned.hazards),
  holding: s(cleaned.holding),
  seabed: s(cleaned.seabed),
  atmosphere: s(cleaned.atmosphere),
  best_arrival: s(cleaned.best_arrival),
  crowding_risk: s(cleaned.crowding_risk),
  notes: cleaned.notes || null
}
```

---

## 3. harbour_weather_profiles

### Actual DB Columns:
```
caution_wind_knots, created_at, depth_notes, expose_mask, exposed_to,
fallback_options, harbour_id, holding_quality, id, mooring_difficulty,
safe_wind_knots, safety_summary, score_version, shelter_mask, sheltered_from,
surge_notes, unsafe_wind_knots
```

### Current Transformation:
```javascript
{
  harbour_name: s(cleaned.harbour_name),  // ❌ WRONG - should be harbour_id
  sheltered_from: ...,
  exposed_to: ...,
  ...
}
```

### Issues:
- ❌ Uses `harbour_name` but DB uses `harbour_id`
- ❌ Column names don't match actual DB schema

---

## 4. harbour_media

### Actual DB Columns:
```
created_at, description, file_url, harbour_id, id, media_type, tier
```

### Current Transformation:
```javascript
{
  harbour_name: s(cleaned.harbour_name),  // ❌ WRONG - should be harbour_id
  media_type: s(cleaned.media_type),
  ...
}
```

### Issues:
- ❌ Uses `harbour_name` but DB uses `harbour_id`
- ❌ Missing required field: `file_url`
- ❌ Many fields don't exist in DB: title, url, category, tags, duration, notes

---

## Summary of Required Fixes:

1. ✅ **harbour_questions** - Add `source` field
2. ❌ **harbours** - Change `harbour_name` → `name`, add more fields
3. ❌ **harbour_weather_profiles** - Discover actual schema, fix column names
4. ❌ **harbour_media** - Discover actual schema, fix column names
