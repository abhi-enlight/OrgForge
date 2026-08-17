#!/usr/bin/env node
/**
 * CLI Runner for OrgForge Nightly AI Judge & Self-Improvement Engine.
 *
 * Usage:
 *   node backend/scripts/runNightlyAi.mjs
 *   node backend/scripts/runNightlyAi.mjs --lookback-hours 48
 *   node backend/scripts/runNightlyAi.mjs --list-lessons
 *   node backend/scripts/runNightlyAi.mjs --sample-fail   # Inserts sample failure trace to test LLM synthesis
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });
dotenv.config({ path: path.join(__dirname, '../../.env') });

const { runSelfImprovement } = await import('../src/lib/selfImprovement.js');
const { supabaseAdmin } = await import('../src/lib/supabaseClients.js');

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    lookbackHours: 24,
    listLessons: false,
    sampleFail: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--help' || args[i] === '-h') {
      options.help = true;
    } else if (args[i] === '--list-lessons') {
      options.listLessons = true;
    } else if (args[i] === '--sample-fail') {
      options.sampleFail = true;
    } else if (args[i] === '--lookback-hours' && args[i + 1]) {
      options.lookbackHours = parseInt(args[++i], 10) || 24;
    }
  }

  return options;
}

async function listLessons() {
  console.log('\n📚 Active AI Lessons in orgforge.ai_lessons:');
  const { data: lessons, error } = await supabaseAdmin
    .from('ai_lessons')
    .select('id, lesson_text, active, created_at')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('❌ Failed to fetch lessons:', error.message);
    return;
  }

  if (!lessons || lessons.length === 0) {
    console.log('   (No active lessons recorded yet)\n');
    return;
  }

  lessons.forEach((l, idx) => {
    const status = l.active ? '🟢 [ACTIVE]' : '⚪ [ARCHIVED]';
    console.log(`\n ${idx + 1}. ${status} (ID: ${l.id})`);
    console.log(`    "${l.lesson_text}"`);
    console.log(`    Created: ${new Date(l.created_at).toLocaleString()}`);
  });
  console.log('');
}

async function injectSampleFailure() {
  console.log('🧪 Injecting sample failure trace into orgforge.ai_logs to test Nightly AI synthesis...');
  const sampleLog = {
    capability: 'agent',
    status: 'FAILED',
    prompt: 'Create a customer support routing agent that reads and modifies standard Case records',
    ai_response: 'Attempted to provision View All and Modify All permissions on Case object for Einstein Agent User',
    salesforce_error: 'LICENSE_LIMIT_EXCEEDED: The user license does not allow Modify All permission on standard Case object',
    error_code: 'INSUFFICIENT_ACCESS_ON_CROSS_REFERENCE_ENTITY',
    created_at: new Date().toISOString(),
  };

  const { data, error } = await supabaseAdmin
    .from('ai_logs')
    .insert(sampleLog)
    .select();

  if (error) {
    console.error('❌ Failed to insert sample failure:', error.message);
  } else {
    console.log('✅ Sample failure logged with ID:', data?.[0]?.id || 'created');
  }
}

async function main() {
  const options = parseArgs();

  if (options.help) {
    console.log(`
OrgForge Nightly AI Judge & Self-Improvement CLI

Options:
  --lookback-hours <N>   Hours of ai_logs to analyze (default: 24)
  --list-lessons         Display all current active/archived lessons in database
  --sample-fail          Log a test failure row into ai_logs before running
  --help                 Show this help message
`);
    process.exit(0);
  }

  if (options.listLessons) {
    await listLessons();
    process.exit(0);
  }

  if (options.sampleFail) {
    await injectSampleFailure();
  }

  console.log(`\n🤖 Running OrgForge Nightly AI Self-Improvement (lookback: ${options.lookbackHours}h)...`);
  
  try {
    const result = await runSelfImprovement({ lookbackHours: options.lookbackHours });
    
    if (result.missingTable) {
      console.log('⚠️ ai_logs or ai_lessons table missing (check schema migrations).');
      process.exit(1);
    }

    if (result.reason === 'no_failures') {
      console.log('✨ Clean bill of health! No failure logs found in the last', options.lookbackHours, 'hours.');
    } else if (result.reason === 'no_new_lessons') {
      console.log('✨ All recent failure signatures are already covered by existing active rules. Zero duplicates created.');
    } else {
      console.log(`\n🎉 Successfully synthesized ${result.synthesizedCount} new lesson(s):`);
      result.lessons?.forEach((lesson, i) => {
        console.log(`   ${i + 1}. "${lesson}"`);
      });
    }

    await listLessons();
  } catch (err) {
    console.error('\n❌ Nightly AI job failed:', err.message);
    process.exit(1);
  }
}

main();
