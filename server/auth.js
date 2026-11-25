import crypto from 'node:crypto';

const COOKIE_NAME = 'homehub_session';
const SESSION_TTL_SEC = 60 * 60 * 24 * 30; // 30 days

function getSecret() {
  return process.env.SESSION_SECRET || 'home-hub-dev-secret-change-in-production';
}

function sign(payloadB64) {
  return crypto
    .createHmac('sha256', getSecret())
    .update(payloadB64)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

export function createSessionToken(member) {
  const payload = {
    memberId: member.id,
    householdId: member.householdId,
    role: member.role,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SEC,
  };
  const b64 = Buffer.from(JSON.stringify(payload))
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${b64}.${sign(b64)}`;
}

export function verifySessionToken(token) {
  if (!token || !token.includes('.')) return null;
  const [b64, sig] = token.split('.');
  const expected = sign(b64);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const padded = b64.replace(/-/g, '+').replace(/_/g, '/');
    const parsed = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
    if (!parsed.exp || parsed.exp < Math.floor(Date.now() / 1000)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function parseCookies(cookieHeader = '') {
  const out = {};
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(val);
  }
  return out;
}

export function getSessionFromRequest(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  const token = cookies[COOKIE_NAME];
  return verifySessionToken(token);
}

export function buildSessionCookie(member, { secure = false } = {}) {
  const token = createSessionToken(member);
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_TTL_SEC}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function buildClearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function sanitizeMember(member) {
  if (!member) return null;
  const { passwordHash, magicToken, magicTokenExpiresAt, ...safe } = member;
  return safe;
}
