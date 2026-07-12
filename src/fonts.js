// 规范字体列表(必须与 public/extra-signals.js 中的顺序完全一致)
// 客户端探测出「命中集」,服务端按此列表把命中集转成 128-bit bitmap(hex 编码)。
// 位数 = ceil(list.length / 8) * 8。当前 76 项 → 96 bit,pad 到 128 bit(16 字节)以留出扩展余量。
export const CANONICAL_FONTS = [
  'Arial','Arial Black','Arial Narrow','Helvetica','Helvetica Neue','Times New Roman','Times',
  'Courier New','Courier','Verdana','Georgia','Palatino','Palatino Linotype','Garamond','Bookman',
  'Comic Sans MS','Trebuchet MS','Impact','Consolas','Monaco','Lucida Console','Lucida Grande',
  'Lucida Sans Unicode','Tahoma','Century Gothic','Franklin Gothic','Rockwell','Copperplate',
  'PingFang SC','PingFang TC','PingFang HK','Microsoft YaHei','Microsoft JhengHei','SimSun','SimHei',
  'FangSong','KaiTi','STHeiti','STSong','STFangsong','Hiragino Sans','Hiragino Kaku Gothic Pro',
  'MS Gothic','MS Mincho','Yu Gothic','Meiryo','Noto Sans CJK JP','Noto Sans CJK SC','Noto Sans CJK KR',
  'Malgun Gothic','Batang','Gulim','Dotum',
  'Segoe UI','Segoe UI Symbol','Segoe UI Emoji','Roboto','Roboto Mono','San Francisco','SF Pro','SF Mono',
  'Menlo','Cascadia Code','Cascadia Mono','JetBrains Mono','Fira Code','Source Code Pro','Ubuntu',
  'Ubuntu Mono','DejaVu Sans','DejaVu Sans Mono','Liberation Sans','Liberation Mono','Inconsolata',
  'Apple Color Emoji','Noto Color Emoji','Twemoji Mozilla',
];

const BITMAP_BYTES = 16; // 128 bit,预留扩展位

/** 将「命中字体列表」编码成 16 字节(128 bit)hex 字符串。 */
export function fontsToBitmap(detectedList) {
  const bytes = new Uint8Array(BITMAP_BYTES);
  const set = new Set(detectedList || []);
  for (let i = 0; i < CANONICAL_FONTS.length && i < BITMAP_BYTES * 8; i++) {
    if (set.has(CANONICAL_FONTS[i])) {
      bytes[i >> 3] |= 1 << (i & 7);
    }
  }
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 两个 hex 编码的 bitmap 之间的汉明距离(0 = 完全相同,越大差异越大)。 */
export function hammingHex(a, b) {
  if (!a || !b || a.length !== b.length) return Infinity;
  let d = 0;
  for (let i = 0; i < a.length; i += 2) {
    const x = parseInt(a.slice(i, i + 2), 16) ^ parseInt(b.slice(i, i + 2), 16);
    // Kernighan popcount
    let v = x;
    while (v) { v &= v - 1; d++; }
  }
  return d;
}

/** GPU renderer 字符串规范化:去掉驱动版本/D3D shader model 尾巴,便于同机不同驱动版本匹配。 */
export function canonicalGpu(renderer) {
  if (!renderer) return '';
  return String(renderer)
    .replace(/Direct3D\d+ vs_[\d_]+ ps_[\d_]+/gi, '')
    .replace(/,\s*OpenGL[^)]*/gi, '')
    .replace(/\s+\d+\.\d+(\.\d+)*/g, ' ')  // 剥离形如 "535.129.03" 的驱动版本
    .replace(/\s+/g, ' ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .trim();
}
