/**
 * RescueOS Disaster Simulation Engine
 * Core Competition Feature: Dynamic offline simulation of multi-phase disaster emergencies.
 */
const { db, syncLegacyJson } = require('./db');
const sse = require('./sse');

class DisasterSimulator {
  constructor() {
    this.status = 'IDLE'; // IDLE, RUNNING, PAUSED, ENDED
    this.scenario = null;
    this.stepIndex = 0;
    this.timer = null;
    this.speedMs = 8000; // 8 seconds per event phase
    this.startedAt = null;
  }

  getStatus() {
    return {
      status: this.status,
      scenario: this.scenario,
      stepIndex: this.stepIndex,
      totalSteps: this.scenario && SCENARIOS[this.scenario] ? SCENARIOS[this.scenario].length : 0,
      speedMs: this.speedMs,
      startedAt: this.startedAt
    };
  }

  start(scenarioName, speedMs = 8000) {
    const scenarioKey = String(scenarioName || '').toUpperCase();
    if (!SCENARIOS[scenarioKey]) {
      throw new Error(`Unknown scenario: ${scenarioName}. Available: ${Object.keys(SCENARIOS).join(', ')}`);
    }

    // Clean any previous simulation records before new start
    this.clearSimulationRecords();

    this.scenario = scenarioKey;
    this.status = 'RUNNING';
    this.stepIndex = 0;
    this.speedMs = Math.max(2000, Number(speedMs) || 8000);
    this.startedAt = new Date().toISOString();

    // Log simulation start
    this.logAudit('SIMULATION_START', `Started ${scenarioKey} simulation scenario at ${this.speedMs}ms interval`);

    // Fire first event immediately
    this.executeCurrentStep();

    // Schedule next events
    this.scheduleNextTick();

    sse.broadcast('simulation_status', this.getStatus());
    return this.getStatus();
  }

  pause() {
    if (this.status !== 'RUNNING') return this.getStatus();
    this.clearTimer();
    this.status = 'PAUSED';
    this.logAudit('SIMULATION_PAUSE', `Paused ${this.scenario} scenario at step ${this.stepIndex}`);
    sse.broadcast('simulation_status', this.getStatus());
    return this.getStatus();
  }

  resume() {
    if (this.status !== 'PAUSED') return this.getStatus();
    this.status = 'RUNNING';
    this.logAudit('SIMULATION_RESUME', `Resumed ${this.scenario} scenario`);
    this.scheduleNextTick();
    sse.broadcast('simulation_status', this.getStatus());
    return this.getStatus();
  }

  end() {
    this.clearTimer();
    this.status = 'ENDED';
    this.logAudit('SIMULATION_END', `Ended ${this.scenario} scenario at step ${this.stepIndex}`);
    sse.broadcast('simulation_status', this.getStatus());
    return this.getStatus();
  }

  reset() {
    this.clearTimer();
    this.clearSimulationRecords();
    this.status = 'IDLE';
    this.scenario = null;
    this.stepIndex = 0;
    this.startedAt = null;
    this.logAudit('SIMULATION_RESET', 'Cleared all simulation records and reset engine');
    sse.broadcast('simulation_status', this.getStatus());
    syncLegacyJson();
    return this.getStatus();
  }

  scheduleNextTick() {
    this.clearTimer();
    if (this.status !== 'RUNNING') return;

    this.timer = setTimeout(() => {
      this.stepIndex++;
      const steps = SCENARIOS[this.scenario] || [];
      if (this.stepIndex >= steps.length) {
        this.end();
        return;
      }
      this.executeCurrentStep();
      this.scheduleNextTick();
    }, this.speedMs);

    if (this.timer.unref) this.timer.unref();
  }

  clearTimer() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  executeCurrentStep() {
    const steps = SCENARIOS[this.scenario] || [];
    const event = steps[this.stepIndex];
    if (!event) return;

    try {
      const result = event.action(this);
      const payload = {
        scenario: this.scenario,
        stepIndex: this.stepIndex,
        totalSteps: steps.length,
        phaseName: event.phase,
        description: event.description,
        timestamp: new Date().toISOString(),
        result
      };

      sse.broadcast('simulation_event', payload);
      sse.broadcast('simulation_status', this.getStatus());
      syncLegacyJson();
    } catch (err) {
      console.error(`Simulation step error (${this.scenario} step ${this.stepIndex}):`, err.message);
    }
  }

  clearSimulationRecords() {
    db.exec(`
      DELETE FROM audit_logs WHERE actor = 'SIMULATION';
      DELETE FROM medical_cases WHERE is_simulation = 1;
      DELETE FROM missing_persons WHERE is_simulation = 1;
      DELETE FROM announcements WHERE is_simulation = 1;
      DELETE FROM tasks WHERE sos_id IN (SELECT id FROM sos_requests WHERE is_simulation = 1);
      DELETE FROM sos_requests WHERE is_simulation = 1;
      DELETE FROM incidents WHERE is_simulation = 1;
      DELETE FROM resource_transactions WHERE resource_id IN (SELECT id FROM resources WHERE is_simulation = 1);
      DELETE FROM resources WHERE is_simulation = 1;
      DELETE FROM shelters WHERE is_simulation = 1;
    `);
  }

  logAudit(action, detail) {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO audit_logs (actor, action, target, detail, ip, created_at)
      VALUES ('SIMULATION', ?, 'SIMULATION ENGINE', ?, '127.0.0.1', ?)
    `).run(action, detail, now);
    sse.broadcast('audit', { actor: 'SIMULATION', action, detail, created_at: now });
  }
}

/**
 * Scenario Event Catalog: Realistic escalating phases
 */
const SCENARIOS = {
  FLOOD: [
    {
      phase: 'Phase 1: Hydrological Warning',
      description: 'Upstream reservoir spillway opened. Flash flood warning issued for riverbank communities.',
      action: () => {
        const now = new Date().toISOString();
        const row = db.prepare(`
          INSERT INTO announcements (title, message, priority, issuer, is_simulation, created_at)
          VALUES ('[SIMULATION] FLASH FLOOD WARNING', 'Upstream flood wave traveling downriver at 12 knots. Evacuate lowlands in Sector B immediately.', 'CRITICAL', 'Flood Forecasting Division', 1, ?)
          RETURNING id, title, message, priority, issuer, is_simulation, created_at
        `).get(now);
        sse.broadcast('announcement', row);
        return { announcement: row };
      }
    },
    {
      phase: 'Phase 2: Infrastructure Inundation',
      description: 'River exceeds embankment. South Access Causeway submerged under 1.2m turbulent flow.',
      action: () => {
        const now = new Date().toISOString();
        const inc = db.prepare(`
          INSERT INTO incidents (title, description, incident_type, severity, location, lat, lng, reporter, status, is_simulation, created_at, updated_at)
          VALUES ('[SIM] South Causeway Submerged & Impassable', 'Rapid current flowing across roadway. Water depth 1.2m. Concrete barriers washed into ditch.', 'ROAD_BLOCK', 'CRITICAL', 'South Causeway - Sector B', 12.9580, 77.5820, 'Highway Patrol Unit 4', 'VERIFIED', 1, ?, ?)
          RETURNING *
        `).get(now, now);
        sse.broadcast('incident_created', inc);
        return { incident: inc };
      }
    },
    {
      phase: 'Phase 3: Critical Civilian Trapping',
      description: 'Family of 5 trapped on rooftop of single-story residence as ground floor fills with water.',
      action: () => {
        const now = new Date().toISOString();
        const rescueId = 'RSC-SIM-' + Math.random().toString(16).slice(2, 6).toUpperCase();
        const sos = db.prepare(`
          INSERT INTO sos_requests (rescue_id, requester, emergency_type, description, people_affected, priority, location, lat, lng, status, is_simulation, created_at, updated_at)
          VALUES (?, '[SIM] Manoj Bakshi & Family', 'TRAPPED', 'Rooftop refuge surrounded by fast water. Includes 8-month infant and grandmother with asthma.', 5, 'CRITICAL', 'House #19, Riverbend Lane, Sector B', 12.9615, 77.5845, 'NEW', 1, ?, ?)
          RETURNING *
        `).get(rescueId, now, now);
        sse.broadcast('sos_created', sos);
        return { sos };
      }
    },
    {
      phase: 'Phase 4: Shelter Surge & Capacity Pressure',
      description: 'Over 80 evacuees arrive at Riverside Community Hall, pushing shelter into overflow state.',
      action: () => {
        const now = new Date().toISOString();
        db.prepare(`
          UPDATE shelters
          SET occupancy = capacity + 12, status = 'FULL', updated_at = ?
          WHERE id = 3
        `).run(now);
        const shelter = db.prepare('SELECT * FROM shelters WHERE id = 3').get();
        sse.broadcast('shelter_updated', shelter);
        return { shelter };
      }
    },
    {
      phase: 'Phase 5: Medical Triage Influx',
      description: 'Hypothermia and flood immersion cases arrive at shelter clinic.',
      action: () => {
        const now = new Date().toISOString();
        const med = db.prepare(`
          INSERT INTO medical_cases (patient_name, triage_status, triage_priority, symptoms, vitals_summary, resource_requests, is_simulation, created_at, updated_at)
          VALUES ('[SIM] Anita Bakshi (Elderly)', 'WAITING', 'RED_IMMEDIATE', 'Acute hypothermia, shivering cessation, pulse thready, severe wheezing', 'BP: 90/55, Pulse: 124, SpO2: 88%', 'Oxygen concentrator, nebulizer with salbutamol, warmed IV saline', 1, ?, ?)
          RETURNING *
        `).get(now, now);
        sse.broadcast('medical_updated', med);
        return { medical: med };
      }
    },
    {
      phase: 'Phase 6: Resource Depletion Alert',
      description: 'Emergency potable water stock at Riverside Shelter drops to zero.',
      action: () => {
        const now = new Date().toISOString();
        db.prepare(`
          UPDATE resources
          SET quantity = 0, last_updated = ?
          WHERE shelter_id = 3 AND category = 'Water'
        `).run(now);
        db.prepare(`
          INSERT INTO resource_transactions (resource_id, resource_name, type, quantity, source_or_destination, notes, actor, created_at)
          VALUES (
            (SELECT id FROM resources WHERE shelter_id = 3 AND category = 'Water' LIMIT 1),
            'Drinking Water 20L Cans',
            'OUTGOING', 40, 'Riverside Shelter Evacuees', 'Water fully exhausted by refugee influx', 'SIMULATION', ?
          )
        `).run(now);
        sse.broadcast('resource_updated', { shelter_id: 3, alert: 'OUT_OF_STOCK', category: 'Water' });
        return { alert: 'WATER_EXHAUSTED' };
      }
    },
    {
      phase: 'Phase 7: Missing Child Report',
      description: 'Child separated from parents during hasty boat embarkation.',
      action: () => {
        const now = new Date().toISOString();
        const code = 'MP-SIM-' + Math.random().toString(16).slice(2, 6).toUpperCase();
        const mp = db.prepare(`
          INSERT INTO missing_persons (tracking_code, full_name, age, gender, last_seen_location, last_seen_time, contact_info, identifying_features, status, notes, is_simulation, created_at, updated_at)
          VALUES (?, '[SIM] Rohan Kulkarni', 6, 'MALE', 'Sector B Boat Landing Assembly Staging', '10 minutes ago', 'Father: Sunil (9876599901)', 'Red hooded sweater, blue rainboots, wearing silver identification wristlet', 'MISSING', 'Separated during boat loading', 1, ?, ?)
          RETURNING *
        `).get(code, now, now);
        sse.broadcast('missing_updated', mp);
        return { missing: mp };
      }
    },
    {
      phase: 'Phase 8: Comprehensive Evacuation Directive',
      description: 'Command center orders full secondary perimeter evacuation and National Disaster Response deployment.',
      action: () => {
        const now = new Date().toISOString();
        const ann = db.prepare(`
          INSERT INTO announcements (title, message, priority, issuer, is_simulation, created_at)
          VALUES ('[SIMULATION] EMERGENCY CODE RED: MANDATORY RELOCATION', 'All shelters in Sector B are in overflow. Evacuee convoy dispatching to Central District Stadium. Avoid all watercourse roads.', 'CRITICAL', 'Joint Disaster Command', 1, ?)
          RETURNING *
        `).get(now);
        sse.broadcast('announcement', ann);
        return { announcement: ann };
      }
    }
  ],

  EARTHQUAKE: [
    {
      phase: 'Phase 1: Seismic Impact',
      description: 'Magnitude 6.5 earthquake strikes district. Heavy shaking reported across all sectors.',
      action: () => {
        const now = new Date().toISOString();
        const ann = db.prepare(`
          INSERT INTO announcements (title, message, priority, issuer, is_simulation, created_at)
          VALUES ('[SIMULATION] SEISMIC EVENT: M6.5 DETECTED', 'Major seismic tremor. Expect aftershocks. Stay clear of masonry structures and power cables.', 'CRITICAL', 'Earthquake Early Warning', 1, ?)
          RETURNING *
        `).get(now);
        sse.broadcast('announcement', ann);
        return { announcement: ann };
      }
    },
    {
      phase: 'Phase 2: Structural Collapse & Trapped Victims',
      description: 'Commercial 3-story concrete building pancake collapse in Sector A.',
      action: () => {
        const now = new Date().toISOString();
        const rescueId = 'RSC-SIM-' + Math.random().toString(16).slice(2, 6).toUpperCase();
        const sos = db.prepare(`
          INSERT INTO sos_requests (rescue_id, requester, emergency_type, description, people_affected, priority, location, lat, lng, status, is_simulation, created_at, updated_at)
          VALUES (?, '[SIM] Commercial Complex Security', 'STRUCTURAL_DAMAGE', 'Pancake collapse of 2nd floor onto ground retail. 7 people trapped under slab voids. Dust cloud heavy.', 7, 'CRITICAL', 'Market Road Block 7, Sector A', 12.9740, 77.5980, 'NEW', 1, ?, ?)
          RETURNING *
        `).get(rescueId, now, now);
        sse.broadcast('sos_created', sos);
        return { sos };
      }
    },
    {
      phase: 'Phase 3: Urban Gas Leak & Fire Outbreak',
      description: 'Ruptured domestic gas main ignites adjacent residential timber structures.',
      action: () => {
        const now = new Date().toISOString();
        const inc = db.prepare(`
          INSERT INTO incidents (title, description, incident_type, severity, location, lat, lng, reporter, status, is_simulation, created_at, updated_at)
          VALUES ('[SIM] Gas Line Rupture & Structural Fire', 'Ruptured 4-inch gas line burning with 6m flame jet. Threatening three adjacent residential blocks.', 'FIRE', 'CRITICAL', 'Crossroad 12, Sector A', 12.9710, 77.5920, 'Fire Scout 01', 'VERIFIED', 1, ?, ?)
          RETURNING *
        `).get(now, now);
        sse.broadcast('incident_created', inc);
        return { incident: inc };
      }
    },
    {
      phase: 'Phase 4: Mass Casualty Triage Surge',
      description: 'Blast trauma and crush injury victims transported to Central Relief Shelter triage.',
      action: () => {
        const now = new Date().toISOString();
        const med = db.prepare(`
          INSERT INTO medical_cases (patient_name, triage_status, triage_priority, symptoms, vitals_summary, resource_requests, is_simulation, created_at, updated_at)
          VALUES ('[SIM] Multiple Crush Trauma (Void Extraction)', 'WAITING', 'RED_IMMEDIATE', 'Crush syndrome lower extremities, compound femur fracture, severe hemorrhagic shock', 'BP: 75/40, Pulse: 140, Resp: 30', 'Tourniquets, IV fluids (Ringer Lactate), blood typing packs, pelvic splint', 1, ?, ?)
          RETURNING *
        `).get(now, now);
        sse.broadcast('medical_updated', med);
        return { medical: med };
      }
    }
  ],

  LANDSLIDE: [
    {
      phase: 'Phase 1: Slope Instability',
      description: 'Prolonged rainfall causes hillside saturation and initial debris movement.',
      action: () => {
        const now = new Date().toISOString();
        const inc = db.prepare(`
          INSERT INTO incidents (title, description, incident_type, severity, location, lat, lng, reporter, status, is_simulation, created_at, updated_at)
          VALUES ('[SIM] Hillside Slope Slump & Road Severance', '150-meter section of North Ridge Road swept into ravine. Sector C hill villages isolated.', 'LANDSLIDE', 'CRITICAL', 'Ridge Road Km 7, Sector C', 12.9890, 77.6120, 'Geological Survey Scout', 'VERIFIED', 1, ?, ?)
          RETURNING *
        `).get(now, now);
        sse.broadcast('incident_created', inc);
        return { incident: inc };
      }
    },
    {
      phase: 'Phase 2: Vehicles Buried in Debris Flow',
      description: 'Two passenger vans caught in mud and rock slide on winding mountain switchback.',
      action: () => {
        const now = new Date().toISOString();
        const rescueId = 'RSC-SIM-' + Math.random().toString(16).slice(2, 6).toUpperCase();
        const sos = db.prepare(`
          INSERT INTO sos_requests (rescue_id, requester, emergency_type, description, people_affected, priority, location, lat, lng, status, is_simulation, created_at, updated_at)
          VALUES (?, '[SIM] Transport Bus Passenger', 'TRAPPED', 'Bus pinned against guardrail by rockslide. Mud pressing through broken windows. 12 passengers on board.', 12, 'CRITICAL', 'Curve 4, North Mountain Pass, Sector C', 12.9910, 77.6150, 'NEW', 1, ?, ?)
          RETURNING *
        `).get(rescueId, now, now);
        sse.broadcast('sos_created', sos);
        return { sos };
      }
    }
  ],

  CYCLONE: [
    {
      phase: 'Phase 1: Gale Force Landfall',
      description: 'Super Cyclone eyewall makes landfall with sustained winds exceeding 160 km/h.',
      action: () => {
        const now = new Date().toISOString();
        const ann = db.prepare(`
          INSERT INTO announcements (title, message, priority, issuer, is_simulation, created_at)
          VALUES ('[SIMULATION] CYCLONE EYEWALL LANDFALL', '165 km/h gusts recorded. Complete power blackout in effect. Shelter in interior concrete rooms away from glass.', 'CRITICAL', 'Meteorological Bureau', 1, ?)
          RETURNING *
        `).get(now);
        sse.broadcast('announcement', ann);
        return { announcement: ann };
      }
    },
    {
      phase: 'Phase 2: Grid & Communications Blackout',
      description: 'Transmission towers toppled. RescueOS operating as isolated emergency mesh hub.',
      action: () => {
        const now = new Date().toISOString();
        const inc = db.prepare(`
          INSERT INTO incidents (title, description, incident_type, severity, location, lat, lng, reporter, status, is_simulation, created_at, updated_at)
          VALUES ('[SIM] High-Tension Transmission Tower Toppled', '400kV line across Highway 9 collapsed. High voltage lines down over residential street.', 'INFRASTRUCTURE', 'CRITICAL', 'Highway 9 Overpass, Sector A', 12.9750, 77.6020, 'Grid Dispatcher', 'REPORTED', 1, ?, ?)
          RETURNING *
        `).get(now, now);
        sse.broadcast('incident_created', inc);
        return { incident: inc };
      }
    }
  ],

  FIRE: [
    {
      phase: 'Phase 1: Urban Wildfire Interface',
      description: 'Forest fire driven by high winds breaches northern perimeter of the district.',
      action: () => {
        const now = new Date().toISOString();
        const inc = db.prepare(`
          INSERT INTO incidents (title, description, incident_type, severity, location, lat, lng, reporter, status, is_simulation, created_at, updated_at)
          VALUES ('[SIM] Rapid Flame Front Approaching North Ridge', 'Active crown fire traveling south at 45m/min. Embers igniting residential cedar shingles.', 'FIRE', 'CRITICAL', 'North Perimeter Ridge, Sector C', 12.9920, 77.6090, 'Forestry Lookouts', 'VERIFIED', 1, ?, ?)
          RETURNING *
        `).get(now, now);
        sse.broadcast('incident_created', inc);
        return { incident: inc };
      }
    },
    {
      phase: 'Phase 2: Immediate Evacuation SOS',
      description: 'Senior citizens home trapped by smoke plume and advancing flame line.',
      action: () => {
        const now = new Date().toISOString();
        const rescueId = 'RSC-SIM-' + Math.random().toString(16).slice(2, 6).toUpperCase();
        const sos = db.prepare(`
          INSERT INTO sos_requests (rescue_id, requester, emergency_type, description, people_affected, priority, location, lat, lng, status, is_simulation, created_at, updated_at)
          VALUES (?, '[SIM] Care Home Warden', 'FIRE', 'Dense toxic smoke filling facility. 18 wheelchair/bedridden residents need immediate bus extraction.', 18, 'CRITICAL', 'Hillside Senior Home, Sector C', 12.9870, 77.6040, 'NEW', 1, ?, ?)
          RETURNING *
        `).get(rescueId, now, now);
        sse.broadcast('sos_created', sos);
        return { sos };
      }
    }
  ]
};

module.exports = new DisasterSimulator();
