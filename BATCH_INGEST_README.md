# Batch WAV Transcription & Ingestion

Automated batch processing script for transcribing WAV files and ingesting them into the Harbourmaster.ai knowledge base.

## Overview

`batch_ingest.js` processes WAV audio files by:
1. Reading files from `voice_inbox/` folder
2. Transcribing each file using OpenAI Whisper API
3. Sending transcripts to `/api/ingest_universal` endpoint on Render
4. Logging results to `batch_log.csv`
5. Moving processed files to `voice_inbox/archive/`

## Setup

### 1. Environment Variables

Create a `.env` file in the project root with:

```bash
# Required for Whisper transcription
OPENAI_API_KEY=sk-your-openai-api-key-here

# Optional - defaults to https://harbourmaster.onrender.com if not set
RENDER_URL=https://harbourmaster.onrender.com
```

### 2. Folder Structure

The script will automatically create these folders if they don't exist:
- `voice_inbox/` - Place your WAV files here
- `voice_inbox/archive/` - Processed files are moved here
- `batch_log.csv` - Processing log (created automatically)

### 3. File Naming Convention

For automatic harbour detection, name your WAV files with the harbour name as a prefix:

```
kioni_mooring_001.wav          → Harbour: Kioni
vathi_anchoring_storm.wav      → Harbour: Vathi
fiskardo_approach_night.wav    → Harbour: Fiskardo
general_sailing_tips.wav       → Harbour: null (will be classified by GPT)
```

Pattern: `{harbour_name}_{description}.wav`

## Usage

### Run Batch Processing

```bash
# Using npm script
npm run batch

# Or directly with node
node batch_ingest.js
```

### Example Workflow

1. Add WAV files to `voice_inbox/`:
   ```
   voice_inbox/
   ├── kioni_mooring_001.wav
   ├── kioni_weather_profile.wav
   └── vathi_facilities.wav
   ```

2. Run the script:
   ```bash
   npm run batch
   ```

3. Check the output:
   ```
   🚀 Batch WAV Transcription & Ingestion
   =====================================

   📦 Found 3 WAV file(s) to process

   📄 Processing: kioni_mooring_001.wav
     Transcribing with Whisper API...
     ✓ Transcription: QUESTION: Kioni mooring. How to stern-to? 1. Drop anchor...
     Sending to ingestion endpoint...
     ✓ Ingested: ok | Table: harbour_questions | Confidence: 1.0
     ✓ Archived to: voice_inbox/archive/kioni_mooring_001.wav

   📊 Batch Processing Complete
   ✓ Successful: 3
   ✗ Failed: 0
   ```

4. Review the log file:
   ```bash
   cat batch_log.csv
   ```

## Log File Format

`batch_log.csv` contains:

| Column | Description |
|--------|-------------|
| timestamp | ISO 8601 timestamp |
| filename | Original WAV filename |
| status | `success` or `error` |
| table_type | Target table (harbour_questions, harbours, etc.) |
| confidence | Classification confidence (0.0-1.0) |
| method | Classification method (prefix or gpt) |
| harbour_id | UUID of matched harbour |
| embedding_triggered | Whether embedding was auto-generated |
| error_message | Error details if status=error |

## Transcript Formatting

For best results, use keyword prefixes in your audio recordings:

- **`QUESTION:`** - Routes to `harbour_questions` table
- **`HARBOUR:`** - Routes to `harbours` table
- **`WEATHER:`** - Routes to `harbour_weather_profiles` table
- **`MEDIA:`** - Routes to `harbour_media` table

Example audio script:
```
"QUESTION: Kioni mooring. How to approach the town quay?
1. Approach from the south with the chapel on your starboard side.
2. Check for available space along the quay wall.
3. Prepare stern lines and fenders on the port side."
```

## Error Handling

**Failed transcriptions** - Logged as errors, files remain in `voice_inbox/`

**Low confidence classification** (< 0.90) - Parked in `qna_review_queue` table

**Missing harbour** - Parked in `qna_review_queue` for manual review

**Schema validation errors** - Logged to `validation_errors` table

## Troubleshooting

### No files processed
- Ensure WAV files are in `voice_inbox/` (not a subdirectory)
- Check file extensions are lowercase `.wav`

### Whisper API errors
- Verify `OPENAI_API_KEY` is set correctly
- Check OpenAI API quota/billing
- Ensure WAV files are valid audio format

### Ingestion endpoint errors
- Verify `RENDER_URL` is correct
- Check Render service is running
- Review `batch_log.csv` for specific error messages

### Files not archived
- Check write permissions on `voice_inbox/archive/`
- Review console output for specific errors

## API Compatibility

This script sends data to `/api/ingest_universal` with this payload:

```json
{
  "transcript": "QUESTION: Kioni mooring...",
  "harbour_name": "Kioni",
  "row_id": "batch_kioni_mooring_001.wav_1234567890"
}
```

See `/api/ingest_universal.test.md` for endpoint documentation.
