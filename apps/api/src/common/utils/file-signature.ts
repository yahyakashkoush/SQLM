/**
 * Verifies a file's real type from its leading bytes.
 *
 * `file.mimetype` from multer is just the client's Content-Type header —
 * entirely attacker-controlled. Checking the declared type alone lets
 * anything through under an image/png label, so uploads are also matched
 * against the actual signature before they reach storage.
 */
const SIGNATURES: Record<string, Array<{ offset: number; bytes: number[] }>> = {
  'image/jpeg': [{ offset: 0, bytes: [0xff, 0xd8, 0xff] }],
  'image/png': [{ offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }],
  // RIFF....WEBP — the size field sits between the two markers.
  'image/webp': [
    { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] },
    { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] },
  ],
  'image/gif': [{ offset: 0, bytes: [0x47, 0x49, 0x46, 0x38] }],
  'application/pdf': [{ offset: 0, bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] }],
};

export function matchesDeclaredType(buffer: Buffer, declaredMimeType: string): boolean {
  const signature = SIGNATURES[declaredMimeType];
  if (!signature) return false;

  return signature.every(({ offset, bytes }) =>
    bytes.every((byte, i) => buffer[offset + i] === byte),
  );
}
