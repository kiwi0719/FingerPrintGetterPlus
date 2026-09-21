import { test } from 'node:test';
import assert from 'node:assert/strict';
import { similarityScore, buildFlags } from '../src/risk.js';
import { fontsToBitmap, CANONICAL_FONTS } from '../src/fonts.js';

const device = {
  gpu_canon: 'ANGLE (NVIDIA, GeForce RTX 3080, D3D11)',
  audio_fp: 'a1b2c3',
  screen_res: '2560x1440',
  cores: 16,
  memory: 8,
  timezone: 'Asia/Shanghai',
  fonts_hash: 'deadbeef',
  fonts_bitmap: fontsToBitmap(CANONICAL_FONTS.slice(0, 30)),
};

test('identical devices score the maximum 10.5', () => {
  const { total } = similarityScore(device, { ...device });
  assert.equal(total, 10.5);
});

test('completely unrelated devices score 0', () => {
  const other = {
    gpu_canon: 'Apple M2', audio_fp: 'zzz', screen_res: '1920x1080',
    cores: 8, memory: 4, timezone: 'Europe/Berlin',
    fonts_hash: 'cafe', fonts_bitmap: fontsToBitmap(CANONICAL_FONTS.slice(50, 70)),
  };
  assert.equal(similarityScore(device, other).total, 0);
});

test('a new monitor only costs the screen_res point', () => {
  const moved = { ...device, screen_res: '3440x1440' };
  assert.equal(similarityScore(device, moved).total, 9.5);
});

test('null fields never match each other', () => {
  const blank = { cores: null, memory: null };
  const { parts } = similarityScore(blank, { cores: null, memory: null });
  assert.equal(parts.cores, 0, 'two unknown core counts are not evidence of a match');
  assert.equal(parts.memory, 0);
});

test('empty strings never match each other', () => {
  const { total } = similarityScore(
    { gpu_canon: '', audio_fp: '', screen_res: '', timezone: '', fonts_hash: '' },
    { gpu_canon: '', audio_fp: '', screen_res: '', timezone: '', fonts_hash: '' },
  );
  assert.equal(total, 0);
});

test('font drift falls back to hamming distance with a graded score', () => {
  const base = CANONICAL_FONTS.slice(0, 30);
  const a = { fonts_hash: 'h1', fonts_bitmap: fontsToBitmap(base) };
  // One font installed -> distance 1 -> 2 - 0.5 = 1.5
  const b = { fonts_hash: 'h2', fonts_bitmap: fontsToBitmap([...base, CANONICAL_FONTS[60]]) };
  const r = similarityScore(a, b);
  assert.equal(r.parts.fonts_hamming, 1);
  assert.equal(r.parts.fonts, 1.5);
});

test('font drift beyond the tolerance window scores 0', () => {
  const a = { fonts_hash: 'h1', fonts_bitmap: fontsToBitmap(CANONICAL_FONTS.slice(0, 30)) };
  const b = { fonts_hash: 'h2', fonts_bitmap: fontsToBitmap(CANONICAL_FONTS.slice(0, 20)) };
  assert.equal(similarityScore(a, b).parts.fonts_hamming, 10);
  assert.equal(similarityScore(a, b).parts.fonts, 0);
});

test('an exact fonts_hash match short-circuits the bitmap comparison', () => {
  const a = { fonts_hash: 'same', fonts_bitmap: fontsToBitmap(CANONICAL_FONTS.slice(0, 30)) };
  const b = { fonts_hash: 'same', fonts_bitmap: fontsToBitmap(CANONICAL_FONTS.slice(0, 10)) };
  const { parts } = similarityScore(a, b);
  assert.equal(parts.fonts, 2);
  assert.equal(parts.fonts_hamming, undefined);
});

test('similarity is symmetric', () => {
  const other = { ...device, screen_res: '1920x1080', cores: 8 };
  assert.equal(similarityScore(device, other).total, similarityScore(other, device).total);
});

test('parts always sum to total', () => {
  const other = { ...device, audio_fp: 'different', memory: 32 };
  const { total, parts } = similarityScore(device, other);
  const sum = parts.gpu + parts.audio + parts.screen + parts.cores + parts.memory + parts.tz + parts.fonts;
  assert.equal(total, +sum.toFixed(2));
});

const row = (over = {}) => ({ bot_score: 0, incognito: 0, ip_asn: 'AS13335', ...over });

test('buildFlags stays quiet for an ordinary device', () => {
  assert.deepEqual(buildFlags([row()], new Set(['s1']), new Set(['1.1.1.1'])), []);
});

test('buildFlags raises session-reuse and IP-hopping past the threshold', () => {
  const many = new Set(['a', 'b', 'c', 'd']);
  assert.ok(buildFlags([row()], many, new Set(['1.1.1.1'])).includes('same_device_many_sessions'));
  assert.ok(buildFlags([row()], new Set(['s1']), many).includes('device_ip_hopping'));
  // Exactly 3 is still under the bar.
  assert.deepEqual(buildFlags([row()], new Set(['a', 'b', 'c']), new Set(['a', 'b', 'c'])), []);
});

test('buildFlags reports automation, incognito and ASN spread', () => {
  assert.ok(buildFlags([row({ bot_score: 0.6 })], new Set(), new Set()).includes('automation_suspected'));
  assert.ok(!buildFlags([row({ bot_score: 0.59 })], new Set(), new Set()).includes('automation_suspected'));
  assert.ok(buildFlags([row({ incognito: 1 })], new Set(), new Set()).includes('incognito_seen'));
  const asns = [row({ ip_asn: 'AS1' }), row({ ip_asn: 'AS2' }), row({ ip_asn: 'AS3' })];
  assert.ok(buildFlags(asns, new Set(), new Set()).includes('cross_asn_device'));
});

test('buildFlags ignores rows with no ASN', () => {
  const rows = [row({ ip_asn: null }), row({ ip_asn: '' }), row({ ip_asn: 'AS1' })];
  assert.ok(!buildFlags(rows, new Set(), new Set()).includes('cross_asn_device'));
});
