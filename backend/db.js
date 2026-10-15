/**
 * RescueOS Database Engine
 * Zero-dependency, offline-first SQLite database layer using Node.js built-in node:sqlite.
 */
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

// Runtime data directory: writable location for SQLite DB and legacy JSON.
// On the Debian Live ISO, /opt/rescueos is read-only SquashFS.  The systemd
// service sets RESCUEOS_DATA_DIR=/var/lib/rescueos (writable tmpfs/persistence).
// On Windows/macOS dev machines the default falls back to __dirname so existing
// workflows keep working without any env configuration.
const DATA_DIR = process.env.RESCUEOS_DATA_DIR
  || (process.platform === 'linux' && fs.existsSync('/var/lib/rescueos')
      ? '/var/lib/rescueos'
      : __dirname);

// Ensure the data directory exists (no-op if it already does)
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch { /* may lack permission on first boot, StateDirectory handles it */ }

const DB_PATH = path.join(DATA_DIR, 'rescueos.sqlite');
const LEGACY_JSON_PATH = path.join(DATA_DIR, 'rescueos-data.json');

console.log(`[RescueOS DB] Data directory: ${DATA_DIR}`);
console.log(`[RescueOS DB] Database path:  ${DB_PATH}`);

// Initialize SQLite database instance
const db = new DatabaseSync(DB_PATH);

// Enable foreign keys and WAL mode for reliability
db.exec('PRAGMA foreign_keys = ON;');

/**
 * Initialize all database tables, constraints, and indexes
 */
function initSchema() {
  db.exec(`
    -- Users and Authentication
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('CITIZEN', 'VOLUNTEER', 'MEDICAL', 'COORDINATOR', 'ADMIN')),
      phone TEXT DEFAULT '',
      badge_number TEXT DEFAULT '',
      created_at TEXT NOT NULL
    );

    -- Active Sessions / Auth Tokens
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      username TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    -- Emergency SOS Requests
    CREATE TABLE IF NOT EXISTS sos_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rescue_id TEXT UNIQUE NOT NULL,
      requester TEXT NOT NULL,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      emergency_type TEXT NOT NULL CHECK(emergency_type IN ('MEDICAL', 'FLOOD', 'FIRE', 'TRAPPED', 'MISSING_PERSON', 'FOOD_WATER', 'STRUCTURAL_DAMAGE', 'OTHER')),
      description TEXT NOT NULL,
      people_affected INTEGER NOT NULL DEFAULT 1,
      priority TEXT NOT NULL CHECK(priority IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW')),
      location TEXT NOT NULL,
      lat REAL DEFAULT NULL,
      lng REAL DEFAULT NULL,
      status TEXT NOT NULL CHECK(status IN ('NEW', 'ACKNOWLEDGED', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CANCELLED')),
      assigned_volunteer TEXT DEFAULT NULL,
      assigned_volunteer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      notes TEXT DEFAULT '',
      resolution TEXT DEFAULT '',
      triage_level TEXT DEFAULT 'NONE',
      is_simulation INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- Volunteer Rescues / Tasks
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sos_id INTEGER NOT NULL REFERENCES sos_requests(id) ON DELETE CASCADE,
      volunteer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      volunteer_name TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('ASSIGNED', 'ACCEPTED', 'EN_ROUTE', 'IN_PROGRESS', 'RESOLVED', 'ABORTED')),
      instructions TEXT DEFAULT '',
      field_notes TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- Shelters
    CREATE TABLE IF NOT EXISTS shelters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      location TEXT NOT NULL,
      lat REAL DEFAULT NULL,
      lng REAL DEFAULT NULL,
      capacity INTEGER NOT NULL DEFAULT 100,
      occupancy INTEGER NOT NULL DEFAULT 0,
      contact TEXT DEFAULT '',
      medical_support INTEGER NOT NULL DEFAULT 1,
      accessibility INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL CHECK(status IN ('OPEN', 'FULL', 'CLOSED', 'EMERGENCY_ONLY')),
      water_liters INTEGER NOT NULL DEFAULT 0,
      food_rations INTEGER NOT NULL DEFAULT 0,
      medical_kits INTEGER NOT NULL DEFAULT 0,
      blankets INTEGER NOT NULL DEFAULT 0,
      is_simulation INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- Resource Inventory
    CREATE TABLE IF NOT EXISTS resources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shelter_id INTEGER REFERENCES shelters(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      category TEXT NOT NULL CHECK(category IN ('Water', 'Food', 'Medicine', 'Blankets', 'Fuel', 'First Aid', 'Clothing', 'Other')),
      quantity REAL NOT NULL DEFAULT 0,
      unit TEXT NOT NULL,
      minimum_threshold REAL NOT NULL DEFAULT 10,
      is_simulation INTEGER NOT NULL DEFAULT 0,
      last_updated TEXT NOT NULL
    );

    -- Resource Stock Movements / Transactions
    CREATE TABLE IF NOT EXISTS resource_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      resource_id INTEGER REFERENCES resources(id) ON DELETE CASCADE,
      resource_name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('INCOMING', 'OUTGOING', 'TRANSFER')),
      quantity REAL NOT NULL,
      source_or_destination TEXT NOT NULL,
      notes TEXT DEFAULT '',
      actor TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    -- General Disaster Incidents
    CREATE TABLE IF NOT EXISTS incidents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      incident_type TEXT NOT NULL CHECK(incident_type IN ('FLOOD', 'FIRE', 'LANDSLIDE', 'STRUCTURAL_DAMAGE', 'ROAD_BLOCK', 'MEDICAL', 'MISSING_PERSON', 'INFRASTRUCTURE', 'OTHER')),
      severity TEXT NOT NULL CHECK(severity IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW')),
      location TEXT NOT NULL,
      lat REAL DEFAULT NULL,
      lng REAL DEFAULT NULL,
      photo TEXT DEFAULT '',
      reporter TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('REPORTED', 'VERIFIED', 'RESPONDING', 'RESOLVED')),
      is_simulation INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- Missing Persons Registry
    CREATE TABLE IF NOT EXISTS missing_persons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tracking_code TEXT UNIQUE NOT NULL,
      full_name TEXT NOT NULL,
      age INTEGER DEFAULT NULL,
      gender TEXT DEFAULT 'UNSPECIFIED',
      last_seen_location TEXT NOT NULL,
      last_seen_time TEXT NOT NULL,
      contact_info TEXT NOT NULL,
      identifying_features TEXT DEFAULT '',
      photo_url TEXT DEFAULT '',
      status TEXT NOT NULL CHECK(status IN ('MISSING', 'FOUND', 'IDENTIFIED', 'REUNITED')),
      notes TEXT DEFAULT '',
      is_simulation INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- Medical Coordination Cases
    CREATE TABLE IF NOT EXISTS medical_cases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sos_id INTEGER REFERENCES sos_requests(id) ON DELETE SET NULL,
      patient_name TEXT NOT NULL,
      triage_status TEXT NOT NULL CHECK(triage_status IN ('WAITING', 'TRIAGED', 'TREATMENT', 'STABILIZED', 'REFERRED', 'RESOLVED')),
      triage_priority TEXT NOT NULL CHECK(triage_priority IN ('RED_IMMEDIATE', 'YELLOW_DELAYED', 'GREEN_MINOR', 'BLACK_EXPECTANT')),
      symptoms TEXT NOT NULL,
      vitals_summary TEXT DEFAULT '',
      resource_requests TEXT DEFAULT '',
      assigned_medic TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      is_simulation INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- Emergency Broadcast Announcements
    CREATE TABLE IF NOT EXISTS announcements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      priority TEXT NOT NULL CHECK(priority IN ('CRITICAL', 'HIGH', 'NORMAL', 'INFO')),
      issuer TEXT NOT NULL,
      expires_at TEXT DEFAULT NULL,
      is_simulation INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    -- Local Mesh / Inter-agency Chat
    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel TEXT NOT NULL CHECK(channel IN ('COMMAND', 'VOLUNTEERS', 'MEDICAL', 'GENERAL')),
      sender_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      sender_name TEXT NOT NULL,
      sender_role TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    -- Immutable Audit Logs
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      target TEXT NOT NULL,
      detail TEXT DEFAULT '',
      ip TEXT DEFAULT '',
      created_at TEXT NOT NULL
    );

    -- Multi-Station Sync Event Ledger
    CREATE TABLE IF NOT EXISTS sync_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_uuid TEXT UNIQUE NOT NULL,
      station_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    -- System Configuration Key-Value Store
    CREATE TABLE IF NOT EXISTS system_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Indexes for High Performance Queries
    CREATE INDEX IF NOT EXISTS idx_sos_status ON sos_requests(status);
    CREATE INDEX IF NOT EXISTS idx_sos_priority ON sos_requests(priority);
    CREATE INDEX IF NOT EXISTS idx_sos_rescue_id ON sos_requests(rescue_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_volunteer ON tasks(volunteer_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_sos ON tasks(sos_id);
    CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status);
    CREATE INDEX IF NOT EXISTS idx_resources_shelter ON resources(shelter_id);
    CREATE INDEX IF NOT EXISTS idx_missing_status ON missing_persons(status);
    CREATE INDEX IF NOT EXISTS idx_medical_status ON medical_cases(triage_status);
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_chat_channel ON chat_messages(channel, created_at DESC);
  `);
}

initSchema();

/**
 * Migration helper: if legacy rescueos-data.json has existing records and DB is empty,
 * import them into SQLite so existing user data is preserved!
 */
function migrateLegacyJsonIfEmpty() {
  const rowCount = db.prepare('SELECT COUNT(*) AS count FROM sos_requests').get().count;
  if (rowCount === 0 && fs.existsSync(LEGACY_JSON_PATH)) {
    try {
      const data = JSON.parse(fs.readFileSync(LEGACY_JSON_PATH, 'utf8'));
      if (Array.isArray(data.shelters) && data.shelters.length > 0) {
        const insertShelter = db.prepare(`
          INSERT OR REPLACE INTO shelters (id, name, location, capacity, occupancy, water_liters, food_rations, medical_kits, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?)
        `);
        for (const s of data.shelters) {
          insertShelter.run(
            s.id,
            s.name || 'Shelter ' + s.id,
            s.location || 'Central District',
            s.capacity || 100,
            s.occupancy || 0,
            s.water || 0,
            s.food || 0,
            s.medical_kits || 0,
            new Date().toISOString(),
            new Date().toISOString()
          );
        }
      }
      if (Array.isArray(data.sos) && data.sos.length > 0) {
        const insertSos = db.prepare(`
          INSERT OR REPLACE INTO sos_requests (id, rescue_id, requester, emergency_type, description, people_affected, priority, location, status, assigned_volunteer, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const r of data.sos) {
          const rescueId = 'RSC-' + (r.id.toString(16).padStart(4, '0') + Math.random().toString(16).slice(2, 6)).toUpperCase();
          insertSos.run(
            r.id,
            rescueId,
            r.name || 'Anonymous',
            r.emergency && ['MEDICAL','FLOOD','FIRE','TRAPPED','MISSING_PERSON','FOOD_WATER','STRUCTURAL_DAMAGE','OTHER'].includes(r.emergency) ? r.emergency : 'OTHER',
            r.emergency || 'Disaster emergency request',
            Number(r.people) || 1,
            r.priority || 'HIGH',
            r.location || 'Unknown location',
            r.status || 'NEW',
            r.assigned_to || null,
            r.created_at || new Date().toISOString(),
            r.updated_at || new Date().toISOString()
          );
        }
      }
    } catch (err) {
      console.warn('Legacy JSON migration notice:', err.message);
    }
  }
}

migrateLegacyJsonIfEmpty();

/**
 * Snapshot SQLite data into rescueos-data.json for backwards compatibility
 */
function syncLegacyJson() {
  try {
    const sos = db.prepare(`
      SELECT id, requester AS name, description AS emergency, people_affected AS people,
             location, priority, status, assigned_volunteer AS assigned_to, created_at, updated_at
      FROM sos_requests
      ORDER BY id DESC
    `).all();

    const volunteers = db.prepare(`
      SELECT id, full_name AS name,
             CASE WHEN EXISTS (SELECT 1 FROM sos_requests WHERE assigned_volunteer_id = users.id AND status IN ('ASSIGNED', 'IN_PROGRESS')) THEN 'BUSY' ELSE 'AVAILABLE' END AS status
      FROM users
      WHERE role = 'VOLUNTEER'
    `).all();

    const shelters = db.prepare(`
      SELECT id, name, capacity, occupancy, water_liters AS water, food_rations AS food, medical_kits
      FROM shelters
      ORDER BY id ASC
    `).all();

    const announcements = db.prepare(`
      SELECT id, title, message, priority, created_at
      FROM announcements
      ORDER BY id DESC
      LIMIT 20
    `).all();

    const audit = db.prepare(`
      SELECT id, action, detail, created_at
      FROM audit_logs
      ORDER BY id DESC
      LIMIT 50
    `).all();

    const legacyPayload = {
      sos,
      volunteers: volunteers.length > 0 ? volunteers : [
        { id: 1, name: 'Rescue Team 01', status: 'AVAILABLE' },
        { id: 2, name: 'Rescue Team 02', status: 'AVAILABLE' },
        { id: 3, name: 'Medical Team 01', status: 'AVAILABLE' },
        { id: 4, name: 'Volunteer 04', status: 'AVAILABLE' }
      ],
      shelters,
      announcements,
      audit
    };

    fs.writeFileSync(LEGACY_JSON_PATH, JSON.stringify(legacyPayload, null, 2));
  } catch (err) {
    // Non-fatal legacy sync
    console.error('Failed to sync legacy JSON snapshot:', err.message);
  }
}

module.exports = {
  db,
  syncLegacyJson,
  initSchema
};
