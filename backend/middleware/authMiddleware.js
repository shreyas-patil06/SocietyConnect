import crypto from 'node:crypto';
import {
  SERVER_SECRET,
  isSupabaseConfigured,
  supabaseAdmin,
} from '../config/supabaseAdmin.js';
import { selectOne } from '../config/db.js';

export const SESSION_COOKIE_NAME = 'sc_session';
const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password, storedHash) {
  if (!storedHash || !storedHash.includes(':')) return false;
  const [salt, keyHex] = storedHash.split(':');
  const keyBuf = Buffer.from(keyHex, 'hex');
  const derived = crypto.scryptSync(password, salt, 64);
  if (keyBuf.length !== derived.length) return false;
  return crypto.timingSafeEqual(keyBuf, derived);
}

export function signSessionToken(payload) {
  const exp = Date.now() + TOKEN_TTL_MS;
  const body = Buffer.from(JSON.stringify({ ...payload, exp })).toString('base64url');
  const sig = crypto.createHmac('sha256', SERVER_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifySessionToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expectedSig = crypto.createHmac('sha256', SERVER_SECRET).update(body).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }
  try {
    const decoded = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!decoded.exp || Date.now() > decoded.exp) return null;
    return decoded;
  } catch {
    return null;
  }
}

export function parseCookies(req) {
  const header = req.headers.cookie || '';
  const cookies = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) cookies[k] = decodeURIComponent(v);
  }
  return cookies;
}

function isHttpsRequest(req) {
  const fwdHost = String(req.headers['x-forwarded-host'] || '');
  const origin = String(req.headers.origin || '');
  const referer = String(req.headers.referer || '');
  return Boolean(
    req.secure ||
      req.headers['x-forwarded-proto'] === 'https' ||
      origin.startsWith('https://') ||
      referer.startsWith('https://') ||
      (fwdHost && !fwdHost.startsWith('localhost') && !fwdHost.startsWith('127.0.0.1'))
  );
}

export function setSessionCookie(req, res, token) {
  const isHttps = isHttpsRequest(req);
  const cookieOpts = {
    httpOnly: true,
    path: '/',
    maxAge: TOKEN_TTL_MS,
  };
  if (isHttps) {
    cookieOpts.secure = true;
    cookieOpts.sameSite = 'none';
    cookieOpts.partitioned = true;
  } else {
    cookieOpts.secure = false;
    cookieOpts.sameSite = 'lax';
  }
  res.cookie(SESSION_COOKIE_NAME, token, cookieOpts);
}

export function clearSessionCookie(req, res) {
  const isHttps = isHttpsRequest(req);
  const cookieOpts = {
    httpOnly: true,
    path: '/',
  };
  if (isHttps) {
    cookieOpts.secure = true;
    cookieOpts.sameSite = 'none';
    cookieOpts.partitioned = true;
  } else {
    cookieOpts.secure = false;
    cookieOpts.sameSite = 'lax';
  }
  res.clearCookie(SESSION_COOKIE_NAME, cookieOpts);
}

export function verifyCsrf(req, res, next) {
  const method = req.method.toUpperCase();
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    return next();
  }
  const requestedWith = req.headers['x-requested-with'];
  if (requestedWith === 'SocietyConnect') {
    return next();
  }
  const origin = req.headers.origin;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  if (origin && host) {
    try {
      const originHost = new URL(origin).host;
      if (originHost === host) return next();
    } catch {
      // fall through
    }
  }
  return res.status(403).json({ error: 'Invalid request origin or missing CSRF header' });
}

export async function resolveUserFromRequest(req) {
  const cookies = parseCookies(req);
  let token = cookies[SESSION_COOKIE_NAME];
  if (!token && req.headers.authorization?.startsWith('Bearer ')) {
    token = req.headers.authorization.slice(7).trim();
  }
  if (!token) return null;

  if (isSupabaseConfigured()) {
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (!error && data?.user) {
      const profile = await selectOne('profiles', { id: data.user.id });
      if (profile && profile.is_active) {
        return sanitizeProfile(profile);
      }
    }
    return null;
  }

  const decoded = verifySessionToken(token);
  if (!decoded?.userId) return null;
  const profile = await selectOne('profiles', { id: decoded.userId });
  if (!profile || !profile.is_active) return null;
  return sanitizeProfile(profile);
}

export function sanitizeProfile(profile) {
  if (!profile) return null;
  const { password_hash, ...safe } = profile;
  return safe;
}

export async function requireAuth(req, res, next) {
  try {
    const user = await resolveUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    req.user = user;
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Authentication failed' });
  }
}

export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied for your role' });
    }
    return next();
  };
}
