'use strict';

const mysql = require('mysql2/promise');
const config = require('./env');
const logger = require('../utils/logger');

/**
 * Pool de connexions MySQL.
 * Utilise mysql2/promise pour les prepared statements natifs.
 * Toutes les requêtes passent par ce pool — jamais de connexion directe.
 */
const pool = mysql.createPool({
  host:               config.db.host,
  port:               config.db.port,
  database:           config.db.name,
  user:               config.db.user,
  password:           config.db.password,
  waitForConnections: true,
  connectionLimit:    10,
  queueLimit:         0,
  charset:            'utf8mb4',
  timezone:           'Z',
  // Sécurité : désactive les requêtes multiples
  multipleStatements: false,
});

// Vérification de la connexion au démarrage
pool.getConnection()
  .then(conn => {
    logger.info('Database connection established');
    conn.release();
  })
  .catch(err => {
    logger.error('Database connection failed', { error: err.message });
    process.exit(1);
  });

/**
 * Exécute une requête préparée.
 * TOUJOURS utiliser cette fonction — jamais de concaténation SQL.
 *
 * @param {string} sql   - Requête avec placeholders ?
 * @param {Array}  params - Valeurs à binder
 * @returns {Promise<Array>}
 */
async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

/**
 * Exécute une requête dans une transaction.
 * @param {Function} fn - Fonction async recevant (conn)
 */
async function transaction(fn) {
  const conn = await pool.getConnection();
  await conn.beginTransaction();
  try {
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { query, transaction, pool };
