/**
 * RescueOS Authentication & Role-Based Access Control (RBAC)
 * Cryptographically secure zero-dependency auth using Node standard crypto library.
 */
const crypto = require('crypto');
const { db } = require('./db');

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_FAILED_LOGINS = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute

// In-memory rate limiting map for brute force protection: IP -> { attempts: number, resetAt: number }
const loginAttempts = new Map();

/**
 * Hash a password using scrypt with unique salt
 */
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

/**
 * Verify password in constant time to prevent timing attacks
 */
function verifyPassword(password, salt, storedHash) {
  try {
    const { hash } = hashPassword(password, salt);
    const hashBuf = Buffer.from(hash, 'hex');
    const storedBuf = Buffer.from(storedHash, 'hex');
    if (hashBuf.length !== storedBuf.length) return false;
    return crypto.timingSafeEqual(hashBuf, storedBuf);
  } catch {
    return false;
  }
}

/**
 * Clean up expired sessions from database
 */
function purgeExpiredSessions() {
  const now = Date.now();
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
}

/**
 * Create a new user session
 */
function createSession(user) {
  purgeExpiredSessions();
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS;

  db.prepare(`
    INSERT INTO sessions (token, user_id, role, username, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(token, user.id, user.role, user.username, expiresAt, new Date(now).toISOString());

  return {
    token,
    expiresAt,
    user: {
      id: user.id,
      username: user.username,
      full_name: user.full_name,
      role: user.role,
      phone: user.phone || ''
    }
  };
}

/**
 * Destroy a session
 */
function destroySession(token) {
  if (!token) return;
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

/**
 * Check rate limit for IP address on login attempts
 */
function checkLoginRateLimit(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    loginAttempts.set(ip, { attempts: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true };
  }
  if (entry.attempts >= MAX_FAILED_LOGINS) {
    const waitSeconds = Math.ceil((entry.resetAt - now) / 1000);
    return { allowed: false, waitSeconds };
  }
  entry.attempts++;
  return { allowed: true };
}

/**
 * Reset rate limit counter on successful login
 */
function resetLoginRateLimit(ip) {
  loginAttempts.delete(ip);
}

/**
 * Extract auth token from Request headers (Bearer token or Cookie)
 */
function extractToken(req) {
  const authHeader = req.headers['authorization'] || '';
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  const cookieHeader = req.headers['cookie'] || '';
  const match = cookieHeader.match(/rescueos_session=([a-f0-9]+)/);
  if (match) {
    return match[1];
  }
  return null;
}

/**
 * Authenticate request and return user context or null
 */
function authenticateRequest(req) {
  const token = extractToken(req);
  if (!token) return null;

  const session = db.prepare(`
    SELECT s.token, s.user_id, s.role, s.username, s.expires_at,
           u.full_name, u.phone
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.token = ? AND s.expires_at > ?
  `).get(token, Date.now());

  if (!session) {
    return null;
  }

  return {
    id: session.user_id,
    username: session.username,
    full_name: session.full_name,
    role: session.role,
    phone: session.phone,
    token: session.token
  };
}

/**
 * RBAC Role Hierarchies & Permission Matrices
 */
const ROLE_PERMISSIONS = {
  ADMIN: ['*'],
  COORDINATOR: [
    'sos:read', 'sos:write', 'sos:assign', 'sos:status',
    'tasks:read', 'tasks:write', 'tasks:assign',
    'shelters:read', 'shelters:write',
    'resources:read', 'resources:write', 'resources:transfer',
    'incidents:read', 'incidents:write', 'incidents:verify',
    'missing:read', 'missing:write',
    'medical:read', 'medical:write',
    'announcements:read', 'announcements:write',
    'chat:read', 'chat:write',
    'timeline:read', 'audit:read', 'sync:export', 'sync:import'
  ],
  MEDICAL: [
    'sos:read', 'sos:status',
    'medical:read', 'medical:write', 'medical:triage',
    'shelters:read',
    'resources:read', 'resources:request',
    'incidents:read',
    'missing:read',
    'announcements:read',
    'chat:read', 'chat:write'
  ],
  VOLUNTEER: [
    'sos:read',
    'tasks:read', 'tasks:accept', 'tasks:update', 'tasks:resolve',
    'shelters:read',
    'resources:read',
    'incidents:read', 'incidents:write',
    'missing:read',
    'announcements:read',
    'chat:read', 'chat:write'
  ],
  CITIZEN: [
    'sos:create', 'sos:read_own',
    'shelters:read',
    'incidents:read', 'incidents:create',
    'missing:read', 'missing:create',
    'announcements:read',
    'qr:read'
  ]
};

/**
 * Validate if a role has the required permission
 */
function hasPermission(role, permission) {
  if (!role) return false;
  const perms = ROLE_PERMISSIONS[role] || [];
  if (perms.includes('*')) return true;
  return perms.includes(permission);
}

module.exports = {
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  checkLoginRateLimit,
  resetLoginRateLimit,
  authenticateRequest,
  hasPermission,
  ROLE_PERMISSIONS
};
