import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isAllowedFile,
  extractFileText,
  buildPromptWithAttachment,
  buildImageParts,
  MAX_INJECTED_CHARS,
} from './fileAttachments.js';

const file = (overrides = {}) => ({
  buffer: Buffer.from('hello forge'),
  mimetype: 'text/plain',
  originalname: 'notes.txt',
  ...overrides,
});

// ── allowlist (legacy Agentforge fileFilter) ────────────────────────────────
test('isAllowedFile: accepts pdf/docx/txt/md + images + .md/.txt extension fallback', () => {
  assert.equal(isAllowedFile(file({ mimetype: 'application/pdf' })), true);
  assert.equal(
    isAllowedFile(file({ mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })),
    true
  );
  assert.equal(isAllowedFile(file({ mimetype: 'text/plain' })), true);
  assert.equal(isAllowedFile(file({ mimetype: 'text/markdown' })), true);
  assert.equal(isAllowedFile(file({ mimetype: 'image/png' })), true);
  assert.equal(isAllowedFile(file({ mimetype: 'image/jpeg' })), true);
  assert.equal(isAllowedFile(file({ mimetype: 'image/webp' })), true);
  // Generic/empty mimetype with a known extension (clients that mislabel).
  assert.equal(isAllowedFile(file({ mimetype: 'application/octet-stream', originalname: 'prd.md' })), true);
  assert.equal(isAllowedFile(file({ mimetype: '', originalname: 'notes.txt' })), true);
});

test('isAllowedFile: rejects executables/scripts and unknown extensions', () => {
  assert.equal(isAllowedFile(file({ mimetype: 'text/html', originalname: 'x.html' })), false);
  assert.equal(isAllowedFile(file({ mimetype: 'application/x-msdownload', originalname: 'evil.exe' })), false);
  assert.equal(isAllowedFile(file({ mimetype: 'text/javascript', originalname: 'x.js' })), false);
  assert.equal(isAllowedFile(file({ mimetype: '', originalname: '' })), false);
});

// ── extraction ──────────────────────────────────────────────────────────────
test('extractFileText: plain text (and .md) is read as utf-8', async () => {
  const res = await extractFileText(file({ buffer: Buffer.from('list my agents') }));
  assert.equal(res.kind, 'text');
  assert.equal(res.text, 'list my agents');
});

test('extractFileText: pdf uses the injected parser', async () => {
  const pdf = async (buf) => ({ text: `parsed pdf (${buf.length} bytes)` });
  const res = await extractFileText(
    file({ mimetype: 'application/pdf', originalname: 'prd.pdf', buffer: Buffer.from('x') }),
    { pdf }
  );
  assert.equal(res.kind, 'text');
  assert.equal(res.text, 'parsed pdf (1 bytes)');
});

test('extractFileText: docx uses the injected mammoth', async () => {
  const docx = { extractRawText: async ({ buffer }) => ({ value: `docx text (${buffer.length})` }) };
  const res = await extractFileText(
    file({ mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', originalname: 'spec.docx', buffer: Buffer.from('abc') }),
    { docx }
  );
  assert.equal(res.kind, 'text');
  assert.equal(res.text, 'docx text (3)');
});

test('extractFileText: images are detected (base64 + mime), not parsed as text', async () => {
  const res = await extractFileText(file({ mimetype: 'image/png', originalname: 'shot.png' }));
  assert.equal(res.kind, 'image');
  assert.equal(res.mimeType, 'image/png');
  assert.equal(res.base64, Buffer.from('hello forge').toString('base64'));
});

test('extractFileText: missing file → none; empty extraction surfaces empty text', async () => {
  assert.equal((await extractFileText(null)).kind, 'none');
  const res = await extractFileText(file({ buffer: Buffer.from('') }));
  assert.equal(res.kind, 'text');
  assert.equal(res.text, '');
});

// ── prompt injection (legacy SYSTEM-INJECTION block) ────────────────────────
test('buildPromptWithAttachment keeps user words first, then the legacy injection block', () => {
  const out = buildPromptWithAttachment('summarize this', file(), 'file body');
  assert.ok(out.startsWith('summarize this\n\n=== SYSTEM INJECTION: ATTACHED DOCUMENT TEXT ==='));
  assert.ok(out.includes('The user attached a file named "notes.txt"'));
  assert.ok(out.includes('DO NOT tell the user you cannot read files'));
  assert.ok(out.includes('file body\n=== END ATTACHED DOCUMENT ==='));
});

test('buildPromptWithAttachment caps injected text at the legacy 50k', () => {
  const big = 'x'.repeat(MAX_INJECTED_CHARS + 10_000);
  const out = buildPromptWithAttachment('hi', file(), big);
  // user prompt (2) + block overhead + capped text — never the full 60k.
  assert.ok(out.length < MAX_INJECTED_CHARS + 1000, 'injected text must be capped');
  assert.ok(out.includes('x'.repeat(MAX_INJECTED_CHARS)));
  assert.ok(!out.includes('x'.repeat(MAX_INJECTED_CHARS + 1)));
});

// ── image attachments (Gemini inlineData, legacy parity) ────────────────────
test('buildImageParts returns the legacy [{ text }, { inlineData }] parts shape', () => {
  const parts = buildImageParts('what does this show', { base64: 'QUJD', mimeType: 'image/png' });
  assert.deepEqual(parts, [
    { text: 'what does this show' },
    { inlineData: { data: 'QUJD', mimeType: 'image/png' } },
  ]);
});

test('buildImageParts falls back to the legacy analyze-image prompt when empty', () => {
  const parts = buildImageParts('', { base64: 'QUJD', mimeType: 'image/webp' });
  assert.equal(parts[0].text, 'Please analyze this image.');
  assert.deepEqual(parts[1], { inlineData: { data: 'QUJD', mimeType: 'image/webp' } });
});
