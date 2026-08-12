import { Worker } from 'bullmq';
import { createRedisConnection } from './queue.js';
import { supabaseAdmin } from '../services/supabaseClient.js';
import { aiOrchestrator } from '../services/aiOrchestrator.js';

// BullMQ workers require their own connection instance when using blocking commands
const connection = createRedisConnection();

const worker = new Worker('orgforge-self-improvement', async job => {
  console.log('Running nightly self-improvement job...');

  try {
    // 1. Fetch recent ai_logs from DB (last 24 hours)
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: recentLogs, error } = await supabaseAdmin
      .from('ai_logs')
      .select('dry_run_errors, ai_repair_attempts, created_at')
      .gte('created_at', yesterday);

    if (error) {
      throw new Error(`Failed to fetch ai_logs: ${error.message}`);
    }

    if (recentLogs && recentLogs.length > 0) {
      // 2. Pass logs to Gemini to synthesize new lessons
      const sysPrompt = "You are the OrgForge Self-Improvement Engine. Analyze these deployment dry run errors and synthesize a single, actionable architectural rule to prevent them in the future. The output should be a plain text rule under 150 words.";
      const prompt = `Recent AI logs:\n${JSON.stringify(recentLogs, null, 2)}`;
      
      const synthesizedLesson = await aiOrchestrator.generateContent(prompt, sysPrompt);
      
      // 3. Save into orgforge.ai_lessons
      if (synthesizedLesson && synthesizedLesson.trim()) {
        const { error: insertError } = await supabaseAdmin
          .from('ai_lessons')
          .insert({ lesson_text: synthesizedLesson.trim(), active: true });
          
        if (insertError) {
          console.error('Failed to save synthesized lesson:', insertError.message);
        } else {
          console.log('Synthesized and saved new lesson:', synthesizedLesson.trim());
        }
      }
    } else {
      console.log('No recent AI logs to process for self-improvement.');
    }

    return { success: true };
  } catch (error) {
    console.error('Self-improvement job failed:', error);
    throw error;
  }
}, { connection });

export default worker;
