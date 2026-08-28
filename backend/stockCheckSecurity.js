import { timingSafeEqual, randomBytes, scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);

const COOKIE_NAME = 'teryaq_stock_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 5;
const SEARCH_WINDOW_MS = 60 * 1000;
const SEARCH_MAX_REQUESTS = 60;

const sessions = new Map();
const loginAttempts = new Map();
const searchAttempts = new Map();

function now() {
  return Date.now();
}

function clientIp(req) {
  return String(req.headers['cf-connecting-ip'] || req.ip || req.socket?.remoteAddress || 'unknown');
}

function parseCookies(header = '') {
  return String(header)
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const separatorIndex = part.indexOf('=');
      if (separatorIndex === -1) return cookies;
      const key = decodeURIComponent(part.slice(0, separatorIndex).trim());
      const value = decodeURIComponent(part.slice(separatorIndex + 1).trim());
      cookies[key] = value;
      return cookies;
    }, {});
}

function cookieOptions(req) {
  const isSecure =
    req.secure ||
    req.headers['x-forwarded-proto'] === 'https' ||
    process.env.NODE_ENV === 'production' ||
    process.env.STOCK_CHECK_SECURE_COOKIES === 'true';
  return [
    `${COOKIE_NAME}=`,
    'Path=/api/stock-check',
    'HttpOnly',
    'SameSite=Lax',
    isSecure ? 'Secure' : '',
    'Max-Age=0'
  ].filter(Boolean);
}

function setSessionCookie(res, req, sessionId) {
  const isSecure =
    req.secure ||
    req.headers['x-forwarded-proto'] === 'https' ||
    process.env.NODE_ENV === 'production' ||
    process.env.STOCK_CHECK_SECURE_COOKIES === 'true';
  res.setHeader(
    'Set-Cookie',
    [
      `${COOKIE_NAME}=${encodeURIComponent(sessionId)}`,
      'Path=/api/stock-check',
      'HttpOnly',
      'SameSite=Lax',
      isSecure ? 'Secure' : '',
      `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`
    ].filter(Boolean).join('; ')
  );
}

function clearSessionCookie(res, req) {
  res.setHeader('Set-Cookie', cookieOptions(req).join('; '));
}

function pruneExpired(map) {
  const current = now();
  for (const [key, value] of map.entries()) {
    if (value.expiresAt <= current) map.delete(key);
  }
}

function rateLimit(map, key, maxAttempts, windowMs) {
  pruneExpired(map);
  const current = now();
  const entry = map.get(key);
  if (!entry || entry.expiresAt <= current) {
    map.set(key, { count: 1, expiresAt: current + windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  if (entry.count >= maxAttempts) {
    return { allowed: false, retryAfterSeconds: Math.ceil((entry.expiresAt - current) / 1000) };
  }
  entry.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

function clearRateLimit(map, key) {
  map.delete(key);
}

function unauthorized(res) {
  res.status(401).json({ success: false, message: 'جلسة غير مصرح بها.' });
}

function configuredPinHash() {
  return process.env.STOCK_CHECK_PIN_HASH || '';
}

function parseScryptHash(hash) {
  const parts = String(hash).split(':');
  if (parts.length !== 5 || parts[0] !== 'scrypt' || parts[1] !== 'v1') {
    throw new Error('Invalid STOCK_CHECK_PIN_HASH format.');
  }
  return {
    salt: Buffer.from(parts[2], 'hex'),
    key: Buffer.from(parts[3], 'hex'),
    keyLength: Number(parts[4])
  };
}

export async function hashStockCheckPin(pin) {
  const salt = randomBytes(16);
  const keyLength = 32;
  const key = await scrypt(String(pin), salt, keyLength);
  return `scrypt:v1:${salt.toString('hex')}:${key.toString('hex')}:${keyLength}`;
}

export async function verifyStockCheckPin(pin) {
  const hash = configuredPinHash();
  if (!hash) return false;
  const parsed = parseScryptHash(hash);
  if (!Number.isFinite(parsed.keyLength) || parsed.keyLength < 16 || parsed.key.length !== parsed.keyLength) {
    throw new Error('Invalid STOCK_CHECK_PIN_HASH key length.');
  }
  const candidate = await scrypt(String(pin), parsed.salt, parsed.keyLength);
  return candidate.length === parsed.key.length && timingSafeEqual(candidate, parsed.key);
}

export function createStockCheckSession(res, req) {
  pruneExpired(sessions);
  const sessionId = randomBytes(32).toString('hex');
  sessions.set(sessionId, {
    createdAt: now(),
    expiresAt: now() + SESSION_TTL_MS,
    ip: clientIp(req)
  });
  setSessionCookie(res, req, sessionId);
  return { expiresAt: new Date(now() + SESSION_TTL_MS).toISOString() };
}

export function getStockCheckSession(req) {
  pruneExpired(sessions);
  const sessionId = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (!sessionId) return null;
  const session = sessions.get(sessionId);
  if (!session || session.expiresAt <= now()) {
    sessions.delete(sessionId);
    return null;
  }
  return { sessionId, ...session };
}

export function destroyStockCheckSession(req, res) {
  const sessionId = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (sessionId) sessions.delete(sessionId);
  clearSessionCookie(res, req);
}

export function requireStockCheckSession(req, res, next) {
  if (!getStockCheckSession(req)) {
    unauthorized(res);
    return;
  }
  next();
}

export function checkStockCheckLoginLimit(req) {
  return rateLimit(loginAttempts, clientIp(req), LOGIN_MAX_FAILURES, LOGIN_WINDOW_MS);
}

export function recordStockCheckLoginSuccess(req) {
  clearRateLimit(loginAttempts, clientIp(req));
}

export function checkStockCheckSearchLimit(req) {
  const session = getStockCheckSession(req);
  const key = `${clientIp(req)}:${session?.sessionId || 'no-session'}`;
  return rateLimit(searchAttempts, key, SEARCH_MAX_REQUESTS, SEARCH_WINDOW_MS);
}

export function stockCheckSessionInfo(req) {
  const session = getStockCheckSession(req);
  if (!session) return { authenticated: false, expiresAt: null };
  return { authenticated: true, expiresAt: new Date(session.expiresAt).toISOString() };
}
