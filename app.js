/* ═══════════════════════════════════════
   DATA LAYER
═══════════════════════════════════════ */
const DB = {
  save(key, val) { localStorage.setItem(key, JSON.stringify(val)); },
  load(key, def) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : def; } catch { return def; } }
};

let profiles = DB.load('tl_profiles', []);
let currentProfileId = null;
let currentProfile = null;
let entries = [];

function getProfile(id) { return profiles.find(p => p.id === id); }

function loadProfile(id) {
  currentProfileId = id;
  currentProfile = getProfile(id);
  entries = DB.load('tl_entries_' + id, []);
}

function saveProfiles() { DB.save('tl_profiles', profiles); }
function saveEntries()  { DB.save('tl_entries_' + currentProfileId, entries); }

function createProfile(name, mode, color) {
  const p = {
    id: Date.now().toString(),
    name, mode, color,
    settings: {
      normalRate: 0, otRate: 0, holidayRate: 0, monthlyBase: 0,
      otThresholdHrs: 8,
      commutation: 0,
      // Insurance rates
      healthInsRate: 10.0,    // % total (employee pays half)
      nursingInsRate: 1.82,   // % total (employee pays half), age 40-64
      nursingInsEnabled: true // toggle for age 40-64
    },
    deductions: {}
  };
  profiles.push(p);
  saveProfiles();
  return p;
}

/* deductions for a month: stored on the profile object */
function getDeductions(yearMonth) {
  if (!currentProfile.deductions) currentProfile.deductions = {};
  return currentProfile.deductions[yearMonth] || {
    healthIns: 0, nursingIns: 0, pensionIns: 0,
    unemployment: 0, incomeTax: 0, inhabitantTax: 0,
    socialAdjust: 0, yearEndAdj: 0, otherDeduct: 0
  };
}
function saveDeductions(yearMonth, data) {
  if (!currentProfile.deductions) currentProfile.deductions = {};
  currentProfile.deductions[yearMonth] = data;
  saveProfiles();
}

function upsertEntry(dateStr, data) {
  const idx = entries.findIndex(e => e.date === dateStr);
  if (idx >= 0) entries[idx] = { ...entries[idx], ...data, date: dateStr };
  else entries.push({ date: dateStr, ...data });
  entries.sort((a, b) => b.date.localeCompare(a.date));
  saveEntries();
}

function deleteEntry(dateStr) {
  entries = entries.filter(e => e.date !== dateStr);
  saveEntries();
}

function getEntry(dateStr) { return entries.find(e => e.date === dateStr) || null; }

/* ═══════════════════════════════════════
   TIME / CALC HELPERS
═══════════════════════════════════════ */
function toMins(t) { const [h,m] = t.split(':').map(Number); return h*60+m; }
function fromMins(m) { return String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0'); }

function calcDay(entry, profile) {
  if (!entry) return null;
  const s = profile.settings;

  if (entry.isHoliday && (!entry.timeIn || !entry.timeOut)) {
    const netHrs = s.otThresholdHrs || 8;
    const holidayPay = netHrs * (s.holidayRate || 0);
    return { netHrs, regularHrs: netHrs, otHrs: 0, holidayHrs: netHrs, pay: holidayPay, otPay: 0, holidayPay, regularPay: 0 };
  }

  if (!entry.timeIn || !entry.timeOut) return null;
  const inM    = toMins(entry.timeIn);
  const outM   = toMins(entry.timeOut);
  const lunchM = entry.lunchMins || 60;
  const totalM = outM - inM - lunchM;
  if (totalM <= 0) return null;
  const netHrs = totalM / 60;

  if (entry.isHoliday) {
    if (profile.mode === 'monthly') {
      const thresh     = s.otThresholdHrs || 8;
      const otHrs      = Math.max(0, netHrs - thresh);
      const regularHrs = netHrs - otHrs;
      const holidayPay = netHrs * (s.holidayRate || 0);
      const otPay      = otHrs  * (s.otRate      || 0);
      return { netHrs, regularHrs, otHrs, holidayHrs: netHrs, pay: holidayPay + otPay, otPay, holidayPay, regularPay: 0 };
    } else {
      const pay = netHrs * (s.holidayRate || 0);
      return { netHrs, regularHrs: 0, otHrs: 0, holidayHrs: netHrs, pay, otPay: 0, holidayPay: pay, regularPay: 0 };
    }
  }

  if (profile.mode === 'monthly') {
    const thresh     = s.otThresholdHrs || 8;
    const otHrs      = Math.max(0, netHrs - thresh);
    const regularHrs = netHrs - otHrs;
    const otPay      = otHrs * (s.otRate || 0);
    return { netHrs, regularHrs, otHrs, holidayHrs: 0, pay: otPay, otPay, holidayPay: 0, regularPay: 0 };
  } else {
    const thresh     = s.otThresholdHrs || 8;
    const otHrs      = Math.max(0, netHrs - thresh);
    const regularHrs = netHrs - otHrs;
    const regularPay = regularHrs * (s.normalRate || 0);
    const otPay      = otHrs      * (s.otRate     || 0);
    return { netHrs, regularHrs, otHrs, holidayHrs: 0, pay: regularPay + otPay, otPay, holidayPay: 0, regularPay };
  }
}

function fmtHrs(h) {
  if (!h || h <= 0) return '0h';
  const hrs  = Math.floor(h);
  const mins = Math.round((h - hrs) * 60);
  return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
}

function fmtYen(n) {
  if (!n || isNaN(n)) return '¥0';
  return '¥' + Math.round(n).toLocaleString('ja-JP');
}

function todayStr() {
  const d = new Date();
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}

function fmtDate(str) {
  const [y,m,d] = str.split('-');
  return new Date(+y,+m-1,+d).toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});
}

function monthEntries(year, month) {
  const prefix = year+'-'+String(month+1).padStart(2,'0');
  return entries.filter(e => e.date.startsWith(prefix));
}

function yearMonthKey(year, month) {
  return year+'-'+String(month+1).padStart(2,'0');
}

/* ═══════════════════════════════════════
   INSURANCE AUTO-CALCULATION
   Standard Monthly Remuneration brackets (厚生年金・健康保険)
   Based on base salary only (commutation excluded per user's company)
═══════════════════════════════════════ */

// Pension brackets — capped at ¥650,000
const PENSION_BRACKETS = [
  88000,98000,104000,110000,118000,126000,134000,142000,
  150000,160000,170000,180000,190000,200000,220000,240000,
  260000,280000,300000,320000,340000,360000,380000,410000,
  440000,470000,500000,530000,560000,590000,620000,650000
];

// Health brackets go higher — capped at ¥1,390,000 (we use up to reasonable)
const HEALTH_BRACKETS = [
  ...PENSION_BRACKETS,
  710000,750000,790000,830000,880000,930000,980000,
  1040000,1090000,1150000,1210000,1270000,1330000,1390000
];

function getStandardRemuneration(baseSalary, brackets) {
  // Find the bracket that covers the salary
  for (let i = 0; i < brackets.length; i++) {
    const lower = i === 0 ? 0 : (brackets[i-1] + brackets[i]) / 2;
    const upper = i === brackets.length-1 ? Infinity : (brackets[i] + brackets[i+1]) / 2;
    if (baseSalary >= lower && baseSalary < upper) return brackets[i];
  }
  return brackets[brackets.length-1];
}

function calcInsurance(profile, grossTotal) {
  const s = profile.settings;
  const base = s.monthlyBase || 0;

  // Standard remuneration for pension (capped at 650,000)
  const pensionRemun  = getStandardRemuneration(base, PENSION_BRACKETS);
  // Standard remuneration for health (higher cap)
  const healthRemun   = getStandardRemuneration(base, HEALTH_BRACKETS);

  const pension     = Math.round(pensionRemun * 0.0915);           // 9.15% employee share
  const healthIns   = Math.round(healthRemun  * (s.healthInsRate || 10.0) / 100 / 2);
  const nursingIns  = s.nursingInsEnabled
    ? Math.round(healthRemun * (s.nursingInsRate || 1.82) / 100 / 2)
    : 0;
  const unemployment = Math.round(grossTotal * 0.0055);            // 0.55% on full gross

  return { pension, healthIns, nursingIns, unemployment };
}

/* ═══════════════════════════════════════
   THEME / APPEARANCE
═══════════════════════════════════════ */
var appTheme    = DB.load('tl_theme',    'light');
var appFontSize = DB.load('tl_fontsize', 'medium');
var appBtnStyle = DB.load('tl_btnstyle', 'modern');

function applyAppearance() {
  document.documentElement.setAttribute('data-theme',    appTheme);
  document.documentElement.setAttribute('data-fontsize', appFontSize);
  document.documentElement.setAttribute('data-btnstyle', appBtnStyle);
  document.getElementById('themeColorMeta').content = appTheme === 'dark' ? '#0f0f14' : '#f5f4f0';
}

/* ═══════════════════════════════════════
   NAVIGATION
═══════════════════════════════════════ */
let currentScreen = 'login';

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-'+id).classList.add('active');
  currentScreen = id;
}

const COLORS = ['#2563eb','#16a34a','#d97706','#dc2626','#7c3aed','#0891b2','#be185d','#059669'];

let calYear  = new Date().getFullYear();
let calMonth = new Date().getMonth();
let selectedDate = todayStr();

/* ═══════════════════════════════════════
   RENDER: LOGIN
═══════════════════════════════════════ */
function renderLogin() {
  const grid = document.getElementById('profilesGrid');
  grid.innerHTML = '';
  profiles.forEach(p => {
    const tile = document.createElement('div');
    tile.className = 'profile-tile';
    tile.innerHTML = `
      <div class="profile-avatar" style="background:${p.color}">${p.name.charAt(0).toUpperCase()}</div>
      <div class="profile-name">${p.name}</div>
      <div class="profile-mode-badge ${p.mode==='monthly'?'badge-monthly':'badge-hourly'}">
        ${p.mode==='monthly'?'📅 Monthly':'⏱ Hourly'}
      </div>`;
    tile.onclick = () => { loadProfile(p.id); showScreen('home'); renderHome(); };
    grid.appendChild(tile);
  });
  const addTile = document.createElement('div');
  addTile.className = 'add-profile-tile';
  addTile.innerHTML = `<div class="plus-icon">＋</div><span>New Profile</span>`;
  addTile.onclick = () => showScreen('onboard');
  grid.appendChild(addTile);
}

/* ═══════════════════════════════════════
   RENDER: ONBOARDING
═══════════════════════════════════════ */
let onboardMode  = 'monthly';
let onboardColor = COLORS[0];

function renderOnboard() {
  document.getElementById('onboardColorDots').innerHTML = COLORS.map(c =>
    `<div class="color-dot${c===onboardColor?' selected':''}" style="background:${c}" onclick="selectOnboardColor('${c}')"></div>`
  ).join('');
  document.querySelectorAll('.mode-card').forEach(c => {
    c.classList.toggle('selected', c.dataset.mode === onboardMode);
  });
}
function selectOnboardColor(c) { onboardColor = c; renderOnboard(); }
function submitOnboard() {
  const name = document.getElementById('onboardName').value.trim();
  if (!name) { alert('Please enter your name.'); return; }
  const p = createProfile(name, onboardMode, onboardColor);
  loadProfile(p.id);
  showScreen('home');
  renderHome();
}

/* ═══════════════════════════════════════
   RENDER: HOME
═══════════════════════════════════════ */
function renderHome() {
  document.getElementById('homeProfileName').textContent = currentProfile.name;
  document.getElementById('homeProfileInitial').textContent = currentProfile.name.charAt(0).toUpperCase();
  document.getElementById('homeProfileInitial').style.background = currentProfile.color;
  document.getElementById('homeModeBadge').textContent = currentProfile.mode==='monthly' ? '📅 Monthly' : '⏱ Hourly';

  const calLabel = new Date(calYear, calMonth).toLocaleDateString('en-US',{month:'long',year:'numeric'});
  document.getElementById('calTileMonth').textContent = calLabel;

  const todayEntry = getEntry(todayStr());
  if (todayEntry && todayEntry.timeIn) {
    const calc = calcDay(todayEntry, currentProfile);
    document.getElementById('todayTileInfo').textContent = calc ? fmtHrs(calc.netHrs)+' logged' : 'Entry exists';
  } else {
    document.getElementById('todayTileInfo').textContent = 'Tap to log today';
  }

  // Earnings tile — gross for selected month
  const mE = monthEntries(calYear, calMonth);
  let monthPay = currentProfile.mode==='monthly' ? (currentProfile.settings.monthlyBase||0) : 0;
  const commutation = currentProfile.settings.commutation || 0;
  mE.forEach(e => { const c = calcDay(e, currentProfile); if(c) monthPay += c.pay; });
  monthPay += commutation;
  document.getElementById('earningsTileInfo').textContent = fmtYen(monthPay);
  document.getElementById('earningsTileSub').textContent  = calLabel;

  // Deductions tile — show net for month
  const ym  = yearMonthKey(calYear, calMonth);
  const ded = getDeductions(ym);
  const totalDed = Object.values(ded).reduce((a,b)=>a+(+b||0), 0);
  document.getElementById('dedTileInfo').textContent = totalDed > 0 ? '−'+fmtYen(totalDed) : 'Not set';
  document.getElementById('dedTileSub').textContent  = calLabel;
}

/* ═══════════════════════════════════════
   RENDER: CALENDAR
═══════════════════════════════════════ */
function renderCalendar() {
  const label = new Date(calYear, calMonth).toLocaleDateString('en-US',{month:'long',year:'numeric'});
  document.getElementById('calMonthLabel').textContent = label;

  const grid = document.getElementById('calGrid');
  grid.innerHTML = '';
  const today = todayStr();

  ['Su','Mo','Tu','We','Th','Fr','Sa'].forEach(dl => {
    const el = document.createElement('div');
    el.className = 'cal-day-label';
    el.textContent = dl;
    grid.appendChild(el);
  });

  const firstDay    = new Date(calYear, calMonth, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth+1, 0).getDate();

  for (let i = 0; i < firstDay; i++) {
    const el = document.createElement('div');
    el.className = 'cal-day empty';
    grid.appendChild(el);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const ds    = calYear+'-'+String(calMonth+1).padStart(2,'0')+'-'+String(d).padStart(2,'0');
    const entry = getEntry(ds);
    const calc  = entry ? calcDay(entry, currentProfile) : null;
    const isToday = ds === today;
    const isSel   = ds === selectedDate;

    let dotColor = '';
    if (entry) {
      if      (entry.isHoliday && !entry.timeIn)  dotColor = 'var(--red)';
      else if (entry.isHoliday && entry.timeIn)   dotColor = 'var(--amber)';
      else if (calc && calc.otHrs > 0)            dotColor = 'var(--blue)';
      else if (entry.timeIn)                      dotColor = 'var(--green)';
    }

    const el = document.createElement('div');
    el.className = 'cal-day' + (isToday?' today':'') + (isSel?' selected':'');
    el.innerHTML = `
      <span class="cal-day-num">${d}</span>
      ${calc ? `<span class="cal-day-hrs">${fmtHrs(calc.netHrs)}</span>`
             : (entry && entry.isHoliday ? '<span class="cal-day-holiday">off</span>' : '')}
      ${dotColor ? `<span class="cal-dot" style="background:${dotColor}"></span>` : ''}
    `;
    el.onclick = () => { selectedDate = ds; renderCalendar(); openLogEntry(ds); };
    grid.appendChild(el);
  }

  const mE = monthEntries(calYear, calMonth);
  let totalHrs = 0, totalPay = 0;
  if (currentProfile.mode === 'monthly') totalPay = currentProfile.settings.monthlyBase || 0;
  totalPay += (currentProfile.settings.commutation || 0);
  mE.forEach(e => { const c = calcDay(e, currentProfile); if(c){totalHrs+=c.netHrs; totalPay+=c.pay;} });
  document.getElementById('calSummaryHrs').textContent = fmtHrs(totalHrs);
  document.getElementById('calSummaryPay').textContent = fmtYen(totalPay);
}

function shiftMonth(dir) {
  calMonth += dir;
  if (calMonth < 0)  { calMonth=11; calYear--; }
  if (calMonth > 11) { calMonth=0;  calYear++; }
  renderCalendar();
  if (currentProfile) renderHome();
}

/* ═══════════════════════════════════════
   LOG ENTRY MODAL
═══════════════════════════════════════ */
function getPrevEntryWithTime(dateStr) {
  const d = new Date(dateStr);
  for (let i = 1; i <= 14; i++) {
    d.setDate(d.getDate() - 1);
    const ds = d.toISOString().slice(0,10);
    const e  = getEntry(ds);
    if (e && e.timeIn) return e;
  }
  return null;
}

function addMinsToTime(timeStr, mins) {
  const total = toMins(timeStr) + mins;
  const h = Math.floor(total/60) % 24;
  const m = total % 60;
  return String(h).padStart(2,'0')+':'+String(m).padStart(2,'0');
}

function snapTo15(timeStr) {
  const t       = toMins(timeStr);
  const snapped = Math.round(t/15)*15;
  const h = Math.floor(snapped/60) % 24;
  const m = snapped % 60;
  return String(h).padStart(2,'0')+':'+String(m).padStart(2,'0');
}

function openLogEntry(dateStr) {
  selectedDate = dateStr;
  document.getElementById('logEntryDate').textContent = fmtDate(dateStr);
  const entry     = getEntry(dateStr) || {};
  const prevEntry = entry.timeIn ? null : getPrevEntryWithTime(dateStr);

  const defaultTimeIn  = entry.timeIn  || (prevEntry ? prevEntry.timeIn  : '09:00');
  const defaultTimeOut = entry.timeOut || snapTo15(addMinsToTime(defaultTimeIn, 9*60));

  document.getElementById('logTimeIn').value    = defaultTimeIn;
  document.getElementById('logTimeOut').value   = defaultTimeOut;
  document.getElementById('logLunch').value     = entry.lunchMins || (prevEntry ? prevEntry.lunchMins : 60);
  document.getElementById('logHoliday').checked = entry.isHoliday || false;

  document.getElementById('previewDetail').style.display = 'none';
  if (typeof previewDetailOpen !== 'undefined') previewDetailOpen = false;
  const hint = document.querySelector('.log-preview-hint');
  if (hint) hint.textContent = ' · tap for detail ▾';

  updateLogPreview();
  document.getElementById('logModal').classList.add('open');
}

function closeLogModal() { document.getElementById('logModal').classList.remove('open'); }

function updateLogPreview() {
  const tIn      = document.getElementById('logTimeIn').value;
  const tOut     = document.getElementById('logTimeOut').value;
  const lunchMins = parseInt(document.getElementById('logLunch').value) || 60;
  const isHoliday = document.getElementById('logHoliday').checked;
  const el        = document.getElementById('logPreview');
  const s         = currentProfile.settings;

  ['pdRegular','pdOT','pdHoliday'].forEach(id => { document.getElementById(id).style.display = 'none'; });
  document.getElementById('pdTotal').textContent = '—';

  if (isHoliday && (!tIn || !tOut)) {
    const netHrs     = s.otThresholdHrs || 8;
    const holidayPay = netHrs * (s.holidayRate || 0);
    el.textContent = `${netHrs}h (full day)  ·  ${fmtYen(holidayPay)}`;
    document.getElementById('pdHoliday').style.display = 'flex';
    document.getElementById('pdHolidayVal').textContent = `${netHrs}h × ${fmtYen(s.holidayRate||0)}/hr = ${fmtYen(holidayPay)}`;
    document.getElementById('pdTotal').textContent = fmtYen(holidayPay);
    return;
  }

  if (!tIn || !tOut) { el.textContent = '—'; return; }
  const totalMins = toMins(tOut) - toMins(tIn) - lunchMins;
  if (totalMins <= 0) { el.textContent = 'Invalid times'; return; }
  const netHrs = totalMins / 60;

  if (isHoliday && currentProfile.mode === 'monthly') {
    const thresh      = s.otThresholdHrs || 8;
    const otHrs       = Math.max(0, netHrs - thresh);
    const regHrs      = netHrs - otHrs;
    const holidayPay  = netHrs * (s.holidayRate || 0);
    const otPay       = otHrs  * (s.otRate      || 0);
    el.textContent = `${fmtHrs(netHrs)}  ·  ${fmtYen(holidayPay + otPay)}`;
    document.getElementById('pdHoliday').style.display = 'flex';
    document.getElementById('pdHolidayVal').textContent = `${fmtHrs(netHrs)} × ${fmtYen(s.holidayRate||0)}/hr = ${fmtYen(holidayPay)}`;
    document.getElementById('pdRegular').style.display = 'flex';
    document.getElementById('pdRegularVal').textContent = `${fmtHrs(regHrs)} (base salary covers)`;
    if (otHrs > 0) { document.getElementById('pdOT').style.display='flex'; document.getElementById('pdOTVal').textContent=`${fmtHrs(otHrs)} × ${fmtYen(s.otRate||0)}/hr = ${fmtYen(otPay)}`; }
    document.getElementById('pdTotal').textContent = fmtYen(holidayPay + otPay);
  } else if (isHoliday) {
    const pay = netHrs * (s.holidayRate || 0);
    el.textContent = `${fmtHrs(netHrs)}  ·  ${fmtYen(pay)}`;
    document.getElementById('pdHoliday').style.display = 'flex';
    document.getElementById('pdHolidayVal').textContent = `${fmtHrs(netHrs)} × ${fmtYen(s.holidayRate||0)}/hr = ${fmtYen(pay)}`;
    document.getElementById('pdTotal').textContent = fmtYen(pay);
  } else if (currentProfile.mode === 'monthly') {
    const thresh = s.otThresholdHrs || 8;
    const otHrs  = Math.max(0, netHrs - thresh);
    const regHrs = netHrs - otHrs;
    const otPay  = otHrs * (s.otRate || 0);
    el.textContent = `${fmtHrs(netHrs)}  ·  OT ${fmtHrs(otHrs)}  ·  ${fmtYen(otPay)}`;
    document.getElementById('pdRegular').style.display = 'flex';
    document.getElementById('pdRegularVal').textContent = `${fmtHrs(regHrs)} (base salary covers)`;
    if (otHrs > 0) { document.getElementById('pdOT').style.display='flex'; document.getElementById('pdOTVal').textContent=`${fmtHrs(otHrs)} × ${fmtYen(s.otRate||0)}/hr = ${fmtYen(otPay)}`; }
    document.getElementById('pdTotal').textContent = fmtYen(otPay);
  } else {
    const thresh  = s.otThresholdHrs || 8;
    const otHrs   = Math.max(0, netHrs - thresh);
    const regHrs  = netHrs - otHrs;
    const regPay  = regHrs * (s.normalRate || 0);
    const otPay   = otHrs  * (s.otRate     || 0);
    el.textContent = `${fmtHrs(netHrs)}  ·  OT ${fmtHrs(otHrs)}  ·  ${fmtYen(regPay+otPay)}`;
    document.getElementById('pdRegular').style.display = 'flex';
    document.getElementById('pdRegularVal').textContent = `${fmtHrs(regHrs)} × ${fmtYen(s.normalRate||0)}/hr = ${fmtYen(regPay)}`;
    if (otHrs > 0) { document.getElementById('pdOT').style.display='flex'; document.getElementById('pdOTVal').textContent=`${fmtHrs(otHrs)} × ${fmtYen(s.otRate||0)}/hr = ${fmtYen(otPay)}`; }
    document.getElementById('pdTotal').textContent = fmtYen(regPay+otPay);
  }
}

function saveLogEntry() {
  const tIn      = document.getElementById('logTimeIn').value;
  const tOut     = document.getElementById('logTimeOut').value;
  const lunchMins = parseInt(document.getElementById('logLunch').value) || 60;
  const isHoliday = document.getElementById('logHoliday').checked;
  if (!isHoliday && (!tIn || !tOut)) { alert('Enter time in and time out.'); return; }
  if (tIn && tOut && toMins(tOut)-toMins(tIn)-lunchMins <= 0) { alert('Net hours must be positive.'); return; }
  upsertEntry(selectedDate, { timeIn: tIn, timeOut: tOut, lunchMins, isHoliday });
  closeLogModal();
  renderCalendar();
  if (currentScreen === 'home') renderHome();
}

function deleteLogEntry() {
  if (!confirm('Delete this entry?')) return;
  deleteEntry(selectedDate);
  closeLogModal();
  renderCalendar();
  if (currentScreen === 'home') renderHome();
}

/* ═══════════════════════════════════════
   RENDER: EARNINGS SCREEN
═══════════════════════════════════════ */
function renderEarnings() {
  const mE   = monthEntries(calYear, calMonth);
  const label = new Date(calYear, calMonth).toLocaleDateString('en-US',{month:'long',year:'numeric'});
  document.getElementById('earningsMonthLabel').textContent = label;

  let regularHrs=0, otHrs=0, holidayHrs=0;
  let regularPay=0, otPay=0, holidayPay=0;
  let baseSalary   = currentProfile.mode==='monthly' ? (currentProfile.settings.monthlyBase||0) : 0;
  let commutation  = currentProfile.settings.commutation || 0;

  mE.forEach(e => {
    const c = calcDay(e, currentProfile);
    if (!c) return;
    regularHrs += c.regularHrs;
    otHrs      += c.otHrs;
    holidayHrs += c.holidayHrs;
    regularPay += c.regularPay;
    otPay      += c.otPay;
    holidayPay += c.holidayPay;
  });

  const gross = baseSalary + regularPay + otPay + holidayPay + commutation;
  document.getElementById('earningsGross').textContent    = fmtYen(gross);
  document.getElementById('earningsMonthLabel').textContent = label;

  const rows = [];
  if (currentProfile.mode === 'monthly') {
    rows.push({ label:'Base Salary',      hours:null,        amount:baseSalary,   color:'var(--blue)' });
    rows.push({ label:'OT Pay',           hours:otHrs,       amount:otPay,        color:'var(--amber)', rate:currentProfile.settings.otRate });
    rows.push({ label:'Holiday Pay',      hours:holidayHrs,  amount:holidayPay,   color:'var(--red)',   rate:currentProfile.settings.holidayRate });
    rows.push({ label:'Commutation 交通費', hours:null,        amount:commutation,  color:'var(--muted)' });
  } else {
    rows.push({ label:'Regular Pay',      hours:regularHrs,  amount:regularPay,   color:'var(--green)', rate:currentProfile.settings.normalRate });
    rows.push({ label:'OT Pay',           hours:otHrs,       amount:otPay,        color:'var(--amber)', rate:currentProfile.settings.otRate });
    rows.push({ label:'Holiday Pay',      hours:holidayHrs,  amount:holidayPay,   color:'var(--red)',   rate:currentProfile.settings.holidayRate });
    rows.push({ label:'Commutation 交通費', hours:null,        amount:commutation,  color:'var(--muted)' });
  }

  document.getElementById('earningsRows').innerHTML = rows.map(r => `
    <div class="earnings-row">
      <div class="er-left">
        <span class="er-dot" style="background:${r.color}"></span>
        <div>
          <div class="er-label">${r.label}</div>
          ${r.hours!=null ? `<div class="er-hrs">${fmtHrs(r.hours)}${r.rate?' × '+fmtYen(r.rate)+'/hr':''}</div>` : ''}
        </div>
      </div>
      <div class="er-amount ${r.amount>0?'':'er-zero'}">${fmtYen(r.amount)}</div>
    </div>
  `).join('');

  document.getElementById('earningsWorkDays').textContent  = mE.filter(e=>e.timeIn&&!e.isHoliday).length+' days';
  document.getElementById('earningsHolidays').textContent  = mE.filter(e=>e.isHoliday).length+' days';
  document.getElementById('earningsTotalHrs').textContent  = fmtHrs(regularHrs+otHrs+holidayHrs);

  // Deductions summary in earnings
  const ym  = yearMonthKey(calYear, calMonth);
  const ded = getDeductions(ym);
  const totalDed = Object.values(ded).reduce((a,b)=>a+(+b||0), 0);
  const net = gross - totalDed;
  document.getElementById('earningsNetRow').style.display  = totalDed > 0 ? '' : 'none';
  document.getElementById('earningsTotalDed').textContent  = '−'+fmtYen(totalDed);
  document.getElementById('earningsNet').textContent       = fmtYen(net);
}

/* ═══════════════════════════════════════
   RENDER: DEDUCTIONS SCREEN
═══════════════════════════════════════ */
function renderDeductions() {
  const ym    = yearMonthKey(calYear, calMonth);
  const ded   = getDeductions(ym);
  const label = new Date(calYear,calMonth).toLocaleDateString('en-US',{month:'long',year:'numeric'});
  document.getElementById('dedMonthLabel').textContent = label;

  // Populate rate fields
  const s = currentProfile.settings;
  document.getElementById('rowNormalRate').style.display  = currentProfile.mode==='hourly'  ? '' : 'none';
  document.getElementById('rowMonthlyBase').style.display = currentProfile.mode==='monthly' ? '' : 'none';
  document.getElementById('rowOtThreshold').style.display = currentProfile.mode==='hourly'  ? '' : 'none';
  document.getElementById('setNormalRate').value    = s.normalRate     || '';
  document.getElementById('setOtRate').value        = s.otRate         || '';
  document.getElementById('setHolidayRate').value   = s.holidayRate    || '';
  document.getElementById('setMonthlyBase').value   = s.monthlyBase    || '';
  document.getElementById('setCommutation').value   = s.commutation    || '';
  document.getElementById('setOtThreshold').value   = s.otThresholdHrs || 8;
  document.getElementById('setHealthRate').value    = s.healthInsRate  || 10.0;
  document.getElementById('setNursingRate').value   = s.nursingInsRate || 1.82;
  document.getElementById('setNursingEnabled').checked = s.nursingInsEnabled !== false;

  // Auto-calculate insurance based on current month gross
  const mE = monthEntries(calYear, calMonth);
  let grossTotal = currentProfile.mode==='monthly' ? (s.monthlyBase||0) : 0;
  grossTotal += (s.commutation || 0);
  mE.forEach(e => { const c = calcDay(e, currentProfile); if(c) grossTotal += c.pay; });

  const auto = calcInsurance(currentProfile, grossTotal);

  // Fill auto-calculated fields (only if user hasn't already saved manual values)
  // If saved value exists use it, otherwise show auto-calc
  const fillAuto = (fieldId, autoVal, savedVal) => {
    const el = document.getElementById(fieldId);
    if (!el) return;
    el.value = savedVal > 0 ? savedVal : autoVal;
  };

  fillAuto('ded_pensionIns',   auto.pension,      ded.pensionIns);
  fillAuto('ded_healthIns',    auto.healthIns,     ded.healthIns);
  fillAuto('ded_nursingIns',   auto.nursingIns,    ded.nursingIns);
  fillAuto('ded_unemployment', auto.unemployment,  ded.unemployment);

  // Manual-only fields
  document.getElementById('ded_incomeTax').value     = ded.incomeTax     || '';
  document.getElementById('ded_inhabitantTax').value = ded.inhabitantTax || '';
  document.getElementById('ded_socialAdjust').value  = ded.socialAdjust  || '';
  document.getElementById('ded_yearEndAdj').value    = ded.yearEndAdj    || '';
  document.getElementById('ded_otherDeduct').value   = ded.otherDeduct   || '';

  // Show auto-calc preview badge
  document.getElementById('autoCalcBadge').textContent =
    `Auto: Pension ${fmtYen(auto.pension)} · Health ${fmtYen(auto.healthIns)} · ` +
    `Nursing ${fmtYen(auto.nursingIns)} · Unemp ${fmtYen(auto.unemployment)}`;

  updateDedTotal();
}

function updateDedTotal() {
  const fields = [
    'healthIns','nursingIns','pensionIns','unemployment',
    'incomeTax','inhabitantTax','socialAdjust','yearEndAdj','otherDeduct'
  ];
  let total = 0;
  fields.forEach(f => {
    const el = document.getElementById('ded_'+f);
    total += parseFloat(el ? el.value : 0) || 0;
  });
  document.getElementById('dedTotalDisplay').textContent = fmtYen(total);
}

function saveDeductionsForm() {
  const ym = yearMonthKey(calYear, calMonth);
  const fields = [
    'healthIns','nursingIns','pensionIns','unemployment',
    'incomeTax','inhabitantTax','socialAdjust','yearEndAdj','otherDeduct'
  ];
  const data = {};
  fields.forEach(f => {
    const el = document.getElementById('ded_'+f);
    data[f] = parseFloat(el ? el.value : 0) || 0;
  });
  saveDeductions(ym, data);
  renderHome();
  const btn = document.getElementById('btnSaveDed');
  btn.textContent = '✓ Saved!';
  setTimeout(() => { btn.textContent = 'Save Deductions'; }, 1800);
}

/* ═══════════════════════════════════════
   INIT
═══════════════════════════════════════ */
window.addEventListener('DOMContentLoaded', () => {
  applyAppearance();

  document.querySelectorAll('.mode-card').forEach(c => {
    c.onclick = () => { onboardMode = c.dataset.mode; renderOnboard(); };
  });

  if (profiles.length === 0) {
    showScreen('onboard');
    renderOnboard();
  } else {
    showScreen('login');
    renderLogin();
  }

  ['logTimeIn','logTimeOut','logLunch','logHoliday'].forEach(id => {
    document.getElementById(id).addEventListener('input',  updateLogPreview);
    document.getElementById(id).addEventListener('change', updateLogPreview);
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(()=>{});
  }
});
