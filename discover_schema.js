#!/usr/bin/env node

/**
 * Discover actual schema by attempting test inserts
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

async function discoverSchema() {
  console.log('🔍 Discovering actual table schemas...\n');
  console.log('='.repeat(70));

  // Test 1: harbour_questions (we know this one works)
  console.log('\n📋 Table: harbour_questions');
  console.log('-'.repeat(70));
  const { data: qData } = await supabase.from('harbour_questions').select('*').limit(1);
  if (qData && qData.length > 0) {
    console.log('Columns:', Object.keys(qData[0]).sort().join(', '));
  }

  // Test 2: harbours - try with "name" instead of "harbour_name"
  console.log('\n📋 Table: harbours');
  console.log('-'.repeat(70));

  // Try inserting with minimal fields
  const testHarbour = {
    name: 'TEST_SCHEMA_CHECK',
    notes: 'Schema discovery test'
  };

  const { data: hData, error: hError } = await supabase
    .from('harbours')
    .insert([testHarbour])
    .select();

  if (hError) {
    console.log('Insert error:', hError.message);
    console.log('Hint:', hError.hint || 'N/A');
    console.log('Details:', hError.details || 'N/A');

    // Try selecting to see existing columns
    const { data: existingData } = await supabase.from('harbours').select('*').limit(1);
    if (existingData && existingData.length > 0) {
      console.log('Columns:', Object.keys(existingData[0]).sort().join(', '));
    }
  } else if (hData && hData.length > 0) {
    console.log('✓ Insert successful!');
    console.log('Columns:', Object.keys(hData[0]).sort().join(', '));

    // Clean up test record
    await supabase.from('harbours').delete().eq('name', 'TEST_SCHEMA_CHECK');
    console.log('✓ Test record deleted');
  }

  // Test 3: harbour_weather_profiles
  console.log('\n📋 Table: harbour_weather_profiles');
  console.log('-'.repeat(70));
  const { data: wData } = await supabase.from('harbour_weather_profiles').select('*').limit(1);
  if (wData && wData.length > 0) {
    console.log('Columns:', Object.keys(wData[0]).sort().join(', '));
  } else {
    console.log('No data - attempting minimal insert to discover schema...');
    const { error: wError } = await supabase
      .from('harbour_weather_profiles')
      .insert([{ harbour_name: 'TEST' }])
      .select();
    if (wError) {
      console.log('Error:', wError.message);
    }
  }

  // Test 4: harbour_media
  console.log('\n📋 Table: harbour_media');
  console.log('-'.repeat(70));
  const { data: mData } = await supabase.from('harbour_media').select('*').limit(1);
  if (mData && mData.length > 0) {
    console.log('Columns:', Object.keys(mData[0]).sort().join(', '));
  } else {
    console.log('No data - attempting minimal insert to discover schema...');
    const { error: mError } = await supabase
      .from('harbour_media')
      .insert([{ harbour_name: 'TEST', media_type: 'photo' }])
      .select();
    if (mError) {
      console.log('Error:', mError.message);
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log('✅ Schema discovery complete\n');
}

discoverSchema().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
