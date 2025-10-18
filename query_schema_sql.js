#!/usr/bin/env node

/**
 * Query actual Supabase schema using SQL information_schema
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

const TABLES = [
  'harbour_questions',
  'harbours',
  'harbour_weather_profiles',
  'harbour_media'
];

async function queryTableSchema(tableName) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`TABLE: ${tableName}`);
  console.log('='.repeat(80));

  // Try to query using PostgREST - some Supabase instances expose information_schema
  const { data, error } = await supabase
    .from('information_schema.columns')
    .select('column_name, data_type, is_nullable, column_default')
    .eq('table_name', tableName)
    .order('ordinal_position');

  if (error) {
    console.log('Direct query failed:', error.message);
    console.log('\nTrying alternative method - inserting minimal record to discover schema...\n');

    // Fallback: Try to get schema from actual table structure
    const { data: tableData, error: tableError } = await supabase
      .from(tableName)
      .select('*')
      .limit(1);

    if (tableError) {
      console.log('Table query error:', tableError.message);
      return null;
    }

    if (tableData && tableData.length > 0) {
      const columns = Object.keys(tableData[0]);
      console.log('Columns found from existing data:');
      console.log('-'.repeat(80));
      columns.forEach((col, i) => {
        const value = tableData[0][col];
        const type = typeof value === 'object' && value !== null ?
          (Array.isArray(value) ? 'array' : 'object') :
          typeof value;
        console.log(`${(i + 1).toString().padStart(2)}. ${col.padEnd(30)} (inferred type: ${type})`);
      });
      return columns;
    } else {
      console.log('No data in table - attempting minimal insert to discover schema...');
      return await discoverByInsert(tableName);
    }
  }

  if (data && data.length > 0) {
    console.log('\nColumn Details:');
    console.log('-'.repeat(80));
    console.log('Column Name'.padEnd(35) + 'Type'.padEnd(20) + 'Nullable'.padEnd(12) + 'Default');
    console.log('-'.repeat(80));

    data.forEach(col => {
      const name = (col.column_name || '').padEnd(35);
      const type = (col.data_type || '').padEnd(20);
      const nullable = (col.is_nullable || '').padEnd(12);
      const defaultVal = col.column_default || '';
      console.log(`${name}${type}${nullable}${defaultVal}`);
    });

    return data.map(c => c.column_name);
  }

  return null;
}

async function discoverByInsert(tableName) {
  // We already know the working minimal payloads from previous tests
  const minimalPayloads = {
    'harbour_questions': null, // Has data, shouldn't need this
    'harbours': { name: 'SCHEMA_TEST', notes: 'temp' },
    'harbour_weather_profiles': null, // Need harbour_id
    'harbour_media': null // Need harbour_id + file_url
  };

  const payload = minimalPayloads[tableName];
  if (!payload) {
    console.log('Cannot discover - need existing data or known payload');
    return null;
  }

  const { data, error } = await supabase
    .from(tableName)
    .insert([payload])
    .select();

  if (error) {
    console.log('Insert error:', error.message);
    console.log('This reveals required fields');
    return null;
  }

  if (data && data.length > 0) {
    const columns = Object.keys(data[0]);
    console.log('Columns discovered:');
    console.log('-'.repeat(80));
    columns.forEach((col, i) => {
      console.log(`${(i + 1).toString().padStart(2)}. ${col}`);
    });

    // Clean up
    await supabase.from(tableName).delete().eq('name', 'SCHEMA_TEST');
    console.log('\n✓ Test record deleted');

    return columns;
  }

  return null;
}

async function generateSchemaReport() {
  console.log('\n');
  console.log('╔' + '═'.repeat(78) + '╗');
  console.log('║' + ' SUPABASE SCHEMA QUERY REPORT '.padStart(50).padEnd(78) + '║');
  console.log('╚' + '═'.repeat(78) + '╝');

  const allSchemas = {};

  for (const table of TABLES) {
    const columns = await queryTableSchema(table);
    allSchemas[table] = columns;
  }

  // Summary
  console.log('\n\n');
  console.log('╔' + '═'.repeat(78) + '╗');
  console.log('║' + ' SUMMARY '.padStart(43).padEnd(78) + '║');
  console.log('╚' + '═'.repeat(78) + '╝');

  for (const [table, columns] of Object.entries(allSchemas)) {
    if (columns) {
      console.log(`\n${table}: ${columns.length} columns`);
      console.log('  ' + columns.join(', '));
    } else {
      console.log(`\n${table}: Could not determine schema`);
    }
  }

  console.log('\n');
}

generateSchemaReport().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
