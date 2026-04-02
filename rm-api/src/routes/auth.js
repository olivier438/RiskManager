'use strict';

const express  = require('express');
const router   = express.Router();
const authSvc  = require('../services/authService');
const { authenticate } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validate');
const { authLimiter } = require('../middleware/rateLimit');
const logger   = require('../utils/logger');

/**
 * POST /api/auth/login
 * Authentification par email + mot de passe.
 * Rate limitée à 10 tentatives / 15min.
 */
router.post('/login', authLimiter, validate(schemas.login), async (req, res) => {
  try {
    const { email, password } = req.body;
    const ip        = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];

    const result = await authSvc.login(email, password, ip, userAgent);

    // Token dans le body — le client le stocke en mémoire JS uniquement
    return res.status(200).json({
      accessToken: result.accessToken,
      user:        result.user,
    });
  } catch (err) {
    if (err.name === 'AuthError') {
      return res.status(401).json({ error: err.message });
    }
    logger.error('Login error', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/auth/logout
 * Révoque la session courante.
 */
router.post('/logout', authenticate, async (req, res) => {
  try {
    const token = req.headers['authorization'].slice(7);
    await authSvc.logout(token);
    return res.status(200).json({ message: 'Logged out successfully' });
  } catch (err) {
    logger.error('Logout error', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/auth/me
 * Retourne les infos du user courant.
 */
router.get('/me', authenticate, (req, res) => {
  return res.status(200).json({ user: req.user });
});

/**
 * POST /api/auth/revoke-all
 * Révoque toutes les sessions (admin ou self).
 */
router.post('/revoke-all', authenticate, async (req, res) => {
  try {
    await authSvc.revokeAllSessions(req.user.id);
    return res.status(200).json({ message: 'All sessions revoked' });
  } catch (err) {
    logger.error('Revoke all error', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
