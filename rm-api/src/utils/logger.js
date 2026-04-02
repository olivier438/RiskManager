'use strict';

const winston = require('winston');
const config  = require('../config/env');

/**
 * Logger structuré Winston.
 * En production : JSON uniquement, niveau info+.
 * Règle absolue : jamais de mot de passe, token, ou donnée sensible dans les logs.
 */
const logger = winston.createLogger({
  level: config.env === 'production' ? 'info' : 'debug',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    config.env === 'production'
      ? winston.format.json()
      : winston.format.prettyPrint()
  ),
  defaultMeta: { service: 'riskmanager-api' },
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      maxsize: 10485760, // 10MB
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: 'logs/combined.log',
      maxsize: 10485760,
      maxFiles: 10,
    }),
  ],
});

/**
 * Log d'audit pour les actions sensibles.
 * Séparé des logs applicatifs.
 */
const auditLogger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({
      filename: 'logs/audit.log',
      maxsize: 52428800, // 50MB
      maxFiles: 30,
    }),
  ],
});

module.exports = { ...logger, audit: auditLogger.info.bind(auditLogger) };
