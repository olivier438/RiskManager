'use strict';

require('dotenv').config();

const express    = require('express');
const helmet     = require('helmet');
const cors       = require('cors');
const config     = require('./config/env');
const logger     = require('./utils/logger');
const { apiLimiter } = require('./middleware/rateLimit');

// Routes
const authRoutes       = require('./routes/auth');
const risksRoutes      = require('./routes/risks');
const usersRoutes      = require('./routes/users');
const frameworksRoutes = require('./routes/frameworks');

const app = express();

// ── SÉCURITÉ — Headers HTTP ──
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'none'"],
      connectSrc: ["'self'"],
    },
  },
  hsts: {
    maxAge:            31536000,
    includeSubDomains: true,
    preload:           true,
  },
  frameguard:    { action: 'deny' },
  noSniff:       true,
  referrerPolicy: { policy: 'strict-origin' },
}));

// ── CORS ──
app.use(cors({
  origin:      config.cors.origin,
  methods:     ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false, // Pas de cookies cross-origin
  maxAge:      86400,
}));

// ── BODY PARSING ──
app.use(express.json({ limit: '50kb' })); // Limite stricte
app.use(express.urlencoded({ extended: false, limit: '50kb' }));

// ── RATE LIMITING global ──
app.use('/api/', apiLimiter);

// ── LOGGING des requêtes ──
app.use((req, _res, next) => {
  // Ne pas logger les headers Authorization
  logger.info('Incoming request', {
    method: req.method,
    path:   req.path,
    ip:     req.ip,
  });
  next();
});

// ── ROUTES ──
app.use('/api/auth',       authRoutes);
app.use('/api/risks',      risksRoutes);
app.use('/api/users',      usersRoutes);
app.use('/api/frameworks', frameworksRoutes);

// Health check — pas d'auth, pas d'info sensible
app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── 404 ──
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ── ERROR HANDLER global ──
// Ne jamais exposer les stack traces en production
app.use((err, _req, res, _next) => {
  logger.error('Unhandled error', {
    error:   err.message,
    stack:   config.env === 'development' ? err.stack : undefined,
  });

  res.status(err.status || 500).json({
    error: config.env === 'production'
      ? 'Internal server error'
      : err.message,
  });
});

// ── DÉMARRAGE ──
const server = app.listen(config.port, () => {
  logger.info(`Risk Manager API started`, {
    port: config.port,
    env:  config.env,
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { reason: String(reason) });
});

module.exports = app;
