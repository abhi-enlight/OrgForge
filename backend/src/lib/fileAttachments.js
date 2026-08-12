import { createRequire } from 'node:module';
import mammoth from 'mammoth';

const require = createRequire(import.meta.url);
// pdf-parse's main entry runs a debug-mode test-file load when it has no
// parent module; ESM imports defeat the `module.parent` check and crash on
// the missing test PDF. Importing the parser directly (lib/pdf-parse.js) is
// the canonical workaround — same parser, no debug side effects.
const pdfParse = require('pdf-parse/lib/pdf-parse.js');

/** Multer file-size limit (legacy parity — Agentforge's 10MB). */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** Legacy 50k cap on the injected document text. */
export const MAX_INJECTED_CHARS = 50_000;

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * Legacy allowlist (Agentforge src/index.js fileFilter): PDF, DOCX, TXT, MD,
 * plus the three image types (png/jpeg/webp). .md/.txt extension fallback
 * covers clients that send a generic/empty mimetype.
 */
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  DOCX_MIME,
  'text/plain',
  'text/markdown',
  'image/png',
  'image/jpeg',
  'image/webp',
]);

export function isAllowedFile(file) {
  return (
    ALLOWED_MIME_TYPES.has(file?.mimetype) ||
    file?.originalname?.endsWith('.md') ||
    file?.originalname?.endsWith('.txt')
  );
}

/**
 * Extracts attachment content for prompt injection (legacy parity).
 *
 *   - image/*  → { kind: 'image', base64, mimeType, originalname } — the AGENT
 *     engine receives it as Gemini inlineData parts (buildImageParts); the
 *     ORG engine receives a vision description (see chat/stream).
 *   - pdf      → { kind: 'text', text } via pdf-parse
 *   - docx     → { kind: 'text', text } via mammoth
 *   - else     → { kind: 'text', text } raw utf-8
 *
 * Parsers are injectable so unit tests never touch the real libraries.
 *
 * @param {object} file - multer file ({ buffer, mimetype, originalname })
 * @param {{ pdf?: (buffer: Buffer) => Promise<{text: string}>, docx?: object }} [parsers]
 */
export async function extractFileText(
  file,
  { pdf = pdfParse, docx = mammoth } = {}
) {
  if (!file) return { kind: 'none' };
  if (file.mimetype?.startsWith('image/')) {
    return {
      kind: 'image',
      mimeType: file.mimetype,
      base64: file.buffer.toString('base64'),
      originalname: file.originalname,
    };
  }

  let text = '';
  if (file.mimetype === 'application/pdf') {
    const data = await pdf(file.buffer);
    text = data?.text || '';
  } else if (file.mimetype === DOCX_MIME) {
    const result = await docx.extractRawText({ buffer: file.buffer });
    text = result?.value || '';
  } else {
    text = file.buffer.toString('utf-8');
  }
  return { kind: 'text', text, originalname: file.originalname };
}

/**
 * Builds the Gemini message parts for an image attachment — the legacy
 * Agentforge shape (src/index.js: `[{ text }, { inlineData }]`), passed to the
 * AGENT engine's ConversationManager chat (which accepts string | part[] as
 * the user message). The text part keeps the user's own words first.
 *
 * @param {string} userPrompt - the raw user message
 * @param {{ base64: string, mimeType: string }} image - from extractFileText
 * @returns {Array<{text: string} | {inlineData: {data: string, mimeType: string}}>}
 */
export function buildImageParts(userPrompt, image) {
  return [
    { text: userPrompt || 'Please analyze this image.' },
    { inlineData: { data: image.base64, mimeType: image.mimeType } },
  ];
}

/**
 * Builds the effective engine prompt for a text attachment — the legacy
 * SYSTEM-INJECTION block (Agentforge src/index.js), verbatim shape, capped at
 * MAX_INJECTED_CHARS. The user's own words stay first so intent routing
 * (which runs on the raw message) is unaffected.
 *
 * @param {string} userPrompt - the raw user message
 * @param {object} file - multer file (for originalname)
 * @param {string} text - extracted document text
 */
export function buildPromptWithAttachment(userPrompt, file, text) {
  const injected = text.substring(0, MAX_INJECTED_CHARS);
  return (
    `${userPrompt}\n\n=== SYSTEM INJECTION: ATTACHED DOCUMENT TEXT ===\n` +
    `[SYSTEM NOTE TO AI: The user attached a file named "${file.originalname}". ` +
    'The text has been extracted and provided below. DO NOT tell the user you cannot read files. ' +
    "You HAVE the full text right here, so read it and fulfill the user's request immediately.]\n\n" +
    `${injected}\n=== END ATTACHED DOCUMENT ===\n`
  );
}
