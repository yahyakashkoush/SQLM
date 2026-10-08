import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encryptSecret, decryptSecret } from './inventory-encryption';

const KEY = '85f4eb2f2bd00d6ae814204f783ecea62825d654dcbecc567bb0aa191b855d0e';
const OTHER_KEY = '00000000000000000000000000000000000000000000000000000000000000';

test('encrypts and decrypts back to the original plaintext', () => {
  const plaintext = 'demo1@example.com:Passw0rd!';
  const ciphertext = encryptSecret(plaintext, KEY);
  assert.equal(decryptSecret(ciphertext, KEY), plaintext);
});

test('produces different ciphertext for the same plaintext each call (random IV)', () => {
  const plaintext = 'same-input';
  const a = encryptSecret(plaintext, KEY);
  const b = encryptSecret(plaintext, KEY);
  assert.notEqual(a, b);
});

test('fails to decrypt with the wrong key', () => {
  const ciphertext = encryptSecret('secret-value', KEY);
  assert.throws(() => decryptSecret(ciphertext, OTHER_KEY));
});

test('fails to decrypt tampered ciphertext (auth tag mismatch)', () => {
  const ciphertext = encryptSecret('secret-value', KEY);
  const [iv, tag, data] = ciphertext.split(':');
  const tampered = `${iv}:${tag}:${data!.slice(0, -2)}${data!.slice(-2) === 'AA' ? 'BB' : 'AA'}`;
  assert.throws(() => decryptSecret(tampered, KEY));
});

test('rejects a key that is not 32 bytes', () => {
  assert.throws(() => encryptSecret('x', 'deadbeef'));
});
