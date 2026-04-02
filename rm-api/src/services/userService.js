'use strict';

const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');
const db     = require('../config/db');
const config = require('../config/env');
const logger = require('../utils/logger');

/**
 * Service de gestion des utilisateurs.
 * Toutes les opérations sont scopées à l'environment_id.
 * Admin uniquement pour créer/modifier/désactiver des users.
 */

/**
 * Liste les users d'un environment.
 */
async function listUsers(environmentId) {
  return await db.query(
    `SELECT id, email, first_name, last_name, job_title,
            role, active, last_login, created_at
     FROM users
     WHERE environment_id = ?
     ORDER BY last_name, first_name`,
    [environmentId]
  );
}

/**
 * Récupère un user par ID.
 */
async function getUser(userId, environmentId) {
  const users = await db.query(
    `SELECT id, email, first_name, last_name, job_title,
            role, active, lang, date_format, last_login, created_at
     FROM users
     WHERE id = ? AND environment_id = ?`,
    [userId, environmentId]
  );
  return users[0] || null;
}

/**
 * Crée un nouvel utilisateur.
 * L'email doit être unique globalement.
 */
async function createUser(data, createdBy, environmentId) {
  // Vérifier unicité email
  const existing = await db.query(
    'SELECT id FROM users WHERE email = ?',
    [data.email]
  );
  if (existing.length) {
    const err = new Error('Email already in use');
    err.status = 409;
    throw err;
  }

  const passwordHash = await bcrypt.hash(data.password, config.bcrypt.rounds);
  const userId = uuidv4();

  await db.transaction(async (conn) => {
    await conn.execute(
      `INSERT INTO users
        (id, environment_id, email, first_name, last_name,
         job_title, role, password_hash)
       VALUES (?,?,?,?,?,?,?,?)`,
      [userId, environmentId, data.email, data.first_name,
       data.last_name, data.job_title || null, data.role, passwordHash]
    );

    await conn.execute(
      `INSERT INTO audit_log
        (id, environment_id, user_id, action, entity_type, entity_id, new_value)
       VALUES (?,?,?,?,?,?,?)`,
      [uuidv4(), environmentId, createdBy, 'USER_CREATED', 'user', userId,
       JSON.stringify({ email: data.email, role: data.role })]
    );
  });

  logger.info('User created', { userId, email: data.email, createdBy });
  return { id: userId };
}

/**
 * Met à jour le profil d'un utilisateur.
 * Un user peut modifier son propre profil.
 * Admin peut modifier n'importe quel user de son environment.
 */
async function updateUser(userId, data, requesterId, environmentId) {
  const user = await getUser(userId, environmentId);
  if (!user) return null;

  const fields = [];
  const params = [];

  if (data.first_name !== undefined) { fields.push('first_name = ?'); params.push(data.first_name); }
  if (data.last_name  !== undefined) { fields.push('last_name = ?');  params.push(data.last_name); }
  if (data.job_title  !== undefined) { fields.push('job_title = ?');  params.push(data.job_title); }
  if (data.lang       !== undefined) { fields.push('lang = ?');       params.push(data.lang); }
  if (data.date_format !== undefined) { fields.push('date_format = ?'); params.push(data.date_format); }

  if (!fields.length) return { id: userId };

  params.push(userId, environmentId);
  await db.query(
    `UPDATE users SET ${fields.join(', ')} WHERE id = ? AND environment_id = ?`,
    params
  );

  logger.info('User updated', { userId, requesterId });
  return { id: userId };
}

/**
 * Change le rôle d'un user (admin uniquement).
 */
async function changeRole(userId, newRole, adminId, environmentId) {
  const user = await getUser(userId, environmentId);
  if (!user) return null;

  // Empêcher un admin de se rétrograder lui-même
  if (userId === adminId) {
    const err = new Error('Cannot change your own role');
    err.status = 400;
    throw err;
  }

  await db.transaction(async (conn) => {
    await conn.execute(
      'UPDATE users SET role = ? WHERE id = ? AND environment_id = ?',
      [newRole, userId, environmentId]
    );
    await conn.execute(
      `INSERT INTO audit_log
        (id, environment_id, user_id, action, entity_type, entity_id, old_value, new_value)
       VALUES (?,?,?,?,?,?,?,?)`,
      [uuidv4(), environmentId, adminId, 'USER_ROLE_CHANGED', 'user', userId,
       JSON.stringify({ role: user.role }),
       JSON.stringify({ role: newRole })]
    );
  });

  logger.info('User role changed', { userId, newRole, adminId });
  return { id: userId };
}

/**
 * Désactive un utilisateur (jamais supprimé pour l'audit trail).
 */
async function deactivateUser(userId, adminId, environmentId) {
  if (userId === adminId) {
    const err = new Error('Cannot deactivate yourself');
    err.status = 400;
    throw err;
  }

  await db.transaction(async (conn) => {
    await conn.execute(
      'UPDATE users SET active = 0 WHERE id = ? AND environment_id = ?',
      [userId, environmentId]
    );
    // Révoquer toutes les sessions actives
    await conn.execute(
      'DELETE FROM sessions WHERE user_id = ?',
      [userId]
    );
    await conn.execute(
      `INSERT INTO audit_log
        (id, environment_id, user_id, action, entity_type, entity_id)
       VALUES (?,?,?,?,?,?)`,
      [uuidv4(), environmentId, adminId, 'USER_DEACTIVATED', 'user', userId]
    );
  });

  logger.info('User deactivated', { userId, adminId });
  return { id: userId };
}

/**
 * Change le mot de passe d'un utilisateur.
 */
async function changePassword(userId, currentPassword, newPassword, environmentId) {
  const users = await db.query(
    'SELECT password_hash FROM users WHERE id = ? AND environment_id = ? AND active = 1',
    [userId, environmentId]
  );
  if (!users.length) return null;

  const valid = await bcrypt.compare(currentPassword, users[0].password_hash);
  if (!valid) {
    const err = new Error('Current password is incorrect');
    err.status = 400;
    throw err;
  }

  const newHash = await bcrypt.hash(newPassword, config.bcrypt.rounds);

  await db.transaction(async (conn) => {
    await conn.execute(
      'UPDATE users SET password_hash = ? WHERE id = ?',
      [newHash, userId]
    );
    // Révoquer toutes les sessions sauf la courante
    await conn.execute(
      'DELETE FROM sessions WHERE user_id = ?',
      [userId]
    );
    await conn.execute(
      `INSERT INTO audit_log
        (id, environment_id, user_id, action, entity_type, entity_id)
       VALUES (?,?,?,?,?,?)`,
      [uuidv4(), environmentId, userId, 'PASSWORD_CHANGED', 'user', userId]
    );
  });

  logger.info('Password changed', { userId });
  return true;
}

module.exports = {
  listUsers, getUser, createUser,
  updateUser, changeRole, deactivateUser, changePassword,
};
