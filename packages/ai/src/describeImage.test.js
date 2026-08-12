import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeImage } from './describeImage.js';

test('describeImage throws when GOOGLE_AI_API_KEY is unset', async () => {
  const prev = process.env.GOOGLE_AI_API_KEY;
  delete process.env.GOOGLE_AI_API_KEY;
  try {
    await assert.rejects(
      describeImage({ base64: 'AAAA', mimeType: 'image/png' }),
      /GOOGLE_AI_API_KEY is not set/
    );
  } finally {
    process.env.GOOGLE_AI_API_KEY = prev;
  }
});

test('describeImage throws on the DUMMY_KEY placeholder (never a real call)', async () => {
  const prev = process.env.GOOGLE_AI_API_KEY;
  process.env.GOOGLE_AI_API_KEY = 'DUMMY_KEY';
  try {
    await assert.rejects(
      describeImage({ base64: 'AAAA', mimeType: 'image/png' }),
      /GOOGLE_AI_API_KEY is not set/
    );
  } finally {
    process.env.GOOGLE_AI_API_KEY = prev;
  }
});
