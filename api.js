/* ============================================
   RISK MANAGER — api.js
   Toutes les opérations DB via Supabase
   ============================================ */

const P = CONFIG.TABLE_PREFIX; // 'rm_'

// ── RISKS ──

async function listRisks(filters = {}) {
  const sb  = getClient();
  const env = getEnvId();

  let q = sb
    .from(`${P}risks`)
    .select(`
      id, risk_ref, name, severity, status,
      likelihood, impact, gross_risk, residual_risk,
      decision, visibility, review_date, asset,
      rs_source_id, created_at, updated_at,
      owner:owner_id(first_name, last_name),
      assignee:assigned_to(first_name, last_name),
      rm_risk_tags(tag, source)
    `)
    .eq('environment_id', env)
    .order('created_at', { ascending: false });

  if (filters.status)   q = q.eq('status', filters.status);
  if (filters.severity) q = q.eq('severity', filters.severity);
  if (filters.owner_id) q = q.eq('owner_id', filters.owner_id);

  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

async function createRisk(riskData) {
  const sb   = getClient();
  const env  = getEnvId();
  const user = getUser();

  // Générer le risk_ref
  const count = await countRisks();
  const prefix = getEnvironment()?.risk_prefix || 'RM';
  const riskRef = `${prefix}-${String(count + 1).padStart(4, '0')}`;

  const gross = riskData.likelihood && riskData.impact
    ? riskData.likelihood * riskData.impact : null;

  const severity = gross
    ? gross >= 16 ? 'critical' : gross >= 9 ? 'high' : gross >= 4 ? 'medium' : 'low'
    : riskData.severity || null;

  const { data, error } = await sb
    .from(`${P}risks`)
    .insert({
      environment_id: env,
      risk_ref:       riskRef,
      name:           riskData.name,
      description:    riskData.description || null,
      asset:          riskData.asset || null,
      likelihood:     riskData.likelihood || null,
      impact:         riskData.impact || null,
      gross_risk:     gross,
      severity,
      status:         'DRAFT',
      visibility:     riskData.visibility || 'PRIVATE',
      owner_id:       riskData.owner_id || user.id,
      created_by:     user.id,
    })
    .select()
    .single();

  if (error) throw error;

  // Tags
  if (riskData.tags?.length) {
    await addTags(data.id, riskData.tags, 'manual');
  }

  // Version initiale
  await createVersion(data.id, 'Risk created', { name: riskData.name, status: 'DRAFT' });

  // Audit log
  await auditLog('RISK_CREATED', 'risk', data.id, null, { risk_ref: riskRef, name: riskData.name });

  return data;
}

async function updateRisk(riskId, updates) {
  const sb   = getClient();
  const env  = getEnvId();
  const user = getUser();

  const old = await getRisk(riskId);
  if (!old) throw new Error('Risk not found');

  const gross = updates.likelihood && updates.impact
    ? updates.likelihood * updates.impact : old.gross_risk;

  const severity = gross
    ? gross >= 16 ? 'critical' : gross >= 9 ? 'high' : gross >= 4 ? 'medium' : 'low'
    : updates.severity || old.severity;

  const payload = { ...updates, gross_risk: gross, severity, updated_at: new Date().toISOString() };
  delete payload.tags;

  const { data, error } = await sb
    .from(`${P}risks`)
    .update(payload)
    .eq('id', riskId)
    .eq('environment_id', env)
    .select()
    .single();

  if (error) throw error;

  // Résumé des changements
  const changes = [];
  if (updates.status   && updates.status   !== old.status)   changes.push(`Status: ${old.status} → ${updates.status}`);
  if (updates.severity && updates.severity !== old.severity) changes.push(`Severity: ${old.severity} → ${updates.severity}`);
  const summary = changes.length ? changes.join(', ') : 'Risk updated';

  await createVersion(riskId, summary, old);
  await auditLog('RISK_UPDATED', 'risk', riskId,
    { status: old.status, severity: old.severity },
    { status: updates.status, severity: updates.severity }
  );

  return data;
}

async function countRisks() {
  const sb  = getClient();
  const env = getEnvId();
  const { count } = await sb
    .from(`${P}risks`)
    .select('id', { count: 'exact', head: true })
    .eq('environment_id', env);
  return count || 0;
}

// ── TAGS ──

async function addTags(riskId, tags, source = 'manual') {
  const sb  = getClient();
  const env = getEnvId();

  const rows = tags.map(tag => ({
    risk_id:        riskId,
    environment_id: env,
    tag:            tag.toLowerCase(),
    source,
  }));

  const { error } = await sb.from(`${P}risk_tags`).upsert(rows, { onConflict: 'risk_id,tag' });
  if (error) console.error('Tag insert error:', error.message);
}

// ── JOURNAL (internal) ──

async function _addJournalInternal(riskId, text) {
  const sb   = getClient();
  const env  = getEnvId();
  const user = getUser();

  const { data, error } = await sb
    .from(`${P}risk_journal`)
    .insert({
      risk_id:        riskId,
      environment_id: env,
      author_id:      user.id,
      entry_text:     text,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// ── VERSIONS ──

async function createVersion(riskId, summary, snapshot) {
  const sb   = getClient();
  const env  = getEnvId();
  const user = getUser();

  // Compter les versions existantes
  const { count } = await sb
    .from(`${P}risk_versions`)
    .select('id', { count: 'exact', head: true })
    .eq('risk_id', riskId);

  const { error } = await sb.from(`${P}risk_versions`).insert({
    risk_id:        riskId,
    environment_id: env,
    version_number: (count || 0) + 1,
    changed_by:     user.id,
    change_summary: summary,
    snapshot:       JSON.stringify(snapshot),
  });

  if (error) console.error('Version insert error:', error.message);
}

// ── AUDIT LOG ──

async function auditLog(action, entityType, entityId, oldValue, newValue) {
  const sb   = getClient();
  const env  = getEnvId();
  const user = getUser();

  const { error } = await sb.from(`${P}audit_log`).insert({
    environment_id: env,
    user_id:        user?.id,
    action,
    entity_type:    entityType,
    entity_id:      entityId,
    old_value:      oldValue ? JSON.stringify(oldValue) : null,
    new_value:      newValue ? JSON.stringify(newValue) : null,
  });

  if (error) console.error('Audit log error:', error.message);
}

// ── USERS ──

async function listUsers() {
  const sb  = getClient();
  const env = getEnvId();

  const { data, error } = await sb
    .from(`${P}users`)
    .select('id, email, first_name, last_name, job_title, role, active, last_login')
    .eq('environment_id', env)
    .order('last_name');

  if (error) throw error;
  return data || [];
}

// ── GET RISK DETAIL ──
async function getRisk(riskUuid) {
  const sb  = getClient();
  const env = getEnvId();

  const { data: risk, error } = await sb
    .from(`${P}risks`)
    .select('*, owner:owner_id(id, first_name, last_name), rm_risk_tags(tag, source)')
    .eq('id', riskUuid)
    .eq('environment_id', env)
    .single();

  if (error) throw error;

  // Journal séparé — Supabase ne résout pas toujours les FK imbriquées
  const { data: journal } = await sb
    .from(`${P}risk_journal`)
    .select('id, entry_text, created_at, author:author_id(first_name, last_name)')
    .eq('risk_id', riskUuid)
    .order('created_at', { ascending: false });

  risk.rm_risk_journal = journal || [];
  return risk;
}

// ── ADD JOURNAL ENTRY ──
async function addJournalEntryAPI(riskUuid, text) {
  const sb   = getClient();
  const env  = getEnvId();
  const user = getUser();

  const { data, error } = await sb
    .from(`${P}risk_journal`)
    .insert({
      risk_id:        riskUuid,
      environment_id: env,
      author_id:      user.id,
      entry_text:     text,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// ── CHANGE STATUS ──
async function applyStatus(riskUuid) {
  const select = document.getElementById('statusSelect');
  if (!select) return;
  await applyStatusDirect(riskUuid, select.value);
}

async function applyStatusDirect(riskUuid, newStatus) {
  const sb  = getClient();
  const env = getEnvId();

  const { error } = await sb
    .from(`${P}risks`)
    .update({ status: newStatus, updated_at: new Date().toISOString() })
    .eq('id', riskUuid)
    .eq('environment_id', env);

  if (error) { alert('Error: ' + error.message); return; }

  closePanel();
  await loadAndRenderRisks();

  const toast = document.createElement('div');
  toast.textContent = `✓ Status → ${newStatus}`;
  Object.assign(toast.style, {
    position:'fixed', bottom:'24px', left:'50%', transform:'translateX(-50%)',
    background:'var(--accent)', color:'#fff', fontFamily:'var(--mono)',
    fontSize:'11px', padding:'10px 20px', borderRadius:'3px',
    zIndex:'9999', boxShadow:'0 4px 16px rgba(0,0,0,0.4)'
  });
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2000);
}

// ── SUBMIT FOR REVIEW ──
async function submitAnalysisSupabase(riskUuid) {
  const sb  = getClient();
  const env = getEnvId();

  const { error } = await sb
    .from(`${P}risks`)
    .update({ status: 'IN REVIEW', updated_at: new Date().toISOString() })
    .eq('id', riskUuid)
    .eq('environment_id', env);

  if (error) { alert('Error: ' + error.message); return; }

  const btn = event?.target;
  if (btn) { btn.textContent = '✓ Submitted for Review'; btn.disabled = true; btn.style.background = 'var(--low)'; }

  await loadAndRenderRisks();
}

// ── RECALC GROSS RISK ──
function recalcGross() {
  const l = parseInt(document.getElementById('editLikelihood')?.value) || 0;
  const i = parseInt(document.getElementById('editImpact')?.value) || 0;
  const el = document.getElementById('grossDisplay');
  if (!el) return;
  if (l && i) {
    const score = l * i;
    const sev = score >= 16 ? 'critical' : score >= 9 ? 'high' : score >= 4 ? 'medium' : 'low';
    const colors = { critical:'var(--critical)', high:'var(--high)', medium:'var(--medium)', low:'var(--low)' };
    el.textContent = `${score}`;
    el.style.color  = colors[sev];
  } else {
    el.textContent = '—';
    el.style.color  = 'var(--muted)';
  }
}

// ── SAVE RISK EDITS ──
async function saveRiskEdits(riskUuid) {
  const sb  = getClient();
  const env = getEnvId();

  const name       = document.getElementById('editName')?.value.trim();
  const asset      = document.getElementById('editAsset')?.value.trim();
  const desc       = document.getElementById('editDesc')?.value.trim();
  const likelihood = parseInt(document.getElementById('editLikelihood')?.value) || null;
  const impact     = parseInt(document.getElementById('editImpact')?.value) || null;
  const residual   = parseInt(document.getElementById('editResidual')?.value) || null;
  const decision   = document.getElementById('editDecision')?.value || null;

  if (!name) { alert('Risk name is required'); return; }

  const gross = likelihood && impact ? likelihood * impact : null;
  const severity = gross
    ? gross >= 16 ? 'critical' : gross >= 9 ? 'high' : gross >= 4 ? 'medium' : 'low'
    : null;

  const btn = document.querySelector('[onclick*="saveRiskEdits"]');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }

  const { error } = await sb
    .from(`${P}risks`)
    .update({
      name, asset: asset || null,
      description: desc || null,
      likelihood, impact,
      gross_risk:    gross,
      residual_risk: residual,
      severity, decision: decision || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', riskUuid)
    .eq('environment_id', env);

  if (error) {
    alert('Error: ' + error.message);
    if (btn) { btn.disabled = false; btn.textContent = 'Save changes →'; }
    return;
  }

  // Version + audit
  await createVersion(riskUuid, 'Risk edited', { name, likelihood, impact, decision });
  await auditLog('RISK_UPDATED', 'risk', riskUuid, null, { name, likelihood, impact, severity, decision });

  await loadAndRenderRisks();
  closePanel();

  const toast = document.createElement('div');
  toast.textContent = '✓ Risk updated';
  Object.assign(toast.style, {
    position:'fixed', bottom:'24px', left:'50%', transform:'translateX(-50%)',
    background:'var(--low)', color:'#fff', fontFamily:'var(--mono)',
    fontSize:'11px', padding:'10px 20px', borderRadius:'3px',
    zIndex:'9999', boxShadow:'0 4px 16px rgba(0,0,0,0.4)'
  });
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2500);
}

// ── TAKE RISK (analyst self-assign) ──
async function takeRisk(riskUuid) {
  const sb   = getClient();
  const env  = getEnvId();
  const user = getUser();

  const { error } = await sb
    .from(`${P}risks`)
    .update({ assigned_to: user.id, updated_at: new Date().toISOString() })
    .eq('id', riskUuid)
    .eq('environment_id', env);

  if (error) { alert('Error: ' + error.message); return; }

  // Ajouter une note journal
  await addJournalEntryAPI(riskUuid, `Risk taken by ${user.first_name} ${user.last_name}`);

  closePanel();
  await loadAndRenderRisks();

  const toast = document.createElement('div');
  toast.textContent = '✓ Risk assigned to you';
  Object.assign(toast.style, {
    position:'fixed', bottom:'24px', left:'50%', transform:'translateX(-50%)',
    background:'var(--low)', color:'#fff', fontFamily:'var(--mono)',
    fontSize:'11px', padding:'10px 20px', borderRadius:'3px',
    zIndex:'9999', boxShadow:'0 4px 16px rgba(0,0,0,0.4)'
  });
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2500);
}

// ── SAVE RISK EDITS ──
async function saveRiskEdits(riskUuid) {
  const name      = document.getElementById('editName')?.value.trim();
  const desc      = document.getElementById('editDesc')?.value.trim();
  const asset     = document.getElementById('editAsset')?.value.trim();
  const likelihood = parseInt(document.getElementById('editLikelihood')?.value) || null;
  const impact     = parseInt(document.getElementById('editImpact')?.value) || null;
  const residual   = parseInt(document.getElementById('editResidual')?.value) || null;
  const decision   = document.getElementById('editDecision')?.value || null;

  if (!name) { alert('Risk name is required'); return; }

  const gross = likelihood && impact ? likelihood * impact : null;
  const severity = gross
    ? gross >= 16 ? 'critical' : gross >= 9 ? 'high' : gross >= 4 ? 'medium' : 'low'
    : null;

  const sb  = getClient();
  const env = getEnvId();

  const { error } = await sb
    .from(`${P}risks`)
    .update({
      name, description: desc, asset,
      likelihood, impact, gross_risk: gross,
      residual_risk: residual, decision,
      severity, updated_at: new Date().toISOString()
    })
    .eq('id', riskUuid)
    .eq('environment_id', env);

  if (error) { alert('Error: ' + error.message); return; }

  await loadAndRenderRisks();

  const toast = document.createElement('div');
  toast.textContent = '✓ Risk saved';
  Object.assign(toast.style, {
    position:'fixed', bottom:'24px', left:'50%', transform:'translateX(-50%)',
    background:'var(--low)', color:'#fff', fontFamily:'var(--mono)',
    fontSize:'11px', padding:'10px 20px', borderRadius:'3px',
    zIndex:'9999', boxShadow:'0 4px 16px rgba(0,0,0,0.4)'
  });
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2000);
}

// ── RECALC GROSS RISK (live) ──
function recalcGross() {
  const l = parseInt(document.getElementById('editLikelihood')?.value) || 0;
  const i = parseInt(document.getElementById('editImpact')?.value) || 0;
  const el = document.getElementById('grossDisplay');
  if (!el) return;
  if (l && i) {
    const score = l * i;
    const sev   = score >= 16 ? 'critical' : score >= 9 ? 'high' : score >= 4 ? 'medium' : 'low';
    const colors = { critical:'var(--critical)', high:'var(--high)', medium:'var(--medium)', low:'var(--low)' };
    el.textContent  = score;
    el.style.color  = colors[sev];
  } else {
    el.textContent = '—';
    el.style.color = 'var(--muted)';
  }
}
