/**
 * RescueOS Demo Data & Scenario Seeding Engine
 * Initializes competition-grade, realistic disaster operational records.
 */
const { db, syncLegacyJson } = require('./db');
const { hashPassword } = require('./auth');

const DEMO_PASSWORD = 'rescueos2026';

function seedDatabase(force = false) {
  const userCount = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
  const resCount = db.prepare('SELECT COUNT(*) AS count FROM resources').get().count;
  if (userCount > 0 && resCount > 0 && !force) {
    return;
  }

  console.log(force ? '⚡ Resetting database to standard Demo dataset...' : '🌱 Seeding initial Demo dataset...');

  // If force reset, clear operational tables
  if (force) {
    db.exec(`
      DELETE FROM sessions;
      DELETE FROM audit_logs;
      DELETE FROM chat_messages;
      DELETE FROM announcements;
      DELETE FROM medical_cases;
      DELETE FROM missing_persons;
      DELETE FROM resource_transactions;
      DELETE FROM resources;
      DELETE FROM tasks;
      DELETE FROM sos_requests;
      DELETE FROM incidents;
      DELETE FROM shelters;
      DELETE FROM users;
      DELETE FROM sync_events;
    `);
  }

  const now = Date.now();
  const isoPast = (mins) => new Date(now - mins * 60 * 1000).toISOString();

  // 1. Seed Users with explicit deterministic IDs
  const insertUser = db.prepare(`
    INSERT OR REPLACE INTO users (id, username, password_hash, salt, full_name, role, phone, badge_number, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const users = [
    { id: 1, username: 'admin', name: 'Emergency Operations Director', role: 'ADMIN', phone: '+91-98800-00001', badge: 'DIR-01' },
    { id: 2, username: 'coordinator', name: 'Sector Dispatch Coordinator', role: 'COORDINATOR', phone: '+91-98800-00002', badge: 'DISP-02' },
    { id: 3, username: 'doctor1', name: 'Dr. Sarah Rao (Field Triage Lead)', role: 'MEDICAL', phone: '+91-98800-00003', badge: 'MED-11' },
    { id: 4, username: 'volunteer1', name: 'Rescue Team 01 (Swiftwater)', role: 'VOLUNTEER', phone: '+91-98800-00004', badge: 'SRT-01' },
    { id: 5, username: 'volunteer2', name: 'Rescue Team 02 (Urban Search)', role: 'VOLUNTEER', phone: '+91-98800-00005', badge: 'USAR-02' },
    { id: 6, username: 'citizen1', name: 'Ananya Sharma (Sector B Resident)', role: 'CITIZEN', phone: '+91-98800-00006', badge: 'CIT-101' }
  ];

  for (const u of users) {
    const { hash, salt } = hashPassword(DEMO_PASSWORD);
    insertUser.run(u.id, u.username, hash, salt, u.name, u.role, u.phone, u.badge, isoPast(120));
  }

  // 2. Seed Shelters with explicit IDs
  const insertShelter = db.prepare(`
    INSERT OR REPLACE INTO shelters (id, name, location, lat, lng, capacity, occupancy, contact, medical_support, accessibility, status, water_liters, food_rations, medical_kits, blankets, is_simulation, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
  `);

  insertShelter.run(1, 'Central Relief Shelter (Indoor Stadium)', 'Sector A - Civil Center, 4th Cross',
    12.9716, 77.5946, 200, 84, 'Capt. Verma (9876543210)', 1, 1, 'OPEN',
    650, 480, 35, 180, isoPast(180), isoPast(15));

  insertShelter.run(2, 'North High School Evacuation Center', 'Sector C - Hillside High School Campus',
    12.9850, 77.6050, 250, 230, 'Principal Nair (9876543211)', 1, 1, 'OPEN',
    140, 110, 8, 90, isoPast(180), isoPast(20));

  insertShelter.run(3, 'Riverside Community Hall', 'Sector B - Riverbank Road, Lowland',
    12.9620, 77.5850, 90, 88, 'R. Deshmukh (9876543212)', 0, 0, 'EMERGENCY_ONLY',
    40, 30, 2, 25, isoPast(180), isoPast(5));

  // 3. Seed Resources with explicit IDs
  const insertResource = db.prepare(`
    INSERT OR REPLACE INTO resources (id, shelter_id, name, category, quantity, unit, minimum_threshold, is_simulation, last_updated)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
  `);

  insertResource.run(1, 1, 'Potable Drinking Water', 'Water', 650, 'Liters', 150, isoPast(30));
  insertResource.run(2, 1, 'Ready-to-Eat Meal Packs', 'Food', 480, 'Packs', 100, isoPast(30));
  insertResource.run(3, 1, 'Emergency Trauma Medical Kits', 'Medicine', 35, 'Kits', 15, isoPast(30));
  insertResource.run(4, 1, 'Thermal Wool Blankets', 'Blankets', 180, 'Pieces', 50, isoPast(30));
  insertResource.run(5, 1, 'Backup Generator Diesel', 'Fuel', 120, 'Liters', 40, isoPast(30));
  insertResource.run(6, 2, 'Potable Drinking Water', 'Water', 140, 'Liters', 200, isoPast(20)); // Low stock!
  insertResource.run(7, 2, 'Ready-to-Eat Meal Packs', 'Food', 110, 'Packs', 150, isoPast(20)); // Low stock!
  insertResource.run(8, 2, 'Trauma Bandages & Splints', 'Medicine', 8, 'Kits', 20, isoPast(20)); // Critical!
  insertResource.run(9, 3, 'Drinking Water 20L Cans', 'Water', 40, 'Liters', 100, isoPast(10)); // Critical!
  insertResource.run(10, 3, 'Emergency High-Energy Biscuits', 'Food', 30, 'Boxes', 50, isoPast(10)); // Low stock!

  // 4. Seed Initial Resource Transactions (only on force reset or first run)
  if (force || db.prepare('SELECT COUNT(*) AS c FROM resource_transactions').get().c === 0) {
    const insertTx = db.prepare(`
      INSERT INTO resource_transactions (resource_id, resource_name, type, quantity, source_or_destination, notes, actor, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertTx.run(1, 'Potable Drinking Water', 'INCOMING', 500, 'State Disaster Logistics Truck 04', 'Initial water tanker delivery', 'Logistics Team', isoPast(90));
    insertTx.run(2, 'Ready-to-Eat Meal Packs', 'OUTGOING', 120, 'Sector A Evacuees', 'Lunch distribution batch 1', 'Shelter Volunteer', isoPast(45));
    insertTx.run(6, 'Potable Drinking Water', 'TRANSFER', 100, 'Transferred from Central Relief Shelter', 'Emergency restock for high school', 'Coordinator', isoPast(25));
  }

  // 5. Seed SOS Requests with explicit IDs and stable rescue IDs
  const insertSos = db.prepare(`
    INSERT OR REPLACE INTO sos_requests (id, rescue_id, requester, user_id, emergency_type, description, people_affected, priority, location, lat, lng, status, assigned_volunteer, notes, resolution, triage_level, is_simulation, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
  `);

  // SOS #1: Trapped Family — CRITICAL, ASSIGNED (active) — RSC-A8F29C1B is used in QR preview card
  insertSos.run(1, 'RSC-A8F29C1B', 'Rajesh Kumar & Family', 6, 'TRAPPED',
    'Flood water reached 4 feet on ground floor. Elderly grandmother and 2 children stranded on terrace.',
    4, 'CRITICAL', 'Plot 14, Riverside Colony, Sector B', 12.9642, 77.5873,
    'ASSIGNED', 'Rescue Team 01 (Swiftwater)',
    'Inflatable boat unit dispatched. Life vests required for 2 children.',
    '', 'DELAYED', isoPast(42), isoPast(15));

  // SOS #2: Medical Emergency — CRITICAL, NEW (active)
  insertSos.run(2, 'RSC-B3E7412A', 'Sunita Patel', null, 'MEDICAL',
    'Severe head injury from falling brick debris during storm. Patient is semi-conscious and bleeding.',
    1, 'CRITICAL', 'Near Market Cross, Sector A', 12.9730, 77.5960,
    'NEW', null, 'Immediate paramedic field triage needed.', '', 'RED_IMMEDIATE',
    isoPast(28), isoPast(28));

  // SOS #3: Structural Collapse — HIGH, NEW (active)
  insertSos.run(3, 'RSC-C5D1908E', 'Farhan Akhtar', null, 'STRUCTURAL_DAMAGE',
    'Perimeter boundary wall collapsed onto neighborhood pathway. Power line down nearby, sparks visible.',
    3, 'HIGH', 'Lane 3, North Hillside, Sector C', 12.9835, 77.6030,
    'NEW', null, 'Electric grid isolated in sector.', '', 'NONE',
    isoPast(18), isoPast(18));

  // SOS #4: Food/Water — HIGH, IN_PROGRESS (active)
  insertSos.run(4, 'RSC-D91A4B72', 'Deepak Reddy', null, 'FOOD_WATER',
    'Elderly apartment block cut off by road flooding. 8 residents without clean drinking water for 18 hours.',
    8, 'HIGH', 'Block 4, Sunrise Apts, Sector B', 12.9610, 77.5890,
    'IN_PROGRESS', 'Rescue Team 02 (Urban Search)',
    'Team en route with 10 water cans and ORS packs.', '', 'NONE',
    isoPast(60), isoPast(10));

  // SOS #5: Resolved Rescue
  insertSos.run(5, 'RSC-E1F8C340', 'Pooja Nair', null, 'FLOOD',
    'Two pregnant women trapped in ground floor clinic as water entered premises.',
    2, 'CRITICAL', 'Health Center 2, Sector B Lowlands', 12.9590, 77.5840,
    'RESOLVED', 'Rescue Team 01 (Swiftwater)',
    'Successfully evacuated by boat to Central Relief Shelter medical wing.',
    'Evacuated safely with zero casualties. Admitted to Central Shelter triage.',
    'STABILIZED', isoPast(110), isoPast(35));

  // 6. Seed Tasks with explicit IDs
  const insertTask = db.prepare(`
    INSERT OR REPLACE INTO tasks (id, sos_id, volunteer_id, volunteer_name, status, instructions, field_notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertTask.run(1, 1, 4, 'Rescue Team 01 (Swiftwater)', 'ASSIGNED',
    'Deploy boat via North Canal approach. Safely extract 4 occupants to dry assembly point.',
    'Approaching canal head. Water current high, proceeding with safety tethers.',
    isoPast(30), isoPast(15));

  insertTask.run(2, 4, 5, 'Rescue Team 02 (Urban Search)', 'IN_PROGRESS',
    'Deliver clean water ration to Block 4 Sunrise Apts.',
    'Reached Sector B perimeter. Wading through knee-deep water.',
    isoPast(25), isoPast(10));

  insertTask.run(3, 5, 4, 'Rescue Team 01 (Swiftwater)', 'RESOLVED',
    'Urgent medical extraction of 2 patients.',
    'Extraction completed at 07:45. Both patients handed over to medical team.',
    isoPast(105), isoPast(35));

  // 7. Seed Incidents with explicit IDs
  const insertIncident = db.prepare(`
    INSERT OR REPLACE INTO incidents (id, title, description, incident_type, severity, location, lat, lng, photo, reporter, status, is_simulation, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, 0, ?, ?)
  `);

  insertIncident.run(1, 'Main River Bridge Submerged & Blocked',
    'Water level 0.8m over bridge deck. Strong debris flow. Police barriers erected on both approaches.',
    'ROAD_BLOCK', 'CRITICAL', 'River Bridge Connecting Sector A & Sector B', 12.9660, 77.5880,
    'Traffic Police Unit 09', 'RESPONDING', isoPast(90), isoPast(40));

  insertIncident.run(2, 'Live Transformer Sparking in Water',
    'Electrical distribution transformer partially submerged near Sector B market.',
    'INFRASTRUCTURE', 'CRITICAL', 'Near Market Crossroad, Sector B', 12.9630, 77.5870,
    'Civil Defense Scout 03', 'VERIFIED', isoPast(50), isoPast(20));

  insertIncident.run(3, 'North Hillside Minor Mudflow',
    'Loose soil and debris blocking one lane of Ridge Road. Heavy rain continuing.',
    'LANDSLIDE', 'MEDIUM', 'Ridge Road Km 4, Sector C', 12.9880, 77.6080,
    'Resident Group', 'REPORTED', isoPast(30), isoPast(30));

  // 8. Seed Missing Persons with explicit IDs
  const insertMissing = db.prepare(`
    INSERT OR REPLACE INTO missing_persons (id, tracking_code, full_name, age, gender, last_seen_location, last_seen_time, contact_info, identifying_features, photo_url, status, notes, is_simulation, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, 0, ?, ?)
  `);

  insertMissing.run(1, 'MP-2026-001', 'Aarav Deshmukh', 9, 'MALE',
    'Sector B Riverside School ground during morning evacuation', '08:30 AM Today',
    'Father: Ramesh Deshmukh (9876500001)',
    'Blue school uniform shirt, yellow raincoat, birthmark near left eyebrow.',
    'MISSING', 'Search teams alerted in nearby shelters.', isoPast(75), isoPast(30));

  insertMissing.run(2, 'MP-2026-002', 'Meenakshi Sundaram', 72, 'FEMALE',
    'Central Bus Station Sector A', '09:15 AM Today',
    'Daughter: Priya (9876500002)',
    'Green cotton saree, walking stick with silver grip, wears bifocal glasses.',
    'FOUND', 'Located at North High School Shelter. Safe and being cared for by volunteer staff.',
    isoPast(65), isoPast(15));

  insertMissing.run(3, 'MP-2026-003', 'Karan Joshi', 16, 'MALE',
    'Sports Ground near North High School', '11:00 AM Today',
    'Mother: Kavita Joshi (9876500003)',
    'Red football jersey, black shorts, Nike sneakers, scar on right chin.',
    'MISSING', 'Last seen with school friends during evacuation. Friends arrived at shelter without him.',
    isoPast(40), isoPast(40));

  // 9. Seed Medical Cases with explicit IDs
  const insertMed = db.prepare(`
    INSERT OR REPLACE INTO medical_cases (id, sos_id, patient_name, triage_status, triage_priority, symptoms, vitals_summary, resource_requests, assigned_medic, notes, is_simulation, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
  `);

  insertMed.run(1, 2, 'Sunita Patel', 'WAITING', 'RED_IMMEDIATE',
    'Head laceration, active bleeding, dizziness, nausea',
    'BP: 105/65, Pulse: 110, Resp: 24, GCS: 13',
    'Sterile gauze, suture kit, saline bag', 'Dr. Sarah Rao',
    'Awaiting volunteer team transport to triage clinic.', isoPast(25), isoPast(25));

  insertMed.run(2, 5, 'Pooja Nair & Infant', 'STABILIZED', 'YELLOW_DELAYED',
    'Exhaustion, hypothermia symptoms, dehydration',
    'BP: 118/76, Pulse: 82, Temp: 36.2C',
    'Warm blankets, oral rehydration solution, prenatal vitamins', 'Dr. Sarah Rao',
    'Safe in Central Shelter Medical Ward. Monitoring vital signs every 2 hours.',
    isoPast(35), isoPast(10));

  insertMed.run(3, null, 'Mohammed Ali (Elderly)', 'WAITING', 'YELLOW_DELAYED',
    'Shortness of breath, chest tightness, pale skin. Pre-existing cardiac history.',
    'BP: 150/90, Pulse: 95, SpO2: 93%',
    'Oxygen cylinder, nitroglycerine tablets, cardiac monitoring', '',
    'Brought in by civilian volunteers. Awaiting Dr. Rao assessment.',
    isoPast(10), isoPast(10));

  // 10. Seed Announcements with explicit IDs (deduplicated via INSERT OR REPLACE)
  const insertAnn = db.prepare(`
    INSERT OR REPLACE INTO announcements (id, title, message, priority, issuer, expires_at, is_simulation, created_at)
    VALUES (?, ?, ?, ?, ?, NULL, 0, ?)
  `);

  insertAnn.run(1, 'EMERGENCY EVACUATION ORDER: SECTOR B LOWLANDS',
    'Water level rising at 15cm per hour. All residents living within 500 meters of the river must evacuate immediately to Central Relief Shelter or North High School. Avoid River Bridge.',
    'CRITICAL', 'Civil Defense & Disaster Operations Center', isoPast(80));

  insertAnn.run(2, 'Boil Water Advisory - Sector B',
    'Municipal tap water supply is compromised due to floodwater inundation. DO NOT drink tap water without boiling for 3 minutes or using chlorine purification tablets distributed at shelters.',
    'HIGH', 'Chief Medical Officer', isoPast(50));

  insertAnn.run(3, 'Volunteer Staging Point Active',
    'All registered civilian volunteers report to Central Shelter Logistics Staging Area for assignment briefings and safety gear issuance.',
    'NORMAL', 'Volunteer Coordination Desk', isoPast(35));

  // 11. Seed Chat Messages (only on force reset or first run)
  if (force || db.prepare('SELECT COUNT(*) AS c FROM chat_messages').get().c === 0) {
    const insertChat = db.prepare(`
      INSERT INTO chat_messages (channel, sender_id, sender_name, sender_role, message, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    insertChat.run('GENERAL', 2, 'Sector Dispatch Coordinator', 'COORDINATOR', 'RescueOS Emergency Network is active. All stations report status.', isoPast(110));
    insertChat.run('GENERAL', 4, 'Rescue Team 01 (Swiftwater)', 'VOLUNTEER', 'Team 01 ready with Zodiac boat and 6 PFDs.', isoPast(100));
    insertChat.run('COMMAND', 2, 'Sector Dispatch Coordinator', 'COORDINATOR', 'River Bridge is now confirmed impassable. Re-routing all logistics through North Ring Road.', isoPast(45));
    insertChat.run('VOLUNTEERS', 4, 'Rescue Team 01 (Swiftwater)', 'VOLUNTEER', 'Sector B water levels are chest deep near 4th cross. Need support truck at dry point.', isoPast(20));
    insertChat.run('MEDICAL', 3, 'Dr. Sarah Rao (Field Triage Lead)', 'MEDICAL', 'Central Shelter clinic running low on pediatric saline. Requesting transfer from North High.', isoPast(15));
  }

  // 12. Seed Audit Trail (only on force reset or first run)
  if (force || db.prepare('SELECT COUNT(*) AS c FROM audit_logs').get().c === 0) {
    const insertAudit = db.prepare(`
      INSERT INTO audit_logs (actor, action, target, detail, ip, created_at)
      VALUES (?, ?, ?, ?, '127.0.0.1', ?)
    `);
    insertAudit.run('SYSTEM', 'SYSTEM_BOOT', 'RescueOS', 'Offline Disaster OS core initialized on host network', isoPast(180));
    insertAudit.run('admin', 'LOGIN', 'Admin User', 'Administrator logged into emergency console', isoPast(170));
    insertAudit.run('Civil Defense', 'ANNOUNCEMENT', 'Public Broadcast', 'Issued CRITICAL evacuation order for Sector B', isoPast(80));
    insertAudit.run('coordinator', 'TASK_ASSIGNED', 'SOS #1', 'Assigned to Rescue Team 01 (Swiftwater)', isoPast(30));
    insertAudit.run('Rescue Team 01', 'TASK_STATUS', 'SOS #5', 'Status updated to RESOLVED (Safe extraction)', isoPast(35));
    insertAudit.run('coordinator', 'SHELTER_UPDATE', 'Central Relief Shelter', 'Resource stock replenished: 500L Water, 120 MREs', isoPast(90));
  }

  // Sync to legacy JSON snapshot
  syncLegacyJson();

  console.log('✅ Demo dataset ready.');
}

module.exports = {
  seedDatabase,
  DEMO_PASSWORD
};
