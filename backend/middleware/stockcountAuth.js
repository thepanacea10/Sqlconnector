import crypto from 'node:crypto';

const WINDOW_MS = Number(process.env.STOCKCOUNT_RATE_WINDOW_MS || 60_000);
const MAX_REQUESTS = Number(process.env.STOCKCOUNT_RATE_MAX || 120);
const buckets = new Map();

function stockcountError(message, statusCode, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function configuredKey() {
  return String(process.env.STOCKCOUNT_API_KEY || '').trim();
}

function allowedOrigins() {
  return String(process.env.STOCKCOUNT_ALLOWED_ORIGINS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function checkOrigin(req) {
  const origin = req.get('origin');
  if (!origin) return;
  const allowlist = allowedOrigins();
  if (!allowlist.length) return;
  if (!allowlist.includes(origin)) {
    throw stockcountError('Origin is not allowed.', 403, 'STOCKCOUNT_ORIGIN_FORBIDDEN');
  }
}

function rateLimit(req) {
  const now = Date.now();
  const key = req.ip || req.socket?.remoteAddress || 'unknown';
  const bucket = buckets.get(key);

  if (!bucket || now - bucket.windowStart >= WINDOW_MS) {
    buckets.set(key, { windowStart: now, count: 1 });
    return;
  }

  bucket.count += 1;
  if (bucket.count > MAX_REQUESTS) {
    throw stockcountError('Too many requests.', 429, 'STOCKCOUNT_RATE_LIMITED');
  }
}

export function stockcountAuth(req, _res, next) {
  try {
    checkOrigin(req);
    rateLimit(req);

    const expectedKey = configuredKey();
    if (!expectedKey) {
      throw stockcountError('StockCount API is not configured.', 503, 'STOCKCOUNT_NOT_CONFIGURED');
    }

    const providedKey = String(req.get('x-stockcount-key') || '').trim();
    if (!providedKey) {
      throw stockcountError('StockCount API key is required.', 401, 'STOCKCOUNT_KEY_REQUIRED');
    }

    if (!safeEqual(providedKey, expectedKey)) {
      throw stockcountError('Invalid StockCount API key.', 403, 'STOCKCOUNT_KEY_INVALID');
    }

    next();
  } catch (error) {
    next(error);
  }
}

export function stockcountRequestLogger(req, res, next) {
  const requestId = crypto.randomUUID();
  const start = Date.now();
  req.stockcountRequestId = requestId;

  res.on('finish', () => {
    const logEntry = {
      requestId,
      route: req.originalUrl?.split('?')[0],
      method: req.method,
      statusCode: res.statusCode,
      durationMs: Date.now() - start,
      itemId: req.params?.itemId,
      page: req.query?.page,
      pageSize: req.query?.pageSize,
      timestamp: new Date().toISOString()
    };
    console.log(`[stockcount] ${JSON.stringify(logEntry)}`);
  });

  next();
}
