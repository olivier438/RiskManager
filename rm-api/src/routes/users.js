'use strict';

const express   = require('express');
const router    = express.Router();
const userSvc   = require('../services/userService');
const { authenticate, requireRole } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validate');
const { z } = require('zod');
const logger    = require('../utils/logger');

router.use(authenticate);

/**
 * GET /api/users
 * Liste les users de l'environment (admin uniquement).
 */
router.get('/', requireRole('admin'), async (req, res) => {
  try {
    const users = await userSvc.listUsers(req.user.environmentId);
    return res.status(200).json({ users });
  } catch (err) {
    logger.error('List users error', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/users/me
 * Profil du user courant.
 */
router.get('/me', async (req, res) => {
  try {
    const user = await userSvc.getUser(req.user.id, req.user.environmentId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    return res.status(200).json({ user });
  } catch (err) {
    logger.error('Get me error', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/users/:id
 * Récupère un user (admin ou self).
 */
router.get('/:id', async (req, res) => {
  try {
    // Un user ne peut voir que son propre profil sauf si admin
    if (req.user.role !== 'admin' && req.params.id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const user = await userSvc.getUser(req.params.id, req.user.environmentId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    return res.status(200).json({ user });
  } catch (err) {
    logger.error('Get user error', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/users
 * Crée un utilisateur (admin uniquement).
 */
router.post('/',
  requireRole('admin'),
  validate(schemas.createUser),
  async (req, res) => {
    try {
      const result = await userSvc.createUser(
        req.body, req.user.id, req.user.environmentId
      );
      return res.status(201).json(result);
    } catch (err) {
      if (err.status === 409) return res.status(409).json({ error: err.message });
      logger.error('Create user error', { error: err.message });
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/**
 * PATCH /api/users/me
 * Met à jour le profil du user courant.
 */
router.patch('/me', validate(z.object({
  first_name:  z.string().min(1).max(100).optional(),
  last_name:   z.string().min(1).max(100).optional(),
  job_title:   z.string().max(255).optional(),
  lang:        z.enum(['en', 'fr', 'nl', 'de']).optional(),
  date_format: z.enum(['DD/MM/YYYY', 'YYYY-MM-DD', 'MM/DD/YYYY']).optional(),
})), async (req, res) => {
  try {
    const result = await userSvc.updateUser(
      req.user.id, req.body, req.user.id, req.user.environmentId
    );
    return res.status(200).json(result);
  } catch (err) {
    logger.error('Update me error', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PATCH /api/users/:id/role
 * Change le rôle d'un user (admin uniquement).
 */
router.patch('/:id/role',
  requireRole('admin'),
  validate(z.object({
    role: z.enum(['admin', 'risk_manager', 'analyst']),
  })),
  async (req, res) => {
    try {
      const result = await userSvc.changeRole(
        req.params.id, req.body.role,
        req.user.id, req.user.environmentId
      );
      if (!result) return res.status(404).json({ error: 'User not found' });
      return res.status(200).json(result);
    } catch (err) {
      if (err.status === 400) return res.status(400).json({ error: err.message });
      logger.error('Change role error', { error: err.message });
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/**
 * PATCH /api/users/:id/deactivate
 * Désactive un user (admin uniquement).
 */
router.patch('/:id/deactivate', requireRole('admin'), async (req, res) => {
  try {
    const result = await userSvc.deactivateUser(
      req.params.id, req.user.id, req.user.environmentId
    );
    if (!result) return res.status(404).json({ error: 'User not found' });
    return res.status(200).json({ message: 'User deactivated' });
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    logger.error('Deactivate user error', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/users/me/password
 * Change le mot de passe du user courant.
 */
router.post('/me/password', validate(schemas.changePassword), async (req, res) => {
  try {
    const result = await userSvc.changePassword(
      req.user.id,
      req.body.current_password,
      req.body.new_password,
      req.user.environmentId
    );
    if (!result) return res.status(404).json({ error: 'User not found' });
    return res.status(200).json({ message: 'Password updated' });
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    logger.error('Change password error', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
