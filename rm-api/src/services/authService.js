'use strict';

const bcrypt = require('bcrypt');
const jwt    = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db     = require('../config/db');
const config = require('../config/env');
const logger = require('../utils/logger');
const { hashToken } = require('../middleware/auth');

/**
 * Service d'authentification.
 * Gère login, logout, refresh token.
 * Les tokens ne sont JAMAIS loggés.
 */

/**
 * Authentifie un utilisateur par email + mot de passe.
 * Retourne un access token JWT et crée une session en base.
 *
 * @returns {{ accessToken: string, user: object }}
 */
async function login(email, password, ipAddress, userAgent) {
  // 1. Trouver le user
  const users = await db.query(
    `SELECT u.id, u.email, u.password_hash, u.role,
            u.first_name, u.last_name, u.active,
            u.environment_id, e.name AS env_name
     FROM users u
     JOIN environments e ON e.id = u.environment_id
     WHERE u.email = ? AND u.active = 1`,
    [email]
  );

  // Délai constant pour éviter timing attacks
  const dummyHash = '$2b$12$invalidhashtopreventtimingattack000000000000000000000000';

  if (!users.length) {
    await bcrypt.compare(password, dummyHash);
    throw new AuthError('Invalid credentials');
  }

  const user = users[0];

  // 2. Vérifier le mot de passe
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    logger.warn('Failed login attempt', { email, ip: ipAddress });
    throw new AuthError('Invalid credentials');
  }

  // 3. Générer le JWT
  const payload = {
    sub:  user.id,
    env:  user.environment_id,
    role: user.role,
    jti:  uuidv4(), // JWT ID unique
  };

  const accessToken = jwt.sign(payload, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn,
    algorithm: 'HS256',
  });

  // 4. Créer la session en base
  const tokenHash = hashToken(accessToken);
  const expiresAt = new Date(Date.now() + parseExpiry(config.jwt.expiresIn));

  await db.query(
    `INSERT INTO sessions (id, user_id, environment_id, token_hash, ip_address, user_agent, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [uuidv4(), user.id, user.environment_id, tokenHash,
     ipAddress?.substring(0, 45), userAgent?.substring(0, 500), expiresAt]
  );

  // 5. Mettre à jour last_login
  await db.query(
    'UPDATE users SET last_login = NOW() WHERE id = ?',
    [user.id]
  );

  logger.info('User logged in', { userId: user.id, env: user.environment_id });

  return {
    accessToken,
    user: {
      id:          user.id,
      email:       user.email,
      firstName:   user.first_name,
      lastName:    user.last_name,
      role:        user.role,
      environment: { id: user.environment_id, name: user.env_name },
    },
  };
}

/**
 * Révoque la session courante.
 */
async function logout(token) {
  const tokenHash = hashToken(token);
  await db.query(
    'DELETE FROM sessions WHERE token_hash = ?',
    [tokenHash]
  );
  logger.info('Session revoked');
}

/**
 * Révoque toutes les sessions d'un utilisateur.
 * Utilisé en cas de compromission de compte.
 */
async function revokeAllSessions(userId) {
  await db.query(
    'DELETE FROM sessions WHERE user_id = ?',
    [userId]
  );
  logger.info('All sessions revoked', { userId });
}

/**
 * Nettoie les sessions expirées (à appeler via cron).
 */
async function cleanExpiredSessions() {
  const result = await db.query(
    'DELETE FROM sessions WHERE expires_at < NOW()'
  );
  logger.info('Expired sessions cleaned', { count: result.affectedRows });
}

// Helpers
function parseExpiry(expiry) {
  const match = expiry.match(/^(\d+)([smhd])$/);
  if (!match) return 15 * 60 * 1000;
  const [, n, unit] = match;
  const units = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return parseInt(n, 10) * units[unit];
}

class AuthError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AuthError';
    this.status = 401;
  }
}

module.exports = { login, logout, revokeAllSessions, cleanExpiredSessions, AuthError };
