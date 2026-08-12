/**
 * Unit tests for cryptoUtils.js
 * Run: npm test
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { encrypt, decrypt } from './cryptoUtils.js';

// Valid 64-char hex key (32 bytes)
const VALID_KEY = 'a'.repeat(64);
const PLAINTEXT = '{"accessToken":"00D123","refreshToken":"abc","expiresAt":9999999999999}';

describe('encrypt', () => {
  it('returns a non-empty string in iv:authTag:encrypted format', () => {
    const result = encrypt(PLAINTEXT, VALID_KEY);
    assert.equal(typeof result, 'string');
    const parts = result.split(':');
    assert.equal(parts.length, 3, 'Must have 3 colon-separated segments');
    // Each segment is hex-encoded so should be non-empty
    for (const part of parts) {
      assert.ok(part.length > 0);
    }
  });

  it('produces different ciphertext on each call (random IV)', () => {
    const enc1 = encrypt(PLAINTEXT, VALID_KEY);
    const enc2 = encrypt(PLAINTEXT, VALID_KEY);
    // IVs differ → different ciphertexts even for the same plaintext
    assert.notEqual(enc1, enc2);
  });

  it('throws for missing key', () => {
    assert.throws(() => encrypt(PLAINTEXT, undefined), /key/i);
    assert.throws(() => encrypt(PLAINTEXT, ''), /key/i);
  });

  it('throws for key that is not 64 hex chars', () => {
    assert.throws(() => encrypt(PLAINTEXT, 'tooshort'), /key/i);
  });
});

describe('decrypt', () => {
  it('round-trips correctly', () => {
    const encrypted = encrypt(PLAINTEXT, VALID_KEY);
    const decrypted = decrypt(encrypted, VALID_KEY);
    assert.equal(decrypted, PLAINTEXT);
  });

  it('throws for tampered ciphertext (auth tag mismatch)', () => {
    const encrypted = encrypt(PLAINTEXT, VALID_KEY);
    // Flip one character in the encrypted data segment
    const parts = encrypted.split(':');
    parts[2] = parts[2].slice(0, -2) + (parts[2].endsWith('00') ? 'ff' : '00');
    const tampered = parts.join(':');
    assert.throws(() => decrypt(tampered, VALID_KEY), /decrypt|auth|tag|unsupported/i);
  });

  it('throws when using a different key', () => {
    const encrypted = encrypt(PLAINTEXT, VALID_KEY);
    const wrongKey = 'b'.repeat(64);
    assert.throws(() => decrypt(encrypted, wrongKey));
  });

  it('throws for malformed input (wrong number of segments)', () => {
    assert.throws(() => decrypt('notvalid', VALID_KEY));
    assert.throws(() => decrypt('a:b', VALID_KEY)); // missing 3rd segment
  });
});
