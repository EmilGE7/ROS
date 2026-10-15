/**
 * RescueOS Comprehensive Automated Integration Test Suite
 * Validates All Core Workflows, RBAC, SOS, Shelters, Simulation & Sync.
 */
const http = require('http');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Start the server programmatically for testing
process.env.PORT = 8089;
const server = require('../server.js');

function request(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: 8089,
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = data ? JSON.parse(data) : {};
          resolve({ status: res.statusCode, headers: res.headers, body: json, text: data });
        } catch {
          resolve({ status: res.statusCode, headers: res.headers, text: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

async function runTests() {
  console.log('🧪 Starting RescueOS Automated Test Suite...\n');
  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`  ✅ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ ${name}:`, err.message);
      failed++;
    }
  }

  await test('Frontend has sidebar pages, responsive layout, and no map assets', async () => {
    const frontend = path.join(__dirname, '../../frontend');
    const html = fs.readFileSync(path.join(frontend, 'index.html'), 'utf8');
    const css = fs.readFileSync(path.join(frontend, 'style.css'), 'utf8');
    const js = fs.readFileSync(path.join(frontend, 'app.js'), 'utf8');
    assert.match(html, /class="nav-tabs-wrapper" aria-label="Primary navigation"/);
    assert.match(html, /data-tab="system"/);
    assert.match(html, /data-tab="network"/);
    assert.match(html, /data-tab="database"/);
    assert.doesNotMatch(html + js, /Leaflet|leaflet|id="map"|data-tab="map"/i);
    assert.match(css, /@media \(max-width: 760px\)/);
    assert.doesNotMatch(css, /@keyframes|animation\s*:|transition\s*:/i);
  });

  // 1. Initial State
  await test('GET /api/state returns valid initial disaster state', async () => {
    const res = await request({ method: 'GET', path: '/api/state' });
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.stats, 'Missing stats');
    assert.ok(Array.isArray(res.body.sos), 'Missing sos list');
    assert.ok(Array.isArray(res.body.shelters), 'Missing shelters list');
    assert.ok(Array.isArray(res.body.volunteers), 'Missing volunteers list');
    assert.ok(res.body.stats.activeSos >= 0);
  });

  // 2. Authentication & Rate-Limiting
  let adminToken = '';
  let coordinatorToken = '';
  let citizenToken = '';
  let volunteerToken = '';

  await test('POST /api/auth/login fails with invalid password', async () => {
    const res = await request({ method: 'POST', path: '/api/auth/login' }, {
      username: 'admin',
      password: 'wrong_password'
    });
    assert.strictEqual(res.status, 401);
  });

  await test('POST /api/auth/login succeeds for admin, coordinator, volunteer & citizen', async () => {
    const adminRes = await request({ method: 'POST', path: '/api/auth/login' }, {
      username: 'admin',
      password: 'rescueos2026'
    });
    assert.strictEqual(adminRes.status, 200);
    assert.ok(adminRes.body.token);
    assert.strictEqual(adminRes.body.user.role, 'ADMIN');
    adminToken = adminRes.body.token;

    const coordRes = await request({ method: 'POST', path: '/api/auth/login' }, {
      username: 'coordinator',
      password: 'rescueos2026'
    });
    assert.strictEqual(coordRes.status, 200);
    coordinatorToken = coordRes.body.token;

    const volRes = await request({ method: 'POST', path: '/api/auth/login' }, {
      username: 'volunteer1',
      password: 'rescueos2026'
    });
    assert.strictEqual(volRes.status, 200);
    volunteerToken = volRes.body.token;

    const citRes = await request({ method: 'POST', path: '/api/auth/login' }, {
      username: 'citizen1',
      password: 'rescueos2026'
    });
    assert.strictEqual(citRes.status, 200);
    citizenToken = citRes.body.token;
  });

  await test('GET /api/auth/me verifies authenticated session', async () => {
    const res = await request({
      method: 'GET',
      path: '/api/auth/me',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.authenticated, true);
    assert.strictEqual(res.body.user.role, 'ADMIN');
  });

  await test('Database browser is admin-only, read-only, paginated, and redacts credentials', async () => {
    const denied = await request({ method: 'GET', path: '/api/database' });
    assert.strictEqual(denied.status, 401);
    const staffDenied = await request({ method: 'GET', path: '/api/database', headers: { Authorization: `Bearer ${coordinatorToken}` } });
    assert.strictEqual(staffDenied.status, 403);
    const tables = await request({ method: 'GET', path: '/api/database', headers: { Authorization: `Bearer ${adminToken}` } });
    assert.strictEqual(tables.status, 200);
    assert.strictEqual(tables.body.connected, true);
    assert.ok(tables.body.tables.includes('users'));
    const users = await request({ method: 'GET', path: '/api/database?table=users&limit=10&offset=0', headers: { Authorization: `Bearer ${adminToken}` } });
    assert.strictEqual(users.status, 200);
    assert.strictEqual(users.body.readOnly, true);
    assert.ok(users.body.rows.length <= 10);
    assert.ok(users.body.rows.every(row => !('password_hash' in row) && !('salt' in row)));
    const invalid = await request({ method: 'GET', path: '/api/database?table=users%22%3B%20DROP%20TABLE%20users', headers: { Authorization: `Bearer ${adminToken}` } });
    assert.strictEqual(invalid.status, 400);
  });

  await test('System information returns real host readings', async () => {
    const res = await request({ method: 'GET', path: '/api/system' });
    assert.strictEqual(res.status, 200);
    assert.ok(typeof res.body.os === 'string' && res.body.os.length > 0);
    assert.ok(res.body.uptimeSeconds >= 0);
    assert.ok(res.body.cpu.cores > 0);
    assert.ok(res.body.memory.totalBytes > 0);
  });

  // 3. RBAC Authorization Controls
  await test('RBAC: Citizen CANNOT issue emergency announcements (403)', async () => {
    const res = await request({
      method: 'POST',
      path: '/api/announcements',
      headers: { 'Authorization': `Bearer ${citizenToken}` }
    }, {
      title: 'Citizen Announcement Attempt',
      message: 'This should fail authorization'
    });
    assert.strictEqual(res.status, 403);
  });

  await test('RBAC: Coordinator CAN issue official announcements (201)', async () => {
    const res = await request({
      method: 'POST',
      path: '/api/announcements',
      headers: { 'Authorization': `Bearer ${coordinatorToken}` }
    }, {
      title: 'Boil Water Advisory - Sector B',
      message: 'All residents boil drinking water for 3 minutes minimum.',
      priority: 'HIGH'
    });
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.title, 'Boil Water Advisory - Sector B');
  });

  // 4. Complete SOS Emergency Workflow
  let testSosId = null;
  let testRescueId = null;

  await test('SOS: Citizen submits new emergency request (POST /api/sos)', async () => {
    const res = await request({ method: 'POST', path: '/api/sos' }, {
      name: 'Ramesh Gupta',
      emergency: 'Family stranded on rooftop by flash flood',
      emergency_type: 'FLOOD',
      people: 3,
      priority: 'CRITICAL',
      location: 'House 44, Riverside Colony Sector B'
    });
    assert.strictEqual(res.status, 201);
    assert.ok(res.body.id);
    assert.ok(res.body.rescue_id.startsWith('RSC-'));
    assert.strictEqual(res.body.status, 'NEW');
    testSosId = res.body.id;
    testRescueId = res.body.rescue_id;
  });

  await test('SOS: Coordinator assigns volunteer to SOS', async () => {
    const res = await request({
      method: 'POST',
      path: `/api/sos/${testSosId}/assign`,
      headers: { 'Authorization': `Bearer ${coordinatorToken}` }
    }, {
      volunteer: 'Rescue Team 01 (Swiftwater)'
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.status, 'ASSIGNED');
    assert.strictEqual(res.body.assigned_to, 'Rescue Team 01 (Swiftwater)');
  });

  await test('SOS: Volunteer accepts and starts rescue (IN_PROGRESS)', async () => {
    const res = await request({
      method: 'POST',
      path: `/api/sos/${testSosId}/status`,
      headers: { 'Authorization': `Bearer ${volunteerToken}` }
    }, {
      status: 'IN_PROGRESS',
      notes: 'Deployed Zodiac boat. Reached stranded residence.'
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.status, 'IN_PROGRESS');
  });

  await test('SOS: Volunteer successfully completes rescue (RESOLVED)', async () => {
    const res = await request({
      method: 'POST',
      path: `/api/sos/${testSosId}/status`,
      headers: { 'Authorization': `Bearer ${volunteerToken}` }
    }, {
      status: 'RESOLVED',
      resolution: 'All 3 family members evacuated safely to Central Relief Shelter.'
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.status, 'RESOLVED');
  });

  // 5. QR Code Resolution
  await test('QR ID: Lookup resolves Rescue ID to card record', async () => {
    const res = await request({ method: 'GET', path: `/api/qr/${testRescueId}` });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.rescueId, testRescueId);
    assert.ok(res.body.data.startsWith('data:image/svg+xml'));
    assert.strictEqual(res.body.record.status, 'RESOLVED');
  });

  // 6. Shelters & Check-in / Check-out
  await test('Shelter: Check-in increases occupancy and recalculates status', async () => {
    const initial = await request({ method: 'GET', path: '/api/shelters' });
    const s1 = initial.body.find(s => s.id === 1);
    const initialOcc = s1.occupancy;

    const res = await request({ method: 'POST', path: '/api/shelters/1/checkin' }, { count: 5 });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.occupancy, initialOcc + 5);

    const resOut = await request({ method: 'POST', path: '/api/shelters/1/checkout' }, { count: 2 });
    assert.strictEqual(resOut.status, 200);
    assert.strictEqual(resOut.body.occupancy, initialOcc + 3);
  });

  // 7. Resource Management & Inventory Transactions
  await test('Resources: Stock transaction records correctly', async () => {
    const res = await request({
      method: 'POST',
      path: '/api/resources/1/transaction',
      headers: { 'Authorization': `Bearer ${coordinatorToken}` }
    }, {
      type: 'INCOMING',
      quantity: 50,
      source_or_destination: 'Water Tanker #3',
      notes: 'Delivered drinking water supply'
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
  });

  // 8. Incidents Reporting
  await test('Incidents: Report hazard and update verification status', async () => {
    const res = await request({ method: 'POST', path: '/api/incidents' }, {
      title: 'Fallen High Voltage Cable',
      description: 'Power cable snapped across North Ring Road',
      incident_type: 'INFRASTRUCTURE',
      severity: 'CRITICAL',
      location: 'North Ring Road KM 2'
    });
    assert.strictEqual(res.status, 201);
    const incId = res.body.id;

    const patchRes = await request({
      method: 'PATCH',
      path: `/api/incidents/${incId}/status`
    }, { status: 'VERIFIED' });
    assert.strictEqual(patchRes.status, 200);
    assert.strictEqual(patchRes.body.status, 'VERIFIED');
  });

  // 9. Missing Persons Registry
  await test('Missing Persons: Register and locate missing individual', async () => {
    const res = await request({ method: 'POST', path: '/api/missing' }, {
      full_name: 'Prakash V.',
      age: 65,
      gender: 'MALE',
      last_seen_location: 'Central Market Sector A',
      last_seen_time: '1 hour ago',
      contact_info: '9888800000',
      identifying_features: 'Navy blue cardigan, spectacles'
    });
    assert.strictEqual(res.status, 201);
    const mpId = res.body.id;

    const updateRes = await request({
      method: 'PATCH',
      path: `/api/missing/${mpId}/status`
    }, { status: 'FOUND', notes: 'Sheltered safely at North High School' });
    assert.strictEqual(updateRes.status, 200);
    assert.strictEqual(updateRes.body.status, 'FOUND');
  });

  // 10. Medical Coordination
  await test('Medical: Create medical triage case and update status', async () => {
    const res = await request({ method: 'POST', path: '/api/medical' }, {
      patient_name: 'David K.',
      triage_priority: 'RED_IMMEDIATE',
      symptoms: 'Blunt chest trauma, dyspnea',
      vitals_summary: 'BP 95/60, SpO2 90%'
    });
    assert.strictEqual(res.status, 201);
    const medId = res.body.id;

    const patchRes = await request({
      method: 'PATCH',
      path: `/api/medical/${medId}`
    }, {
      triage_status: 'STABILIZED',
      assigned_medic: 'Dr. Sarah Rao'
    });
    assert.strictEqual(patchRes.status, 200);
    assert.strictEqual(patchRes.body.triage_status, 'STABILIZED');
  });

  // 11. Local Inter-agency Chat
  await test('Chat: Post and retrieve messages across local channels', async () => {
    const postRes = await request({
      method: 'POST',
      path: '/api/chat/GENERAL',
      headers: { 'Authorization': `Bearer ${coordinatorToken}` }
    }, {
      message: 'Network check: Central Station online and listening.'
    });
    assert.strictEqual(postRes.status, 201);

    const getRes = await request({ method: 'GET', path: '/api/chat/GENERAL' });
    assert.strictEqual(getRes.status, 200);
    assert.ok(Array.isArray(getRes.body));
    assert.ok(getRes.body.some(m => m.message.includes('Central Station online')));
  });

  // 12. Disaster Simulation Engine
  await test('Simulation: Start FLOOD scenario and verify status & events', async () => {
    const startRes = await request({ method: 'POST', path: '/api/simulation/start' }, {
      scenario: 'FLOOD',
      speedMs: 2000
    });
    assert.strictEqual(startRes.status, 200);
    assert.strictEqual(startRes.body.status, 'RUNNING');
    assert.strictEqual(startRes.body.scenario, 'FLOOD');

    const pauseRes = await request({ method: 'POST', path: '/api/simulation/pause' });
    assert.strictEqual(pauseRes.status, 200);
    assert.strictEqual(pauseRes.body.status, 'PAUSED');

    const resetRes = await request({ method: 'POST', path: '/api/simulation/reset' });
    assert.strictEqual(resetRes.status, 200);
    assert.strictEqual(resetRes.body.status, 'IDLE');
  });

  // 13. USB Disaster Package Export & Import
  await test('Sync: Export and import disaster packages with checksum verification', async () => {
    const exportRes = await request({ method: 'GET', path: '/api/sync/export' });
    assert.strictEqual(exportRes.status, 200);
    assert.strictEqual(exportRes.body.format, 'RescueOS-DisasterPackage');
    assert.ok(exportRes.body.checksum);
    assert.ok(exportRes.body.counts.sos > 0);

    const importRes = await request({ method: 'POST', path: '/api/sync/import' }, exportRes.body);
    assert.strictEqual(importRes.status, 200);
    assert.ok(importRes.body.imported !== undefined);
  });

  // 14. Network & LoRa Status
  await test('Network & LoRa: Returns dynamic interfaces and honest adapter status', async () => {
    const netRes = await request({ method: 'GET', path: '/api/network' });
    assert.strictEqual(netRes.status, 200);
    assert.ok(Array.isArray(netRes.body.interfaces));
    assert.ok(Array.isArray(netRes.body.dns));

    const diagRes = await request({ method: 'GET', path: '/api/network/diagnostics' });
    assert.strictEqual(diagRes.status, 200);
    assert.deepStrictEqual(diagRes.body.checks.map(check => check.label), [
      'Interface', 'Link', 'IP assignment', 'Default route', 'DNS resolution', 'External connectivity'
    ]);
    assert.ok(diagRes.body.checks.every(check => typeof check.detail === 'string'));

    const loraRes = await request({ method: 'GET', path: '/api/lora' });
    assert.strictEqual(loraRes.status, 200);
    assert.strictEqual(loraRes.body.hardwareDetected, false);
    assert.strictEqual(loraRes.body.status, 'FUTURE_EXTENSION_UNPLUGGED');
  });

  console.log(`\n======================================================`);
  console.log(`📊 Test Results: ${passed} Passed, ${failed} Failed`);
  console.log(`======================================================\n`);

  server.close(() => {
    process.exit(failed > 0 ? 1 : 0);
  });
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
