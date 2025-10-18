#!/usr/bin/env node

/**
 * Batch WAV File Transcription and Ingestion Script
 *
 * This script:
 * 1. Reads WAV files from voice_inbox folder
 * 2. Transcribes each file using OpenAI Whisper API
 * 3. POSTs transcript to Render endpoint (/api/ingest_universal)
 * 4. Logs results to batch_log.csv
 * 5. Moves processed files to archive folder
 *
 * Environment Variables Required:
 * - OPENAI_API_KEY: OpenAI API key for Whisper
 * - RENDER_URL: Base URL for Render deployment (e.g., https://harbourmaster.onrender.com)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// ES Module __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const VOICE_INBOX = path.join(__dirname, 'voice_inbox');
const ARCHIVE_FOLDER = path.join(__dirname, 'voice_inbox', 'archive');
const LOG_FILE = path.join(__dirname, 'batch_log.csv');
const RENDER_URL = process.env.RENDER_URL || 'https://harbourmaster.onrender.com';
const INGEST_ENDPOINT = `${RENDER_URL}/api/ingest_universal`;

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * Ensure required directories exist
 */
function ensureDirectories() {
  if (!fs.existsSync(VOICE_INBOX)) {
    fs.mkdirSync(VOICE_INBOX, { recursive: true });
    console.log(`✓ Created voice_inbox folder`);
  }

  if (!fs.existsSync(ARCHIVE_FOLDER)) {
    fs.mkdirSync(ARCHIVE_FOLDER, { recursive: true });
    console.log(`✓ Created archive folder`);
  }
}

/**
 * Initialize CSV log file with headers if it doesn't exist
 */
function initializeLogFile() {
  if (!fs.existsSync(LOG_FILE)) {
    const headers = 'timestamp,filename,status,table_type,confidence,method,harbour_id,embedding_triggered,error_message\n';
    fs.writeFileSync(LOG_FILE, headers, 'utf8');
    console.log(`✓ Created batch_log.csv`);
  }
}

/**
 * Log processing result to CSV
 */
function logResult(filename, status, result = {}, error = null) {
  const timestamp = new Date().toISOString();
  const row = [
    timestamp,
    filename,
    status,
    result.table_type || '',
    result.confidence || '',
    result.method || '',
    result.harbour_id || '',
    result.embedding_triggered || '',
    error ? `"${error.replace(/"/g, '""')}"` : ''
  ].join(',') + '\n';

  fs.appendFileSync(LOG_FILE, row, 'utf8');
}

/**
 * Transcribe WAV file using OpenAI Whisper API
 */
async function transcribeAudio(filePath) {
  console.log(`  Transcribing with Whisper API...`);

  const fileStream = fs.createReadStream(filePath);

  const transcription = await openai.audio.transcriptions.create({
    file: fileStream,
    model: 'whisper-1',
    response_format: 'text'
  });

  return transcription;
}

/**
 * Send transcript to Render ingestion endpoint
 */
async function ingestTranscript(transcript, filename) {
  console.log(`  Sending to ingestion endpoint...`);

  // Extract harbour name from filename if present (e.g., kioni_mooring_001.wav)
  const harbourMatch = filename.match(/^([a-zA-Z]+)_/);
  const harbourName = harbourMatch ? harbourMatch[1].charAt(0).toUpperCase() + harbourMatch[1].slice(1) : null;

  const payload = {
    transcript: transcript,
    harbour_name: harbourName,
    row_id: `batch_${filename}_${Date.now()}`
  };

  const response = await fetch(INGEST_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorText}`);
  }

  return await response.json();
}

/**
 * Move file to archive folder
 */
function archiveFile(filePath, filename) {
  const archivePath = path.join(ARCHIVE_FOLDER, filename);
  fs.renameSync(filePath, archivePath);
  console.log(`  ✓ Archived to: ${archivePath}`);
}

/**
 * Process a single WAV file
 */
async function processFile(filename) {
  const filePath = path.join(VOICE_INBOX, filename);

  console.log(`\n📄 Processing: ${filename}`);

  try {
    // Step 1: Transcribe audio
    const transcript = await transcribeAudio(filePath);
    console.log(`  ✓ Transcription: ${transcript.substring(0, 100)}...`);

    // Step 2: Send to ingestion endpoint
    const result = await ingestTranscript(transcript, filename);
    console.log(`  ✓ Ingested: ${result.status} | Table: ${result.table_type} | Confidence: ${result.confidence}`);

    // Step 3: Log success
    logResult(filename, 'success', result);

    // Step 4: Archive file
    archiveFile(filePath, filename);

    return { success: true, result };

  } catch (error) {
    console.error(`  ✗ Error: ${error.message}`);
    logResult(filename, 'error', {}, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Main batch processing function
 */
async function main() {
  console.log('🚀 Batch Audio Transcription & Ingestion');
  console.log('=====================================\n');

  // Validate environment variables
  if (!process.env.OPENAI_API_KEY) {
    console.error('❌ Error: OPENAI_API_KEY not found in environment variables');
    process.exit(1);
  }

  console.log(`📍 Voice Inbox: ${VOICE_INBOX}`);
  console.log(`📍 Archive Folder: ${ARCHIVE_FOLDER}`);
  console.log(`📍 Log File: ${LOG_FILE}`);
  console.log(`📍 Ingestion Endpoint: ${INGEST_ENDPOINT}\n`);

  // Setup
  ensureDirectories();
  initializeLogFile();

  // Read audio files (Whisper supports: wav, m4a, mp3, mp4, mpeg, mpga, webm)
  const supportedFormats = ['.wav', '.m4a', '.mp3', '.mp4', '.mpeg', '.mpga', '.webm'];
  const files = fs.readdirSync(VOICE_INBOX)
    .filter(file => {
      const ext = path.extname(file).toLowerCase();
      return supportedFormats.includes(ext);
    });

  if (files.length === 0) {
    console.log('📭 No audio files found in voice_inbox folder');
    console.log(`   Supported formats: ${supportedFormats.join(', ')}`);
    return;
  }

  console.log(`📦 Found ${files.length} audio file(s) to process\n`);

  // Process each file
  const results = {
    total: files.length,
    successful: 0,
    failed: 0
  };

  for (const file of files) {
    const result = await processFile(file);

    if (result.success) {
      results.successful++;
    } else {
      results.failed++;
    }
  }

  // Summary
  console.log('\n=====================================');
  console.log('📊 Batch Processing Complete');
  console.log('=====================================');
  console.log(`Total files: ${results.total}`);
  console.log(`✓ Successful: ${results.successful}`);
  console.log(`✗ Failed: ${results.failed}`);
  console.log(`\n📝 Log file: ${LOG_FILE}`);
}

// Run the script
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
