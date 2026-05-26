import crypto from 'crypto';

export type EpayParams = Record<string, string | number | boolean | null | undefined>;

function normalizePublicBaseUrl(value?: string | null): string | null {
  const trimmed = String(value || '').trim().replace(/\/+$/, '');
  if (!trimmed || !/^https?:\/\//i.test(trimmed)) return null;

  try {
    const parsed = new URL(trimmed);
    const hostname = parsed.hostname.toLowerCase();
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
      return null;
    }
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

export function normalizeEpayApiUrl(apiUrl: string): string {
  const trimmed = (apiUrl || '').trim() || 'https://vip1.zhunfu.cn/';
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
}

export function buildEpaySign(params: EpayParams, key: string): string {
  const signSource = Object.entries(params)
    .filter(([name, value]) => name !== 'sign' && name !== 'sign_type' && value !== undefined && value !== null && String(value) !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => `${name}=${String(value)}`)
    .join('&');

  return crypto.createHash('md5').update(`${signSource}${key}`).digest('hex');
}

export function verifyEpaySign(params: EpayParams, key: string): boolean {
  const sign = typeof params.sign === 'string' ? params.sign : '';
  if (!sign) return false;
  return buildEpaySign(params, key).toLowerCase() === sign.toLowerCase();
}

export function buildEpaySubmitUrl(apiUrl: string, params: EpayParams, key: string): string {
  const signedParams = {
    ...params,
    sign: buildEpaySign(params, key),
    sign_type: 'MD5',
  };
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(signedParams)) {
    if (value === undefined || value === null) continue;
    query.set(name, String(value));
  }
  return `${normalizeEpayApiUrl(apiUrl)}submit.php?${query.toString()}`;
}

export function getBaseUrlFromRequest(request: Request): string {
  const envUrl = normalizePublicBaseUrl(
    process.env.SANHUB_PUBLIC_BASE_URL || process.env.NEXTAUTH_URL || process.env.APP_URL || process.env.PUBLIC_BASE_URL
  );
  if (envUrl) return envUrl;

  const forwardedProto = request.headers.get('x-forwarded-proto') || 'http';
  const forwardedHost = request.headers.get('x-forwarded-host') || request.headers.get('host') || 'localhost:3000';
  const forwardedUrl = normalizePublicBaseUrl(`${forwardedProto}://${forwardedHost}`);
  if (forwardedUrl) return forwardedUrl;

  return `${forwardedProto}://${forwardedHost}`.replace(/\/$/, '');
}
