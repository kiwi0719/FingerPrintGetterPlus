export function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...extra },
  });
}

export function cors(resp) {
  const h = new Headers(resp.headers);
  h.set('access-control-allow-origin', '*');
  h.set('access-control-allow-methods', 'GET,POST,OPTIONS');
  h.set('access-control-allow-headers', 'content-type,x-admin-key');
  return new Response(resp.body, { status: resp.status, headers: h });
}

export function notFound() {
  return json({ error: 'not_found' }, 404);
}

export function unauthorized() {
  return json({ error: 'unauthorized' }, 401);
}

// 随机 token
export function randToken(len = 24) {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, len);
}

// SHA-256 hex
export async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// 校验管理密钥(header 或 query)
export function checkAdmin(request, env, url) {
  const key = request.headers.get('x-admin-key') || (url && url.searchParams.get('key'));
  return env.ADMIN_KEY && key === env.ADMIN_KEY;
}
