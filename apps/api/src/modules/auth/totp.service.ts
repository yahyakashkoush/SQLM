import { createHmac, randomBytes } from 'node:crypto';
import { Injectable, BadRequestException } from '@nestjs/common';

const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const TOTP_DIGITS = 6;
const TOTP_STEP_SECS = 30;
const TOTP_WINDOW = 1; // ±1 step (90s tolerance for clock drift)

function base32Encode(buf: Buffer): string {
  let out = '';
  let bits = 0;
  let acc = 0;
  for (const byte of buf) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += BASE32_CHARS[(acc >> bits) & 0x1f];
    }
  }
  if (bits > 0) out += BASE32_CHARS[(acc << (5 - bits)) & 0x1f];
  return out;
}

function base32Decode(s: string): Buffer {
  const cleaned = s.toUpperCase().replace(/=+$/, '');
  let bits = 0;
  let acc = 0;
  const out: number[] = [];
  for (const ch of cleaned) {
    const val = BASE32_CHARS.indexOf(ch);
    if (val === -1) throw new Error('Invalid base32');
    acc = (acc << 5) | val;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
  }
  return Buffer.from(out);
}

function hotp(secret: Buffer, counter: bigint): number {
  const buf = Buffer.allocUnsafe(8);
  buf.writeBigUInt64BE(counter);
  const mac = createHmac('sha1', secret).update(buf).digest();
  const offset = mac.at(-1)! & 0x0f;
  const code =
    ((mac.at(offset)! & 0x7f) << 24) |
    (mac.at(offset + 1)! << 16) |
    (mac.at(offset + 2)! << 8) |
    mac.at(offset + 3)!;
  return code % 10 ** TOTP_DIGITS;
}

function totpAt(secret: Buffer, t: number): number {
  return hotp(secret, BigInt(Math.floor(t / TOTP_STEP_SECS)));
}

@Injectable()
export class TotpService {
  /** Generate a fresh base32 secret (20 bytes = 160 bits). */
  generateSecret(): string {
    return base32Encode(randomBytes(20));
  }

  /** Build a `otpauth://totp/…` URI for QR code generation. */
  otpauthUri(label: string, secret: string, issuer = 'SQLM Admin'): string {
    const params = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: String(TOTP_DIGITS), period: String(TOTP_STEP_SECS) });
    return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`;
  }

  /** Verify a 6-digit code with ±TOTP_WINDOW step tolerance. */
  verify(secret: string, code: string): boolean {
    let secretBuf: Buffer;
    try {
      secretBuf = base32Decode(secret);
    } catch {
      return false;
    }
    const now = Date.now() / 1000;
    const target = parseInt(code, 10);
    if (!Number.isFinite(target)) return false;
    for (let delta = -TOTP_WINDOW; delta <= TOTP_WINDOW; delta++) {
      if (totpAt(secretBuf, now + delta * TOTP_STEP_SECS) === target) return true;
    }
    return false;
  }

  assertValid(secret: string, code: string): void {
    if (!this.verify(secret, code)) throw new BadRequestException('Invalid TOTP code');
  }
}
