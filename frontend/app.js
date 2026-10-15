/**
 * RescueOS — Client Application Logic & Event Orchestration
 * Offline-first, Zero External CDN, Real-Time SSE Integration.
 */

// Application State
let state = {
  stats: {},
  sos: [],
  volunteers: [],
  shelters: [],
  announcements: [],
  audit: [],
  incidents: [],
  missing_persons: [],
  medical_cases: [],
  resources: [],
  simulation: { status: 'IDLE' }
};

let currentUser = null;
let currentTab = 'dashboard';
let currentChatChannel = 'GENERAL';
let activeFilter = 'ALL';
let showSimData = true;
let databaseTable = '';
let databaseOffset = 0;
let databaseTotalRows = 0;
const databaseLimit = 50;

// DOM Helper
const $ = id => document.getElementById(id);

// Safe HTML Escaping (XSS Prevention)
function esc(v) {
  return String(v ?? '').replace(/[&<>'"]/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[c]));
}

// Format date relative or time
function formatTime(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return iso;
  }
}

// Priority Badge Helper
function priorityBadge(p) {
  const pri = (p || 'MEDIUM').toUpperCase();
  const cls = pri === 'CRITICAL' ? 'badge-critical' : pri === 'HIGH' ? 'badge-high' : pri === 'LOW' ? 'badge-low' : 'badge-medium';
  return `<span class="badge ${cls}">${esc(pri)}</span>`;
}

// Status Badge Helper
function statusBadge(s) {
  const st = (s || 'NEW').toUpperCase();
  let cls = 'badge-new';
  if (st === 'ASSIGNED') cls = 'badge-assigned';
  else if (st === 'IN_PROGRESS' || st === 'RESPONDING') cls = 'badge-progress';
  else if (st === 'RESOLVED' || st === 'REUNITED') cls = 'badge-resolved';
  return `<span class="badge ${cls}">${esc(st)}</span>`;
}

// API Call Wrapper with Authentication Token Header
async function api(url, options = {}) {
  const token = localStorage.getItem('rescueos_token');
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(url, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}: Request failed`);
  }
  return data;
}

// Tab Switching
function showTab(tabId) {
  currentTab = tabId;
  document.querySelectorAll('main section').forEach(sec => sec.classList.add('hidden'));
  const target = $(tabId);
  if (target) target.classList.remove('hidden');

  document.querySelectorAll('.nav-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });

  document.querySelectorAll('.nav-tab').forEach(btn => {
    if (btn.dataset.tab === tabId) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  });

  if (tabId === 'chat') {
    loadChatMessages(currentChatChannel);
  } else if (tabId === 'database') {
    loadDatabase();
  } else if (tabId === 'system') {
    fetchSystemInfo();
  }

  render();
}

// Initialize Application
async function initApp() {
  await checkAuthStatus();
  await loadState();
  initSSE();
  fetchNetworkInfo();
  fetchSystemInfo();
}

async function fetchSystemInfo() {
  const target = $('systemInfo');
  if (!target) return;
  target.textContent = 'Reading system information…';
  const formatBytes = value => {
    if (!Number.isFinite(value)) return 'Unavailable';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = value;
    let unit = 0;
    while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit++; }
    return `${size.toFixed(unit ? 1 : 0)} ${units[unit]}`;
  };
  try {
    const system = await api('/api/system');
    const uptime = Math.floor(system.uptimeSeconds / 60);
    const storage = system.storage
      ? `${formatBytes(system.storage.availableBytes)} available of ${formatBytes(system.storage.totalBytes)} (${esc(system.storage.path)})`
      : 'Unavailable on this platform';
    target.innerHTML = `<dl class="system-details"><div><dt>Operating system</dt><dd>${esc(system.os)}</dd></div><div><dt>Uptime</dt><dd>${Math.floor(uptime / 1440)}d ${Math.floor((uptime % 1440) / 60)}h ${uptime % 60}m</dd></div><div><dt>Processor</dt><dd>${esc(system.cpu.model)} · ${system.cpu.cores} logical cores · ${system.cpu.usagePercent == null ? 'usage unavailable' : `${system.cpu.usagePercent}% sampled usage`}</dd></div><div><dt>Memory</dt><dd>${formatBytes(system.memory.availableBytes)} available of ${formatBytes(system.memory.totalBytes)}</dd></div><div><dt>Root storage</dt><dd>${storage}</dd></div></dl>`;
  } catch (err) {
    target.textContent = `System information unavailable: ${err.message}`;
  }
}

// Authentication Check
async function checkAuthStatus() {
  try {
    const res = await api('/api/auth/me');
    if (res.authenticated && res.user) {
      currentUser = res.user;
    } else {
      currentUser = null;
      localStorage.removeItem('rescueos_token');
    }
  } catch {
    currentUser = null;
  }
  updateAuthUI();
}

function updateAuthUI() {
  const userPill = $('userStatusPill');
  if (currentUser) {
    userPill.innerHTML = `👤 <strong>${esc(currentUser.username)}</strong> (${esc(currentUser.role)}) <button class="btn btn-dark btn-sm" onclick="logout()" style="margin-left:6px">Logout</button>`;
  } else {
    userPill.innerHTML = `<button class="btn btn-primary btn-sm" onclick="openLoginModal()">🔑 Login / Staff</button>`;
  }
}

// Fetch Full System State
async function loadState() {
  try {
    state = await api('/api/state');
    render();
  } catch (err) {
    console.error('Failed to load state:', err);
  }
}

// Fetch Local Network Information (Dynamic LAN IPs)
async function fetchNetworkInfo() {
  try {
    const net = await api('/api/network');
    $('stationName').textContent = net.stationId || 'STATION-ALPHA';
    if (net.interfaces && net.interfaces.length > 0) {
      const lanUrl = net.interfaces[0].url;
      $('lanPill').innerHTML = `📡 LAN: <a href="${lanUrl}" target="_blank" style="color:inherit;text-decoration:none">${esc(net.interfaces[0].address)}:${net.port}</a>`;
      $('lanListInfo').innerHTML = net.interfaces.map(i => `<div><strong>${esc(i.name)}:</strong> <span style="font-family:monospace;color:var(--blue)">${esc(i.url)}</span></div>`).join('');
    }
    const networkList = $('networkInterfaces');
    if (networkList) {
      networkList.innerHTML = net.interfaces?.length
        ? `<div class="table-responsive"><table class="table"><thead><tr><th>Interface</th><th>IPv4</th><th>Access URL</th></tr></thead><tbody>${net.interfaces.map(i => `<tr><td>${esc(i.name)}</td><td>${esc(i.address)}</td><td>${esc(i.url)}</td></tr>`).join('')}</tbody></table></div><p class="panel-sub">DNS: ${net.dns?.length ? net.dns.map(esc).join(', ') : 'Not reported by this platform'}</p><p class="panel-sub">Default gateway: ${net.defaultGateway ? esc(net.defaultGateway) : 'Not detected'}</p>`
        : '<p>No non-loopback IPv4 interfaces are currently reported.</p>';
    }
  } catch (err) {
    console.warn('Network info unavailable:', err.message);
  }
}

async function runNetworkDiagnostics() {
  const output = $('networkDiagnostics');
  if (!output) return;
  output.textContent = 'Checking interface, route, DNS, and external connectivity…';
  try {
    const result = await api('/api/network/diagnostics');
    output.innerHTML = `<ul class="diagnostic-list">${result.checks.map(check => `<li><strong>${esc(check.label)}:</strong> ${check.ok === true ? 'OK' : check.ok === false ? 'Failed' : 'Not verified'} — ${esc(check.detail)}</li>`).join('')}</ul>`;
  } catch (err) {
    output.textContent = `Diagnostics failed: ${err.message}`;
  }
}

async function loadDatabase(table = databaseTable, offset = databaseOffset) {
  const status = $('databaseStatus');
  if (!status) return;
  status.textContent = 'Connecting…';
  const params = new URLSearchParams();
  if (table) {
    params.set('table', table);
    params.set('limit', String(databaseLimit));
    params.set('offset', String(offset));
  }
  try {
    const data = await api(`/api/database${params.size ? `?${params}` : ''}`);
    status.textContent = `${data.engine} connected · read-only`;
    const tables = $('databaseTables');
    tables.innerHTML = data.tables.length
      ? data.tables.map(name => `<button class="database-table-button" type="button" data-table="${esc(name)}">${esc(name)}</button>`).join('')
      : '<p>No application tables found.</p>';
    tables.querySelectorAll('[data-table]').forEach(button => button.addEventListener('click', () => loadDatabase(button.dataset.table, 0)));
    if (!table) return;
    databaseTable = table;
    databaseOffset = offset;
    databaseTotalRows = data.totalRows;
    $('databaseTableTitle').textContent = table;
    $('databaseQueryTime').textContent = `Read in ${data.durationMs} ms`;
    $('databaseSchema').innerHTML = `<p class="panel-sub">${data.schema.map(column => `${esc(column.name)} (${esc(column.type || 'any')}${column.primaryKey ? ', primary key' : ''}${column.required ? ', required' : ''})`).join(' · ')}</p>`;
    const headers = data.schema.map(column => `<th>${esc(column.name)}</th>`).join('');
    const rows = data.rows.map(row => `<tr>${data.schema.map(column => {
      const value = row[column.name];
      return `<td>${esc(value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : value)}</td>`;
    }).join('')}</tr>`).join('');
    $('databaseRows').innerHTML = data.rows.length
      ? `<table class="table"><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>`
      : '<p>No rows in this page.</p>';
    $('databasePage').textContent = `${data.totalRows ? offset + 1 : 0}–${Math.min(offset + data.rows.length, data.totalRows)} of ${data.totalRows}`;
  } catch (err) {
    status.textContent = `Database unavailable: ${err.message}`;
    if (err.message.includes('administrator')) $('databaseTables').textContent = 'Administrator sign-in is required.';
  }
}

function pageDatabase(direction) {
  const lastPage = databaseTotalRows ? Math.floor((databaseTotalRows - 1) / databaseLimit) * databaseLimit : 0;
  const next = Math.min(lastPage, Math.max(0, databaseOffset + direction * databaseLimit));
  if (next !== databaseOffset && databaseTable) loadDatabase(databaseTable, next);
}

// Real-Time SSE Connection Manager (Step 8)
function initSSE() {
  const indicator = $('liveIndicator');
  const es = new EventSource('/events');

  es.onopen = () => {
    indicator.className = 'status-badge online';
    indicator.innerHTML = '<span class="pulse"></span> LOCAL ONLINE';
  };

  es.onmessage = e => {
    try {
      const msg = JSON.parse(e.data);
      handleRealtimeEvent(msg);
    } catch (err) {
      console.warn('Malformed event:', err);
    }
  };

  es.onerror = () => {
    indicator.className = 'status-badge offline';
    indicator.innerHTML = '<span class="pulse"></span> DISCONNECTED';
    es.close();
    setTimeout(initSSE, 2000);
  };
}

// Handle Incoming Push Events
function handleRealtimeEvent(msg) {
  const { type, payload } = msg;

  if (type === 'state') {
    state = payload;
  } else if (type === 'sos_created') {
    state.sos.unshift(payload);
    flashAlert(`🚨 NEW SOS: #${payload.id} ${payload.name} (${payload.priority})`);
  } else if (type === 'sos_updated' || type === 'sos_assigned') {
    const idx = state.sos.findIndex(s => s.id === payload.id);
    if (idx >= 0) state.sos[idx] = payload;
    else state.sos.unshift(payload);
  } else if (type === 'shelter_updated') {
    const idx = state.shelters.findIndex(s => s.id === payload.id);
    if (idx >= 0) state.shelters[idx] = payload;
    else state.shelters.push(payload);
  } else if (type === 'announcement') {
    state.announcements.unshift(payload);
    flashAlert(`📢 BROADCAST: ${payload.title}`);
  } else if (type === 'incident_created' || type === 'incident_updated') {
    const idx = state.incidents.findIndex(i => i.id === payload.id);
    if (idx >= 0) state.incidents[idx] = payload;
    else state.incidents.unshift(payload);
  } else if (type === 'missing_updated') {
    const idx = state.missing_persons.findIndex(m => m.id === payload.id);
    if (idx >= 0) state.missing_persons[idx] = payload;
    else state.missing_persons.unshift(payload);
  } else if (type === 'medical_updated') {
    const idx = state.medical_cases.findIndex(m => m.id === payload.id);
    if (idx >= 0) state.medical_cases[idx] = payload;
    else state.medical_cases.unshift(payload);
  } else if (type === 'message_created') {
    if (currentTab === 'chat' && payload.channel === currentChatChannel) {
      appendChatMessage(payload);
    }
  } else if (type === 'simulation_event' || type === 'simulation_status') {
    loadState();
  } else if (type === 'audit') {
    state.audit.unshift(payload);
  }

  render();
}

// Temporary Toast / Banner Flash
function flashAlert(text) {
  const banner = $('flashBanner');
  if (!banner) return;
  banner.textContent = text;
  banner.classList.remove('hidden');
  setTimeout(() => banner.classList.add('hidden'), 5000);
}

// Master Render Function
function render() {
  renderStats();
  renderSimulationBanner();
  renderTopBroadcast();
  renderCommandCenter();
  renderVolunteerOps();
  renderShelters();
  renderResources();
  renderIncidents();
  renderMissingPersons();
  renderMedical();
  renderTimeline();
  renderAuditLogs();
}

// Render Top Stats
function renderStats() {
  const activeSos = state.sos.filter(s => !['RESOLVED', 'CANCELLED'].includes(s.status) && (showSimData || !s.is_simulation)).length;
  const criticalSos = state.sos.filter(s => s.priority === 'CRITICAL' && !['RESOLVED', 'CANCELLED'].includes(s.status) && (showSimData || !s.is_simulation)).length;
  const activeInc = state.incidents.filter(i => i.status !== 'RESOLVED' && (showSimData || !i.is_simulation)).length;
  const activeVols = state.volunteers.length;

  const totalCap = state.shelters.reduce((acc, s) => acc + s.capacity, 0) || 1;
  const totalOcc = state.shelters.reduce((acc, s) => acc + s.occupancy, 0);
  const occPct = Math.round((totalOcc / totalCap) * 100);

  const missingCount = state.missing_persons.filter(m => m.status === 'MISSING').length;
  const medicalWaiting = state.medical_cases.filter(m => ['WAITING', 'TRIAGED'].includes(m.triage_status)).length;
  const lowStockCount = state.resources.filter(r => ['OUT_OF_STOCK', 'CRITICAL', 'LOW_STOCK'].includes(r.stock_status)).length;

  $('statActiveSos').textContent = activeSos;
  $('statCritical').textContent = criticalSos;
  $('statIncidents').textContent = activeInc;
  $('statVolunteers').textContent = activeVols;
  $('statShelterOcc').textContent = `${occPct}%`;
  $('statResources').textContent = lowStockCount;
  $('statMissing').textContent = missingCount;
  $('statMedical').textContent = medicalWaiting;

  // Badges on tabs
  $('badgeSos').textContent = activeSos;
  $('badgeVol').textContent = state.sos.filter(s => s.assigned_to).length;
  $('badgeMed').textContent = medicalWaiting;
  $('badgeInc').textContent = activeInc;
}

// Render Simulation Banner (Step 19)
function renderSimulationBanner() {
  const sim = state.simulation || {};
  const isRunning = sim.status === 'RUNNING';
  const banner = $('simActiveBanner');
  if (banner) {
    if (isRunning) {
      banner.classList.remove('hidden');
      $('simStatusText').textContent = `[SIMULATION MODE ACTIVE] Scenario: ${sim.scenario || 'FLOOD'} (Step ${sim.stepIndex + 1}/${sim.totalSteps})`;
    } else {
      banner.classList.add('hidden');
    }
  }
}

// Render Top Broadcast Alert
function renderTopBroadcast() {
  const banner = $('topBroadcastBanner');
  const critical = state.announcements.find(a => a.priority === 'CRITICAL');
  if (banner) {
    if (critical) {
      banner.classList.remove('hidden');
      $('topBroadcastMsg').innerHTML = `🚨 <strong>${esc(critical.title)}:</strong> ${esc(critical.message)}`;
    } else {
      banner.classList.add('hidden');
    }
  }
}

// Render Command Center View
function renderCommandCenter() {
  const container = $('sosList');
  if (!container) return;

  let list = state.sos.filter(s => showSimData || !s.is_simulation);
  if (activeFilter === 'CRITICAL') list = list.filter(s => s.priority === 'CRITICAL');
  else if (activeFilter === 'ACTIVE') list = list.filter(s => !['RESOLVED', 'CANCELLED'].includes(s.status));
  else if (activeFilter === 'RESOLVED') list = list.filter(s => s.status === 'RESOLVED');

  if (!list.length) {
    container.innerHTML = '<p class="panel-sub" style="padding:16px 0">No emergency requests matching current filter.</p>';
    return;
  }

  container.innerHTML = list.map(s => {
    const isNew = s.status === 'NEW';
    const isCrit = s.priority === 'CRITICAL';
    const simBadge = s.is_simulation ? '<span class="badge badge-simulation">SIMULATION</span>' : '';
    const assignedText = s.assigned_to ? `<span style="color:var(--amber)">Assigned: ${esc(s.assigned_to)}</span>` : '<span style="color:var(--text-muted)">Unassigned</span>';

    return `
      <div class="incident-item ${isCrit ? 'critical' : ''} ${isNew ? 'new-alert' : ''}">
        <div class="incident-top">
          <div class="incident-id">
            <span>#${s.id}</span>
            <span style="font-family:monospace;color:var(--blue)">${esc(s.rescue_id || ('RSC-' + s.id))}</span>
            ${priorityBadge(s.priority)}
            ${statusBadge(s.status)}
            ${simBadge}
          </div>
          <span style="font-size:12px;color:var(--text-muted)">${formatTime(s.created_at)}</span>
        </div>
        <div class="incident-body">
          <strong>${esc(s.name)}</strong>: ${esc(s.emergency || s.description)}
        </div>
        <div class="incident-meta">
          <span>📍 ${esc(s.location)}</span>
          <span>👥 ${s.people} affected</span>
          <span>🚨 Category: ${esc(s.emergency_type || 'GENERAL')}</span>
          <span>🛟 ${assignedText}</span>
        </div>
        <div class="incident-actions">
          ${isNew ? `
            <select id="selVol_${s.id}" class="form-control" style="width:auto;display:inline-block;padding:5px 8px;font-size:12px">
              ${state.volunteers.map(v => `<option value="${esc(v.name)}">${esc(v.name)} (${esc(v.status)})</option>`).join('')}
            </select>
            <button class="btn btn-amber btn-sm" onclick="assignSos(${s.id})">Dispatch Team</button>
          ` : ''}
          ${s.status === 'ASSIGNED' ? `<button class="btn btn-green btn-sm" onclick="updateSosStatus(${s.id}, 'IN_PROGRESS')">Start Rescue</button>` : ''}
          ${s.status === 'IN_PROGRESS' ? `<button class="btn btn-green btn-sm" onclick="promptResolveSos(${s.id})">Mark Resolved</button>` : ''}
          <button class="btn btn-dark btn-sm" onclick="viewQrModal('${esc(s.rescue_id || s.id)}')">View QR Card</button>
        </div>
      </div>
    `;
  }).join('');

  // Announcements sub-list
  const annBox = $('announcementsList');
  if (annBox) {
    annBox.innerHTML = state.announcements.slice(0, 4).map(a => `
      <div style="background:var(--bg-card-sub);border:1px solid var(--border);border-radius:8px;padding:10px;margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
          <strong>${esc(a.title)}</strong>
          ${priorityBadge(a.priority)}
        </div>
        <div style="font-size:13px;color:#cbd5e1;margin-bottom:6px">${esc(a.message)}</div>
        <div style="font-size:11px;color:var(--text-dim)">Issued by: ${esc(a.issuer)} · ${formatTime(a.created_at)}</div>
      </div>
    `).join('') || '<p class="panel-sub">No official announcements.</p>';
  }
}

// Filter SOS list
function setSosFilter(filter) {
  activeFilter = filter;
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.classList.toggle('btn-primary', btn.dataset.filter === filter);
    btn.classList.toggle('btn-dark', btn.dataset.filter !== filter);
  });
  renderCommandCenter();
}

function toggleSimData() {
  showSimData = !showSimData;
  $('btnToggleSim').textContent = showSimData ? 'Simulation Data: Visible' : 'Simulation Data: Hidden';
  render();
}

// Volunteer Ops View (Step 9)
function renderVolunteerOps() {
  const container = $('volunteerTaskList');
  if (!container) return;

  const assigned = state.sos.filter(s => s.assigned_to && (showSimData || !s.is_simulation));
  if (!assigned.length) {
    container.innerHTML = '<p class="panel-sub">No volunteer tasks currently active.</p>';
    return;
  }

  container.innerHTML = assigned.map(s => `
    <div class="incident-item">
      <div class="incident-top">
        <div class="incident-id">
          <span>SOS #${s.id}</span>
          <span style="font-family:monospace;color:var(--blue)">${esc(s.rescue_id)}</span>
          ${statusBadge(s.status)}
          ${priorityBadge(s.priority)}
        </div>
        <span style="font-size:12px;color:var(--amber);font-weight:700">Team: ${esc(s.assigned_to)}</span>
      </div>
      <p style="margin:8px 0;font-size:14px">${esc(s.emergency)}</p>
      <div class="incident-meta">
        <span>📍 ${esc(s.location)}</span>
        <span>👥 ${s.people} Persons</span>
        ${s.notes ? `<span>📝 Notes: ${esc(s.notes)}</span>` : ''}
      </div>
      <div class="incident-actions">
        ${s.status === 'ASSIGNED' ? `<button class="btn btn-green btn-sm" onclick="updateSosStatus(${s.id}, 'IN_PROGRESS')">Accept &amp; En Route</button>` : ''}
        ${s.status === 'IN_PROGRESS' ? `
          <button class="btn btn-outline btn-sm" onclick="promptAddNotes(${s.id})">Add Field Notes</button>
          <button class="btn btn-green btn-sm" onclick="promptResolveSos(${s.id})">Complete Rescue (Resolve)</button>
        ` : ''}
        ${s.status === 'RESOLVED' ? `<span style="font-size:12px;color:var(--green)">✓ Rescue Successfully Completed</span>` : ''}
      </div>
    </div>
  `).join('');
}

// Shelters View (Step 11)
function renderShelters() {
  const container = $('sheltersGrid');
  if (!container) return;

  container.innerHTML = state.shelters.map(s => {
    const pct = Math.round((s.occupancy / s.capacity) * 100);
    const isFull = s.occupancy >= s.capacity;
    const isLowCap = pct >= 85;

    return `
      <div class="panel" style="margin-bottom:0">
        <div class="panel-header">
          <div>
            <h3 style="font-size:16px;color:#fff">${esc(s.name)}</h3>
            <span style="font-size:12px;color:var(--text-muted)">📍 ${esc(s.location)}</span>
          </div>
          <span class="badge ${isFull ? 'badge-critical' : isLowCap ? 'badge-high' : 'badge-progress'}">${isFull ? 'FULL' : isLowCap ? 'LOW CAPACITY' : esc(s.status)}</span>
        </div>
        <div style="margin:12px 0">
          <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">
            <span>Occupancy (${s.occupancy} / ${s.capacity})</span>
            <strong>${pct}%</strong>
          </div>
          <div style="background:#1e293b;border-radius:4px;height:8px;overflow:hidden">
            <div style="background:${isFull ? 'var(--red)' : isLowCap ? 'var(--amber)' : 'var(--green)'};width:${Math.min(100, pct)}%;height:100%"></div>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px;margin-bottom:12px;color:#cbd5e1">
          <div>💧 Water: <strong>${s.water || s.water_liters || 0} L</strong></div>
          <div>🍲 Food: <strong>${s.food || s.food_rations || 0} units</strong></div>
          <div>🩹 Medical Kits: <strong>${s.medical_kits || 0}</strong></div>
          <div>🛏️ Blankets: <strong>${s.blankets || 0}</strong></div>
        </div>
        <div class="incident-actions">
          <button class="btn btn-dark btn-sm" onclick="shelterCheckin(${s.id}, 1)">+1 Check-in</button>
          <button class="btn btn-dark btn-sm" onclick="shelterCheckout(${s.id}, 1)">-1 Check-out</button>
          <button class="btn btn-outline btn-sm" onclick="openShelterModal(${s.id})">Manage Stock</button>
        </div>
      </div>
    `;
  }).join('');
}

// Resources View (Step 12)
function renderResources() {
  const container = $('resourcesTableBody');
  if (!container) return;

  container.innerHTML = state.resources.map(r => {
    let badgeCls = 'badge-progress';
    if (r.stock_status === 'OUT_OF_STOCK') badgeCls = 'badge-critical';
    else if (r.stock_status === 'CRITICAL') badgeCls = 'badge-critical';
    else if (r.stock_status === 'LOW_STOCK') badgeCls = 'badge-high';

    return `
      <tr>
        <td><strong>${esc(r.name)}</strong></td>
        <td>${esc(r.category)}</td>
        <td>${esc(r.shelter_name || 'Central Logistics Depot')}</td>
        <td><strong>${r.quantity}</strong> ${esc(r.unit)}</td>
        <td>${r.minimum_threshold} ${esc(r.unit)}</td>
        <td><span class="badge ${badgeCls}">${esc(r.stock_status)}</span></td>
        <td>
          <button class="btn btn-dark btn-sm" onclick="openResourceTxModal(${r.id}, '${esc(r.name)}')">Record Stock Movement</button>
        </td>
      </tr>
    `;
  }).join('');
}

// Incidents View (Step 14)
function renderIncidents() {
  const container = $('incidentsFeed');
  if (!container) return;

  container.innerHTML = state.incidents.map(i => `
    <div class="incident-item">
      <div class="incident-top">
        <div class="incident-id">
          <span>${esc(i.title)}</span>
          ${priorityBadge(i.severity)}
          ${statusBadge(i.status)}
        </div>
        <span style="font-size:12px;color:var(--text-muted)">${formatTime(i.created_at)}</span>
      </div>
      <p style="margin:6px 0;font-size:13px">${esc(i.description)}</p>
      <div class="incident-meta">
        <span>📍 ${esc(i.location)}</span>
        <span>Type: ${esc(i.incident_type)}</span>
        <span>Reporter: ${esc(i.reporter)}</span>
      </div>
      <div class="incident-actions">
        ${i.status === 'REPORTED' ? `<button class="btn btn-amber btn-sm" onclick="updateIncidentStatus(${i.id}, 'VERIFIED')">Verify Hazard</button>` : ''}
        ${i.status === 'VERIFIED' ? `<button class="btn btn-blue btn-sm" onclick="updateIncidentStatus(${i.id}, 'RESPONDING')">Dispatch Units</button>` : ''}
        ${i.status !== 'RESOLVED' ? `<button class="btn btn-green btn-sm" onclick="updateIncidentStatus(${i.id}, 'RESOLVED')">Mark Cleared</button>` : ''}
      </div>
    </div>
  `).join('');
}

// Missing Persons View (Step 13)
function renderMissingPersons() {
  const container = $('missingPersonsGrid');
  if (!container) return;

  container.innerHTML = state.missing_persons.map(m => `
    <div class="panel" style="margin-bottom:0">
      <div class="panel-header">
        <div>
          <h3 style="font-size:16px;color:#fff">${esc(m.full_name)}</h3>
          <span style="font-family:monospace;font-size:12px;color:var(--blue)">${esc(m.tracking_code)}</span>
        </div>
        ${statusBadge(m.status)}
      </div>
      <div style="font-size:13px;color:#cbd5e1;margin-bottom:10px">
        <div><strong>Age:</strong> ${m.age || 'Unknown'} · <strong>Gender:</strong> ${esc(m.gender)}</div>
        <div><strong>Last Seen:</strong> ${esc(m.last_seen_location)} (${esc(m.last_seen_time)})</div>
        ${m.identifying_features ? `<div><strong>Features:</strong> ${esc(m.identifying_features)}</div>` : ''}
        ${m.notes ? `<div style="color:var(--text-dim);margin-top:4px">Notes: ${esc(m.notes)}</div>` : ''}
      </div>
      <div class="incident-actions">
        ${m.status === 'MISSING' ? `<button class="btn btn-green btn-sm" onclick="updateMissingStatus(${m.id}, 'FOUND')">Mark Located</button>` : ''}
        ${m.status === 'FOUND' ? `<button class="btn btn-blue btn-sm" onclick="updateMissingStatus(${m.id}, 'REUNITED')">Mark Reunited</button>` : ''}
      </div>
    </div>
  `).join('');
}

// Medical View (Step 10)
function renderMedical() {
  const container = $('medicalCasesList');
  if (!container) return;

  container.innerHTML = state.medical_cases.map(m => {
    let triCls = 'badge-high';
    if (m.triage_priority === 'RED_IMMEDIATE') triCls = 'badge-critical';
    else if (m.triage_priority === 'GREEN_MINOR') triCls = 'badge-progress';
    else if (m.triage_priority === 'BLACK_EXPECTANT') triCls = 'badge-low';

    return `
      <div class="incident-item">
        <div class="incident-top">
          <div class="incident-id">
            <span>Patient: <strong>${esc(m.patient_name)}</strong></span>
            <span class="badge ${triCls}">${esc(m.triage_priority)}</span>
            ${statusBadge(m.triage_status)}
          </div>
          <span style="font-size:12px;color:var(--text-muted)">${formatTime(m.created_at)}</span>
        </div>
        <div style="font-size:13px;margin:6px 0">
          <div><strong>Symptoms / Injury:</strong> ${esc(m.symptoms)}</div>
          ${m.vitals_summary ? `<div style="color:var(--blue);margin-top:3px">📊 Vitals: ${esc(m.vitals_summary)}</div>` : ''}
          ${m.resource_requests ? `<div style="color:var(--amber);margin-top:3px">📦 Supply Requests: ${esc(m.resource_requests)}</div>` : ''}
        </div>
        <div class="incident-actions">
          <button class="btn btn-dark btn-sm" onclick="updateMedicalTriage(${m.id}, 'TREATMENT')">Initiate Treatment</button>
          <button class="btn btn-green btn-sm" onclick="updateMedicalTriage(${m.id}, 'STABILIZED')">Mark Stabilized</button>
          <button class="btn btn-outline btn-sm" onclick="updateMedicalTriage(${m.id}, 'RESOLVED')">Discharge</button>
        </div>
      </div>
    `;
  }).join('');
}

// Timeline View (Step 20)
async function renderTimeline() {
  const container = $('timelineFeed');
  if (!container) return;
  try {
    const list = await api('/api/timeline');
    container.innerHTML = list.map(item => `
      <div style="border-left:3px solid var(--border-light);padding-left:14px;margin-bottom:14px;position:relative">
        <div style="position:absolute;left:-7px;top:0;width:11px;height:11px;border-radius:50%;background:var(--blue)"></div>
        <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-muted);margin-bottom:2px">
          <strong>${esc(item.title)}</strong>
          <span>${formatTime(item.time)}</span>
        </div>
        <div style="font-size:13px;color:#e2e8f0">${esc(item.detail)}</div>
      </div>
    `).join('') || '<p class="panel-sub">No operational milestones yet.</p>';
  } catch (err) {
    console.warn('Timeline error:', err);
  }
}

// Audit Logs View (Step 21)
function renderAuditLogs() {
  const container = $('auditFeed');
  if (!container) return;
  container.innerHTML = state.audit.slice(0, 30).map(a => `
    <div style="border-left:2px solid #334155;padding-left:10px;margin-bottom:8px">
      <div style="font-size:12px;font-weight:700;color:#fff">${esc(a.actor)}: <span style="color:var(--amber)">${esc(a.action)}</span> [${esc(a.target)}]</div>
      ${a.detail ? `<div style="font-size:11px;color:var(--text-muted)">${esc(a.detail)}</div>` : ''}
      <div style="font-size:10px;color:var(--text-dim)">${formatTime(a.created_at)}</div>
    </div>
  `).join('') || '<span class="panel-sub">No audit events logged.</span>';
}

// =========================================================================
// ACTION HANDLERS
// =========================================================================

// Submit SOS (Step 6)
async function submitSOS() {
  const name = $('sosName').value.trim();
  const emergency = $('sosEmergency').value.trim();
  const people = $('sosPeople').value;
  const location = $('sosLocation').value.trim();
  const priority = $('sosPriority').value;
  const type = $('sosType').value;

  if (!name || !emergency || !location) {
    alert('Please enter your Name, Emergency description, and Location.');
    return;
  }

  try {
    const s = await api('/api/sos', {
      method: 'POST',
      body: JSON.stringify({
        name,
        emergency,
        emergency_type: type,
        people,
        location,
        priority
      })
    });

    // Reset inputs
    $('sosName').value = '';
    $('sosEmergency').value = '';
    $('sosLocation').value = '';

    // Show generated QR card immediately
    viewQrModal(s.rescue_id || s.id);
  } catch (err) {
    alert('SOS submission error: ' + err.message);
  }
}

// Assign SOS
async function assignSos(id) {
  const sel = $(`selVol_${id}`);
  if (!sel || !sel.value) return;
  try {
    await api(`/api/sos/${id}/assign`, {
      method: 'POST',
      body: JSON.stringify({ volunteer: sel.value })
    });
  } catch (err) {
    alert('Assignment error: ' + err.message);
  }
}

// Update SOS Status
async function updateSosStatus(id, status, notes = '', resolution = '') {
  try {
    await api(`/api/sos/${id}/status`, {
      method: 'POST',
      body: JSON.stringify({ status, notes, resolution })
    });
  } catch (err) {
    alert('Status update error: ' + err.message);
  }
}

function promptResolveSos(id) {
  const resolution = prompt('Enter rescue completion summary / outcome:');
  if (resolution !== null) {
    updateSosStatus(id, 'RESOLVED', '', resolution);
  }
}

function promptAddNotes(id) {
  const notes = prompt('Enter field rescue observations / notes:');
  if (notes !== null) {
    updateSosStatus(id, 'IN_PROGRESS', notes);
  }
}

// QR Code View & Print Modal (Step 15)
async function viewQrModal(identifier) {
  try {
    const d = await api(`/api/qr/${encodeURIComponent(identifier)}`);
    $('modalQrTitle').textContent = `Rescue ID Card: ${d.rescueId}`;
    $('modalQrImage').src = d.data;
    $('printRescueId').textContent = d.rescueId;
    $('printRequesterName').textContent = d.record.name;
    $('printStatus').textContent = d.record.status;
    $('printCategory').textContent = d.record.emergencyCategory;
    $('printLocation').textContent = d.record.location;
    $('printTimestamp').textContent = new Date().toLocaleString();
    $('modalQrOverlay').classList.remove('hidden');
  } catch (err) {
    alert('Error resolving Rescue ID: ' + err.message);
  }
}

function searchQrId() {
  const val = $('inputQrSearch').value.trim();
  if (!val) return alert('Enter a Rescue ID (e.g., RSC-A8F29C1B)');
  viewQrModal(val);
}

function printRescueCard() {
  window.print();
}

function closeModal(id) {
  $(id).classList.add('hidden');
}

// Broadcast Announcement (Step 16)
async function submitAnnouncement() {
  const title = $('annTitle').value.trim();
  const message = $('annMessage').value.trim();
  const priority = $('annPriority').value;

  if (!title || !message) {
    alert('Please enter an Announcement Title and Emergency Message');
    return;
  }

  try {
    await api('/api/announcements', {
      method: 'POST',
      body: JSON.stringify({ title, message, priority })
    });
    $('annTitle').value = '';
    $('annMessage').value = '';
    alert('Emergency announcement broadcast successfully.');
  } catch (err) {
    alert('Broadcast error: ' + err.message);
  }
}

// Shelter Actions
async function shelterCheckin(id, count = 1) {
  try {
    await api(`/api/shelters/${id}/checkin`, { method: 'POST', body: JSON.stringify({ count }) });
  } catch (err) {
    alert('Check-in error: ' + err.message);
  }
}

async function shelterCheckout(id, count = 1) {
  try {
    await api(`/api/shelters/${id}/checkout`, { method: 'POST', body: JSON.stringify({ count }) });
  } catch (err) {
    alert('Check-out error: ' + err.message);
  }
}

function openShelterModal(id) {
  const s = state.shelters.find(x => x.id === id);
  if (!s) return;
  const newWater = prompt(`Update Water Stock for ${s.name} (Liters):`, s.water || s.water_liters);
  if (newWater !== null) {
    api(`/api/shelters/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ water: Number(newWater) })
    }).catch(err => alert(err.message));
  }
}

// Resource Stock Transaction Modal
function openResourceTxModal(id, name) {
  const type = prompt(`Record Transaction for "${name}":\nEnter INCOMING, OUTGOING, or TRANSFER:`, 'INCOMING');
  if (!type) return;
  const qty = prompt('Enter quantity:');
  if (!qty) return;
  const notes = prompt('Enter notes / source or destination:');

  api(`/api/resources/${id}/transaction`, {
    method: 'POST',
    body: JSON.stringify({
      type: type.toUpperCase(),
      quantity: Number(qty),
      notes: notes || '',
      source_or_destination: 'Field Operation'
    })
  }).catch(err => alert('Transaction failed: ' + err.message));
}

// Incidents & Missing Persons Status Updates
async function updateIncidentStatus(id, status) {
  try {
    await api(`/api/incidents/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
  } catch (err) {
    alert(err.message);
  }
}

async function submitIncident() {
  const title = $('incTitle').value.trim();
  const type = $('incType').value;
  const severity = $('incSeverity').value;
  const location = $('incLocation').value.trim();
  const description = $('incDescription').value.trim();

  if (!title || !location || !description) return alert('Fill in all required fields');

  try {
    await api('/api/incidents', {
      method: 'POST',
      body: JSON.stringify({ title, incident_type: type, severity, location, description })
    });
    $('incTitle').value = '';
    $('incLocation').value = '';
    $('incDescription').value = '';
    alert('Hazard incident reported.');
  } catch (err) {
    alert(err.message);
  }
}

async function updateMissingStatus(id, status) {
  const notes = prompt(`Update status to ${status}. Enter location/notes:`, '');
  try {
    await api(`/api/missing/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status, notes })
    });
  } catch (err) {
    alert(err.message);
  }
}

async function submitMissingPerson() {
  const full_name = $('mpName').value.trim();
  const age = $('mpAge').value;
  const gender = $('mpGender').value;
  const last_seen_location = $('mpLocation').value.trim();
  const identifying_features = $('mpFeatures').value.trim();
  const contact_info = $('mpContact').value.trim();

  if (!full_name || !last_seen_location) return alert('Name and Last Seen Location required');

  try {
    await api('/api/missing', {
      method: 'POST',
      body: JSON.stringify({ full_name, age, gender, last_seen_location, identifying_features, contact_info })
    });
    $('mpName').value = '';
    $('mpLocation').value = '';
    $('mpFeatures').value = '';
    $('mpContact').value = '';
    alert('Missing person registered into search registry.');
  } catch (err) {
    alert(err.message);
  }
}

// Medical Triage Update & Intake
async function updateMedicalTriage(id, status) {
  try {
    await api(`/api/medical/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ triage_status: status })
    });
  } catch (err) {
    alert(err.message);
  }
}

async function submitMedicalIntake() {
  const patient_name = $('medPatient').value.trim();
  const triage_priority = $('medPriority').value;
  const symptoms = $('medSymptoms').value.trim();
  const vitals_summary = $('medVitals').value.trim();
  const resource_requests = $('medSupplies').value.trim();

  if (!patient_name || !symptoms) return alert('Patient name and clinical symptoms required');

  try {
    await api('/api/medical', {
      method: 'POST',
      body: JSON.stringify({ patient_name, triage_priority, symptoms, vitals_summary, resource_requests })
    });
    $('medPatient').value = '';
    $('medSymptoms').value = '';
    $('medVitals').value = '';
    $('medSupplies').value = '';
    alert('Medical triage intake recorded.');
  } catch (err) {
    alert(err.message);
  }
}

function searchMissing(query) {
  const q = (query || '').toLowerCase().trim();
  const container = $('missingPersonsGrid');
  if (!container) return;

  const filtered = state.missing_persons.filter(m =>
    !q ||
    (m.full_name && m.full_name.toLowerCase().includes(q)) ||
    (m.last_seen_location && m.last_seen_location.toLowerCase().includes(q)) ||
    (m.identifying_features && m.identifying_features.toLowerCase().includes(q)) ||
    (m.tracking_code && m.tracking_code.toLowerCase().includes(q))
  );

  container.innerHTML = filtered.map(m => `
    <div class="panel" style="margin-bottom:0">
      <div class="panel-header">
        <div>
          <h3 style="font-size:16px;color:#fff">${esc(m.full_name)}</h3>
          <span style="font-family:monospace;font-size:12px;color:var(--blue)">${esc(m.tracking_code)}</span>
        </div>
        ${statusBadge(m.status)}
      </div>
      <div style="font-size:13px;color:#cbd5e1;margin-bottom:10px">
        <div><strong>Age:</strong> ${m.age || 'Unknown'} · <strong>Gender:</strong> ${esc(m.gender)}</div>
        <div><strong>Last Seen:</strong> ${esc(m.last_seen_location)} (${esc(m.last_seen_time)})</div>
        ${m.identifying_features ? `<div><strong>Features:</strong> ${esc(m.identifying_features)}</div>` : ''}
        ${m.notes ? `<div style="color:var(--text-dim);margin-top:4px">Notes: ${esc(m.notes)}</div>` : ''}
      </div>
      <div class="incident-actions">
        ${m.status === 'MISSING' ? `<button class="btn btn-green btn-sm" onclick="updateMissingStatus(${m.id}, 'FOUND')">Mark Located</button>` : ''}
        ${m.status === 'FOUND' ? `<button class="btn btn-blue btn-sm" onclick="updateMissingStatus(${m.id}, 'REUNITED')">Mark Reunited</button>` : ''}
      </div>
    </div>
  `).join('') || '<p class="panel-sub">No matching records found.</p>';
}

// Chat Engine (Step 17)
function selectChatChannel(channel) {
  currentChatChannel = channel;
  document.querySelectorAll('.chat-channel-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.channel === channel);
  });
  $('chatChannelHeader').textContent = `#${channel} Channel`;
  loadChatMessages(channel);
}

async function loadChatMessages(channel) {
  const box = $('chatMessagesFeed');
  if (!box) return;
  try {
    const msgs = await api(`/api/chat/${channel}`);
    box.innerHTML = msgs.map(m => {
      const isMine = currentUser && m.sender_id === currentUser.id;
      return `
        <div class="chat-msg ${isMine ? 'mine' : ''}">
          <div class="chat-msg-header">
            <strong>${esc(m.sender_name)}</strong>
            <span>(${esc(m.sender_role)})</span>
            <span>· ${formatTime(m.created_at)}</span>
          </div>
          <div class="chat-msg-text">${esc(m.message)}</div>
        </div>
      `;
    }).join('') || '<p class="panel-sub">No messages in this channel yet.</p>';
    box.scrollTop = box.scrollHeight;
  } catch (err) {
    console.warn('Chat load error:', err);
  }
}

function appendChatMessage(m) {
  const box = $('chatMessagesFeed');
  if (!box) return;
  const isMine = currentUser && m.sender_id === currentUser.id;
  const div = document.createElement('div');
  div.className = `chat-msg ${isMine ? 'mine' : ''}`;
  div.innerHTML = `
    <div class="chat-msg-header">
      <strong>${esc(m.sender_name)}</strong>
      <span>(${esc(m.sender_role)})</span>
      <span>· ${formatTime(m.created_at)}</span>
    </div>
    <div class="chat-msg-text">${esc(m.message)}</div>
  `;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

async function sendChatMessage() {
  const input = $('chatInput');
  const text = input.value.trim();
  if (!text) return;

  try {
    await api(`/api/chat/${currentChatChannel}`, {
      method: 'POST',
      body: JSON.stringify({ message: text })
    });
    input.value = '';
  } catch (err) {
    alert('Message failed: ' + err.message);
  }
}

// Disaster Simulation Controls (Step 19)
async function startSimulation(scenario) {
  try {
    await api('/api/simulation/start', {
      method: 'POST',
      body: JSON.stringify({ scenario, speedMs: 7000 })
    });
    loadState();
  } catch (err) {
    alert(err.message);
  }
}

async function pauseSimulation() {
  try {
    await api('/api/simulation/pause', { method: 'POST' });
    loadState();
  } catch (err) {
    alert(err.message);
  }
}

async function resumeSimulation() {
  try {
    await api('/api/simulation/resume', { method: 'POST' });
    loadState();
  } catch (err) {
    alert(err.message);
  }
}

async function resetSimulation() {
  try {
    await api('/api/simulation/reset', { method: 'POST' });
    loadState();
  } catch (err) {
    alert(err.message);
  }
}

async function resetDemoData() {
  if (!confirm('Reset entire system database back to standard competition demo dataset?')) return;
  try {
    await api('/api/demo/reset', { method: 'POST' });
    await loadState();
    alert('System successfully reset to clean demo dataset.');
  } catch (err) {
    alert(err.message);
  }
}

// Multi-Station USB Sync (Step 27)
async function exportDisasterPackage() {
  try {
    const pkg = await api('/api/sync/export');
    const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `RescueOS-DisasterPackage-${pkg.stationId}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    alert('Export failed: ' + err.message);
  }
}

async function importDisasterPackage(input) {
  const file = input.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async e => {
    try {
      const json = JSON.parse(e.target.result);
      const res = await api('/api/sync/import', {
        method: 'POST',
        body: JSON.stringify(json)
      });
      alert(`Package merged! Station: ${res.stationId}\nImported: ${res.imported.sos} SOS, ${res.imported.incidents} Incidents`);
      loadState();
    } catch (err) {
      alert('Import failed: ' + err.message);
    }
  };
  reader.readAsText(file);
}

// =========================================================================
// AUTHENTICATION MODAL & DEMO ROLE SWITCHER
// =========================================================================
function openLoginModal() {
  $('loginModalOverlay').classList.remove('hidden');
}

async function submitLogin() {
  const u = $('loginUsername').value.trim();
  const p = $('loginPassword').value.trim();
  if (!u || !p) return alert('Enter username and password');

  try {
    const res = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: u, password: p })
    });
    localStorage.setItem('rescueos_token', res.token);
    currentUser = res.user;
    updateAuthUI();
    closeModal('loginModalOverlay');
    alert(`Logged in as ${currentUser.username} (${currentUser.role})`);
    loadState();
  } catch (err) {
    alert('Login failed: ' + err.message);
  }
}

async function quickRoleLogin(username) {
  $('loginUsername').value = username;
  $('loginPassword').value = 'rescueos2026';
  await submitLogin();
}

async function logout() {
  try {
    await api('/api/auth/logout', { method: 'POST' });
  } catch (e) {
    console.warn(e);
  }
  currentUser = null;
  localStorage.removeItem('rescueos_token');
  updateAuthUI();
  alert('Logged out.');
  loadState();
}

// DOM Ready Hook
window.addEventListener('DOMContentLoaded', () => {
  initApp();
});
