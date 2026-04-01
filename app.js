/* ============================================
   RISK MANAGER — app.js
   ONE CIRCLE IT SOLUTIONS
   ============================================ */

// ── ENV BADGE ──
function initEnv() {
  const badge = document.getElementById('envBadge');
  if (!badge) return;
  if (CONFIG.ENV === 'prod') {
    badge.textContent = 'PROD';
    badge.classList.remove('beta');
    badge.classList.add('prod');
  }
  const vt = document.getElementById('versionTag');
  if (vt) vt.textContent = `v${CONFIG.APP_VERSION} · ${CONFIG.ENV.toUpperCase()}`;
}

// ── LOGIN ──
async function doLogin() {
  const email = document.getElementById('inputEmail')?.value.trim();
  const pass  = document.getElementById('inputPassword')?.value;
  const btn   = document.getElementById('btnLogin');
  const err   = document.getElementById('errorMsg');

  if (!email || !pass) { err.textContent = 'Email and password required.'; return; }

  btn.disabled = true;
  btn.textContent = 'Authenticating...';
  err.textContent = '';

  try {
    await Auth.login(email, pass);
    window.location.href = '/dashboard.html';
  } catch (e) {
    err.textContent = e.message || 'Authentication failed.';
    btn.disabled = false;
    btn.textContent = 'Authenticate';
  }
}

// ── DATE ──
function initDate() {
  const el = document.getElementById('topDate');
  if (!el) return;
  el.textContent = new Date().toLocaleDateString('en-GB', {
    weekday:'short', day:'2-digit', month:'short', year:'numeric'
  }).toUpperCase();
}

// ── SPARKLINE ──
function drawSparkline(criticalData, highData) {
  const svg = document.getElementById('sparkline');
  if (!svg) return;
  const W = 200, H = 32, PAD = 3;
  const allVals = [...criticalData, ...highData];
  const min = Math.min(...allVals);
  const max = Math.max(...allVals);
  const range = max - min || 1;
  const n = 12;

  const x = i => PAD + (i / (n - 1)) * (W - PAD * 2);
  const y = v => H - PAD - ((v - min) / range) * (H - PAD * 2 - 2);

  function makeLine(data, color) {
    const pts = data.map((v, i) => `${x(i)},${y(v)}`).join(' ');
    const areaPath = `M${x(0)},${y(data[0])} ` +
      data.slice(1).map((v,i) => `L${x(i+1)},${y(v)}`).join(' ') +
      ` L${x(n-1)},${H} L${x(0)},${H} Z`;
    const gid = `grad${color.replace('#','')}`;
    return `
      <defs>
        <linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stop-color="${color}" stop-opacity="0.18"/>
          <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <path d="${areaPath}" fill="url(#${gid})"/>
      <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${x(n-1)}" cy="${y(data[n-1])}" r="2.5" fill="${color}"/>
    `;
  }

  const ticks = Array.from({length:12}, (_,i) =>
    `<line x1="${x(i)}" y1="${H-1}" x2="${x(i)}" y2="${H}" stroke="var(--border-hi)" stroke-width="1"/>`
  ).join('');

  svg.innerHTML = ticks + makeLine(highData, '#d4700a') + makeLine(criticalData, '#c0392b');
}

// ── PULSE ──
function initPulse(state = 'ELEVATED') {
  const colors = { CALM:'#1a7a4a', ELEVATED:'#b8960a', CRITICAL:'#c0392b' };
  const color = colors[state];
  document.documentElement.style.setProperty('--pulse-color', color);
  const label = document.getElementById('pulseLabel');
  if (label) label.textContent = state;

  let secs = 4 * 60;
  setInterval(() => {
    secs++;
    const el = document.getElementById('pulseUpdated');
    if (el) el.textContent = `${Math.floor(secs/60)} min ago`;
  }, 1000);
}

// ── SLIDE PANEL ──
function openPanel(title, subtitle, bodyHTML) {
  document.getElementById('spTitle').textContent = title;
  document.getElementById('spSubtitle').textContent = subtitle;
  document.getElementById('spBody').innerHTML = bodyHTML;
  document.getElementById('spOverlay').classList.add('open');
  document.getElementById('slidePanel').classList.add('open');
  const id = title.match(/RM-\d+/)?.[0];
  if (id) history.replaceState(null, '', `?risk=${id}`);
}

function closePanel() {
  document.getElementById('spOverlay')?.classList.remove('open');
  document.getElementById('slidePanel')?.classList.remove('open');
  history.replaceState(null, '', '?');
}

// ── HELPERS ──
function sevBadge(sev) {
  return `<span class="severity ${sev}">${sev.charAt(0).toUpperCase()+sev.slice(1)}</span>`;
}

function tagHTML(tags) {
  return (tags || []).map(t => `<span class="tag">${t}</span>`).join('');
}

// ── RISK DETAIL PANEL ──
function openRisk(risk) {
  const brut = risk.likelihood && risk.impact ? risk.likelihood * risk.impact : '—';
  openPanel(risk.id, `${risk.status} · ${risk.sev.toUpperCase()}`, `
    <div class="sp-section">
      <div class="sp-section-title">Identification</div>
      <div class="sp-field"><div class="sp-field-label">Risk Name</div><div class="sp-field-value">${risk.name}</div></div>
      <div class="sp-row">
        <div class="sp-field"><div class="sp-field-label">Severity</div><div class="sp-field-value">${sevBadge(risk.sev)}</div></div>
        <div class="sp-field"><div class="sp-field-label">Status</div><div class="sp-field-value" style="font-family:var(--mono);font-size:11px;color:var(--muted)">${risk.status}</div></div>
      </div>
      <div class="sp-field"><div class="sp-field-label">Tags</div><div class="sp-field-value" style="display:flex;gap:4px;flex-wrap:wrap">${tagHTML(risk.tags)}</div></div>
    </div>
    <div class="sp-section">
      <div class="sp-section-title">ISO 27005 Analysis</div>
      <div class="sp-row">
        <div class="sp-field"><div class="sp-field-label">Likelihood</div><div class="sp-field-value" style="font-family:var(--mono);font-size:20px;font-weight:600">${risk.likelihood ?? '—'}</div></div>
        <div class="sp-field"><div class="sp-field-label">Impact</div><div class="sp-field-value" style="font-family:var(--mono);font-size:20px;font-weight:600">${risk.impact ?? '—'}</div></div>
      </div>
      <div class="sp-row">
        <div class="sp-field"><div class="sp-field-label">Gross Risk</div><div class="sp-field-value" style="font-family:var(--mono);font-size:20px;font-weight:600;color:var(--high)">${brut}</div></div>
        <div class="sp-field"><div class="sp-field-label">Residual Risk</div><div class="sp-field-value" style="font-family:var(--mono);font-size:20px;font-weight:600;color:var(--low)">${risk.residual ?? '—'}</div></div>
      </div>
      <div class="sp-field"><div class="sp-field-label">Treatment Decision</div><div class="sp-field-value">${risk.decision ?? 'Not defined'}</div></div>
    </div>
    <div class="sp-section">
      <div class="sp-section-title">Governance</div>
      <div class="sp-row">
        <div class="sp-field"><div class="sp-field-label">Risk Owner</div><div class="sp-field-value">${risk.owner_full}</div></div>
        <div class="sp-field"><div class="sp-field-label">Visibility</div><div class="sp-field-value">TEAM</div></div>
      </div>
    </div>
    <div class="sp-actions">
      <button class="sp-btn primary">Edit Risk</button>
    </div>
  `);
}

// ── FEED DETAIL PANEL ──
function openFeed(item) {
  openPanel(item.id, `${item.source} · ${item.time}`, `
    <div class="sp-section">
      <div class="sp-section-title">Threat Intelligence</div>
      <div class="sp-field"><div class="sp-field-label">Title</div><div class="sp-field-value">${item.name}</div></div>
      <div class="sp-field"><div class="sp-field-label">Severity</div><div class="sp-field-value">${sevBadge(item.sev)}</div></div>
      <div class="sp-field"><div class="sp-field-label">Source</div><div class="sp-field-value" style="font-family:var(--mono);font-size:11px">${item.source}</div></div>
      <div class="sp-field"><div class="sp-field-label">Tags</div><div class="sp-field-value" style="display:flex;gap:4px;flex-wrap:wrap">${tagHTML(item.tags)}</div></div>
      <div class="sp-field"><div class="sp-field-label">Description</div><div class="sp-field-value">${item.desc}</div></div>
    </div>
    <div class="sp-actions">
      <button class="sp-btn primary">Import as Risk</button>
    </div>
  `);
}

// ── FILTERED LIST PANEL ──
function openFiltered(RISKS, sev, label) {
  const filtered = RISKS.filter(r => sev === 'pending' ? r.status === 'PENDING' : r.sev === sev);
  const cards = filtered.map(r => `
    <div class="sp-risk-card" onclick='openRisk(${JSON.stringify(r)})'>
      <div class="sp-risk-card-top">
        <span class="sp-risk-card-id">${r.id}</span>
        <span class="sp-risk-card-name">${r.name}</span>
        ${sevBadge(r.sev)}
      </div>
      <div class="sp-risk-card-bot">
        <span style="font-family:var(--mono);font-size:9px;color:var(--muted)">${r.status}</span>
        <span style="margin-left:auto">${tagHTML(r.tags)}</span>
      </div>
    </div>
  `).join('');
  openPanel(`${filtered.length} ${label} Risk${filtered.length > 1 ? 's' : ''}`, 'Filtered view', `
    <div class="sp-section">
      <div class="sp-risk-list">${cards || '<div style="color:var(--muted);font-size:12px">No risks found.</div>'}</div>
    </div>
  `);
}

// ── INIT ──
document.addEventListener('DOMContentLoaded', () => {
  initEnv();
  initDate();
});
