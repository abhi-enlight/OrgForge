import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encrypt, decrypt } from './cryptoUtils.js';

const KEY = 'a'.repeat(64); // valid 64-hex-char key

test('encrypt/decrypt round-trip', () => {
  const plaintext = '{"accessToken":"00Dx...","refreshToken":"5Aep...","expiresAt":1750000000000}';
  const encrypted = encrypt(plaintext, KEY);
  assert.ok(encrypted, 'should return an encrypted string');
  assert.equal(encrypted.split(':').length, 3, 'format must be iv:authTag:encryptedData');

  const decrypted = decrypt(encrypted, KEY);
  assert.equal(decrypted, plaintext);
});

test('produces a unique ciphertext per call (random IV)', () => {
  const a = encrypt('same text', KEY);
  const b = encrypt('same text', KEY);
  assert.notEqual(a, b, 'random IV must produce different ciphertexts');
});

test('decrypt fails (throws) with a wrong key', () => {
  const encrypted = encrypt('secret tokens', KEY);
  const wrongKey = 'b'.repeat(64);
  assert.throws(() => decrypt(encrypted, wrongKey), /Unsupported state or unable to authenticate/i);
});

test('null/empty handling', () => {
  assert.equal(encrypt('', KEY), null);
  assert.equal(decrypt('', KEY), null);
});

test('validates key length', () => {
  assert.throws(() => encrypt('x', 'short'), /32 bytes/);
  assert.throws(() => decrypt('a:b:c', 'short'), /32 bytes/);
  assert.throws(() => encrypt('x', ''), /Missing encryption key/);
});

test('rejects malformed encrypted format', () => {
  assert.throws(() => decrypt('not-an-encrypted-string', KEY), /Invalid encrypted format/);
});
