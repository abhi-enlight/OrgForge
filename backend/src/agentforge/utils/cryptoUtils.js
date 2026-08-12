'use strict';

import crypto from 'crypto'

let ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
if (!ENCRYPTION_KEY) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('ENCRYPTION_KEY environment variable is required in production');
  }
  ENCRYPTION_KEY = crypto.createHash('sha256').update('fallback-encryption-key-for-dev').digest('hex');
} else if (ENCRYPTION_KEY.length !== 64) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('ENCRYPTION_KEY must be a 64-character hex string (32 bytes)');
  }
  ENCRYPTION_KEY = crypto.createHash('sha256').update(ENCRYPTION_KEY).digest('hex');
}

const ALGORITHM = 'aes-256-gcm';

function encrypt(text) {
  if (!text) return text;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

function decrypt(text) {
  if (!text) return text;
  const parts = text.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted format');
  const [ivHex, authTagHex, encryptedHex] = parts;
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    Buffer.from(ENCRYPTION_KEY, 'hex'),
    Buffer.from(ivHex, 'hex')
  );
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

export { encrypt, decrypt };
