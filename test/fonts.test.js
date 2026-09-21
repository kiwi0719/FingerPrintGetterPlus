import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CANONICAL_FONTS, fontsToBitmap, hammingHex, canonicalGpu } from '../src/fonts.js';

test('CANONICAL_FONTS fits in the 128-bit bitmap', () => {
  assert.ok(CANONICAL_FONTS.length <= 128,
    'font list outgrew the bitmap; widen BITMAP_BYTES and re-encode historical rows');
  assert.equal(new Set(CANONICAL_FONTS).size, CANONICAL_FONTS.length, 'duplicate font names');
});

test('fontsToBitmap produces a fixed-width hex string', () => {
  assert.equal(fontsToBitmap([]).length, 32);          // 16 bytes -> 32 hex chars
  assert.equal(fontsToBitmap([]), '0'.repeat(32));
  assert.equal(fontsToBitmap(null).length, 32);        // tolerates missing input
  assert.equal(fontsToBitmap(undefined), '0'.repeat(32));
});

test('fontsToBitmap sets the bit matching the font index', () => {
  // index 0 -> byte 0, bit 0 -> 0x01
  assert.equal(fontsToBitmap([CANONICAL_FONTS[0]]).slice(0, 2), '01');
  // index 8 -> byte 1, bit 0
  const bm = fontsToBitmap([CANONICAL_FONTS[8]]);
  assert.equal(bm.slice(0, 2), '00');
  assert.equal(bm.slice(2, 4), '01');
});

test('fontsToBitmap ignores fonts outside the canonical list', () => {
  assert.equal(fontsToBitmap(['Totally Not A Real Font']), '0'.repeat(32));
});

test('fontsToBitmap is order-independent', () => {
  const a = [CANONICAL_FONTS[1], CANONICAL_FONTS[5], CANONICAL_FONTS[30]];
  assert.equal(fontsToBitmap(a), fontsToBitmap([...a].reverse()));
});

test('hammingHex counts differing bits', () => {
  assert.equal(hammingHex('00', '00'), 0);
  assert.equal(hammingHex('00', 'ff'), 8);
  assert.equal(hammingHex('0f', 'f0'), 8);
  assert.equal(hammingHex('01', '00'), 1);
});

test('hammingHex returns Infinity for unusable input', () => {
  assert.equal(hammingHex('', 'ff'), Infinity);
  assert.equal(hammingHex(null, 'ff'), Infinity);
  assert.equal(hammingHex('ffff', 'ff'), Infinity);   // length mismatch
});

test('hammingHex over real bitmaps equals the symmetric difference', () => {
  const base = CANONICAL_FONTS.slice(0, 20);
  const drifted = [...base.slice(0, 18), CANONICAL_FONTS[40]];  // -2 fonts, +1 font
  assert.equal(hammingHex(fontsToBitmap(base), fontsToBitmap(drifted)), 3);
});

test('canonicalGpu strips D3D shader model and driver versions', () => {
  const angle = canonicalGpu('ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Direct3D11 vs_5_0 ps_5_0, D3D11)');
  assert.ok(!angle.includes('vs_5_0'), 'shader model should be stripped');
  assert.ok(angle.includes('GeForce RTX 3080'), 'the GPU model itself must survive');
  assert.ok(!canonicalGpu('Mesa Intel(R) UHD Graphics 535.129.03').includes('535.129.03'));
});

test('canonicalGpu collapses driver-version drift on the same machine', () => {
  const a = canonicalGpu('ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x00009A49) Direct3D11 vs_5_0 ps_5_0, D3D11)');
  const b = canonicalGpu('ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x00009A49) Direct3D11 vs_5_0 ps_5_0, D3D11)');
  assert.equal(a, b);
});

test('canonicalGpu handles empty input', () => {
  assert.equal(canonicalGpu(''), '');
  assert.equal(canonicalGpu(null), '');
  assert.equal(canonicalGpu(undefined), '');
});
