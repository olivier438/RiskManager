'use strict';

const express = require('express');
const router  = express.Router();
const db      = require('../config/db');
const { authenticate } = require('../middleware/auth');
const logger  = require('../utils/logger');

router.use(authenticate);

/**
 * GET /api/frameworks
 * Liste les frameworks actifs de l'environment.
 */
router.get('/', async (req, res) => {
  try {
    const frameworks = await db.query(
      `SELECT f.id, f.code, f.name, f.version, f.issuer, f.description,
              ef.active AS env_active, ef.activated_at
       FROM frameworks f
       JOIN environment_frameworks ef ON ef.framework_id = f.id
       WHERE ef.environment_id = ? AND ef.active = 1
       ORDER BY f.code`,
      [req.user.environmentId]
    );
    return res.status(200).json({ frameworks });
  } catch (err) {
    logger.error('List frameworks error', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/frameworks/:code/measures
 * Liste les mesures d'un framework avec filtres optionnels.
 * Utilisé pour le matching et les suggestions dans RM.
 */
router.get('/:code/measures', async (req, res) => {
  try {
    const { level, nist_function, keyword } = req.query;

    let sql = `
      SELECT fm.id, fm.code, fm.level, fm.nist_function,
             fm.title, fm.description, fm.keywords,
             fm.is_key_measure, fm.sort_order
      FROM framework_measures fm
      JOIN frameworks f ON f.id = fm.framework_id
      WHERE f.code = ?
    `;
    const params = [req.params.code];

    if (level)         { sql += ' AND fm.level = ?';         params.push(level); }
    if (nist_function) { sql += ' AND fm.nist_function = ?'; params.push(nist_function.toUpperCase()); }

    // Recherche par mot-clé dans les keywords JSON
    if (keyword) {
      sql += ' AND JSON_CONTAINS(fm.keywords, ?)';
      params.push(JSON.stringify(keyword.toLowerCase()));
    }

    sql += ' ORDER BY fm.sort_order';

    const measures = await db.query(sql, params);

    // Parser les keywords JSON
    const result = measures.map(m => ({
      ...m,
      keywords: typeof m.keywords === 'string'
        ? JSON.parse(m.keywords)
        : m.keywords,
    }));

    return res.status(200).json({ measures: result, total: result.length });
  } catch (err) {
    logger.error('List measures error', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/frameworks/measures/suggest
 * Suggère des mesures basées sur les tags d'un risque.
 * Cross-framework : cherche dans tous les frameworks actifs de l'environment.
 */
router.get('/measures/suggest', async (req, res) => {
  try {
    const { tags } = req.query;
    if (!tags) return res.status(400).json({ error: 'tags parameter required' });

    const tagList = tags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
    if (!tagList.length) return res.status(400).json({ error: 'No valid tags provided' });

    // Récupérer les frameworks actifs de l'environment
    const activeFrameworks = await db.query(
      `SELECT f.id FROM frameworks f
       JOIN environment_frameworks ef ON ef.framework_id = f.id
       WHERE ef.environment_id = ? AND ef.active = 1`,
      [req.user.environmentId]
    );

    if (!activeFrameworks.length) {
      return res.status(200).json({ suggestions: [] });
    }

    const fwIds = activeFrameworks.map(f => f.id);
    const placeholders = fwIds.map(() => '?').join(',');

    // Pour chaque tag, chercher les mesures avec ce keyword
    const suggestions = new Map();

    for (const tag of tagList) {
      const tagClean = tag.replace('#', '');
      const measures = await db.query(
        `SELECT fm.id, fm.code, fm.level, fm.nist_function,
                fm.title, fm.is_key_measure,
                f.code AS framework_code, f.name AS framework_name
         FROM framework_measures fm
         JOIN frameworks f ON f.id = fm.framework_id
         WHERE fm.framework_id IN (${placeholders})
           AND JSON_CONTAINS(fm.keywords, ?)
         ORDER BY fm.is_key_measure DESC, fm.sort_order
         LIMIT 5`,
        [...fwIds, JSON.stringify(tagClean)]
      );

      measures.forEach(m => {
        if (!suggestions.has(m.id)) {
          suggestions.set(m.id, { ...m, matched_tags: [tag] });
        } else {
          suggestions.get(m.id).matched_tags.push(tag);
        }
      });
    }

    // Trier par nombre de tags matchés
    const sorted = [...suggestions.values()]
      .sort((a, b) => b.matched_tags.length - a.matched_tags.length)
      .slice(0, 10);

    return res.status(200).json({ suggestions: sorted });
  } catch (err) {
    logger.error('Suggest measures error', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/frameworks/stats
 * Stats de couverture des frameworks pour le dashboard KPI.
 */
router.get('/stats', async (req, res) => {
  try {
    const stats = await db.query(
      `SELECT f.code, f.name,
              COUNT(DISTINCT rm.risk_id) AS risks_with_measures,
              COUNT(DISTINCT r.id)       AS total_risks,
              COUNT(DISTINCT fm.id)      AS total_measures
       FROM frameworks f
       JOIN environment_frameworks ef ON ef.framework_id = f.id
         AND ef.environment_id = ?
       LEFT JOIN framework_measures fm ON fm.framework_id = f.id
       LEFT JOIN risks r ON r.environment_id = ?
       LEFT JOIN risk_measures rm ON rm.measure_id = fm.id
         AND rm.environment_id = ?
       WHERE ef.active = 1
       GROUP BY f.id`,
      [req.user.environmentId, req.user.environmentId, req.user.environmentId]
    );

    return res.status(200).json({ stats });
  } catch (err) {
    logger.error('Framework stats error', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
