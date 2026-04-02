'use strict';

const jwt    = require('jsonwebtoken');
const config = require('../config/env');
const db     = require('../config/db');
const logger = require('../utils/logger');

/**
 * Middleware d'authentification JWT.
 *
 * Vérifie :
 * 1. Présence du header Authorization: Bearer <token>
 * 2. Signature JWT valide
 * 3. Session active en base (non révoquée)
 * 4. User actif dans son environment
 *
 * Injecte req.user et req.environmentId sur chaque requête authentifiée.
 */
async function authenticate(req, res, next) {
  try {
    // 1. Extraction du token
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const token = authHeader.slice(7);

    // 2. Vérification de la signature JWT
    let payload;
    try {
      payload = jwt.verify(token, config.jwt.secret);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Token expired' });
      }
      return res.status(401).json({ error: 'Invalid token' });
    }

    // 3. Vérification de la session en base
    const tokenHash = hashToken(token);
    const sessions = await db.query(
      `SELECT s.id, s.expires_at, s.environment_id,
              u.id AS user_id, u.email, u.role,
              u.first_name, u.last_name, u.active AS user_active
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?
         AND s.expires_at > NOW()
         AND u.active = 1`,
      [tokenHash]
    );

    if (!sessions.length) {
      return res.status(401).json({ error: 'Session expired or revoked' });
    }

    const session = sessions[0];

    // 4. Injection sur la requête
    req.user = {
      id:            session.user_id,
      email:         session.email,
      role:          session.role,
      firstName:     session.first_name,
      lastName:      session.last_name,
      environmentId: session.environment_id,
    };

    next();
  } catch (err) {
    logger.error('Authentication middleware error', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Hash simple du token pour stockage en base.
 * On ne stocke JAMAIS le token brut.
 */
function hashToken(token) {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Factory de middleware de vérification de rôle.
 * Doit être utilisé APRÈS authenticate.
 *
 * @param {...string} roles - Rôles autorisés
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (!roles.includes(req.user.role)) {
      logger.warn('Unauthorized role access attempt', {
        userId: req.user.id,
        role:   req.user.role,
        required: roles,
        path:   req.path,
      });
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

/**
 * Vérifie que l'environment_id demandé correspond à celui du user.
 * Utilisé sur toutes les routes qui exposent des données d'un environment.
 */
function requireSameEnvironment(req, res, next) {
  const envId = req.params.environmentId || req.body?.environmentId;
  if (envId && envId !== req.user.environmentId) {
    logger.warn('Cross-environment access attempt', {
      userId:          req.user.id,
      userEnvironment: req.user.environmentId,
      requestedEnv:    envId,
    });
    return res.status(403).json({ error: 'Access denied' });
  }
  next();
}

module.exports = { authenticate, requireRole, requireSameEnvironment, hashToken };
