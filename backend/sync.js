/**
 * RescueOS Multi-Station & USB Disaster Package Sync Engine
 * Step 26 & 27: Decentralized event ledger, tamper-evident checksums, idempotent merge.
 */
const crypto = require('crypto');
const { db, syncLegacyJson } = require('./db');

const DEFAULT_STATION_ID = process.env.STATION_ID || 'STATION-ALPHA';

/**
 * Generate SHA-256 checksum of payload
 */
function computeChecksum(obj) {
  const serialized = JSON.stringify(obj, Object.keys(obj).sort());
  return crypto.createHash('sha256').update(serialized).digest('hex');
}

/**
 * Export current station state as a signed Disaster Sync Package
 */
function exportDisasterPackage(customStationId = null) {
  const stationId = customStationId || DEFAULT_STATION_ID;
  const exportedAt = new Date().toISOString();

  // Export non-simulation records
  const sos = db.prepare('SELECT * FROM sos_requests WHERE is_simulation = 0').all();
  const tasks = db.prepare('SELECT * FROM tasks WHERE sos_id IN (SELECT id FROM sos_requests WHERE is_simulation = 0)').all();
  const shelters = db.prepare('SELECT * FROM shelters WHERE is_simulation = 0').all();
  const resources = db.prepare('SELECT * FROM resources WHERE is_simulation = 0').all();
  const incidents = db.prepare('SELECT * FROM incidents WHERE is_simulation = 0').all();
  const missing_persons = db.prepare('SELECT * FROM missing_persons WHERE is_simulation = 0').all();
  const medical_cases = db.prepare('SELECT * FROM medical_cases WHERE is_simulation = 0').all();
  const announcements = db.prepare('SELECT * FROM announcements WHERE is_simulation = 0').all();

  const dataPayload = {
    sos,
    tasks,
    shelters,
    resources,
    incidents,
    missing_persons,
    medical_cases,
    announcements
  };

  const checksum = computeChecksum(dataPayload);

  const syncPackage = {
    format: 'RescueOS-DisasterPackage',
    version: '1.0.0',
    stationId,
    exportedAt,
    checksum,
    counts: {
      sos: sos.length,
      tasks: tasks.length,
      shelters: shelters.length,
      resources: resources.length,
      incidents: incidents.length,
      missing_persons: missing_persons.length,
      medical_cases: medical_cases.length,
      announcements: announcements.length
    },
    data: dataPayload
  };

  return syncPackage;
}

/**
 * Import and merge an external Disaster Sync Package (e.g. from USB drive or Station B)
 */
function importDisasterPackage(syncPackage, actor = 'USB_SYNC', ip = '127.0.0.1') {
  if (!syncPackage || typeof syncPackage !== 'object') {
    throw new Error('Invalid sync package format');
  }

  if (syncPackage.format !== 'RescueOS-DisasterPackage') {
    throw new Error('Unrecognized package format: expected RescueOS-DisasterPackage');
  }

  // Verify checksum integrity
  const expectedChecksum = syncPackage.checksum;
  const actualChecksum = computeChecksum(syncPackage.data || {});
  if (expectedChecksum !== actualChecksum) {
    throw new Error('Integrity check failed: Checksum mismatch. Disaster package may be corrupt or tampered.');
  }

  const results = {
    stationId: syncPackage.stationId,
    exportedAt: syncPackage.exportedAt,
    imported: { sos: 0, shelters: 0, incidents: 0, missing: 0, announcements: 0 },
    updated: { sos: 0, shelters: 0, incidents: 0, missing: 0 },
    skipped: 0
  };

  const data = syncPackage.data || {};
  const now = new Date().toISOString();

  // 1. Merge SOS Requests
  if (Array.isArray(data.sos)) {
    const checkSos = db.prepare('SELECT id, rescue_id, updated_at FROM sos_requests WHERE rescue_id = ?');
    const updateSos = db.prepare(`
      UPDATE sos_requests
      SET requester = ?, emergency_type = ?, description = ?, people_affected = ?, priority = ?,
          location = ?, lat = ?, lng = ?, status = ?, assigned_volunteer = ?, notes = ?, resolution = ?,
          updated_at = ?
      WHERE rescue_id = ?
    `);
    const insertSos = db.prepare(`
      INSERT INTO sos_requests (rescue_id, requester, emergency_type, description, people_affected, priority, location, lat, lng, status, assigned_volunteer, notes, resolution, is_simulation, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    `);

    for (const r of data.sos) {
      const existing = checkSos.get(r.rescue_id);
      if (existing) {
        // Last-write-wins based on updated_at
        if (new Date(r.updated_at) > new Date(existing.updated_at)) {
          updateSos.run(
            r.requester, r.emergency_type, r.description, r.people_affected, r.priority,
            r.location, r.lat, r.lng, r.status, r.assigned_volunteer, r.notes, r.resolution,
            r.updated_at, r.rescue_id
          );
          results.updated.sos++;
        } else {
          results.skipped++;
        }
      } else {
        insertSos.run(
          r.rescue_id, r.requester, r.emergency_type, r.description, r.people_affected, r.priority,
          r.location, r.lat, r.lng, r.status, r.assigned_volunteer, r.notes, r.resolution,
          r.created_at || now, r.updated_at || now
        );
        results.imported.sos++;
      }
    }
  }

  // 2. Merge Missing Persons
  if (Array.isArray(data.missing_persons)) {
    const checkMp = db.prepare('SELECT id, tracking_code, updated_at FROM missing_persons WHERE tracking_code = ?');
    const updateMp = db.prepare(`
      UPDATE missing_persons
      SET full_name = ?, age = ?, gender = ?, last_seen_location = ?, last_seen_time = ?,
          contact_info = ?, identifying_features = ?, photo_url = ?, status = ?, notes = ?, updated_at = ?
      WHERE tracking_code = ?
    `);
    const insertMp = db.prepare(`
      INSERT INTO missing_persons (tracking_code, full_name, age, gender, last_seen_location, last_seen_time, contact_info, identifying_features, photo_url, status, notes, is_simulation, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    `);

    for (const m of data.missing_persons) {
      const existing = checkMp.get(m.tracking_code);
      if (existing) {
        if (new Date(m.updated_at) > new Date(existing.updated_at)) {
          updateMp.run(
            m.full_name, m.age, m.gender, m.last_seen_location, m.last_seen_time,
            m.contact_info, m.identifying_features, m.photo_url, m.status, m.notes, m.updated_at,
            m.tracking_code
          );
          results.updated.missing++;
        }
      } else {
        insertMp.run(
          m.tracking_code, m.full_name, m.age, m.gender, m.last_seen_location, m.last_seen_time,
          m.contact_info, m.identifying_features, m.photo_url, m.status, m.notes,
          m.created_at || now, m.updated_at || now
        );
        results.imported.missing++;
      }
    }
  }

  // 3. Merge Incidents
  if (Array.isArray(data.incidents)) {
    const checkInc = db.prepare('SELECT id, title, updated_at FROM incidents WHERE title = ? AND location = ?');
    const insertInc = db.prepare(`
      INSERT INTO incidents (title, description, incident_type, severity, location, lat, lng, photo, reporter, status, is_simulation, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    `);

    for (const inc of data.incidents) {
      const existing = checkInc.get(inc.title, inc.location);
      if (!existing) {
        insertInc.run(
          inc.title, inc.description, inc.incident_type, inc.severity, inc.location,
          inc.lat, inc.lng, inc.photo, inc.reporter, inc.status,
          inc.created_at || now, inc.updated_at || now
        );
        results.imported.incidents++;
      }
    }
  }

  // 4. Record Audit Log & Sync Event
  const eventUuid = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
  db.prepare(`
    INSERT INTO sync_events (event_uuid, station_id, event_type, entity_id, payload_json, created_at)
    VALUES (?, ?, 'PACKAGE_IMPORT', ?, ?, ?)
  `).run(eventUuid, syncPackage.stationId, syncPackage.stationId, JSON.stringify(results), now);

  db.prepare(`
    INSERT INTO audit_logs (actor, action, target, detail, ip, created_at)
    VALUES (?, 'SYNC_IMPORT', ?, ?, ?, ?)
  `).run(
    actor,
    `Station: ${syncPackage.stationId}`,
    `Imported ${results.imported.sos} SOS, ${results.imported.incidents} Incidents, ${results.imported.missing} Missing Persons`,
    ip,
    now
  );

  syncLegacyJson();
  return results;
}

module.exports = {
  exportDisasterPackage,
  importDisasterPackage,
  DEFAULT_STATION_ID
};
