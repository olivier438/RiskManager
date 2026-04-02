'use strict';

const rateLimit = require('express-rate-limit');
const config    = require('../config/env');

/**
 * Rate limiter général — toutes les routes API.
 */
const apiLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max:      config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Too many requests, please try again later' },
  skip: req => config.env === 'development',
});

/**
 * Rate limiter strict pour l'authentification.
 * 10 tentatives par 15 minutes par IP.
 * Protection brute force.
 */
const authLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max:      config.rateLimit.authMax,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Too many authentication attempts, please try again later' },
  // Toujours actif, même en dev
});

module.exports = { apiLimiter, authLimiter };
