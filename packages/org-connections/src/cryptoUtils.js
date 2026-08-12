import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';

/**
 * Encrypts a plain text string using AES-256-GCM.
 * Format: iv:authTag:encryptedData (identical to both legacy implementations,
 * so tokens encrypted by either engine remain decryptable here — D4).
 *
 * @param {string} text - the plain text to encrypt
 * @param {string} keyHex - 64-character hex string (32 bytes)
 * @returns {string|null} encrypted string, or null when text is empty
 */
export function encrypt(text, keyHex) {
  if (!text) return null;
  if (!keyHex) throw new Error('Missing encryption key.');
  const key = Buffer.from(keyHex, 'hex');
  if (key.length !== 32) throw new Error('Encryption key must be 32 bytes (64 hex chars).');

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypts a string formatted as iv:authTag:encryptedData.
 *
 * @param {string} encryptedStr - the encrypted string
 * @param {string} keyHex - 64-character hex string (32 bytes)
 * @returns {string|null} plain text, or null when the input is empty
 */
export function decrypt(encryptedStr, keyHex) {
  if (!encryptedStr) return null;
  if (!keyHex) throw new Error('Missing encryption key.');
  const key = Buffer.from(keyHex, 'hex');
  if (key.length !== 32) throw new Error('Encryption key must be 32 bytes (64 hex chars).');

  const parts = encryptedStr.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted format. Expected iv:authTag:encryptedData');

  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encrypted = parts[2];

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}
