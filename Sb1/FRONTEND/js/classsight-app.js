/* =========================================================================
   ClassSight — application logic for INDEX.HTML
   -------------------------------------------------------------------------
   Sections:
     1. Config & behaviour labels
     2. Utilities (escaping, toasts, sound)
     3. State + saving (backend API when available, else localStorage)
     4. Navigation
     5. Subjects & dashboard
     6. Live vision: tracking, explainable classifier, drawing
     7. Attendance capture
     8. Verification queue, roster, admin mode
     9. Export (CSV / JSON) and analytics charts
    10. Start-up
   ========================================================================= */

// ==================== 1. CONFIG & BEHAVIOUR LABELS ====================

/** All classifier thresholds in one place, so they are easy to explain and tune. */
const CONFIG = {
  calibrationMs: 2000,         // look at the screen this long to set the "neutral" head pose
  labelHoldMs: 600,            // a new label must persist this long before it is shown (debounce)
  yawAwayThreshold: 0.25,      // |yaw - baseline| above this = head turned sideways
  lookAwayMs: 2000,            // ...for this long = "looking away"
  pitchDownThreshold: 0.06,    // pitch - baseline above this = head tilted down
  gazeDownThreshold: 0.5,      // eyeLookDown blendshape above this = eyes looking down
  eyesClosedThreshold: 0.55,   // eyeBlink blendshape above this = eyes closed (head level)
  eyesClosedDownThreshold: 0.8,// stricter when looking down (eyelids lower naturally)
  drowsyMs: 1500,              // eyes closed this long = drowsy (normal blinks are ~0.2 s)
  balancedHeadDownMs: 8000,    // balanced mode: head down longer than this without a writing hand = distracted
  attentionWindowMs: 60000,    // attention index = share of attentive samples in this window
  attentionSampleMs: 500,
  hudUpdateMs: 250,            // DOM updates are throttled; drawing still runs every frame
  overrideMs: 5000,            // demo override duration
  trackLostMs: 1000,           // drop a face track not seen for this long
};

const BEHAVIORS = {
  attentive:    { label: '👀 Attentive - Facing Board',        attentive: true,  color: '#3b82f6' },
  notes:        { label: '✍️ Attentive - Writing / Reading',   attentive: true,  color: '#22c55e' },
  hand_raised:  { label: '🙋 Attentive - Hand Raised',         attentive: true,  color: '#6366f1' },
  looking_away: { label: '↩️ Distracted - Looking Away',       attentive: false, color: '#ec4899' },
  head_down:    { label: '⬇️ Distracted - Head Down Too Long', attentive: false, color: '#f97316' },
  phone:        { label: '📱 Distracted - Smartphone',          attentive: false, color: '#f43f5e' },
  drowsy:       { label: '😴 Distracted - Drowsy / Eyes Closed', attentive: false, color: '#f59e0b' },
};

// ==================== 2. UTILITIES ====================

const $ = id => document.getElementById(id);

/** Escape user-entered text before putting it into innerHTML (prevents HTML injection). */
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let audioCtx = null;
function playBeep(freq = 600, duration = 0.15) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
  } catch (e) { /* audio not available before a user gesture */ }
}

function showToast(message, type = 'info') {
  const colors = {
    success: 'bg-emerald-950 border-emerald-500 text-emerald-200',
    error: 'bg-rose-950 border-rose-500 text-rose-200',
    warning: 'bg-amber-950 border-amber-500 text-amber-200',
    info: 'bg-slate-900 border-indigo-500 text-slate-200',
  };
  const toast = document.createElement('div');
  toast.className = `p-3 rounded-xl border ${colors[type] || colors.info} text-xs font-semibold shadow-2xl flex items-center space-x-2 transition-opacity duration-300 pointer-events-auto`;
  toast.innerHTML = `<i class="fa-solid fa-bell"></i> <span>${esc(message)}</span>`;
  $('toast-container').appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 3500);
}

function downloadFile(filename, content, mime) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ==================== 3. STATE & PERSISTENCE ====================

const STORAGE_KEY = 'classsight-state-v1';
const avatar = id => `https://images.unsplash.com/photo-${id}?q=80&w=200&auto=format&fit=crop`;

function defaultData() {
  const today = new Date();
  const daysAgo = n => new Date(today.getTime() - n * 86400000).toISOString();
  return {
    activeSubjectId: 'sub-1',
    webcamStudentId: 'std-1',
    subjects: [
      { id: 'sub-1', code: 'CS-302', name: 'Neural Networks & Deep Learning', room: 'Lab 402', schedule: 'Mon/Wed 10:00 AM' },
      { id: 'sub-2', code: 'CS-401', name: 'Computer Vision & Optics', room: 'Hall B', schedule: 'Tue/Thu 02:00 PM' },
      { id: 'sub-3', code: 'EC-201', name: 'Digital Signal Processing', room: 'Room 105', schedule: 'Fri 09:00 AM' },
    ],
    students: [
      { id: 'std-1', subjectId: 'sub-1', name: 'Ananya Sharma', roll: 'CS2026-014', status: 'Present', attendanceRate: 94, avatar: avatar('1534528741775-53994a69daeb') },
      { id: 'std-2', subjectId: 'sub-1', name: 'Rohan Mehta', roll: 'CS2026-019', status: 'Present', attendanceRate: 88, avatar: avatar('1507003211169-0a1dd7228f2d') },
      { id: 'std-3', subjectId: 'sub-1', name: 'Priya Nair', roll: 'CS2026-022', status: 'Present', attendanceRate: 96, avatar: avatar('1494790108377-be9c29b29330') },
      { id: 'std-4', subjectId: 'sub-1', name: 'Aarav Patel', roll: 'CS2026-005', status: 'Present', attendanceRate: 90, avatar: avatar('1500648767791-00dcc994a43e') },
      { id: 'std-5', subjectId: 'sub-1', name: 'Siddharth Das', roll: 'CS2026-031', status: 'Flagged', attendanceRate: 68, avatar: avatar('1522075469751-3a6694fb2f61') },
      { id: 'std-6', subjectId: 'sub-1', name: 'Kavya Iyer', roll: 'CS2026-027', status: 'Flagged', attendanceRate: 72, avatar: avatar('1517841905240-472988babdf9') },
      { id: 'std-7', subjectId: 'sub-1', name: 'Neha Gupta', roll: 'CS2026-011', status: 'Absent', attendanceRate: 60, avatar: avatar('1544005313-94ddf0286df2') },
      { id: 'std-8', subjectId: 'sub-1', name: 'Aditya Rao', roll: 'CS2026-003', status: 'Absent', attendanceRate: 55, avatar: avatar('1506794778202-cad84cf45f1d') },
    ],
    flaggedQueue: [
      { id: 1, subjectId: 'sub-1', studentId: 'std-5', score: 64, reason: 'Partial face occlusion' },
      { id: 2, subjectId: 'sub-1', studentId: 'std-6', score: 61, reason: 'Low classroom lighting' },
    ],
    sessions: [
      { id: 's-1', subjectId: 'sub-1', time: daysAgo(2), present: 7, total: 8, faces: 7, attention: 89, source: 'sample' },
      { id: 's-2', subjectId: 'sub-1', time: daysAgo(1), present: 6, total: 8, faces: 6, attention: 84, source: 'sample' },
    ],
    // Seconds spent in each behaviour, per subject: { 'sub-1': { attentive: 12.5, ... } }
    behaviorSeconds: {},
  };
}

/** Runtime-only values (never saved). */
const Runtime = {
  tempAccessEnabled: false,
  cameraMode: 'single_webcam_user',
  lookingDownMode: 'notes',
  webcamStream: null,
  webcamActive: false,
  engineMode: 'off',        // off | loading | live | simulated
  rafId: null,
  targetFps: 30,
  lastInferenceAt: 0,
  fpsFrames: 0,
  fpsSince: 0,
  fps: 0,
  lastHudUpdate: 0,
  lastSampleAt: 0,
  lastStatsAt: 0,
  attentionSamples: [],     // [{t, attentive}]
  tracks: [],
  nextTrackId: 1,
  lastResult: null,
  calibration: null,        // { yaw, pitch }
  calibrationSamples: [],
  calibrationStart: 0,
  override: null,           // { key, until }
  simInterval: null,
  simBehavior: 'attentive',
};

const AppStore = Object.assign(defaultData(), loadState());

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

let saveTimer = null;
function saveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const { activeSubjectId, webcamStudentId, subjects, students, flaggedQueue, sessions, behaviorSeconds } = AppStore;
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ activeSubjectId, webcamStudentId, subjects, students, flaggedQueue, sessions, behaviorSeconds }));
    } catch (e) { /* storage unavailable (private window) - app still works in memory */ }
  }, 200);
}

/**
 * Backend connection. When the page is served by the Python backend
 * (Sb1/backend, `python run.py`), every change is also saved to its SQLite
 * database. Opened any other way, the app keeps working with localStorage only.
 */
const Api = {
  enabled: false,

  async request(method, path, body) {
    const res = await fetch(path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      let detail = res.statusText;
      try { detail = (await res.json()).detail || detail; } catch (e) { /* not JSON */ }
      throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
    }
    return res.status === 204 ? null : res.json();
  },

  /** Save a change in the background; the UI has already been updated locally. */
  send(method, path, body) {
    if (!this.enabled) return;
    this.request(method, path, body).catch(err => {
      console.error(`${method} ${path} failed:`, err);
      showToast(`Not saved to database: ${err.message}`, 'error');
    });
  },

  async connect() {
    if (location.protocol === 'file:') return false;
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 2500);
      const res = await fetch('/api/state', { signal: ctl.signal });
      clearTimeout(timer);
      if (!res.ok) return false;
      applyServerState(await res.json());
      this.enabled = true;
      return true;
    } catch (e) {
      return false;
    }
  },
};

function applyServerState(state) {
  const { subjects, students, flaggedQueue, sessions, behaviorSeconds } = state;
  Object.assign(AppStore, { subjects, students, flaggedQueue, sessions, behaviorSeconds });
}

function showStorageMode() {
  $('storage-mode-title').textContent = Api.enabled ? 'Saved to database' : 'Saved in this browser';
  $('storage-mode-text').textContent = Api.enabled
    ? 'Connected to the ClassSight backend: every change is stored in its SQLite database. API docs at /docs.'
    : 'Backend not running, so data is kept in this browser (localStorage). Start it with "python run.py" in Sb1/backend.';
}

async function resetDemoData() {
  if (!confirm('Reset all subjects, students, sessions and statistics to the demo data?')) return;
  if (Api.enabled) {
    try {
      applyServerState(await Api.request('POST', '/api/reset'));
    } catch (err) {
      return showToast(`Reset failed: ${err.message}`, 'error');
    }
  } else {
    Object.assign(AppStore, defaultData());
  }
  try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
  renderAll();
  showToast('Demo data restored', 'info');
}

const getActiveSubject = () => AppStore.subjects.find(s => s.id === AppStore.activeSubjectId) || AppStore.subjects[0];
const subjectStudents = (subId = AppStore.activeSubjectId) => AppStore.students.filter(s => s.subjectId === subId);
const getStudent = id => AppStore.students.find(s => s.id === id);

function getWebcamStudent() {
  const list = subjectStudents();
  return list.find(s => s.id === AppStore.webcamStudentId) || list[0] || null;
}

// ==================== 4. NAVIGATION ====================

const TABS = ['dashboard', 'scanner', 'subjects', 'verification', 'roster', 'analytics'];

function switchTab(tabId) {
  if (!TABS.includes(tabId)) tabId = 'dashboard';
  TABS.forEach(t => {
    $('tab-' + t).classList.toggle('hidden', t !== tabId);
    $('nav-' + t).classList.toggle('active', t === tabId);
  });
  if (location.hash.slice(1) !== tabId) history.replaceState(null, '', '#' + tabId);

  if (tabId === 'analytics') renderAnalyticsCharts();
  else if (tabId === 'verification') renderFlaggedQueue();
  else if (tabId === 'roster') renderRosterGrid();
  else if (tabId === 'subjects') renderSubjectCardsGrid();
}

const SIDEBAR_KEY = 'classsight-sidebar-collapsed';

function setSidebarCollapsed(collapsed) {
  $('sidebar').classList.toggle('collapsed', collapsed);
  const btn = $('sidebar-toggle');
  btn.title = collapsed ? 'Expand menu' : 'Collapse menu';
  btn.setAttribute('aria-expanded', String(!collapsed));
  try { localStorage.setItem(SIDEBAR_KEY, collapsed ? '1' : '0'); } catch (e) { /* ignore */ }
}

function toggleSidebar() {
  setSidebarCollapsed(!$('sidebar').classList.contains('collapsed'));
  // Charts need to resize to the new width.
  if (!$('tab-analytics').classList.contains('hidden')) setTimeout(renderAnalyticsCharts, 250);
}

function renderAll() {
  if (!getActiveSubject()) AppStore.activeSubjectId = AppStore.subjects[0].id;
  renderSubjectDropdown();
  renderWebcamStudentSelect();
  updateDashboard();
  renderSubjectSessionTable();
  renderSubjectCardsGrid();
  renderFlaggedQueue();
  renderRosterGrid();
}

// ==================== 5. SUBJECTS & DASHBOARD ====================

function renderSubjectDropdown() {
  $('subject-dropdown').innerHTML = AppStore.subjects.map(sub =>
    `<option value="${esc(sub.id)}" ${sub.id === AppStore.activeSubjectId ? 'selected' : ''}>${esc(sub.code)} - ${esc(sub.name)}</option>`
  ).join('');
}

function renderWebcamStudentSelect() {
  const current = getWebcamStudent();
  const list = subjectStudents();
  $('webcam-student').innerHTML = list.length
    ? list.map(s => `<option value="${esc(s.id)}" ${current && s.id === current.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')
    : '<option value="">No students enrolled</option>';
  AppStore.webcamStudentId = current ? current.id : null;
}

function changeActiveSubject(subId) {
  AppStore.activeSubjectId = subId;
  saveState();
  renderAll();
  if (!$('tab-analytics').classList.contains('hidden')) renderAnalyticsCharts();
  showToast(`Active subject: ${getActiveSubject().code}`, 'info');
}

function updateDashboard() {
  const sub = getActiveSubject();
  const students = subjectStudents();
  const count = status => students.filter(s => s.status === status).length;
  const total = students.length;
  const present = count('Present');
  const rate = total ? (present / total * 100).toFixed(1) : '0.0';

  $('banner-subject-code').textContent = sub.code;
  $('banner-subject-title').textContent = sub.name;
  $('banner-subject-desc').textContent = `Schedule: ${sub.schedule || 'TBA'} • Room: ${sub.room || 'TBA'}`;

  $('sidebar-subject-code').textContent = sub.code;
  $('sidebar-subject-name').textContent = sub.name;
  $('sidebar-subject-room').textContent = sub.room;
  $('sidebar-subject-students').textContent = `${total} Students`;

  $('stat-present').textContent = present;
  $('stat-total-label').textContent = `/ ${total}`;
  $('stat-rate-text').textContent = `${rate}% Attendance Rate`;
  $('stat-flagged').textContent = AppStore.flaggedQueue.filter(f => f.subjectId === sub.id).length;
  $('stat-absent').textContent = count('Absent');

  const sessions = AppStore.sessions.filter(s => s.subjectId === sub.id);
  const latest = sessions[sessions.length - 1];
  $('stat-attention-score').textContent = latest ? `${latest.attention}%` : '—';
  $('stat-attention-source').textContent = latest
    ? `Latest session (${latest.source === 'live' ? 'live AI' : latest.source})`
    : 'No sessions recorded yet';

  $('hud-subject-badge').textContent = sub.code;
  $('badge-subject-count').textContent = AppStore.subjects.length;
  $('badge-flagged-count').textContent = AppStore.flaggedQueue.filter(f => f.subjectId === sub.id).length;
}

function renderSubjectSessionTable() {
  const sub = getActiveSubject();
  const sessions = AppStore.sessions.filter(s => s.subjectId === sub.id).slice().reverse();
  const sourceBadge = {
    live: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    simulated: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    sample: 'bg-slate-500/20 text-slate-300 border-slate-500/30',
  };
  $('subject-session-table').innerHTML = sessions.length ? sessions.map(s => `
    <tr class="hover:bg-slate-800/50 transition">
      <td class="p-3 font-medium text-slate-100">${new Date(s.time).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</td>
      <td class="p-3 font-mono text-indigo-300">${esc(sub.code)} (${esc(sub.room)})</td>
      <td class="p-3">${s.present} / ${s.total}</td>
      <td class="p-3">${s.faces}</td>
      <td class="p-3 text-purple-400 font-bold">${s.attention}%</td>
      <td class="p-3"><span class="${sourceBadge[s.source] || sourceBadge.sample} text-[10px] px-2 py-0.5 rounded border font-bold uppercase">${esc(s.source)}</span></td>
    </tr>`).join('')
    : `<tr><td colspan="6" class="p-6 text-center text-slate-400">No sessions yet for ${esc(sub.code)}. Use "Mark Attendance" on the webcam page.</td></tr>`;
}

function renderSubjectCardsGrid() {
  $('subject-cards-grid').innerHTML = AppStore.subjects.map(sub => {
    const isActive = sub.id === AppStore.activeSubjectId;
    return `
      <div class="p-5 rounded-2xl border ${isActive ? 'bg-indigo-950/40 border-indigo-500 shadow-indigo-500/10 shadow-xl' : 'bg-slate-950 border-slate-800'} space-y-4 transition">
        <div class="flex items-center justify-between">
          <span class="px-2.5 py-1 bg-indigo-500/20 text-indigo-300 text-xs font-mono font-bold rounded-lg border border-indigo-500/30">${esc(sub.code)}</span>
          ${isActive ? '<span class="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-bold">Active</span>' : ''}
        </div>
        <div>
          <h3 class="text-sm font-bold text-white">${esc(sub.name)}</h3>
          <p class="text-xs text-slate-400 mt-1"><i class="fa-solid fa-location-dot mr-1"></i>${esc(sub.room)} • ${esc(sub.schedule)}</p>
        </div>
        <div class="flex items-center justify-between pt-2 border-t border-slate-800 text-xs text-slate-400">
          <span>Enrolled: <strong class="text-white">${subjectStudents(sub.id).length}</strong></span>
          <div class="flex items-center gap-2">
            ${!isActive ? `<button onclick="changeActiveSubject('${esc(sub.id)}')" class="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-lg text-xs transition">Select</button>` : ''}
            ${AppStore.subjects.length > 1 ? `<button onclick="removeSubject('${esc(sub.id)}')" aria-label="Remove ${esc(sub.code)}" class="text-slate-500 hover:text-rose-400 text-xs transition"><i class="fa-solid fa-trash"></i></button>` : ''}
          </div>
        </div>
      </div>`;
  }).join('');
}

function openAddSubjectModal() { $('modal-subject').classList.remove('hidden'); $('inp-subject-code').focus(); }
function closeSubjectModal() { $('modal-subject').classList.add('hidden'); }

function handleSaveSubject(e) {
  e.preventDefault();
  const code = $('inp-subject-code').value.trim();
  if (AppStore.subjects.some(s => s.code.toLowerCase() === code.toLowerCase())) {
    showToast(`Subject ${code} already exists`, 'warning');
    return;
  }
  const newSub = {
    id: 'sub-' + Date.now(),
    code,
    name: $('inp-subject-name').value.trim(),
    room: $('inp-subject-room').value.trim() || 'TBA',
    schedule: $('inp-subject-schedule').value.trim() || 'TBA',
  };
  AppStore.subjects.push(newSub);
  AppStore.activeSubjectId = newSub.id;
  saveState();
  Api.send('POST', '/api/subjects', newSub);
  closeSubjectModal();
  e.target.reset();
  renderAll();
  showToast(`Subject ${code} created & activated`, 'success');
}

function removeSubject(subId) {
  if (AppStore.subjects.length <= 1) return showToast('Cannot delete the only subject', 'warning');
  const sub = AppStore.subjects.find(s => s.id === subId);
  if (!confirm(`Remove ${sub.code} and its students, sessions and flagged cases?`)) return;
  // Remove everything that belongs to the subject so no orphan records remain.
  AppStore.subjects = AppStore.subjects.filter(s => s.id !== subId);
  AppStore.students = AppStore.students.filter(s => s.subjectId !== subId);
  AppStore.flaggedQueue = AppStore.flaggedQueue.filter(f => f.subjectId !== subId);
  AppStore.sessions = AppStore.sessions.filter(s => s.subjectId !== subId);
  delete AppStore.behaviorSeconds[subId];
  if (AppStore.activeSubjectId === subId) AppStore.activeSubjectId = AppStore.subjects[0].id;
  saveState();
  Api.send('DELETE', `/api/subjects/${encodeURIComponent(subId)}`);
  renderAll();
  showToast(`Removed ${sub.code}`, 'info');
}

// ==================== 6. LIVE VISION ====================

function toggleCameraTargetMode(mode) {
  Runtime.cameraMode = mode;
  $('distraction-alert-banner').classList.add('hidden');
  showToast(mode === 'single_webcam_user' ? 'Live webcam mode (real AI detection)' : 'Classroom simulation mode (demo data)', 'info');
}

function updateLookingDownContext(mode) {
  Runtime.lookingDownMode = mode;
  const msg = { notes: 'Looking down = attentive (notes/reading)', balanced: 'Looking down = attentive only with a writing hand or for < 8 s', strict: 'Looking down = distracted' };
  showToast(msg[mode], mode === 'strict' ? 'warning' : 'info');
}

function setPhoneThreshold(value) {
  $('thresh-val').textContent = value + '%';
  if (window.VisionEngine) VisionEngine.setPhoneThreshold(value / 100);
}

function setTargetFps(value) {
  Runtime.targetFps = Number(value);
  $('fps-val').textContent = value + ' FPS';
}

function setEngineStatus(mode) {
  Runtime.engineMode = mode;
  const map = {
    off:       ['STANDBY', 'bg-slate-700/40 text-slate-300 border-slate-600', 'AI engine: idle'],
    loading:   ['LOADING MODELS…', 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30', 'AI engine: loading'],
    live:      ['LIVE AI DETECTION', 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30', 'AI engine: live'],
    simulated: ['SIMULATED (models offline)', 'bg-amber-500/20 text-amber-300 border-amber-500/30', 'AI engine: simulated'],
  };
  const [text, cls, header] = map[mode];
  const badge = $('auto-ai-status-badge');
  badge.textContent = text;
  badge.className = `px-2 py-0.5 rounded-full text-[10px] border font-mono ${cls}`;
  $('engine-status-text').textContent = header;
  $('hud-status').textContent = { off: 'Standby', loading: 'Loading…', live: 'AI Active', simulated: 'Simulated' }[mode];

  const live = mode === 'live' || mode === 'simulated';
  $('badge-live').textContent = live ? 'LIVE' : 'OFF';
  $('badge-live').className = live
    ? 'nav-badge bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
    : 'nav-badge bg-slate-700/40 text-slate-400 border-slate-600';
  $('live-dot').className = `w-3 h-3 rounded-full ${live ? 'bg-emerald-500 animate-pulse' : 'bg-slate-600'}`;
}

async function startWebcam() {
  if (Runtime.webcamActive) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return showToast('Camera API unavailable. Open the page via http://localhost or https://', 'error');
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } });
    Runtime.webcamStream = stream;
    Runtime.webcamActive = true;

    const video = $('webcam-stream');
    video.srcObject = stream;
    video.classList.remove('hidden');
    $('webcam-placeholder').classList.add('hidden');
    $('scanner-line').classList.remove('hidden');
    $('btn-start-webcam').classList.add('hidden');
    $('btn-stop-webcam').classList.remove('hidden');
    playBeep(900, 0.2);

    // Start drawing immediately; the AI joins once the models are downloaded.
    Runtime.tracks = [];
    Runtime.attentionSamples = [];
    Runtime.fpsSince = performance.now();
    Runtime.rafId = requestAnimationFrame(renderVisionLoop);

    setEngineStatus('loading');
    const ok = window.VisionEngine ? await VisionEngine.load() : false;
    if (!Runtime.webcamActive) return; // camera was stopped while loading
    if (ok) {
      setEngineStatus('live');
      recalibrate();
      showToast('AI models loaded — look at the screen for 2 s to calibrate', 'success');
    } else {
      startSimulatedClassifier();
      showToast('Could not download the AI models (offline?). Running a labelled simulation instead.', 'warning');
    }
  } catch (err) {
    console.error('Webcam error:', err);
    showToast('Unable to access camera. Please grant camera permission.', 'error');
  }
}

function stopWebcam() {
  if (Runtime.webcamStream) Runtime.webcamStream.getTracks().forEach(t => t.stop());
  Runtime.webcamStream = null;
  Runtime.webcamActive = false;
  cancelAnimationFrame(Runtime.rafId);
  clearInterval(Runtime.simInterval);
  Runtime.simInterval = null;
  Runtime.tracks = [];
  Runtime.lastResult = null;

  const canvas = $('vision-canvas');
  canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  $('webcam-stream').classList.add('hidden');
  $('webcam-placeholder').classList.remove('hidden');
  $('scanner-line').classList.add('hidden');
  $('btn-start-webcam').classList.remove('hidden');
  $('btn-stop-webcam').classList.add('hidden');
  $('distraction-alert-banner').classList.add('hidden');
  $('hud-fps').textContent = '0 FPS';
  $('explain-panel').innerHTML = '<dt class="text-slate-500">Status</dt><dd>Camera off</dd>';
  setEngineStatus('off');
  saveState();
  syncBehaviorTotals();
  showToast('Camera stopped', 'info');
}

function recalibrate() {
  if (Runtime.engineMode !== 'live') return showToast('Start the webcam (with AI models loaded) first', 'warning');
  Runtime.calibration = null;
  Runtime.calibrationSamples = [];
  Runtime.calibrationStart = performance.now();
  appendLogStream('🎯 Calibrating neutral head pose — look at the screen');
}

/** Fallback used only when the models cannot load: picks plausible labels at random and says so. */
function startSimulatedClassifier() {
  setEngineStatus('simulated');
  clearInterval(Runtime.simInterval);
  const pool = { notes: ['notes', 'attentive', 'hand_raised', 'phone'], balanced: ['notes', 'attentive', 'looking_away', 'head_down'], strict: ['phone', 'drowsy', 'notes'] };
  Runtime.simInterval = setInterval(() => {
    const keys = pool[Runtime.lookingDownMode];
    Runtime.simBehavior = keys[Math.floor(Math.random() * keys.length)];
  }, 3500);
}

function triggerActionDemo(actionType) {
  if (!Runtime.webcamActive) return showToast("Click 'Start Webcam' first", 'warning');
  const map = { hand_raised: 'hand_raised', writing: 'notes', attentive: 'attentive', drowsy: 'drowsy', phone: 'phone' };
  Runtime.override = { key: map[actionType], until: performance.now() + CONFIG.overrideMs };
  appendLogStream(`[Manual override] ${BEHAVIORS[map[actionType]].label}`);
  playBeep(750, 0.1);
}

// ---- Tracking: keep identity of each face between frames (nearest centre) ----
function updateTracks(faces, now) {
  const unmatched = new Set(Runtime.tracks);
  for (const face of faces) {
    let best = null, bestDist = Math.max(face.box.w, 80);
    for (const t of unmatched) {
      const d = Math.hypot(t.center.x - face.center.x, t.center.y - face.center.y);
      if (d < bestDist) { best = t; bestDist = d; }
    }
    if (!best) {
      best = { id: Runtime.nextTrackId++, stableKey: null, candidateKey: null, candidateSince: now, eyesClosedSince: null, awaySince: null, downSince: null };
      Runtime.tracks.push(best);
    }
    unmatched.delete(best);
    best.center = face.center;
    best.face = face;
    best.lastSeen = now;
  }
  Runtime.tracks = Runtime.tracks.filter(t => now - t.lastSeen < CONFIG.trackLostMs);
  Runtime.tracks.sort((a, b) => a.id - b.id);
  return Runtime.tracks.filter(t => t.lastSeen === now);
}

// ---- Explainable rule-based classifier ----
function classifyFace(track, ctx, now) {
  const f = track.face;
  const base = Runtime.calibration || { yaw: 0, pitch: f.pitch };
  const yawDelta = f.yaw - base.yaw;
  const pitchDelta = f.pitch - base.pitch;
  const lookingDown = pitchDelta > CONFIG.pitchDownThreshold || f.gazeDown > CONFIG.gazeDownThreshold;
  const turnedAway = Math.abs(yawDelta) > CONFIG.yawAwayThreshold;
  const eyesClosed = f.eyeClosure > (lookingDown ? CONFIG.eyesClosedDownThreshold : CONFIG.eyesClosedThreshold);

  // Hands and phones are assigned to the closest face.
  const nearest = pt => ctx.faces.reduce((a, b) =>
    Math.abs(a.center.x - pt.x) <= Math.abs(b.center.x - pt.x) ? a : b);
  const myHands = ctx.hands.filter(h => nearest(h) === f);
  const handRaised = myHands.some(h => h.topY < f.foreheadY);
  const writingHand = myHands.some(h => h.y > f.chinY);
  const myPhones = ctx.phones.filter(p => nearest({ x: p.box.x + p.box.w / 2 }) === f);
  const phoneScore = myPhones.reduce((m, p) => Math.max(m, p.score), 0);

  // Timers for conditions that only count when they persist.
  track.eyesClosedSince = eyesClosed ? (track.eyesClosedSince ?? now) : null;
  track.awaySince = turnedAway ? (track.awaySince ?? now) : null;
  track.downSince = lookingDown ? (track.downSince ?? now) : null;
  const held = since => since === null ? 0 : now - since;

  let key, reason;
  if (phoneScore > 0) {
    key = 'phone'; reason = `phone detected (${Math.round(phoneScore * 100)}%)`;
  } else if (held(track.eyesClosedSince) >= CONFIG.drowsyMs) {
    key = 'drowsy'; reason = `eyes closed ${(held(track.eyesClosedSince) / 1000).toFixed(1)} s`;
  } else if (handRaised) {
    key = 'hand_raised'; reason = 'hand above forehead';
  } else if (held(track.awaySince) >= CONFIG.lookAwayMs) {
    key = 'looking_away'; reason = `head turned ${(held(track.awaySince) / 1000).toFixed(1)} s`;
  } else if (lookingDown) {
    const downMs = held(track.downSince);
    if (Runtime.lookingDownMode === 'strict') {
      key = 'head_down'; reason = 'looking down (strict policy)';
    } else if (Runtime.lookingDownMode === 'balanced' && !writingHand && downMs > CONFIG.balancedHeadDownMs) {
      key = 'head_down'; reason = `head down ${(downMs / 1000).toFixed(0)} s, no writing hand`;
    } else {
      key = 'notes'; reason = writingHand ? 'looking down, hand on desk' : 'looking down (notes policy)';
    }
  } else {
    key = 'attentive'; reason = 'facing forward';
  }

  // Debounce: only switch the displayed label after it has held for labelHoldMs.
  if (key !== track.candidateKey) { track.candidateKey = key; track.candidateSince = now; }
  if (track.stableKey === null || now - track.candidateSince >= CONFIG.labelHoldMs) track.stableKey = key;
  track.reason = reason;
  track.features = { yawDelta, pitchDelta, eyeClosure: f.eyeClosure, gazeDown: f.gazeDown, phoneScore, handRaised, writingHand };
  return track.stableKey;
}

function onLabelChange(track, prevKey, name) {
  const b = BEHAVIORS[track.stableKey];
  const sub = getActiveSubject();
  appendLogStream(`${b.attentive ? '✅' : '⚠️'} [${sub.code}] ${name}: ${b.label} — ${track.reason || 'manual'}`);
  Api.send('POST', '/api/events', {
    subjectId: sub.id, studentName: name.slice(0, 60), behavior: track.stableKey, attentive: b.attentive,
    reason: (track.reason || 'manual').slice(0, 120), source: track.reason === 'manual override' ? 'manual' : 'live',
  });
  if (!b.attentive && prevKey !== null) playBeep(400, 0.2);
}

function trackName(index) {
  if (index === 0) {
    const s = getWebcamStudent();
    return s ? s.name : 'Face 1';
  }
  return `Face ${index + 1}`;
}

// ---- Main render loop (one call per animation frame) ----
function renderVisionLoop(now) {
  if (!Runtime.webcamActive) return;
  Runtime.rafId = requestAnimationFrame(renderVisionLoop);

  const video = $('webcam-stream');
  const canvas = $('vision-canvas');
  if (video.readyState < 2) return;

  // Canvas uses the video's real resolution; CSS object-fit keeps both aligned.
  if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
  }
  const ctx = canvas.getContext('2d');

  // Respect the FPS cap: skip inference (and redraw) on extra frames.
  if (now - Runtime.lastInferenceAt < 1000 / Runtime.targetFps) return;
  const dt = Runtime.lastInferenceAt ? Math.min(now - Runtime.lastInferenceAt, 1000) : 0;
  Runtime.lastInferenceAt = now;
  Runtime.fpsFrames++;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const override = Runtime.override && now < Runtime.override.until ? Runtime.override.key : null;
  let shown = []; // [{ key, name }] for stats/HUD

  if (Runtime.cameraMode === 'multi_student_sim') {
    shown = drawSimulatedClassroom(ctx, canvas);
  } else if (Runtime.engineMode === 'live') {
    const result = VisionEngine.detect(video, now);
    Runtime.lastResult = result;
    if (result) {
      collectCalibration(result, now);
      const tracks = updateTracks(result.faces, now);
      tracks.forEach((t, i) => {
        const prev = t.stableKey;
        classifyFace(t, result, now);
        if (i === 0 && override) { t.stableKey = override; t.reason = 'manual override'; }
        if (t.stableKey !== prev) onLabelChange(t, prev, trackName(i));
        drawFaceBox(ctx, t.face.box, trackName(i), t.stableKey, i === 0 && override);
        shown.push({ key: t.stableKey, name: trackName(i) });
      });
      result.phones.forEach(p => drawPhoneBox(ctx, p));
    }
  } else if (Runtime.engineMode === 'simulated') {
    const key = override || Runtime.simBehavior;
    const w = canvas.width * 0.36, h = canvas.height * 0.6;
    const box = { x: (canvas.width - w) / 2 + Math.sin(now / 800) * 15, y: (canvas.height - h) / 2, w, h };
    const name = trackName(0) + ' (simulated)';
    if (key !== Runtime.lastSimKey) { appendLogStream(`[Simulated] ${name}: ${BEHAVIORS[key].label}`); Runtime.lastSimKey = key; }
    drawFaceBox(ctx, box, name, key, true);
    shown.push({ key, name });
  }

  accumulateStats(shown, now, dt);
  if (now - Runtime.lastHudUpdate >= CONFIG.hudUpdateMs) {
    Runtime.lastHudUpdate = now;
    updateHud(shown, now);
  }
}

function collectCalibration(result, now) {
  if (Runtime.calibration || !Runtime.calibrationStart || !result.faces.length) return;
  Runtime.calibrationSamples.push({ yaw: result.faces[0].yaw, pitch: result.faces[0].pitch });
  if (now - Runtime.calibrationStart >= CONFIG.calibrationMs && Runtime.calibrationSamples.length >= 10) {
    const avg = k => Runtime.calibrationSamples.reduce((s, x) => s + x[k], 0) / Runtime.calibrationSamples.length;
    Runtime.calibration = { yaw: avg('yaw'), pitch: avg('pitch') };
    appendLogStream(`🎯 Calibrated: yaw ${Runtime.calibration.yaw.toFixed(3)}, pitch ${Runtime.calibration.pitch.toFixed(3)}`);
    showToast('Calibration complete', 'success');
  }
}

function accumulateStats(shown, now, dt) {
  // Time spent per behaviour (for the analytics doughnut), saved per subject.
  if (shown.length && dt) {
    const stats = AppStore.behaviorSeconds[AppStore.activeSubjectId] ||= {};
    shown.forEach(s => { stats[s.key] = (stats[s.key] || 0) + dt / 1000; });
  }
  // Rolling attention samples (for the attention index).
  if (now - Runtime.lastSampleAt >= CONFIG.attentionSampleMs) {
    Runtime.lastSampleAt = now;
    shown.forEach(s => Runtime.attentionSamples.push({ t: now, attentive: BEHAVIORS[s.key].attentive }));
    while (Runtime.attentionSamples.length && now - Runtime.attentionSamples[0].t > CONFIG.attentionWindowMs) Runtime.attentionSamples.shift();
  }
  if (now - Runtime.lastStatsAt > 5000) { Runtime.lastStatsAt = now; saveState(); syncBehaviorTotals(); }
}

function syncBehaviorTotals() {
  const subId = AppStore.activeSubjectId;
  const stats = AppStore.behaviorSeconds[subId];
  if (stats) Api.send('PUT', `/api/subjects/${encodeURIComponent(subId)}/behavior`, { seconds: stats });
}

function attentionIndex() {
  const s = Runtime.attentionSamples;
  return s.length ? Math.round(s.filter(x => x.attentive).length / s.length * 100) : null;
}

function updateHud(shown, now) {
  const elapsed = now - Runtime.fpsSince;
  if (elapsed >= 1000) {
    Runtime.fps = Runtime.fpsFrames * 1000 / elapsed;
    Runtime.fpsFrames = 0;
    Runtime.fpsSince = now;
    $('hud-fps').textContent = `${Runtime.fps.toFixed(1)} FPS`;
  }

  $('hud-face-count').textContent = shown.length;
  const idx = attentionIndex();
  const att = $('hud-attention-val');
  att.textContent = idx === null ? '—' : `${idx}%`;
  att.className = idx === null ? 'text-purple-300' : idx >= 70 ? 'text-emerald-400 font-bold' : idx >= 40 ? 'text-amber-400 font-bold' : 'text-rose-400 font-bold';

  const ticker = $('live-action-ticker');
  const banner = $('distraction-alert-banner');
  if (!shown.length) {
    ticker.textContent = Runtime.engineMode === 'loading' ? 'Loading AI models…' : 'No face in frame';
    ticker.style.color = '';
    banner.classList.add('hidden');
  } else {
    const first = shown[0];
    ticker.textContent = shown.map(s => `${s.name}: ${BEHAVIORS[s.key].label}`).join('  |  ');
    ticker.style.color = BEHAVIORS[first.key].color;
    const distracted = shown.filter(s => !BEHAVIORS[s.key].attentive);
    banner.classList.toggle('hidden', !distracted.length);
    if (distracted.length) $('distraction-alert-text').textContent = distracted.map(s => `${s.name} — ${BEHAVIORS[s.key].label}`).join('; ');
  }

  renderExplainPanel();
}

function renderExplainPanel() {
  const panel = $('explain-panel');
  const row = (k, v) => `<dt class="text-slate-500">${k}</dt><dd>${v}</dd>`;
  if (Runtime.cameraMode === 'multi_student_sim') {
    panel.innerHTML = row('Mode', 'Classroom simulation — fixed demo data, no model output');
    return;
  }
  if (Runtime.engineMode !== 'live') {
    panel.innerHTML = row('Mode', Runtime.engineMode === 'simulated' ? 'Simulation (models unavailable)' : 'Loading models…');
    return;
  }
  const t = Runtime.tracks.find(x => x.lastSeen === Runtime.lastInferenceAt);
  if (!t || !t.features) {
    panel.innerHTML = row('Face', 'none detected') + row('Calibrated', Runtime.calibration ? 'yes' : 'waiting for a face');
    return;
  }
  const f = t.features;
  const flag = (cond, text) => cond ? `<span class="text-amber-300">${text}</span>` : text;
  panel.innerHTML =
    row('Label', `<span style="color:${BEHAVIORS[t.stableKey].color}">${BEHAVIORS[t.stableKey].label}</span>`) +
    row('Reason', esc(t.reason)) +
    row('Head yaw Δ', flag(Math.abs(f.yawDelta) > CONFIG.yawAwayThreshold, `${f.yawDelta.toFixed(3)} (limit ±${CONFIG.yawAwayThreshold})`)) +
    row('Head pitch Δ', flag(f.pitchDelta > CONFIG.pitchDownThreshold, `${f.pitchDelta.toFixed(3)} (down > ${CONFIG.pitchDownThreshold})`)) +
    row('Gaze down', flag(f.gazeDown > CONFIG.gazeDownThreshold, f.gazeDown.toFixed(2))) +
    row('Eye closure', flag(f.eyeClosure > CONFIG.eyesClosedThreshold, f.eyeClosure.toFixed(2))) +
    row('Phone score', flag(f.phoneScore > 0, f.phoneScore ? f.phoneScore.toFixed(2) : '—')) +
    row('Hand', f.handRaised ? 'raised' : f.writingHand ? 'on desk' : '—') +
    row('Calibrated', Runtime.calibration ? 'yes' : 'in progress…');
}

// ---- Drawing helpers ----
function drawFaceBox(ctx, box, name, key, manual) {
  const b = BEHAVIORS[key];
  const fs = Math.max(12, Math.round(ctx.canvas.width / 70));
  ctx.strokeStyle = b.color;
  ctx.lineWidth = 3;
  ctx.shadowColor = b.color;
  ctx.shadowBlur = 12;
  ctx.strokeRect(box.x, box.y, box.w, box.h);
  ctx.shadowBlur = 0;

  const tagH = fs + 12;
  const label = `${name}${manual ? ' · manual' : ''}`;
  ctx.font = `bold ${fs}px sans-serif`;
  const tagW = Math.max(box.w, ctx.measureText(label).width + 16);
  ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
  ctx.fillRect(box.x, box.y - tagH - 4, tagW, tagH);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(label, box.x + 8, box.y - 10);

  ctx.font = `bold ${fs - 1}px monospace`;
  const actW = Math.max(box.w, ctx.measureText(b.label).width + 16);
  ctx.fillStyle = b.color;
  ctx.fillRect(box.x, box.y + box.h + 4, actW, tagH);
  ctx.fillStyle = '#0f172a';
  ctx.fillText(b.label, box.x + 8, box.y + box.h + tagH - 2);
}

function drawPhoneBox(ctx, p) {
  ctx.setLineDash([8, 6]);
  ctx.strokeStyle = '#f43f5e';
  ctx.lineWidth = 2;
  ctx.strokeRect(p.box.x, p.box.y, p.box.w, p.box.h);
  ctx.setLineDash([]);
  ctx.fillStyle = '#f43f5e';
  ctx.font = 'bold 13px monospace';
  ctx.fillText(`phone ${Math.round(p.score * 100)}%`, p.box.x + 4, p.box.y - 6);
}

const SIM_TRACKERS = [
  { x: 0.08, studentIdx: 0, key: 'hand_raised' },
  { x: 0.39, studentIdx: 1, key: 'phone' },
  { x: 0.70, studentIdx: 4, key: 'drowsy' },
];

function drawSimulatedClassroom(ctx, canvas) {
  const list = subjectStudents();
  return SIM_TRACKERS.map((t, i) => {
    const s = list[t.studentIdx] || list[i];
    const name = s ? s.name : `Student ${i + 1}`;
    const box = { x: t.x * canvas.width, y: 0.25 * canvas.height, w: 0.22 * canvas.width, h: 0.4 * canvas.height };
    drawFaceBox(ctx, box, name + ' (sim)', t.key, false);
    return { key: t.key, name };
  });
}

function appendLogStream(text) {
  const stream = $('action-log-stream');
  if (stream.firstElementChild && stream.firstElementChild.classList.contains('italic')) stream.innerHTML = '';
  const div = document.createElement('div');
  div.className = 'flex items-start space-x-2 text-slate-300 border-b border-slate-800/60 pb-1';
  div.innerHTML = `<span class="text-indigo-400 font-bold whitespace-nowrap">[${new Date().toLocaleTimeString()}]</span> <span>${esc(text)}</span>`;
  stream.prepend(div);
  while (stream.children.length > 200) stream.lastElementChild.remove(); // keep the DOM small
}

// ==================== 7. ATTENDANCE CAPTURE ====================

function captureAndMarkAttendance() {
  const sub = getActiveSubject();
  const students = subjectStudents();
  if (!Runtime.webcamActive) return showToast('Start the webcam first', 'warning');

  let faces, source;
  const markedIds = [];
  if (Runtime.cameraMode === 'multi_student_sim') {
    faces = SIM_TRACKERS.length;
    source = 'simulated';
    SIM_TRACKERS.forEach((t, i) => { const s = students[t.studentIdx] || students[i]; if (s) { s.status = 'Present'; markedIds.push(s.id); } });
  } else if (Runtime.engineMode === 'live') {
    faces = Runtime.tracks.filter(t => t.lastSeen === Runtime.lastInferenceAt).length;
    source = 'live';
    if (!faces) return showToast('No face detected — attendance not marked', 'warning');
    const s = getWebcamStudent();
    if (s) { s.status = 'Present'; markedIds.push(s.id); }
  } else {
    return showToast('AI models are not running; cannot verify a face', 'warning');
  }

  const present = students.filter(s => s.status === 'Present').length;
  const att = attentionIndex();
  const session = {
    id: 's-' + Date.now(), subjectId: sub.id, time: new Date().toISOString(),
    present, total: students.length, faces, attention: att === null ? 0 : att, source,
  };
  AppStore.sessions.push(session);
  saveState();
  Api.send('POST', '/api/sessions', { ...session, presentStudentIds: markedIds });
  updateDashboard();
  renderSubjectSessionTable();
  renderRosterGrid();
  playBeep(1100, 0.25);
  appendLogStream(`📸 Attendance saved for ${sub.code}: ${present}/${students.length} present, ${faces} face(s) in frame`);
  showToast(`Attendance saved for ${sub.code}`, 'success');
}

// ==================== 8. VERIFICATION, ROSTER, ADMIN MODE ====================

function renderFlaggedQueue() {
  const container = $('flagged-cards-container');
  const sub = getActiveSubject();
  const items = AppStore.flaggedQueue.filter(f => f.subjectId === sub.id);
  $('badge-flagged-count').textContent = items.length;

  if (!items.length) {
    container.innerHTML = `
      <div class="bg-slate-950 p-8 rounded-2xl border border-slate-800 text-center space-y-2">
        <i class="fa-solid fa-circle-check text-3xl text-emerald-400"></i>
        <h4 class="text-sm font-bold text-white">No Flagged Cases Pending</h4>
        <p class="text-xs text-slate-400">All matches for ${esc(sub.code)} are resolved.</p>
      </div>`;
    return;
  }

  container.innerHTML = items.map(item => {
    const s = getStudent(item.studentId) || { name: 'Unknown', roll: '—', avatar: '' };
    const person = (title, border) => `
      <div class="bg-slate-900 p-3 rounded-xl border border-slate-800 flex items-center space-x-3">
        <img src="${esc(s.avatar)}" alt="" loading="lazy" class="w-16 h-16 rounded-lg object-cover border-2 ${border}">
        <div class="text-xs space-y-1">
          <p class="text-slate-400 font-bold uppercase">${title}</p>
          <p class="font-bold text-white">${esc(s.name)}</p>
          <p class="text-slate-400 font-mono">Roll: ${esc(s.roll)}</p>
        </div>
      </div>`;
    return `
      <div class="bg-slate-950 p-5 rounded-2xl border border-amber-500/30 space-y-4 shadow-lg">
        <div class="flex items-center justify-between">
          <span class="text-xs font-semibold bg-amber-500/20 text-amber-400 px-3 py-1 rounded-full border border-amber-500/30">
            <i class="fa-solid fa-triangle-exclamation mr-1"></i> Confidence: ${item.score}% (${esc(item.reason)})
          </span>
          <span class="text-xs text-slate-400 font-mono">${esc(sub.code)}</span>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
          ${person('Webcam Capture', 'border-amber-500')}
          ${person('Enrolled Profile', 'border-emerald-500')}
        </div>
        <div class="flex items-center justify-end space-x-3 pt-2 border-t border-slate-800">
          <button onclick="resolveFlag(${item.id}, false)" class="text-xs bg-slate-800 hover:bg-rose-900/40 text-rose-400 px-4 py-2 rounded-xl border border-slate-700 transition">Reject / Mark Absent</button>
          <button onclick="resolveFlag(${item.id}, true)" class="text-xs bg-emerald-600 hover:bg-emerald-500 text-white font-semibold px-5 py-2 rounded-xl shadow-lg shadow-emerald-600/30 transition">Confirm & Mark Present</button>
        </div>
      </div>`;
  }).join('');
}

function resolveFlag(flagId, approved) {
  const flag = AppStore.flaggedQueue.find(f => f.id === flagId);
  if (!flag) return;
  AppStore.flaggedQueue = AppStore.flaggedQueue.filter(f => f.id !== flagId);
  const student = getStudent(flag.studentId);
  if (student) student.status = approved ? 'Present' : 'Absent';
  saveState();
  Api.send('POST', `/api/flags/${flagId}/resolve`, { approved });
  renderFlaggedQueue();
  updateDashboard();
  renderRosterGrid();
  const name = student ? student.name : 'student';
  showToast(approved ? `Match confirmed for ${name}` : `Marked ${name} as Absent`, approved ? 'success' : 'info');
}

function batchApproveAllFlags() {
  const subId = AppStore.activeSubjectId;
  AppStore.flaggedQueue.filter(f => f.subjectId === subId).forEach(f => {
    const s = getStudent(f.studentId);
    if (s) s.status = 'Present';
  });
  AppStore.flaggedQueue = AppStore.flaggedQueue.filter(f => f.subjectId !== subId);
  saveState();
  Api.send('POST', `/api/subjects/${encodeURIComponent(subId)}/flags/approve-all`);
  renderFlaggedQueue();
  updateDashboard();
  renderRosterGrid();
  showToast(`All flagged cases for ${getActiveSubject().code} approved`, 'success');
}

function renderRosterGrid() {
  const grid = $('roster-grid');
  const query = $('roster-search').value.trim().toLowerCase();
  const sub = getActiveSubject();
  const students = subjectStudents().filter(s => s.name.toLowerCase().includes(query) || s.roll.toLowerCase().includes(query));

  if (!students.length) {
    grid.innerHTML = `<div class="col-span-full text-center py-8 text-slate-400 text-xs">No students in ${esc(sub.code)}${query ? ` matching "${esc(query)}"` : ''}.</div>`;
    return;
  }
  const badge = {
    Present: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    Flagged: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    Absent: 'bg-rose-500/20 text-rose-400 border-rose-500/30',
  };
  grid.innerHTML = students.map(s => `
    <div class="bg-slate-950 p-4 rounded-2xl border border-slate-800 shadow-lg flex items-center justify-between">
      <div class="flex items-center space-x-3 min-w-0">
        <img src="${esc(s.avatar)}" alt="" loading="lazy" class="w-12 h-12 rounded-xl object-cover border border-slate-700 flex-shrink-0">
        <div class="min-w-0">
          <h4 class="text-xs font-bold text-white truncate">${esc(s.name)}</h4>
          <p class="text-[11px] text-indigo-400 font-mono">${esc(s.roll)}</p>
          <p class="text-[10px] text-slate-400">Attendance: ${s.attendanceRate}%</p>
        </div>
      </div>
      <div class="flex flex-col items-end space-y-2">
        <span class="text-[10px] font-bold px-2 py-0.5 rounded-full border ${badge[s.status] || badge.Absent}">${esc(s.status)}</span>
        ${Runtime.tempAccessEnabled ? `<button onclick="removeStudent('${esc(s.id)}')" aria-label="Remove ${esc(s.name)}" class="text-xs text-slate-500 hover:text-rose-400 transition"><i class="fa-solid fa-trash"></i></button>` : ''}
      </div>
    </div>`).join('');
}

function openAddStudentModal() {
  $('inp-student-subject').innerHTML = AppStore.subjects.map(sub =>
    `<option value="${esc(sub.id)}" ${sub.id === AppStore.activeSubjectId ? 'selected' : ''}>${esc(sub.code)} — ${esc(sub.name)}</option>`).join('');
  $('modal-student').classList.remove('hidden');
  $('inp-student-name').focus();
}
function closeAddStudentModal() { $('modal-student').classList.add('hidden'); }

function handleSaveStudent(e) {
  e.preventDefault();
  const name = $('inp-student-name').value.trim();
  const roll = $('inp-student-roll').value.trim();
  const subjectId = $('inp-student-subject').value;
  if (AppStore.students.some(s => s.subjectId === subjectId && s.roll.toLowerCase() === roll.toLowerCase())) {
    return showToast(`Roll number ${roll} is already enrolled in this subject`, 'warning');
  }
  const student = {
    id: 'std-' + Date.now(), subjectId, name, roll,
    status: 'Absent', attendanceRate: 0,
    avatar: $('inp-student-avatar').value.trim() || `https://ui-avatars.com/api/?background=4f46e5&color=fff&name=${encodeURIComponent(name)}`,
  };
  AppStore.students.push(student);
  saveState();
  Api.send('POST', '/api/students', student);
  closeAddStudentModal();
  e.target.reset();
  renderAll();
  const sub = AppStore.subjects.find(s => s.id === subjectId);
  showToast(`Enrolled ${name} in ${sub.code}`, 'success');
}

function removeStudent(stdId) {
  const s = getStudent(stdId);
  if (!s || !confirm(`Remove ${s.name} from the directory?`)) return;
  AppStore.students = AppStore.students.filter(x => x.id !== stdId);
  AppStore.flaggedQueue = AppStore.flaggedQueue.filter(f => f.studentId !== stdId);
  saveState();
  Api.send('DELETE', `/api/students/${encodeURIComponent(stdId)}`);
  renderAll();
  showToast(`${s.name} removed`, 'info');
}

function toggleTempAccess() {
  Runtime.tempAccessEnabled = !Runtime.tempAccessEnabled;
  const on = Runtime.tempAccessEnabled;
  $('btn-temp-access').className = on
    ? 'text-xs bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 px-3 py-1.5 rounded-lg border border-emerald-500/40 transition flex items-center space-x-1.5 font-medium'
    : 'text-xs bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 px-3 py-1.5 rounded-lg border border-amber-500/40 transition flex items-center space-x-1.5 font-medium';
  $('temp-access-text').textContent = on ? 'Admin Mode On' : 'Enable Admin Mode';
  ['unlocked-model-tuning', 'btn-batch-approve', 'btn-add-student'].forEach(id => $(id).classList.toggle('hidden', !on));
  renderRosterGrid();
  showToast(on ? 'Admin mode enabled' : 'Standard mode restored', on ? 'success' : 'info');
}

// ==================== 9. EXPORT & ANALYTICS ====================

function exportPayload() {
  const sub = getActiveSubject();
  const students = subjectStudents();
  return {
    exportTimestamp: new Date().toISOString(),
    subject: sub,
    attendanceSummary: {
      totalRegistered: students.length,
      present: students.filter(s => s.status === 'Present').length,
      flagged: students.filter(s => s.status === 'Flagged').length,
      absent: students.filter(s => s.status === 'Absent').length,
    },
    roster: students.map(s => ({ roll: s.roll, name: s.name, status: s.status, attendanceRate: s.attendanceRate })),
    sessions: AppStore.sessions.filter(s => s.subjectId === sub.id),
    behaviorSeconds: AppStore.behaviorSeconds[sub.id] || {},
  };
}

function exportJSON() {
  const sub = getActiveSubject();
  downloadFile(`ClassSight_${sub.code}_${Date.now()}.json`, JSON.stringify(exportPayload(), null, 2), 'application/json');
  showToast(`Exported JSON for ${sub.code}`, 'success');
}

function exportCSV() {
  const sub = getActiveSubject();
  const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['Roll', 'Name', 'Subject', 'Status', 'Attendance %'].map(cell).join(',')];
  subjectStudents().forEach(s => lines.push([s.roll, s.name, sub.code, s.status, s.attendanceRate].map(cell).join(',')));
  // ﻿ makes Excel read the file as UTF-8.
  downloadFile(`ClassSight_${sub.code}_${Date.now()}.csv`, '﻿' + lines.join('\r\n'), 'text/csv;charset=utf-8');
  showToast(`Exported CSV for ${sub.code}`, 'success');
}

let trendChart = null;
let actionChart = null;

function renderAnalyticsCharts() {
  if (typeof Chart === 'undefined') {
    $('analytics-source-note').textContent = 'Chart.js could not be loaded (offline?).';
    return;
  }
  const sub = getActiveSubject();
  const sessions = AppStore.sessions.filter(s => s.subjectId === sub.id).slice(-10);
  const stats = AppStore.behaviorSeconds[sub.id] || {};
  const statKeys = Object.keys(BEHAVIORS).filter(k => stats[k] > 0);
  const hasLive = statKeys.length > 0;

  Chart.defaults.color = '#94a3b8';
  Chart.defaults.borderColor = 'rgba(255,255,255,0.06)';

  if (trendChart) trendChart.destroy();
  trendChart = new Chart($('chart-attendance-trend'), {
    type: 'line',
    data: {
      labels: sessions.map(s => new Date(s.time).toLocaleDateString([], { month: 'short', day: 'numeric' })),
      datasets: [
        { label: 'Attendance %', data: sessions.map(s => s.total ? Math.round(s.present / s.total * 100) : 0), borderColor: '#6366f1', backgroundColor: 'rgba(99,102,241,0.12)', fill: true, tension: 0.35 },
        { label: 'Attentiveness %', data: sessions.map(s => s.attention), borderColor: '#a855f7', borderDash: [5, 4], tension: 0.35 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom' } },
      scales: { y: { min: 0, max: 100 } },
    },
  });

  if (actionChart) actionChart.destroy();
  const keys = hasLive ? statKeys : ['attentive', 'notes', 'hand_raised', 'phone'];
  actionChart = new Chart($('chart-action-dist'), {
    type: 'doughnut',
    data: {
      labels: keys.map(k => BEHAVIORS[k].label),
      datasets: [{ data: hasLive ? keys.map(k => Math.round(stats[k])) : [55, 25, 12, 8], backgroundColor: keys.map(k => BEHAVIORS[k].color), borderWidth: 0 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom' },
        tooltip: { callbacks: { label: c => hasLive ? ` ${c.label}: ${c.raw} s` : ` ${c.label}: ${c.raw}%` } },
      },
    },
  });

  $('analytics-source-note').textContent = hasLive
    ? `${sub.code}: ${sessions.length} session(s); behaviour chart shows seconds detected by the live AI.`
    : `${sub.code}: ${sessions.length} session(s). Behaviour chart shows SAMPLE data until you run the live webcam for this subject.`;
}

// ==================== 10. START-UP ====================

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeSubjectModal(); closeAddStudentModal(); }
});
window.addEventListener('hashchange', () => switchTab(location.hash.slice(1)));
window.addEventListener('beforeunload', () => {
  if (Runtime.webcamStream) Runtime.webcamStream.getTracks().forEach(t => t.stop());
});

document.addEventListener('DOMContentLoaded', async () => {
  let collapsed = false;
  try { collapsed = localStorage.getItem(SIDEBAR_KEY) === '1'; } catch (e) { /* ignore */ }
  setSidebarCollapsed(collapsed);
  setEngineStatus('off');
  // Start downloading the AI models in the background so "Start Webcam" is fast.
  if (window.VisionEngine) VisionEngine.load();
  // Load data from the backend if it is running (falls back to localStorage).
  await Api.connect();
  showStorageMode();
  renderAll();
  switchTab(location.hash.slice(1) || 'dashboard');
});
