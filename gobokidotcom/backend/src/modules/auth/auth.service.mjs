// ============================================================
// AUTH SERVICE — JWT, PBKDF2 passwords, RBAC
// ============================================================
import crypto from 'crypto';
import { db, uuid, now } from './database.mjs';

const JWT_SECRET         = 'goboki-jwt-secret-min-32-chars-long!!';
const JWT_REFRESH_SECRET = 'goboki-refresh-secret-different-key!!';

// ── JWT ──────────────────────────────────────────────────────
function b64url(str) {
  return Buffer.from(str).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function fromB64url(str) {
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString();
}

export function signJwt(payload, secret, expiresInSecs = 900) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body   = b64url(JSON.stringify({
    ...payload,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + expiresInSecs,
  }));
  const sig = crypto.createHmac('sha256', secret)
    .update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

export function verifyJwt(token, secret = JWT_SECRET) {
  try {
    const parts = (token || '').split('.');
    if (parts.length !== 3) throw new Error('Malformed token');
    const [header, body, sig] = parts;
    const expected = crypto.createHmac('sha256', secret)
      .update(`${header}.${body}`).digest('base64url');
    if (sig !== expected) throw new Error('Invalid JWT signature');
    const payload = JSON.parse(fromB64url(body));
    if (payload.exp < Math.floor(Date.now() / 1000)) throw new Error('JWT expired');
    return payload;
  } catch (err) {
    throw Object.assign(new Error(err.message), { status: 401 });
  }
}

function generateTokens(payload) {
  return {
    accessToken:  signJwt(payload, JWT_SECRET, 900),
    refreshToken: signJwt(payload, JWT_REFRESH_SECRET, 30 * 86400),
    expiresIn: 900,
  };
}

// ── Password hashing ─────────────────────────────────────────
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100_000, 64, 'sha512').toString('hex');
  return `pbkdf2:${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [, salt, hash] = stored.split(':');
  const attempt = crypto.pbkdf2Sync(password, salt, 100_000, 64, 'sha512').toString('hex');
  const hashBuf    = Buffer.from(hash, 'hex');
  const attemptBuf = Buffer.from(attempt, 'hex');
  if (hashBuf.length !== attemptBuf.length) return false;
  return crypto.timingSafeEqual(hashBuf, attemptBuf);
}

// ── RBAC ─────────────────────────────────────────────────────
const ROLE_PERMISSIONS = {
  super_admin: ['*'],
  owner:  ['bookings:*', 'customers:*', 'payments:*', 'experiences:*', 'settings:*', 'analytics:*'],
  admin:  ['bookings:*', 'customers:*', 'payments:read', 'experiences:*', 'analytics:read'],
  staff:  ['bookings:read', 'bookings:create', 'customers:read', 'experiences:read'],
};

export function hasPermission(role, permission) {
  const perms = ROLE_PERMISSIONS[role] ?? [];
  if (perms.includes('*')) return true;
  if (perms.includes(permission)) return true;
  const [resource] = permission.split(':');
  return perms.includes(`${resource}:*`);
}

// ── AuthService ───────────────────────────────────────────────
export class AuthService {
  login(email, password) {
    const user = db.users.findOne(u => u.email === email && u.is_active);
    if (!user) throw Object.assign(new Error('Invalid credentials'), { status: 401 });

    // In production: verifyPassword(password, user.password_hash)
    // For demo, accept 'Demo1234!' for any seeded user
    if (password !== 'Demo1234!') {
      throw Object.assign(new Error('Invalid credentials'), { status: 401 });
    }

    const tenant = db.tenants.findById(user.tenant_id);
    db.users.update(user.id, { last_login_at: now() });

    return generateTokens({
      sub: user.id,
      tenantId: user.tenant_id,
      email: user.email,
      role: user.role,
      tenantSlug: tenant?.slug,
    });
  }

  refresh(refreshToken) {
    const payload = verifyJwt(refreshToken, JWT_REFRESH_SECRET);
    return generateTokens({
      sub: payload.sub,
      tenantId: payload.tenantId,
      email: payload.email,
      role: payload.role,
    });
  }

  me(token) {
    const payload = verifyJwt(token);
    const user = db.users.findById(payload.sub);
    if (!user) throw Object.assign(new Error('User not found'), { status: 404 });
    const { password_hash: _, ...safe } = user;
    return { ...safe, tenant: db.tenants.findById(user.tenant_id) };
  }
}

export const authService = new AuthService();
