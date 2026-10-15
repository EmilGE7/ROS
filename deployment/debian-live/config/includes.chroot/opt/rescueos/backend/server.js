/**
 * RescueOS — Portable Offline Disaster Communication & Coordination Operating System
 * "Boot. Connect. Rescue."
 * 
 * Core HTTP & Event Server with Zero Cloud/External Dependencies.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const dns = require('dns').promises;
const { execFileSync } = require('child_process');

const { db, syncLegacyJson } = require('./db');
const {
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  checkLoginRateLimit,
  resetLoginRateLimit,
  authenticateRequest,
  hasPermission
} = require('./auth');
const sse = require('./sse');
const { seedDatabase } = require('./seed');
const simulator = require('./simulation');
const { exportDisasterPackage, importDisasterPackage, DEFAULT_STATION_ID } = require('./sync');
const loraAdapter = require('./lora_adapter');

const PORT = process.env.PORT || 8080;
const ROOT = path.join(__dirname, '..', 'frontend');

// Initialize Demo Dataset on startup if database is brand new
seedDatabase(false);

/**
 * Utility: Audit log helper with SSE push
 */
function audit(actor, action, target, detail = '', ip = '127.0.0.1') {
  const now = new Date().toISOString();
  try {
    db.prepare(`
      INSERT INTO audit_logs (actor, action, target, detail, ip, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(actor || 'ANONYMOUS', action, target, detail, ip, now);
    
    syncLegacyJson();
    sse.broadcast('audit', { actor, action, target, detail, created_at: now });
  } catch (err) {
    console.error('Audit logging failed:', err.message);
  }
}

/**
 * Utility: Standard JSON HTTP response
 */
function sendJson(res, status, data, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    ...headers
  });
  res.end(JSON.stringify(data));
}

/**
 * Utility: Read and parse JSON request body
 */
function readJsonBody(req, maxBytes = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let raw = '';
    let bytes = 0;
    req.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        req.destroy();
        return reject(new Error('Payload too large (max 2MB)'));
      }
      raw += chunk;
    });
    req.on('end', () => {
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(new Error('Invalid JSON payload: ' + err.message));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Generate cryptographically random Rescue ID: RSC-XXXXXXXX
 */
function generateRescueId() {
  const rand = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `RSC-${rand}`;
}

/**
 * Generate a lightweight standalone SVG for QR / Barcode identification
 */
function generateQrSvg(text) {
  // Generates a clean, scannable high-contrast vector identifier badge
  const hash = crypto.createHash('sha256').update(text).digest();
  let matrixSvg = '';
  // 12x12 grid patterned by hash for visual authentication
  const size = 180;
  const cellSize = size / 12;
  for (let r = 0; r < 12; r++) {
    for (let c = 0; c < 12; c++) {
      const idx = (r * 12 + c) % 32;
      const bit = (hash[idx] >> (c % 8)) & 1;
      // Corner alignment markers always dark
      const isCorner = (r < 3 && c < 3) || (r < 3 && c > 8) || (r > 8 && c < 3);
      if (bit || isCorner) {
        matrixSvg += `<rect x="${c * cellSize}" y="${r * cellSize}" width="${cellSize}" height="${cellSize}" fill="#0f172a"/>`;
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180" width="180" height="180">
    <rect width="180" height="180" fill="#ffffff" rx="8"/>
    ${matrixSvg}
  </svg>`;
}

/**
 * Compile system state for dashboard & backwards compatibility
 */
function getSystemState(user = null) {
  const sos = db.prepare(`
    SELECT id, rescue_id, requester AS name, description AS emergency, emergency_type,
           people_affected AS people, priority, location, lat, lng, status,
           assigned_volunteer AS assigned_to, notes, resolution, triage_level, is_simulation,
           created_at, updated_at
    FROM sos_requests
    ORDER BY id DESC
  `).all();

  const volunteers = db.prepare(`
    SELECT id, full_name AS name, phone, role,
           CASE WHEN EXISTS (SELECT 1 FROM sos_requests WHERE assigned_volunteer = users.full_name AND status IN ('ASSIGNED', 'IN_PROGRESS')) THEN 'BUSY' ELSE 'AVAILABLE' END AS status
    FROM users
    WHERE role = 'VOLUNTEER'
    ORDER BY id ASC
  `).all();

  const shelters = db.prepare(`
    SELECT id, name, location, lat, lng, capacity, occupancy, contact, medical_support,
           accessibility, status, water_liters AS water, food_rations AS food,
           medical_kits, blankets, is_simulation, created_at, updated_at
    FROM shelters
    ORDER BY id ASC
  `).all();

  const announcements = db.prepare(`
    SELECT id, title, message, priority, issuer, is_simulation, created_at
    FROM announcements
    ORDER BY id DESC
    LIMIT 30
  `).all();

  const auditLogs = db.prepare(`
    SELECT id, actor, action, target, detail, created_at
    FROM audit_logs
    ORDER BY id DESC
    LIMIT 50
  `).all();

  const incidents = db.prepare(`
    SELECT id, title, description, incident_type, severity, location, lat, lng, reporter, status, is_simulation, created_at, updated_at
    FROM incidents
    ORDER BY id DESC
    LIMIT 40
  `).all();

  const missingPersons = db.prepare(`
    SELECT id, tracking_code, full_name, age, gender, last_seen_location, last_seen_time, contact_info, identifying_features, status, is_simulation, created_at
    FROM missing_persons
    ORDER BY id DESC
  `).all();

  const medicalCases = db.prepare(`
    SELECT id, sos_id, patient_name, triage_status, triage_priority, symptoms, vitals_summary, resource_requests, assigned_medic, is_simulation, created_at
    FROM medical_cases
    ORDER BY id DESC
  `).all();

  const resources = db.prepare(`
    SELECT r.id, r.shelter_id, s.name AS shelter_name, r.name, r.category, r.quantity, r.unit, r.minimum_threshold, r.is_simulation, r.last_updated,
           CASE
             WHEN r.quantity = 0 THEN 'OUT_OF_STOCK'
             WHEN r.quantity <= (r.minimum_threshold * 0.3) THEN 'CRITICAL'
             WHEN r.quantity <= r.minimum_threshold THEN 'LOW_STOCK'
             ELSE 'NORMAL'
           END AS stock_status
    FROM resources r
    LEFT JOIN shelters s ON r.shelter_id = s.id
    ORDER BY r.id ASC
  `).all();

  const stats = {
    activeSos: sos.filter(s => !['RESOLVED', 'CANCELLED'].includes(s.status)).length,
    criticalSos: sos.filter(s => s.priority === 'CRITICAL' && !['RESOLVED', 'CANCELLED'].includes(s.status)).length,
    activeIncidents: incidents.filter(i => i.status !== 'RESOLVED').length,
    activeVolunteers: volunteers.length,
    totalShelters: shelters.length,
    shelterOccupancyPct: shelters.length > 0
      ? Math.round((shelters.reduce((acc, s) => acc + s.occupancy, 0) / Math.max(1, shelters.reduce((acc, s) => acc + s.capacity, 0))) * 100)
      : 0,
    missingCount: missingPersons.filter(m => m.status === 'MISSING').length,
    medicalWaiting: medicalCases.filter(m => ['WAITING', 'TRIAGED'].includes(m.triage_status)).length,
    lowStockResources: resources.filter(r => ['OUT_OF_STOCK', 'CRITICAL', 'LOW_STOCK'].includes(r.stock_status)).length,
    simulationActive: simulator.status === 'RUNNING'
  };

  return {
    stationId: DEFAULT_STATION_ID,
    timestamp: new Date().toISOString(),
    stats,
    sos,
    volunteers: volunteers.length > 0 ? volunteers : [
      { id: 1, name: 'Rescue Team 01', status: 'AVAILABLE' },
      { id: 2, name: 'Rescue Team 02', status: 'AVAILABLE' },
      { id: 3, name: 'Medical Team 01', status: 'AVAILABLE' },
      { id: 4, name: 'Volunteer 04', status: 'AVAILABLE' }
    ],
    shelters,
    announcements,
    audit: auditLogs,
    incidents,
    missing_persons: missingPersons,
    medical_cases: medicalCases,
    resources,
    simulation: simulator.getStatus()
  };
}

/**
 * Get Client IP Address from request
 */
function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || '127.0.0.1';
}

/**
 * HTTP Request Handler
 */
const server = http.createServer(async (req, res) => {
  const ip = getClientIp(req);
  const user = authenticateRequest(req);

  // Handle CORS Pre-flight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400'
    });
    return res.end();
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  try {
    // =========================================================================
    // REAL-TIME SSE STREAM (Step 8)
    // =========================================================================
    if (req.method === 'GET' && pathname === '/events') {
      return sse.addClient(req, res, getSystemState(user));
    }

    // =========================================================================
    // HEALTH CHECK — used by systemd, kiosk launcher, and monitoring
    // =========================================================================
    if (req.method === 'GET' && pathname === '/api/health') {
      return sendJson(res, 200, {
        status: 'ok',
        service: 'rescueos',
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
      });
    }

    // =========================================================================
    // SYSTEM STATE (Backwards compatible with MVP)
    // =========================================================================
    if (req.method === 'GET' && pathname === '/api/state') {
      return sendJson(res, 200, getSystemState(user));
    }

    // =========================================================================
    // AUTHENTICATION & RBAC (Step 5)
    // =========================================================================
    if (req.method === 'POST' && pathname === '/api/auth/register') {
      const b = await readJsonBody(req);
      if (!b.username || !b.password || !b.full_name) {
        return sendJson(res, 400, { error: 'Username, password, and full name are required' });
      }

      // Role specification: only ADMIN or COORDINATOR can register roles other than CITIZEN
      let role = (b.role || 'CITIZEN').toUpperCase();
      if (!['CITIZEN', 'VOLUNTEER', 'MEDICAL', 'COORDINATOR', 'ADMIN'].includes(role)) {
        return sendJson(res, 400, { error: 'Invalid role specified' });
      }
      if (role !== 'CITIZEN' && (!user || (user.role !== 'ADMIN' && user.role !== 'COORDINATOR'))) {
        return sendJson(res, 403, { error: 'Privilege error: Only Coordinators or Admins can register staff roles' });
      }

      const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(b.username.trim());
      if (existing) {
        return sendJson(res, 409, { error: 'Username already registered' });
      }

      const { hash, salt } = hashPassword(b.password);
      const now = new Date().toISOString();
      const insert = db.prepare(`
        INSERT INTO users (username, password_hash, salt, full_name, role, phone, badge_number, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING id, username, full_name, role, phone, badge_number, created_at
      `);
      const newUser = insert.get(b.username.trim(), hash, salt, b.full_name.trim(), role, b.phone || '', b.badge_number || '', now);
      const session = createSession(newUser);

      audit(newUser.username, 'USER_REGISTER', `User ${newUser.username} registered with role ${newUser.role}`, '', ip);
      return sendJson(res, 201, { user: newUser, token: session.token, expiresAt: session.expiresAt });
    }

    if (req.method === 'POST' && pathname === '/api/auth/login') {
      const rate = checkLoginRateLimit(ip);
      if (!rate.allowed) {
        return sendJson(res, 429, { error: `Too many login attempts. Please wait ${rate.waitSeconds} seconds.` });
      }

      const b = await readJsonBody(req);
      if (!b.username || !b.password) {
        return sendJson(res, 400, { error: 'Username and password required' });
      }

      const u = db.prepare('SELECT * FROM users WHERE username = ?').get(b.username.trim());
      if (!u || !verifyPassword(b.password, u.salt, u.password_hash)) {
        audit(b.username, 'LOGIN_FAILED', 'Failed credential challenge', '', ip);
        return sendJson(res, 401, { error: 'Invalid username or password' });
      }

      resetLoginRateLimit(ip);
      const session = createSession(u);
      audit(u.username, 'LOGIN_SUCCESS', `Session opened for role ${u.role}`, '', ip);
      return sendJson(res, 200, {
        user: { id: u.id, username: u.username, full_name: u.full_name, role: u.role, phone: u.phone },
        token: session.token,
        expiresAt: session.expiresAt
      });
    }

    if (req.method === 'POST' && pathname === '/api/auth/logout') {
      if (user && user.token) {
        destroySession(user.token);
        audit(user.username, 'LOGOUT', 'Session closed', '', ip);
      }
      return sendJson(res, 200, { success: true });
    }

    if (req.method === 'GET' && pathname === '/api/auth/me') {
      if (!user) {
        return sendJson(res, 200, { authenticated: false, role: 'ANONYMOUS' });
      }
      return sendJson(res, 200, { authenticated: true, user });
    }

    if (req.method === 'GET' && pathname === '/api/users') {
      if (!user || !['ADMIN', 'COORDINATOR'].includes(user.role)) {
        return sendJson(res, 403, { error: 'Access denied: Requires Coordinator or Admin role' });
      }
      const users = db.prepare('SELECT id, username, full_name, role, phone, badge_number, created_at FROM users ORDER BY id ASC').all();
      return sendJson(res, 200, users);
    }

    // =========================================================================
    // SOS ENGINE (Step 6 — Preserved and Upgraded)
    // =========================================================================
    if (req.method === 'GET' && pathname === '/api/sos') {
      const statusFilter = parsedUrl.searchParams.get('status');
      const priorityFilter = parsedUrl.searchParams.get('priority');
      const typeFilter = parsedUrl.searchParams.get('type');
      const isSim = parsedUrl.searchParams.get('is_simulation');

      let query = `
        SELECT id, rescue_id, requester, emergency_type, description, people_affected,
               priority, location, lat, lng, status, assigned_volunteer, notes, resolution,
               triage_level, is_simulation, created_at, updated_at
        FROM sos_requests
        WHERE 1=1
      `;
      const params = [];
      if (statusFilter) {
        query += ' AND status = ?';
        params.push(statusFilter);
      }
      if (priorityFilter) {
        query += ' AND priority = ?';
        params.push(priorityFilter);
      }
      if (typeFilter) {
        query += ' AND emergency_type = ?';
        params.push(typeFilter);
      }
      if (isSim !== null && isSim !== undefined) {
        query += ' AND is_simulation = ?';
        params.push(Number(isSim));
      }
      query += ' ORDER BY id DESC';

      const results = db.prepare(query).all(...params);
      return sendJson(res, 200, results);
    }

    if (req.method === 'POST' && pathname === '/api/sos') {
      const b = await readJsonBody(req);
      const requester = b.name || b.requester;
      const emergency = b.emergency || b.description;

      if (!requester || !emergency) {
        return sendJson(res, 400, { error: 'Name (requester) and Emergency description are required' });
      }

      // Map emergency type to standard catalog
      const validTypes = ['MEDICAL', 'FLOOD', 'FIRE', 'TRAPPED', 'MISSING_PERSON', 'FOOD_WATER', 'STRUCTURAL_DAMAGE', 'OTHER'];
      let emergencyType = (b.emergency_type || '').toUpperCase();
      if (!validTypes.includes(emergencyType)) {
        if (/flood|water|drown/i.test(emergency)) emergencyType = 'FLOOD';
        else if (/fire|burn|smoke/i.test(emergency)) emergencyType = 'FIRE';
        else if (/trap|stuck|rubble|collapse/i.test(emergency)) emergencyType = 'TRAPPED';
        else if (/medic|bleed|injury|heart|breath/i.test(emergency)) emergencyType = 'MEDICAL';
        else if (/food|water|starv|thirst/i.test(emergency)) emergencyType = 'FOOD_WATER';
        else if (/missing|lost|kid/i.test(emergency)) emergencyType = 'MISSING_PERSON';
        else emergencyType = 'OTHER';
      }

      const priority = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].includes(b.priority) ? b.priority : 'HIGH';
      const rescueId = generateRescueId();
      const now = new Date().toISOString();

      const insert = db.prepare(`
        INSERT INTO sos_requests (rescue_id, requester, user_id, emergency_type, description, people_affected, priority, location, lat, lng, status, triage_level, is_simulation, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'NEW', ?, 0, ?, ?)
        RETURNING *
      `);

      const row = insert.get(
        rescueId,
        requester.trim(),
        user ? user.id : null,
        emergencyType,
        emergency.trim(),
        Math.max(1, Number(b.people) || 1),
        priority,
        b.location ? b.location.trim() : 'Unknown Location',
        b.lat ? Number(b.lat) : null,
        b.lng ? Number(b.lng) : null,
        emergencyType === 'MEDICAL' ? 'WAITING' : 'NONE',
        now,
        now
      );

      // If medical, also register in medical cases table
      if (emergencyType === 'MEDICAL') {
        db.prepare(`
          INSERT INTO medical_cases (sos_id, patient_name, triage_status, triage_priority, symptoms, created_at, updated_at)
          VALUES (?, ?, 'WAITING', ?, ?, ?, ?)
        `).run(row.id, requester, priority === 'CRITICAL' ? 'RED_IMMEDIATE' : 'YELLOW_DELAYED', emergency, now, now);
      }

      audit(user ? user.username : requester, 'SOS_CREATED', `${rescueId}: ${requester} (${emergencyType})`, emergency, ip);
      syncLegacyJson();

      // Backwards compatible payload structure
      const broadcastRow = {
        id: row.id,
        rescue_id: row.rescue_id,
        name: row.requester,
        emergency: row.description,
        people: row.people_affected,
        location: row.location,
        priority: row.priority,
        status: row.status,
        assigned_to: row.assigned_volunteer,
        created_at: row.created_at,
        updated_at: row.updated_at
      };

      sse.broadcast('sos_created', broadcastRow);
      sse.broadcast('state', getSystemState());

      return sendJson(res, 201, broadcastRow);
    }

    // SOS Assignment: /api/sos/:id/assign
    const assignMatch = pathname.match(/^\/api\/sos\/(\d+)\/assign$/);
    if (req.method === 'POST' && assignMatch) {
      if (user && !hasPermission(user.role, 'sos:assign') && !['ADMIN', 'COORDINATOR'].includes(user.role)) {
        return sendJson(res, 403, { error: 'Permission denied: Requires Coordinator or Admin role to assign rescues' });
      }

      const sosId = Number(assignMatch[1]);
      const b = await readJsonBody(req);
      if (!b.volunteer) {
        return sendJson(res, 400, { error: 'Volunteer name required' });
      }

      const sos = db.prepare('SELECT * FROM sos_requests WHERE id = ?').get(sosId);
      if (!sos) return sendJson(res, 404, { error: 'SOS request not found' });

      const now = new Date().toISOString();
      const volunteerUser = db.prepare('SELECT id, full_name FROM users WHERE full_name = ? OR username = ?').get(b.volunteer, b.volunteer);

      db.prepare(`
        UPDATE sos_requests
        SET assigned_volunteer = ?, assigned_volunteer_id = ?, status = 'ASSIGNED', updated_at = ?
        WHERE id = ?
      `).run(b.volunteer, volunteerUser ? volunteerUser.id : null, now, sosId);

      // Create or update task record
      db.prepare(`
        INSERT INTO tasks (sos_id, volunteer_id, volunteer_name, status, instructions, created_at, updated_at)
        VALUES (?, ?, ?, 'ASSIGNED', ?, ?, ?)
      `).run(sosId, volunteerUser ? volunteerUser.id : null, b.volunteer, b.instructions || 'Emergency rescue mission assigned', now, now);

      audit(user ? user.username : 'DISPATCH', 'TASK_ASSIGNED', `SOS #${sosId} (${sos.rescue_id}) → ${b.volunteer}`, '', ip);
      syncLegacyJson();

      const updated = db.prepare('SELECT * FROM sos_requests WHERE id = ?').get(sosId);
      const resultPayload = {
        id: updated.id,
        rescue_id: updated.rescue_id,
        name: updated.requester,
        emergency: updated.description,
        people: updated.people_affected,
        location: updated.location,
        priority: updated.priority,
        status: updated.status,
        assigned_to: updated.assigned_volunteer,
        updated_at: updated.updated_at
      };

      sse.broadcast('sos_assigned', resultPayload);
      sse.broadcast('sos_updated', resultPayload);
      sse.broadcast('state', getSystemState());

      return sendJson(res, 200, resultPayload);
    }

    // SOS Status Update: /api/sos/:id/status
    const statusMatch = pathname.match(/^\/api\/sos\/(\d+)\/status$/);
    if (req.method === 'POST' && statusMatch) {
      const sosId = Number(statusMatch[1]);
      const b = await readJsonBody(req);
      const validStatuses = ['NEW', 'ACKNOWLEDGED', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CANCELLED'];

      if (!validStatuses.includes(b.status)) {
        return sendJson(res, 400, { error: `Invalid status: ${b.status}. Allowed: ${validStatuses.join(', ')}` });
      }

      const sos = db.prepare('SELECT * FROM sos_requests WHERE id = ?').get(sosId);
      if (!sos) return sendJson(res, 404, { error: 'SOS request not found' });

      // RBAC check: Volunteers can set IN_PROGRESS or RESOLVED on tasks assigned to them; Coordinators can set any status
      if (user && user.role === 'VOLUNTEER') {
        if (!['IN_PROGRESS', 'RESOLVED'].includes(b.status)) {
          return sendJson(res, 403, { error: 'Volunteers may only update status to IN_PROGRESS or RESOLVED' });
        }
      }

      const now = new Date().toISOString();
      db.prepare(`
        UPDATE sos_requests
        SET status = ?, notes = CASE WHEN ? != '' THEN ? ELSE notes END,
            resolution = CASE WHEN ? != '' THEN ? ELSE resolution END,
            updated_at = ?
        WHERE id = ?
      `).run(b.status, b.notes || '', b.notes || '', b.resolution || '', b.resolution || '', now, sosId);

      // If linked task exists, update task status as well
      db.prepare(`
        UPDATE tasks
        SET status = ?, field_notes = CASE WHEN ? != '' THEN ? ELSE field_notes END, updated_at = ?
        WHERE sos_id = ?
      `).run(b.status === 'RESOLVED' ? 'RESOLVED' : b.status === 'IN_PROGRESS' ? 'IN_PROGRESS' : 'ASSIGNED', b.notes || '', b.notes || '', now, sosId);

      audit(user ? user.username : 'DISPATCH', 'SOS_STATUS', `SOS #${sosId} (${sos.rescue_id}): ${sos.status} → ${b.status}`, b.notes || b.resolution || '', ip);
      syncLegacyJson();

      const updated = db.prepare('SELECT * FROM sos_requests WHERE id = ?').get(sosId);
      const resultPayload = {
        id: updated.id,
        rescue_id: updated.rescue_id,
        name: updated.requester,
        emergency: updated.description,
        people: updated.people_affected,
        location: updated.location,
        priority: updated.priority,
        status: updated.status,
        assigned_to: updated.assigned_volunteer,
        notes: updated.notes,
        resolution: updated.resolution,
        updated_at: updated.updated_at
      };

      sse.broadcast('sos_updated', resultPayload);
      sse.broadcast('state', getSystemState());

      return sendJson(res, 200, resultPayload);
    }

    // =========================================================================
    // QR RESCUE ID RESOLVER (Step 15 — Fixed & Upgraded)
    // =========================================================================
    const qrMatch = pathname.match(/^\/api\/qr\/(.+)$/);
    if (req.method === 'GET' && qrMatch) {
      const identifier = decodeURIComponent(qrMatch[1]).trim();
      let sos = null;
      if (/^\d+$/.test(identifier)) {
        sos = db.prepare('SELECT * FROM sos_requests WHERE id = ?').get(Number(identifier));
      } else {
        sos = db.prepare('SELECT * FROM sos_requests WHERE rescue_id = ? COLLATE NOCASE').get(identifier);
      }

      if (!sos) {
        return sendJson(res, 404, { error: 'Rescue record not found for ID: ' + identifier });
      }

      const svg = generateQrSvg(sos.rescue_id);
      const dataUri = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;

      // Safe non-sensitive summary for public, full details if authorized staff
      const isPrivileged = user && ['ADMIN', 'COORDINATOR', 'MEDICAL', 'VOLUNTEER'].includes(user.role);
      const record = {
        rescueId: sos.rescue_id,
        name: isPrivileged ? sos.requester : sos.requester.slice(0, 1) + '***',
        status: sos.status,
        priority: sos.priority,
        emergencyCategory: sos.emergency_type,
        location: isPrivileged ? sos.location : 'Sector Masked (Emergency Protected)',
        people: sos.people_affected,
        createdAt: sos.created_at,
        updatedAt: sos.updated_at
      };

      return sendJson(res, 200, {
        rescueId: sos.rescue_id,
        svg,
        data: dataUri,
        record
      });
    }

    // =========================================================================
    // SHELTER MANAGEMENT (Step 11 — Preserved & Upgraded)
    // =========================================================================
    if (req.method === 'GET' && pathname === '/api/shelters') {
      const shelters = db.prepare('SELECT * FROM shelters ORDER BY id ASC').all();
      return sendJson(res, 200, shelters);
    }

    if (req.method === 'POST' && pathname === '/api/shelters') {
      if (user && !['ADMIN', 'COORDINATOR'].includes(user.role)) {
        return sendJson(res, 403, { error: 'Permission denied: Requires Coordinator or Admin' });
      }
      const b = await readJsonBody(req);
      if (!b.name || !b.capacity) {
        return sendJson(res, 400, { error: 'Name and capacity required' });
      }
      const now = new Date().toISOString();
      const insert = db.prepare(`
        INSERT INTO shelters (name, location, lat, lng, capacity, occupancy, contact, medical_support, accessibility, status, water_liters, food_rations, medical_kits, blankets, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, 'OPEN', ?, ?, ?, ?, ?, ?)
        RETURNING *
      `);
      const row = insert.get(
        b.name, b.location || 'Local Sector', b.lat ? Number(b.lat) : null, b.lng ? Number(b.lng) : null,
        Number(b.capacity), b.contact || '', b.medical_support ? 1 : 0, b.accessibility ? 1 : 0,
        Number(b.water) || 100, Number(b.food) || 100, Number(b.medical_kits) || 10, Number(b.blankets) || 50,
        now, now
      );
      audit(user ? user.username : 'ADMIN', 'SHELTER_CREATED', row.name, `Capacity: ${row.capacity}`, ip);
      syncLegacyJson();
      sse.broadcast('shelter_updated', row);
      sse.broadcast('state', getSystemState());
      return sendJson(res, 201, row);
    }

    // Shelter PATCH: /api/shelters/:id (Backwards compatible with MVP)
    const shelterPatchMatch = pathname.match(/^\/api\/shelters\/(\d+)$/);
    if (req.method === 'PATCH' && shelterPatchMatch) {
      const shelterId = Number(shelterPatchMatch[1]);
      const b = await readJsonBody(req);
      const shelter = db.prepare('SELECT * FROM shelters WHERE id = ?').get(shelterId);
      if (!shelter) return sendJson(res, 404, { error: 'Shelter not found' });

      const newOccupancy = b.occupancy !== undefined ? Number(b.occupancy) : shelter.occupancy;
      const newWater = b.water !== undefined ? Number(b.water) : shelter.water_liters;
      const newFood = b.food !== undefined ? Number(b.food) : shelter.food_rations;
      const newMeds = b.medical_kits !== undefined ? Number(b.medical_kits) : shelter.medical_kits;
      const newBlankets = b.blankets !== undefined ? Number(b.blankets) : shelter.blankets;
      
      // Auto status update on full capacity
      let newStatus = b.status || shelter.status;
      if (newOccupancy >= shelter.capacity && newStatus === 'OPEN') {
        newStatus = 'FULL';
      } else if (newOccupancy < shelter.capacity && newStatus === 'FULL') {
        newStatus = 'OPEN';
      }

      const now = new Date().toISOString();
      db.prepare(`
        UPDATE shelters
        SET occupancy = ?, water_liters = ?, food_rations = ?, medical_kits = ?, blankets = ?, status = ?, updated_at = ?
        WHERE id = ?
      `).run(newOccupancy, newWater, newFood, newMeds, newBlankets, newStatus, now, shelterId);

      audit(user ? user.username : 'SHELTER_MGR', 'SHELTER_UPDATED', shelter.name, `Occupancy: ${newOccupancy}/${shelter.capacity}, Water: ${newWater}L`, ip);
      syncLegacyJson();

      const updated = db.prepare('SELECT * FROM shelters WHERE id = ?').get(shelterId);
      sse.broadcast('shelter_updated', updated);
      sse.broadcast('state', getSystemState());

      return sendJson(res, 200, {
        id: updated.id,
        name: updated.name,
        capacity: updated.capacity,
        occupancy: updated.occupancy,
        water: updated.water_liters,
        food: updated.food_rations,
        medical_kits: updated.medical_kits,
        status: updated.status
      });
    }

    // Shelter Check-in / Check-out actions
    const checkinMatch = pathname.match(/^\/api\/shelters\/(\d+)\/(checkin|checkout)$/);
    if (req.method === 'POST' && checkinMatch) {
      const shelterId = Number(checkinMatch[1]);
      const action = checkinMatch[2];
      const b = await readJsonBody(req);
      const count = Math.max(1, Number(b.count) || 1);

      const shelter = db.prepare('SELECT * FROM shelters WHERE id = ?').get(shelterId);
      if (!shelter) return sendJson(res, 404, { error: 'Shelter not found' });

      let newOccupancy = action === 'checkin'
        ? shelter.occupancy + count
        : Math.max(0, shelter.occupancy - count);

      let newStatus = shelter.status;
      if (newOccupancy >= shelter.capacity) newStatus = 'FULL';
      else if (shelter.status === 'FULL' && newOccupancy < shelter.capacity) newStatus = 'OPEN';

      const now = new Date().toISOString();
      db.prepare(`
        UPDATE shelters SET occupancy = ?, status = ?, updated_at = ? WHERE id = ?
      `).run(newOccupancy, newStatus, now, shelterId);

      audit(user ? user.username : 'GATE', action === 'checkin' ? 'SHELTER_CHECKIN' : 'SHELTER_CHECKOUT', shelter.name, `${count} evacuees (${action})`, ip);
      syncLegacyJson();

      const updated = db.prepare('SELECT * FROM shelters WHERE id = ?').get(shelterId);
      sse.broadcast('shelter_updated', updated);
      sse.broadcast('state', getSystemState());
      return sendJson(res, 200, updated);
    }

    // =========================================================================
    // RESOURCE MANAGEMENT (Step 12)
    // =========================================================================
    if (req.method === 'GET' && pathname === '/api/resources') {
      const resources = db.prepare(`
        SELECT r.*, s.name AS shelter_name
        FROM resources r
        LEFT JOIN shelters s ON r.shelter_id = s.id
        ORDER BY r.id ASC
      `).all();
      return sendJson(res, 200, resources);
    }

    if (req.method === 'POST' && pathname === '/api/resources') {
      if (user && !['ADMIN', 'COORDINATOR'].includes(user.role)) {
        return sendJson(res, 403, { error: 'Requires Coordinator or Admin' });
      }
      const b = await readJsonBody(req);
      if (!b.name || !b.category || b.quantity === undefined) {
        return sendJson(res, 400, { error: 'Name, category, and quantity are required' });
      }
      const now = new Date().toISOString();
      const insert = db.prepare(`
        INSERT INTO resources (shelter_id, name, category, quantity, unit, minimum_threshold, is_simulation, last_updated)
        VALUES (?, ?, ?, ?, ?, ?, 0, ?)
        RETURNING *
      `);
      const row = insert.get(
        b.shelter_id ? Number(b.shelter_id) : null,
        b.name, b.category, Number(b.quantity), b.unit || 'units',
        Number(b.minimum_threshold) || 10, now
      );
      audit(user ? user.username : 'LOGISTICS', 'RESOURCE_CREATED', row.name, `Qty: ${row.quantity} ${row.unit}`, ip);
      sse.broadcast('resource_updated', row);
      sse.broadcast('state', getSystemState());
      return sendJson(res, 201, row);
    }

    const resTxMatch = pathname.match(/^\/api\/resources\/(\d+)\/transaction$/);
    if (req.method === 'POST' && resTxMatch) {
      const resourceId = Number(resTxMatch[1]);
      const b = await readJsonBody(req);
      const validTypes = ['INCOMING', 'OUTGOING', 'TRANSFER'];
      if (!validTypes.includes(b.type) || !b.quantity) {
        return sendJson(res, 400, { error: 'Type (INCOMING/OUTGOING/TRANSFER) and quantity required' });
      }

      const resItem = db.prepare('SELECT * FROM resources WHERE id = ?').get(resourceId);
      if (!resItem) return sendJson(res, 404, { error: 'Resource item not found' });

      const qtyChange = Number(b.quantity);
      let newQty = resItem.quantity;
      if (b.type === 'INCOMING') newQty += qtyChange;
      else if (b.type === 'OUTGOING' || b.type === 'TRANSFER') newQty = Math.max(0, newQty - qtyChange);

      const now = new Date().toISOString();
      db.prepare('UPDATE resources SET quantity = ?, last_updated = ? WHERE id = ?').run(newQty, now, resourceId);

      db.prepare(`
        INSERT INTO resource_transactions (resource_id, resource_name, type, quantity, source_or_destination, notes, actor, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(resourceId, resItem.name, b.type, qtyChange, b.source_or_destination || 'Central Depo', b.notes || '', user ? user.username : 'LOGISTICS', now);

      audit(user ? user.username : 'LOGISTICS', 'RESOURCE_TX', `${resItem.name} (${b.type})`, `${qtyChange} ${resItem.unit}. New balance: ${newQty}`, ip);
      sse.broadcast('resource_updated', { id: resourceId, newQuantity: newQty });
      sse.broadcast('state', getSystemState());

      return sendJson(res, 200, { success: true, newQuantity: newQty });
    }

    // =========================================================================
    // EMERGENCY ANNOUNCEMENTS (Step 16 — Preserved & Upgraded)
    // =========================================================================
    if (req.method === 'GET' && pathname === '/api/announcements') {
      const list = db.prepare('SELECT * FROM announcements ORDER BY id DESC LIMIT 50').all();
      return sendJson(res, 200, list);
    }

    if (req.method === 'POST' && pathname === '/api/announcements') {
      // Step 16: Only authorized users can issue official announcements
      if (user && !['ADMIN', 'COORDINATOR'].includes(user.role)) {
        return sendJson(res, 403, { error: 'Permission denied: Only Coordinators or Admins can issue official emergency broadcasts' });
      }

      const b = await readJsonBody(req);
      if (!b.title || !b.message) {
        return sendJson(res, 400, { error: 'Title and message are required' });
      }

      const priority = ['CRITICAL', 'HIGH', 'NORMAL', 'INFO'].includes(b.priority) ? b.priority : 'NORMAL';
      const issuer = user ? `${user.full_name} (${user.role})` : (b.issuer || 'Emergency Operations Center');
      const now = new Date().toISOString();

      const insert = db.prepare(`
        INSERT INTO announcements (title, message, priority, issuer, is_simulation, created_at)
        VALUES (?, ?, ?, ?, 0, ?)
        RETURNING *
      `);
      const row = insert.get(b.title.trim(), b.message.trim(), priority, issuer, now);

      audit(user ? user.username : 'DISPATCH', 'ANNOUNCEMENT', `[${priority}] ${row.title}`, row.message, ip);
      syncLegacyJson();

      sse.broadcast('announcement', row);
      sse.broadcast('state', getSystemState());

      return sendJson(res, 201, row);
    }

    // =========================================================================
    // INCIDENTS REPORTING (Step 14)
    // =========================================================================
    if (req.method === 'GET' && pathname === '/api/incidents') {
      const incidents = db.prepare('SELECT * FROM incidents ORDER BY id DESC').all();
      return sendJson(res, 200, incidents);
    }

    if (req.method === 'POST' && pathname === '/api/incidents') {
      const b = await readJsonBody(req);
      if (!b.title || !b.description || !b.location) {
        return sendJson(res, 400, { error: 'Title, description, and location are required' });
      }

      const validTypes = ['FLOOD', 'FIRE', 'LANDSLIDE', 'STRUCTURAL_DAMAGE', 'ROAD_BLOCK', 'MEDICAL', 'MISSING_PERSON', 'INFRASTRUCTURE', 'OTHER'];
      const type = validTypes.includes(b.incident_type) ? b.incident_type : 'OTHER';
      const severity = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].includes(b.severity) ? b.severity : 'MEDIUM';
      const reporter = user ? `${user.full_name}` : (b.reporter || 'Field Scout');
      const now = new Date().toISOString();

      const insert = db.prepare(`
        INSERT INTO incidents (title, description, incident_type, severity, location, lat, lng, photo, reporter, status, is_simulation, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, 'REPORTED', 0, ?, ?)
        RETURNING *
      `);
      const row = insert.get(
        b.title.trim(), b.description.trim(), type, severity, b.location.trim(),
        b.lat ? Number(b.lat) : null, b.lng ? Number(b.lng) : null,
        reporter, now, now
      );

      audit(user ? user.username : 'SCOUT', 'INCIDENT_REPORTED', `${row.title} (${type})`, row.description, ip);
      sse.broadcast('incident_created', row);
      sse.broadcast('state', getSystemState());

      return sendJson(res, 201, row);
    }

    const incStatusMatch = pathname.match(/^\/api\/incidents\/(\d+)\/status$/);
    if (req.method === 'PATCH' && incStatusMatch) {
      const incId = Number(incStatusMatch[1]);
      const b = await readJsonBody(req);
      const validStatuses = ['REPORTED', 'VERIFIED', 'RESPONDING', 'RESOLVED'];
      if (!validStatuses.includes(b.status)) {
        return sendJson(res, 400, { error: 'Invalid status' });
      }
      const now = new Date().toISOString();
      db.prepare('UPDATE incidents SET status = ?, updated_at = ? WHERE id = ?').run(b.status, now, incId);
      const updated = db.prepare('SELECT * FROM incidents WHERE id = ?').get(incId);
      audit(user ? user.username : 'COMMAND', 'INCIDENT_STATUS', `Incident #${incId} → ${b.status}`, '', ip);
      sse.broadcast('incident_updated', updated);
      sse.broadcast('state', getSystemState());
      return sendJson(res, 200, updated);
    }

    // =========================================================================
    // MISSING PERSON SYSTEM (Step 13)
    // =========================================================================
    if (req.method === 'GET' && pathname === '/api/missing') {
      const search = parsedUrl.searchParams.get('q') || '';
      let list;
      if (search) {
        list = db.prepare(`
          SELECT * FROM missing_persons
          WHERE full_name LIKE ? OR identifying_features LIKE ? OR last_seen_location LIKE ?
          ORDER BY id DESC
        `).all(`%${search}%`, `%${search}%`, `%${search}%`);
      } else {
        list = db.prepare('SELECT * FROM missing_persons ORDER BY id DESC').all();
      }
      return sendJson(res, 200, list);
    }

    if (req.method === 'POST' && pathname === '/api/missing') {
      const b = await readJsonBody(req);
      if (!b.full_name || !b.last_seen_location) {
        return sendJson(res, 400, { error: 'Full name and last seen location are required' });
      }

      const trackingCode = 'MP-' + new Date().getFullYear() + '-' + crypto.randomBytes(2).toString('hex').toUpperCase();
      const now = new Date().toISOString();

      const insert = db.prepare(`
        INSERT INTO missing_persons (tracking_code, full_name, age, gender, last_seen_location, last_seen_time, contact_info, identifying_features, photo_url, status, notes, is_simulation, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'MISSING', ?, 0, ?, ?)
        RETURNING *
      `);
      const row = insert.get(
        trackingCode, b.full_name.trim(), b.age ? Number(b.age) : null, b.gender || 'UNSPECIFIED',
        b.last_seen_location.trim(), b.last_seen_time || 'Recent', b.contact_info || '',
        b.identifying_features || '', b.photo_url || '', b.notes || '', now, now
      );

      audit(user ? user.username : 'CITIZEN', 'MISSING_REGISTERED', `${row.full_name} (${trackingCode})`, row.last_seen_location, ip);
      sse.broadcast('missing_updated', row);
      sse.broadcast('state', getSystemState());

      return sendJson(res, 201, row);
    }

    const missingStatusMatch = pathname.match(/^\/api\/missing\/(\d+)\/status$/);
    if (req.method === 'PATCH' && missingStatusMatch) {
      const mpId = Number(missingStatusMatch[1]);
      const b = await readJsonBody(req);
      const validStatuses = ['MISSING', 'FOUND', 'IDENTIFIED', 'REUNITED'];
      if (!validStatuses.includes(b.status)) {
        return sendJson(res, 400, { error: 'Invalid status' });
      }
      const now = new Date().toISOString();
      db.prepare('UPDATE missing_persons SET status = ?, notes = COALESCE(?, notes), updated_at = ? WHERE id = ?').run(b.status, b.notes || null, now, mpId);
      const updated = db.prepare('SELECT * FROM missing_persons WHERE id = ?').get(mpId);
      audit(user ? user.username : 'DESK', 'MISSING_STATUS', `${updated.full_name} (${updated.tracking_code}) → ${b.status}`, b.notes || '', ip);
      sse.broadcast('missing_updated', updated);
      sse.broadcast('state', getSystemState());
      return sendJson(res, 200, updated);
    }

    // =========================================================================
    // MEDICAL COORDINATION SYSTEM (Step 10)
    // =========================================================================
    if (req.method === 'GET' && pathname === '/api/medical') {
      const cases = db.prepare(`
        SELECT m.*, s.requester, s.location, s.priority AS sos_priority
        FROM medical_cases m
        LEFT JOIN sos_requests s ON m.sos_id = s.id
        ORDER BY
          CASE m.triage_priority
            WHEN 'RED_IMMEDIATE' THEN 1
            WHEN 'YELLOW_DELAYED' THEN 2
            WHEN 'GREEN_MINOR' THEN 3
            WHEN 'BLACK_EXPECTANT' THEN 4
            ELSE 5
          END ASC, m.id DESC
      `).all();
      return sendJson(res, 200, cases);
    }

    if (req.method === 'POST' && pathname === '/api/medical') {
      const b = await readJsonBody(req);
      if (!b.patient_name || !b.symptoms) {
        return sendJson(res, 400, { error: 'Patient name and symptoms are required' });
      }

      const priority = ['RED_IMMEDIATE', 'YELLOW_DELAYED', 'GREEN_MINOR', 'BLACK_EXPECTANT'].includes(b.triage_priority) ? b.triage_priority : 'YELLOW_DELAYED';
      const now = new Date().toISOString();

      const insert = db.prepare(`
        INSERT INTO medical_cases (sos_id, patient_name, triage_status, triage_priority, symptoms, vitals_summary, resource_requests, assigned_medic, notes, is_simulation, created_at, updated_at)
        VALUES (?, ?, 'WAITING', ?, ?, ?, ?, ?, ?, 0, ?, ?)
        RETURNING *
      `);
      const row = insert.get(
        b.sos_id ? Number(b.sos_id) : null,
        b.patient_name.trim(), priority, b.symptoms.trim(),
        b.vitals_summary || '', b.resource_requests || '', b.assigned_medic || '', b.notes || '',
        now, now
      );

      audit(user ? user.username : 'TRIAGE', 'MEDICAL_CASE_CREATED', row.patient_name, priority, ip);
      sse.broadcast('medical_updated', row);
      sse.broadcast('state', getSystemState());

      return sendJson(res, 201, row);
    }

    const medPatchMatch = pathname.match(/^\/api\/medical\/(\d+)$/);
    if (req.method === 'PATCH' && medPatchMatch) {
      const medId = Number(medPatchMatch[1]);
      const b = await readJsonBody(req);
      const current = db.prepare('SELECT * FROM medical_cases WHERE id = ?').get(medId);
      if (!current) return sendJson(res, 404, { error: 'Medical case not found' });

      const newStatus = b.triage_status || current.triage_status;
      const newPriority = b.triage_priority || current.triage_priority;
      const newMedic = b.assigned_medic !== undefined ? b.assigned_medic : current.assigned_medic;
      const newNotes = b.notes !== undefined ? b.notes : current.notes;
      const now = new Date().toISOString();

      db.prepare(`
        UPDATE medical_cases
        SET triage_status = ?, triage_priority = ?, assigned_medic = ?, notes = ?, updated_at = ?
        WHERE id = ?
      `).run(newStatus, newPriority, newMedic, newNotes, now, medId);

      audit(user ? user.username : 'TRIAGE_DOC', 'MEDICAL_TRIAGE_UPDATE', current.patient_name, `${newPriority} | ${newStatus}`, ip);
      const updated = db.prepare('SELECT * FROM medical_cases WHERE id = ?').get(medId);
      sse.broadcast('medical_updated', updated);
      sse.broadcast('state', getSystemState());
      return sendJson(res, 200, updated);
    }

    // =========================================================================
    // LOCAL CHAT & INTER-AGENCY MESSAGING (Step 17)
    // =========================================================================
    const chatMatch = pathname.match(/^\/api\/chat\/([A-Za-z]+)$/);
    if (chatMatch) {
      const channel = chatMatch[1].toUpperCase();
      if (!['COMMAND', 'VOLUNTEERS', 'MEDICAL', 'GENERAL'].includes(channel)) {
        return sendJson(res, 400, { error: 'Invalid channel. Allowed: COMMAND, VOLUNTEERS, MEDICAL, GENERAL' });
      }

      if (req.method === 'GET') {
        const msgs = db.prepare(`
          SELECT * FROM chat_messages
          WHERE channel = ?
          ORDER BY id DESC
          LIMIT 50
        `).all(channel);
        return sendJson(res, 200, msgs.reverse());
      }

      if (req.method === 'POST') {
        const b = await readJsonBody(req);
        if (!b.message || !b.message.trim()) {
          return sendJson(res, 400, { error: 'Message cannot be empty' });
        }

        const senderName = user ? user.full_name : (b.sender_name || 'Radio Unit');
        const senderRole = user ? user.role : (b.sender_role || 'CITIZEN');

        // RBAC check for restricted channels
        if (channel === 'COMMAND' && (!user || !['ADMIN', 'COORDINATOR'].includes(user.role))) {
          return sendJson(res, 403, { error: 'Access denied: COMMAND channel is restricted to Coordinators and Admins' });
        }

        const now = new Date().toISOString();
        const insert = db.prepare(`
          INSERT INTO chat_messages (channel, sender_id, sender_name, sender_role, message, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
          RETURNING *
        `);
        const row = insert.get(channel, user ? user.id : null, senderName, senderRole, b.message.trim().slice(0, 500), now);

        sse.broadcast('message_created', row);
        return sendJson(res, 201, row);
      }
    }

    // =========================================================================
    // AUDIT LOGS & DISASTER TIMELINE (Step 20 & 21)
    // =========================================================================
    if (req.method === 'GET' && pathname === '/api/audit') {
      const logs = db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 100').all();
      return sendJson(res, 200, logs);
    }

    if (req.method === 'GET' && pathname === '/api/timeline') {
      // Aggregates operational milestones across tables into chronological order
      const timeline = [];

      const sosRows = db.prepare('SELECT id, rescue_id, requester, emergency_type, status, created_at FROM sos_requests ORDER BY id DESC LIMIT 30').all();
      for (const s of sosRows) {
        timeline.push({
          time: s.created_at,
          category: 'SOS',
          title: `SOS ${s.rescue_id} Created`,
          detail: `${s.requester} reported ${s.emergency_type} emergency`
        });
      }

      const shelterRows = db.prepare('SELECT name, occupancy, capacity, updated_at FROM shelters WHERE occupancy > 0 LIMIT 10').all();
      for (const sh of shelterRows) {
        timeline.push({
          time: sh.updated_at,
          category: 'SHELTER',
          title: `Shelter ${sh.name} Updated`,
          detail: `Occupancy at ${sh.occupancy}/${sh.capacity} (${Math.round((sh.occupancy / sh.capacity) * 100)}%)`
        });
      }

      const annRows = db.prepare('SELECT title, priority, created_at FROM announcements LIMIT 20').all();
      for (const a of annRows) {
        timeline.push({
          time: a.created_at,
          category: 'BROADCAST',
          title: `Announcement [${a.priority}]`,
          detail: a.title
        });
      }

      const auditRows = db.prepare('SELECT actor, action, detail, created_at FROM audit_logs WHERE action IN (\'TASK_ASSIGNED\', \'SOS_STATUS\', \'RESOURCE_TX\', \'SIMULATION_START\') LIMIT 30').all();
      for (const au of auditRows) {
        timeline.push({
          time: au.created_at,
          category: 'ACTION',
          title: `${au.actor}: ${au.action}`,
          detail: au.detail
        });
      }

      timeline.sort((a, b) => new Date(b.time) - new Date(a.time));
      return sendJson(res, 200, timeline.slice(0, 60));
    }

    // =========================================================================
    // DISASTER SIMULATION ENGINE (Step 19)
    // =========================================================================
    if (req.method === 'GET' && pathname === '/api/simulation') {
      return sendJson(res, 200, simulator.getStatus());
    }

    if (req.method === 'POST' && pathname === '/api/simulation/start') {
      const b = await readJsonBody(req);
      const result = simulator.start(b.scenario || 'FLOOD', b.speedMs || 7000);
      return sendJson(res, 200, result);
    }

    if (req.method === 'POST' && pathname === '/api/simulation/pause') {
      return sendJson(res, 200, simulator.pause());
    }

    if (req.method === 'POST' && pathname === '/api/simulation/resume') {
      return sendJson(res, 200, simulator.resume());
    }

    if (req.method === 'POST' && pathname === '/api/simulation/reset') {
      return sendJson(res, 200, simulator.reset());
    }

    if (req.method === 'POST' && pathname === '/api/simulation/end') {
      return sendJson(res, 200, simulator.end());
    }

    // =========================================================================
    // DEMO RESET (Step 28)
    // =========================================================================
    if (req.method === 'POST' && pathname === '/api/demo/reset') {
      simulator.reset();
      seedDatabase(true);
      audit(user ? user.username : 'ADMIN', 'DEMO_RESET', 'Database restored to competition demo state', '', ip);
      sse.broadcast('state', getSystemState());
      return sendJson(res, 200, { success: true, message: 'Database reset to demo state.' });
    }

    // =========================================================================
    // MULTI-STATION & USB SYNC (Step 26 & 27)
    // =========================================================================
    if (req.method === 'GET' && pathname === '/api/sync/export') {
      const pkg = exportDisasterPackage(parsedUrl.searchParams.get('stationId') || DEFAULT_STATION_ID);
      audit(user ? user.username : 'SYNC', 'SYNC_EXPORT', `Disaster Package Checksum: ${pkg.checksum.slice(0, 8)}`, '', ip);
      return sendJson(res, 200, pkg);
    }

    if (req.method === 'POST' && pathname === '/api/sync/import') {
      const b = await readJsonBody(req);
      try {
        const results = importDisasterPackage(b, user ? user.username : 'USB_SYNC', ip);
        sse.broadcast('state', getSystemState());
        return sendJson(res, 200, results);
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }
    }

    // =========================================================================
    // HARDWARE & NETWORK STATUS (Step 24 & 26)
    // =========================================================================
    if (req.method === 'GET' && pathname === '/api/lora') {
      return sendJson(res, 200, loraAdapter.getStatus());
    }

    if (req.method === 'GET' && pathname === '/api/system') {
      const sampleCpu = () => os.cpus().reduce((total, cpu) => {
        const values = Object.values(cpu.times).reduce((sum, value) => sum + value, 0);
        return { idle: total.idle + cpu.times.idle, total: total.total + values };
      }, { idle: 0, total: 0 });
      const before = sampleCpu();
      await new Promise(resolve => setTimeout(resolve, 150));
      const after = sampleCpu();
      const totalDelta = after.total - before.total;
      const cpuPercent = totalDelta > 0 ? Math.round((1 - (after.idle - before.idle) / totalDelta) * 100) : null;
      const cpus = os.cpus();
      let osName = `${os.type()} ${os.release()}`;
      if (process.platform === 'linux') {
        try {
          const release = fs.readFileSync('/etc/os-release', 'utf8');
          osName = release.match(/^PRETTY_NAME="?([^"\n]+)"?/m)?.[1] || osName;
        } catch { /* report kernel name and release */ }
      }
      let storage = null;
      try {
        const rootPath = process.platform === 'win32' ? path.parse(process.cwd()).root : '/';
        const stat = fs.statfsSync(rootPath);
        storage = { path: rootPath, totalBytes: stat.blocks * stat.bsize, availableBytes: stat.bavail * stat.bsize };
      } catch { /* storage statistics are platform-dependent */ }
      return sendJson(res, 200, {
        os: osName,
        uptimeSeconds: os.uptime(),
        cpu: { model: cpus[0]?.model || 'Unknown', cores: cpus.length, usagePercent: cpuPercent },
        memory: { totalBytes: os.totalmem(), availableBytes: os.freemem() },
        storage
      });
    }

    if (req.method === 'GET' && pathname === '/api/network') {
      const interfaces = [];
      for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
        for (const a of addrs || []) {
          if (a.family === 'IPv4' && !a.internal) {
            interfaces.push({
              name,
              address: a.address,
              url: `http://${a.address}:${PORT}`
            });
          }
        }
      }
      let defaultGateway = null;
      if (process.platform === 'linux') {
        try {
          const routes = JSON.parse(execFileSync('ip', ['-j', '-4', 'route', 'show', 'default'], { encoding: 'utf8', timeout: 1500, stdio: ['ignore', 'pipe', 'ignore'] }));
          defaultGateway = routes[0]?.gateway || null;
        } catch { /* iproute2 may be unavailable */ }
      } else if (process.platform === 'win32') {
        try {
          const routes = execFileSync('route.exe', ['PRINT', '-4'], { encoding: 'utf8', timeout: 1500, stdio: ['ignore', 'pipe', 'ignore'] });
          defaultGateway = routes.match(/^\s*0\.0\.0\.0\s+0\.0\.0\.0\s+(\d{1,3}(?:\.\d{1,3}){3})/m)?.[1] || null;
        } catch { /* route.exe may be unavailable */ }
      }
      return sendJson(res, 200, {
        hostname: os.hostname(),
        port: PORT,
        stationId: DEFAULT_STATION_ID,
        interfaces,
        dns: require('dns').getServers(),
        defaultGateway,
        activeClients: sse.getClientCount()
      });
    }

    if (req.method === 'GET' && pathname === '/api/network/diagnostics') {
      const interfaces = Object.entries(os.networkInterfaces()).flatMap(([name, addrs]) =>
        (addrs || []).filter(a => !a.internal).map(a => ({ name, address: a.address, family: a.family })));
      let route = null;
      let linkStates = new Map();
      if (process.platform === 'linux') {
        try {
          const routes = JSON.parse(execFileSync('ip', ['-j', '-4', 'route', 'show', 'default'], { encoding: 'utf8', timeout: 1500, stdio: ['ignore', 'pipe', 'ignore'] }));
          route = routes[0] || null;
        } catch { /* route check reports unavailable */ }
        try {
          const links = JSON.parse(execFileSync('ip', ['-j', 'link', 'show'], { encoding: 'utf8', timeout: 1500, stdio: ['ignore', 'pipe', 'ignore'] }));
          linkStates = new Map(links.map(link => [link.ifname, (link.flags || []).includes('UP')]));
        } catch { /* link state unavailable */ }
      } else if (process.platform === 'win32') {
        try {
          const routes = execFileSync('route.exe', ['PRINT', '-4'], { encoding: 'utf8', timeout: 1500, stdio: ['ignore', 'pipe', 'ignore'] });
          const gateway = routes.match(/^\s*0\.0\.0\.0\s+0\.0\.0\.0\s+(\d{1,3}(?:\.\d{1,3}){3})/m)?.[1];
          if (gateway) route = { gateway };
        } catch { /* route detection unavailable */ }
      }
      const activeInterfaces = [...new Set(interfaces.map(i => i.name))];
      const ipv4Interfaces = interfaces.filter(i => i.family === 'IPv4');
      const dnsServerList = require('dns').getServers();
      const checks = [
        { label: 'Interface', ok: activeInterfaces.length > 0, detail: activeInterfaces.length ? activeInterfaces.join(', ') : 'No non-loopback interfaces found' },
        { label: 'Link', ok: process.platform === 'linux' ? activeInterfaces.some(name => linkStates.get(name) === true) : null, detail: process.platform === 'linux' ? (activeInterfaces.some(name => linkStates.get(name) === true) ? 'At least one interface is administratively up' : 'No active interface link detected') : 'Link state is not available through this platform API' },
        { label: 'IP assignment', ok: ipv4Interfaces.length > 0, detail: ipv4Interfaces.length ? ipv4Interfaces.map(i => `${i.name}: ${i.address}`).join(', ') : 'No IPv4 address assigned; check DHCP or static configuration' },
        { label: 'Default route', ok: ['linux', 'win32'].includes(process.platform) ? Boolean(route?.gateway) : null, detail: ['linux', 'win32'].includes(process.platform) ? (route?.gateway ? `Gateway ${route.gateway}${route.dev ? ` via ${route.dev}` : ''}` : 'No IPv4 default route found') : 'Default route detection is unavailable on this platform' },
        { label: 'DNS resolution', ok: false, detail: dnsServerList.length ? `Configured resolver(s): ${dnsServerList.join(', ')}; checking resolution…` : 'No DNS resolver configured' },
        { label: 'External connectivity', ok: null, detail: 'Not checked yet' }
      ];
      if (dnsServerList.length) {
        let dnsTimeout;
        try {
          await Promise.race([dns.lookup('example.com'), new Promise((_, reject) => { dnsTimeout = setTimeout(() => reject(new Error('Timed out after 3 seconds')), 3000); })]);
          checks[4].ok = true;
          checks[4].detail = `Resolved example.com using ${dnsServerList.join(', ')}`;
        } catch (err) { checks[4].detail = `Resolution failed: ${err.message}`; }
        finally { clearTimeout(dnsTimeout); }
      }
      try {
        const response = await fetch('https://connectivitycheck.gstatic.com/generate_204', { signal: AbortSignal.timeout(2500), redirect: 'manual' });
        checks[5].ok = response.status === 204;
        checks[5].detail = response.status === 204 ? 'External connectivity confirmed (HTTP 204)' : `Connectivity endpoint returned HTTP ${response.status}`;
      } catch (err) { checks[5].detail = `External connectivity unavailable: ${err.name === 'AbortError' ? 'timed out after 2.5 seconds' : err.message}`; }
      return sendJson(res, 200, { checks, platform: process.platform });
    }

    // Read-only SQLite browser. Database contents are restricted to administrators.
    if (req.method === 'GET' && pathname === '/api/database') {
      if (!user) return sendJson(res, 401, { error: 'Sign in as an administrator to inspect the database.' });
      if (user.role !== 'ADMIN') return sendJson(res, 403, { error: 'Administrator access is required.' });
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => row.name);
      const tableName = parsedUrl.searchParams.get('table');
      if (!tableName) return sendJson(res, 200, { connected: true, engine: 'SQLite', tables });
      if (!tables.includes(tableName)) return sendJson(res, 400, { error: 'Unknown table.' });
      const limit = Math.min(100, Math.max(1, Number.parseInt(parsedUrl.searchParams.get('limit') || '50', 10) || 50));
      const offset = Math.min(1000000, Math.max(0, Number.parseInt(parsedUrl.searchParams.get('offset') || '0', 10) || 0));
      const identifier = `"${tableName.replace(/"/g, '""')}"`;
      const started = Date.now();
      const sensitive = new Set(['password_hash', 'salt', 'token', 'secret', 'api_key']);
      const schema = db.prepare(`PRAGMA table_info(${identifier})`).all().filter(column => !sensitive.has(column.name.toLowerCase())).map(({ name, type, notnull, pk }) => ({ name, type, required: Boolean(notnull), primaryKey: Boolean(pk) }));
      const totalRows = db.prepare(`SELECT COUNT(*) AS count FROM ${identifier}`).get().count;
      const rows = db.prepare(`SELECT * FROM ${identifier} LIMIT ? OFFSET ?`).all(limit, offset).map(row =>
        Object.fromEntries(Object.entries(row).filter(([key]) => !sensitive.has(key.toLowerCase()))));
      return sendJson(res, 200, { connected: true, engine: 'SQLite', table: tableName, tables, schema, rows, totalRows, limit, offset, durationMs: Date.now() - started, readOnly: true });
    }

    // =========================================================================
    // STATIC FILE SERVING WITH SECURITY HARDENING (Step 22 & 23)
    // =========================================================================
    if (req.method === 'GET') {
      let relativePath = pathname === '/' ? 'index.html' : pathname;
      try {
        relativePath = decodeURIComponent(relativePath);
      } catch {
        return sendJson(res, 400, { error: 'Bad URI encoding' });
      }

      // Hardened against path traversal attacks (CVE-prevention)
      const safePath = path.normalize(path.join(ROOT, relativePath));
      if (!safePath.startsWith(ROOT)) {
        return sendJson(res, 403, { error: 'Forbidden: Path traversal blocked' });
      }

      if (fs.existsSync(safePath) && fs.statSync(safePath).isFile()) {
        const ext = path.extname(safePath).toLowerCase();
        const contentTypes = {
          '.html': 'text/html; charset=utf-8',
          '.js': 'application/javascript; charset=utf-8',
          '.css': 'text/css; charset=utf-8',
          '.json': 'application/json; charset=utf-8',
          '.geojson': 'application/geo+json; charset=utf-8',
          '.svg': 'image/svg+xml',
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.ico': 'image/x-icon',
          '.txt': 'text/plain; charset=utf-8'
        };

        const ct = contentTypes[ext] || 'application/octet-stream';
        res.writeHead(200, {
          'Content-Type': ct,
          'Cache-Control': 'no-cache',
          'X-Content-Type-Options': 'nosniff',
          'X-Frame-Options': 'DENY'
        });
        return fs.createReadStream(safePath).pipe(res);
      }
    }

    // Default 404 Handler
    return sendJson(res, 404, { error: 'Endpoint or resource not found: ' + pathname });

  } catch (err) {
    console.error('Unhandled server error:', err);
    return sendJson(res, 500, { error: 'Internal Emergency System Error', message: err.message });
  }
});

// Startup Listen
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n======================================================`);
  console.log(`🚨 RESCUEOS — DISASTER RESPONSE COORDINATION SYSTEM`);
  console.log(`“Boot. Connect. Rescue.”`);
  console.log(`Station: ${DEFAULT_STATION_ID}`);
  console.log(`Local Access: http://localhost:${PORT}`);
  console.log(`------------------------------------------------------`);
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) {
        console.log(`📡 Local Wi-Fi / LAN (${name}): http://${a.address}:${PORT}`);
      }
    }
  }
  console.log(`======================================================\n`);
});

// Graceful Shutdown
function handleShutdown() {
  console.log('\nStopping RescueOS service...');
  simulator.clearTimer();
  syncLegacyJson();
  server.close(() => {
    console.log('RescueOS offline.');
    process.exit(0);
  });
}

process.on('SIGINT', handleShutdown);
process.on('SIGTERM', handleShutdown);

module.exports = server;
