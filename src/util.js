export function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...extra },
  });
}

export function notFound() {
  return json({ error: 'not_found' }, 404);
}

export function unauthorized() {
  return json({ error: 'unauthorized' }, 401);
}

// 随机 token:len 个字符,均匀取自 36 字符表(0-9a-z)。
// 旧实现用 byte.toString(36) 再截断,每个字节只映射到 "0".."73",
// 分布不均且浪费一半熵。这里用拒绝采样去掉模偏差,每字符都是均匀的。
export function randToken(len = 24) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const out = [];
  const buf = new Uint8Array(len);
  while (out.length < len) {
    crypto.getRandomValues(buf);
    for (let i = 0; i < buf.length && out.length < len; i++) {
      // 252 = 36*7,最大的 36 的倍数且 <= 256;丢弃 >=252 的字节以保持均匀。
      if (buf[i] < 252) out.push(alphabet[buf[i] % 36]);
    }
  }
  return out.join('');
}

// SHA-256 hex
export async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// 常量时间比较:先各自 SHA-256 成定长摘要再逐字节异或累计,
// 避免按字符短路泄露密钥前缀长度,也避免长度差异本身泄露信息。
export async function timingSafeEqual(a, b) {
  const [ha, hb] = await Promise.all([sha256(String(a)), sha256(String(b))]);
  let diff = 0;
  for (let i = 0; i < ha.length; i++) diff |= ha.charCodeAt(i) ^ hb.charCodeAt(i);
  return diff === 0;
}

// 校验管理密钥。只认 x-admin-key 头:放在 query 里会进访问日志、浏览器历史和 Referer。
export async function checkAdmin(request, env) {
  const key = request.headers.get('x-admin-key');
  if (!env.ADMIN_KEY || !key) return false;
  return timingSafeEqual(key, env.ADMIN_KEY);
}
