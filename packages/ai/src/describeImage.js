import { GoogleGenAI } from '@google/genai';

/**
 * Vision describe for image attachments (plan §10.1 — the org-change
 * pipeline's Gemini calls are text-based, so an attached image is turned into
 * a concise text description that gets injected through the standard
 * SYSTEM-INJECTION block; the AGENT engine instead receives the image as
 * Gemini `inlineData` parts directly — legacy Agentforge parity).
 *
 * Uses inlineData (base64 + mimeType) — the same wire shape the classifier
 * and engines use via @google/genai. Lazily instantiated (OrgForge
 * convention): a missing GOOGLE_AI_API_KEY fails at call time, not at boot.
 *
 * @param {object} opts
 * @param {string} opts.base64 - image bytes as base64 (no data: prefix)
 * @param {string} opts.mimeType - image/png | image/jpeg | image/webp
 * @param {string} [opts.hint] - the user's message, so the description focuses
 *   on what matters for the request
 * @param {string} [opts.model] - override GEMINI_MODEL
 * @returns {Promise<string>} the description text ('' on empty response)
 */
export async function describeImage({ base64, mimeType, hint = '', model } = {}) {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey || apiKey === 'DUMMY_KEY') {
    throw new Error('GOOGLE_AI_API_KEY is not set. Configure it to analyze attached images.');
  }
  const ai = new GoogleGenAI({ apiKey });
  const prompt =
    'You are Forge, a Salesforce admin assistant. Describe the attached image concisely ' +
    '(what it shows, any text/UI/config it contains, anything relevant to a Salesforce ' +
    'metadata change). The user\'s request is: ' +
    (hint ? `"${String(hint).slice(0, 2_000)}"` : '(none)') +
    '. Focus the description on what that request needs. Do not mention that you are ' +
    'describing an image; the description will be fed to the request pipeline as context.';

  const response = await ai.models.generateContent({
    model: model || process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    contents: [
      {
        role: 'user',
        parts: [
          { text: prompt },
          { inlineData: { mimeType, data: base64 } },
        ],
      },
    ],
    config: { maxOutputTokens: 800 },
  });
  return response?.text ?? '';
}
