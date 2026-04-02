'use strict';

const express   = require('express');
const router    = express.Router();
const riskSvc   = require('../services/riskService');
const { authenticate, requireRole } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validate');
const logger    = require('../utils/logger');

// Toutes les routes nécessitent une authentification
router.use(authenticate);

/**
 * GET /api/risks
 * Liste les risques de l'environment du user courant.
 */
router.get('/', async (req, res) => {
  try {
    const filters = {
      status:   req.query.status   || null,
      severity: req.query.severity || null,
      owner_id: req.query.owner_id || null,
    };
    const risks = await riskSvc.listRisks(req.user.environmentId, filters);
    return res.status(200).json({ risks, total: risks.length });
  } catch (err) {
    logger.error('List risks error', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/risks/:id
 * Récupère un risque avec journal, tags et mesures.
 */
router.get('/:id', async (req, res) => {
  try {
    const risk = await riskSvc.getRisk(req.params.id, req.user.environmentId);
    if (!risk) return res.status(404).json({ error: 'Risk not found' });

    // Analyst ne voit que les risques qui lui sont assignés
    if (req.user.role === 'analyst' && risk.assigned_to !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    return res.status(200).json({ risk });
  } catch (err) {
    logger.error('Get risk error', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/risks
 * Crée un nouveau risque.
 * Risk Manager uniquement.
 */
router.post('/',
  requireRole('risk_manager', 'admin'),
  validate(schemas.createRisk),
  async (req, res) => {
    try {
      const result = await riskSvc.createRisk(
        req.body, req.user.id, req.user.environmentId
      );
      return res.status(201).json(result);
    } catch (err) {
      logger.error('Create risk error', { error: err.message });
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/**
 * PATCH /api/risks/:id
 * Met à jour un risque.
 * Risk Manager : tous les champs.
 * Analyst : uniquement les champs d'analyse sur ses risques assignés.
 */
router.patch('/:id', validate(schemas.updateRisk), async (req, res) => {
  try {
    const risk = await riskSvc.getRisk(req.params.id, req.user.environmentId);
    if (!risk) return res.status(404).json({ error: 'Risk not found' });

    // Analyst : uniquement ses risques + champs limités
    if (req.user.role === 'analyst') {
      if (risk.assigned_to !== req.user.id) {
        return res.status(403).json({ error: 'Access denied' });
      }
      // Champs autorisés pour l'analyst
      const allowed = ['likelihood', 'impact', 'scenario',
                       'existing_controls', 'proposed_measures'];
      const forbidden = Object.keys(req.body).filter(k => !allowed.includes(k));
      if (forbidden.length) {
        return res.status(403).json({
          error: 'Analysts can only update analysis fields',
          forbidden,
        });
      }
    }

    const result = await riskSvc.updateRisk(
      req.params.id, req.body, req.user.id, req.user.environmentId
    );
    if (!result) return res.status(404).json({ error: 'Risk not found' });

    return res.status(200).json(result);
  } catch (err) {
    logger.error('Update risk error', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/risks/:id/journal
 * Ajoute une entrée au journal (immuable).
 * Risk Manager et Analyst (sur ses risques assignés).
 */
router.post('/:id/journal',
  validate(schemas.createJournalEntry),
  async (req, res) => {
    try {
      const risk = await riskSvc.getRisk(req.params.id, req.user.environmentId);
      if (!risk) return res.status(404).json({ error: 'Risk not found' });

      if (req.user.role === 'analyst' && risk.assigned_to !== req.user.id) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const entryId = await riskSvc.addJournalEntry(
        req.params.id, req.body.entry_text,
        req.user.id, req.user.environmentId
      );

      return res.status(201).json({ id: entryId });
    } catch (err) {
      logger.error('Journal entry error', { error: err.message });
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/**
 * GET /api/risks/:id/versions
 * Historique des versions (risk_manager uniquement).
 */
router.get('/:id/versions',
  requireRole('risk_manager'),
  async (req, res) => {
    try {
      const versions = await require('../config/db').query(
        `SELECT id, version_number, changed_by, changed_at, change_summary
         FROM risk_versions
         WHERE risk_id = ? AND environment_id = ?
         ORDER BY version_number DESC`,
        [req.params.id, req.user.environmentId]
      );
      return res.status(200).json({ versions });
    } catch (err) {
      logger.error('Get versions error', { error: err.message });
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

module.exports = router;
