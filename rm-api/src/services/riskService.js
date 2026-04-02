'use strict';

const { v4: uuidv4 } = require('uuid');
const db     = require('../config/db');
const logger = require('../utils/logger');

/**
 * Service de gestion des risques.
 * Toutes les opérations sont scopées à l'environment_id du user.
 * Versioning automatique à chaque modification.
 */

/**
 * Liste les risques de l'environment.
 */
async function listRisks(environmentId, filters = {}) {
  let sql = `
    SELECT r.id, r.risk_ref, r.name, r.severity, r.status,
           r.likelihood, r.impact, r.gross_risk, r.residual_risk,
           r.decision, r.visibility, r.review_date,
           r.asset, r.rs_source_id,
           r.created_at, r.updated_at,
           u.first_name AS owner_first, u.last_name AS owner_last,
           a.first_name AS assignee_first, a.last_name AS assignee_last,
           GROUP_CONCAT(t.tag ORDER BY t.tag SEPARATOR ',') AS tags
    FROM risks r
    LEFT JOIN users u ON u.id = r.owner_id
    LEFT JOIN users a ON a.id = r.assigned_to
    LEFT JOIN risk_tags t ON t.risk_id = r.id
    WHERE r.environment_id = ?
  `;
  const params = [environmentId];

  if (filters.status) { sql += ' AND r.status = ?'; params.push(filters.status); }
  if (filters.severity) { sql += ' AND r.severity = ?'; params.push(filters.severity); }
  if (filters.owner_id) { sql += ' AND r.owner_id = ?'; params.push(filters.owner_id); }

  sql += ' GROUP BY r.id ORDER BY r.created_at DESC';

  const risks = await db.query(sql, params);
  return risks.map(r => ({
    ...r,
    tags: r.tags ? r.tags.split(',') : [],
  }));
}

/**
 * Récupère un risque par ID.
 */
async function getRisk(riskId, environmentId) {
  const risks = await db.query(
    `SELECT r.*, 
            u.first_name AS owner_first, u.last_name AS owner_last,
            a.first_name AS assignee_first, a.last_name AS assignee_last
     FROM risks r
     LEFT JOIN users u ON u.id = r.owner_id
     LEFT JOIN users a ON a.id = r.assigned_to
     WHERE r.id = ? AND r.environment_id = ?`,
    [riskId, environmentId]
  );

  if (!risks.length) return null;
  const risk = risks[0];

  // Tags
  const tags = await db.query(
    'SELECT tag, source FROM risk_tags WHERE risk_id = ? ORDER BY tag',
    [riskId]
  );

  // Journal
  const journal = await db.query(
    `SELECT j.id, j.entry_text, j.created_at,
            u.first_name, u.last_name
     FROM risk_journal j
     JOIN users u ON u.id = j.author_id
     WHERE j.risk_id = ?
     ORDER BY j.created_at DESC`,
    [riskId]
  );

  // Mesures associées
  const measures = await db.query(
    `SELECT fm.code, fm.title, fm.nist_function, f.code AS framework_code
     FROM risk_measures rm
     JOIN framework_measures fm ON fm.id = rm.measure_id
     JOIN frameworks f ON f.id = fm.framework_id
     WHERE rm.risk_id = ?`,
    [riskId]
  );

  return { ...risk, tags, journal, measures };
}

/**
 * Crée un nouveau risque.
 */
async function createRisk(data, userId, environmentId) {
  return await db.transaction(async (conn) => {
    // Générer le risk_ref
    const [countRow] = await conn.execute(
      'SELECT COUNT(*) AS cnt FROM risks WHERE environment_id = ?',
      [environmentId]
    );
    const count = countRow[0].cnt + 1;

    // Récupérer le préfixe de l'environment
    const [envRow] = await conn.execute(
      'SELECT risk_prefix FROM environments WHERE id = ?',
      [environmentId]
    );
    const prefix = envRow[0]?.risk_prefix || 'RM';
    const riskRef = `${prefix}-${String(count).padStart(4, '0')}`;

    const riskId = uuidv4();
    const grossRisk = data.likelihood && data.impact
      ? data.likelihood * data.impact
      : null;
    const severity = grossRisk
      ? grossRisk >= 16 ? 'critical'
        : grossRisk >= 9 ? 'high'
        : grossRisk >= 4 ? 'medium'
        : 'low'
      : data.severity || null;

    await conn.execute(
      `INSERT INTO risks (
        id, environment_id, risk_ref, name, description, asset,
        threat_source, vulnerability, scenario,
        existing_controls, proposed_measures,
        likelihood, impact, gross_risk, residual_risk,
        severity, decision, status, visibility,
        owner_id, assigned_to, review_date,
        rs_source_id, created_by
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        riskId, environmentId, riskRef,
        data.name, data.description || null, data.asset || null,
        data.threat_source || null, data.vulnerability || null,
        data.scenario || null, data.existing_controls || null,
        data.proposed_measures || null,
        data.likelihood || null, data.impact || null,
        grossRisk, data.residual_risk || null,
        severity, data.decision || null,
        data.status || 'DRAFT', data.visibility || 'PRIVATE',
        data.owner_id || userId, data.assigned_to || null,
        data.review_date || null, data.rs_source_id || null, userId,
      ]
    );

    // Tags
    if (data.tags?.length) {
      for (const tag of data.tags) {
        await conn.execute(
          'INSERT IGNORE INTO risk_tags (id, risk_id, environment_id, tag, source) VALUES (?,?,?,?,?)',
          [uuidv4(), riskId, environmentId, tag.toLowerCase(), 'manual']
        );
      }
    }

    // Version initiale
    await createVersion(conn, riskId, environmentId, userId, 'Risk created', {
      name: data.name, status: 'DRAFT',
    });

    // Audit log
    await conn.execute(
      `INSERT INTO audit_log (id, environment_id, user_id, action, entity_type, entity_id, new_value)
       VALUES (?,?,?,?,?,?,?)`,
      [uuidv4(), environmentId, userId, 'RISK_CREATED', 'risk', riskId,
       JSON.stringify({ risk_ref: riskRef, name: data.name })]
    );

    logger.info('Risk created', { riskId, riskRef, userId });
    return { id: riskId, risk_ref: riskRef };
  });
}

/**
 * Met à jour un risque avec versioning automatique.
 */
async function updateRisk(riskId, data, userId, environmentId) {
  return await db.transaction(async (conn) => {
    // Vérifier que le risque appartient à l'environment
    const [existing] = await conn.execute(
      'SELECT * FROM risks WHERE id = ? AND environment_id = ?',
      [riskId, environmentId]
    );

    if (!existing.length) return null;
    const old = existing[0];

    const grossRisk = (data.likelihood ?? old.likelihood) && (data.impact ?? old.impact)
      ? (data.likelihood ?? old.likelihood) * (data.impact ?? old.impact)
      : old.gross_risk;

    const severity = grossRisk
      ? grossRisk >= 16 ? 'critical'
        : grossRisk >= 9 ? 'high'
        : grossRisk >= 4 ? 'medium'
        : 'low'
      : data.severity ?? old.severity;

    await conn.execute(
      `UPDATE risks SET
        name              = COALESCE(?, name),
        description       = COALESCE(?, description),
        asset             = COALESCE(?, asset),
        threat_source     = COALESCE(?, threat_source),
        vulnerability     = COALESCE(?, vulnerability),
        scenario          = COALESCE(?, scenario),
        existing_controls = COALESCE(?, existing_controls),
        proposed_measures = COALESCE(?, proposed_measures),
        likelihood        = COALESCE(?, likelihood),
        impact            = COALESCE(?, impact),
        gross_risk        = ?,
        residual_risk     = COALESCE(?, residual_risk),
        severity          = ?,
        decision          = COALESCE(?, decision),
        status            = COALESCE(?, status),
        visibility        = COALESCE(?, visibility),
        owner_id          = COALESCE(?, owner_id),
        assigned_to       = COALESCE(?, assigned_to),
        review_date       = COALESCE(?, review_date)
      WHERE id = ? AND environment_id = ?`,
      [
        data.name ?? null, data.description ?? null,
        data.asset ?? null, data.threat_source ?? null,
        data.vulnerability ?? null, data.scenario ?? null,
        data.existing_controls ?? null, data.proposed_measures ?? null,
        data.likelihood ?? null, data.impact ?? null,
        grossRisk, data.residual_risk ?? null,
        severity, data.decision ?? null,
        data.status ?? null, data.visibility ?? null,
        data.owner_id ?? null, data.assigned_to ?? null,
        data.review_date ?? null,
        riskId, environmentId,
      ]
    );

    // Détecter les changements significatifs pour le résumé
    const changes = [];
    if (data.status && data.status !== old.status)
      changes.push(`Status: ${old.status} → ${data.status}`);
    if (data.severity && data.severity !== old.severity)
      changes.push(`Severity: ${old.severity} → ${data.severity}`);
    const summary = changes.length ? changes.join(', ') : 'Risk updated';

    await createVersion(conn, riskId, environmentId, userId, summary, old);

    // Audit log
    await conn.execute(
      `INSERT INTO audit_log (id, environment_id, user_id, action, entity_type, entity_id, old_value, new_value)
       VALUES (?,?,?,?,?,?,?,?)`,
      [uuidv4(), environmentId, userId, 'RISK_UPDATED', 'risk', riskId,
       JSON.stringify({ status: old.status, severity: old.severity }),
       JSON.stringify({ status: data.status, severity: data.severity })]
    );

    logger.info('Risk updated', { riskId, summary, userId });
    return { id: riskId };
  });
}

/**
 * Crée une entrée de versioning immuable.
 */
async function createVersion(conn, riskId, environmentId, userId, summary, snapshot) {
  const [countRow] = await conn.execute(
    'SELECT COUNT(*) AS cnt FROM risk_versions WHERE risk_id = ?',
    [riskId]
  );
  const version = countRow[0].cnt + 1;

  await conn.execute(
    `INSERT INTO risk_versions (id, risk_id, environment_id, version_number, changed_by, change_summary, snapshot)
     VALUES (?,?,?,?,?,?,?)`,
    [uuidv4(), riskId, environmentId, version, userId, summary, JSON.stringify(snapshot)]
  );
}

/**
 * Ajoute une entrée au journal analyste (immuable).
 */
async function addJournalEntry(riskId, text, authorId, environmentId) {
  // Vérifier que le risque appartient à l'environment
  const risks = await db.query(
    'SELECT id FROM risks WHERE id = ? AND environment_id = ?',
    [riskId, environmentId]
  );
  if (!risks.length) return null;

  const entryId = uuidv4();
  await db.query(
    `INSERT INTO risk_journal (id, risk_id, environment_id, author_id, entry_text)
     VALUES (?,?,?,?,?)`,
    [entryId, riskId, environmentId, authorId, text]
  );

  logger.info('Journal entry added', { riskId, authorId });
  return entryId;
}

module.exports = { listRisks, getRisk, createRisk, updateRisk, addJournalEntry };
