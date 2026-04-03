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

async function getRisk(riskId) {
  const sb  = getClient();
  const env = getEnvId();

  const { data, error } = await sb
    .from(`${P}risks`)
    .select(`
      *,
      owner:owner_id(id, first_name, last_name),
      assignee:assigned_to(id, first_name, last_name),
      rm_risk_tags(tag, source),
      rm_risk_journal(
        id, entry_text, created_at,
        author:author_id(first_name, last_name)
      ),
      rm_risk_versions(
        id, version_number, change_summary, changed_at,
        changed_by(first_name, last_name)
      )
    `)
    .eq('id', riskId)
    .eq('environment_id', env)
    .single();

  if (error) throw error;
  return data;
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

// ── JOURNAL ──

async function addJournalEntry(riskId, text) {
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
