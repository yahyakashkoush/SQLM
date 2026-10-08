import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM for individual inventory payloads (account credentials,
 * license keys, vouchers). Ciphertext is stored as `iv:authTag:data`
 * (base64 each), so `INVENTORY_ENCRYPTION_KEY` is the only secret an
 * attacker with DB access alone can't work around. Used by the inventory
 * service (delivery-time decrypt) and the database seed script — kept here,
 * not duplicated, because both need the exact same wire format.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

function keyFromHex(keyHex: string): Buffer {
  const key = Buffer.from(keyHex, 'hex');
  if (key.length !== 32) {
    throw new Error('INVENTORY_ENCRYPTION_KEY must decode to exactly 32 bytes (64 hex chars)');
  }
  return key;
}

export function encryptSecret(plaintext: string, keyHex: string): string {
  const key = keyFromHex(keyHex);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
}

export function decryptSecret(ciphertext: string, keyHex: string): string {
  const key = keyFromHex(keyHex);
  const [ivB64, authTagB64, dataB64] = ciphertext.split(':');
  if (!ivB64 || !authTagB64 || !dataB64) {
    throw new Error('Malformed encrypted inventory payload');
  }
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(authTagB64, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}
