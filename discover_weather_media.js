#!/usr/bin/env node

/**
 * Discover schema for harbour_weather_profiles and harbour_media
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

async function discoverWeatherMediaSchema() {
  console.log('🔍 Discovering schema for weather_profiles and media tables...\n');

  // First, get a test harbour_id from harbours table
  const { data: harbours } = await supabase.from('harbours').select('id, name').limit(1);

  if (!harbours || harbours.length === 0) {
    console.log('❌ No harbours found - creating test harbour first...');

    const { data: newHarbour } = await supabase
      .from('harbours')
      .insert([{ name: 'TEST_FOR_SCHEMA', notes: 'Temp' }])
      .select();

    if (newHarbour && newHarbour.length > 0) {
      console.log('✓ Created test harbour:', newHarbour[0].id);
      var testHarbourId = newHarbour[0].id;
    } else {
      console.log('❌ Could not create test harbour');
      return;
    }
  } else {
    var testHarbourId = harbours[0].id;
    console.log('✓ Using existing harbour ID:', testHarbourId);
  }

  console.log('\n' + '='.repeat(70));

  // Test harbour_weather_profiles
  console.log('\n📋 Table: harbour_weather_profiles');
  console.log('-'.repeat(70));

  const testWeather = {
    harbour_id: testHarbourId
  };

  const { data: wData, error: wError } = await supabase
    .from('harbour_weather_profiles')
    .insert([testWeather])
    .select();

  if (wError) {
    console.log('Insert error:', wError.message);
    console.log('Code:', wError.code);
  } else if (wData && wData.length > 0) {
    console.log('✓ Insert successful!');
    console.log('Columns:', Object.keys(wData[0]).sort().join(', '));

    // Clean up
    await supabase.from('harbour_weather_profiles').delete().eq('harbour_id', testHarbourId);
    console.log('✓ Test record deleted');
  }

  // Test harbour_media
  console.log('\n📋 Table: harbour_media');
  console.log('-'.repeat(70));

  // Try different media_type values (based on CLAUDE.md and common alternatives)
  const mediaTypes = ['aerial', 'tutorial', 'diagram', 'photo', 'video', 'image'];

  for (const type of mediaTypes) {
    const testMedia = {
      harbour_id: testHarbourId,
      media_type: type,
      file_url: 'https://example.com/test.jpg'
    };

    const { data: mData, error: mError } = await supabase
      .from('harbour_media')
      .insert([testMedia])
      .select();

    if (!mError && mData && mData.length > 0) {
      console.log(`✓ Insert successful with media_type="${type}"!`);
      console.log('Columns:', Object.keys(mData[0]).sort().join(', '));

      // Clean up
      await supabase.from('harbour_media').delete().eq('harbour_id', testHarbourId);
      console.log('✓ Test record deleted');
      break;
    } else if (mError) {
      console.log(`  ✗ media_type="${type}" failed:`, mError.code);
    }
  }

  // Media type test above

  // Clean up test harbour if we created it
  if (harbours && harbours.length === 0) {
    await supabase.from('harbours').delete().eq('id', testHarbourId);
    console.log('\n✓ Cleaned up test harbour');
  }

  console.log('\n' + '='.repeat(70));
  console.log('✅ Schema discovery complete\n');
}

discoverWeatherMediaSchema().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
