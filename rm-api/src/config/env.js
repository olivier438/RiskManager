'use strict';

function required(key) {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required environment variable: ${key}`);
  return val;
}

function optional(key, defaultValue) {
  return process.env[key] || defaultValue;
}

const config = {
  env:  optional('NODE_ENV', 'production'),
  port: parseInt(optional('PORT', '3000'), 10),

  db: {
    host:     required('DB_HOST'),
    port:     parseInt(optional('DB_PORT', '3306'), 10),
    name:     required('DB_NAME'),
    user:     required('DB_USER'),
    password: required('DB_PASSWORD'),
  },

  jwt: {
    secret:         required('JWT_SECRET'),
    expiresIn:      optional('JWT_EXPIRES_IN', '15m'),
    refreshExpires: optional('JWT_REFRESH_EXPIRES_IN', '7d'),
  },

  bcrypt: {
    rounds: parseInt(optional('BCRYPT_ROUNDS', '12'), 10),
  },

  ai: {
    apiUrl: optional('AI_API_URL', 'https://api.infomaniak.com/1/ai/openai/v1/chat/completions'),
    apiKey: required('AI_API_KEY'),
    model:  optional('AI_MODEL', 'openai/gpt-oss-120b'),
  },

  cors: {
    origin: optional('CORS_ORIGIN', 'https://beta.riskmanager.io'),
  },

  rateLimit: {
    windowMs: parseInt(optional('RATE_LIMIT_WINDOW_MS', '900000'), 10),
    max:      parseInt(optional('RATE_LIMIT_MAX', '100'), 10),
    authMax:  parseInt(optional('RATE_LIMIT_AUTH_MAX', '10'), 10),
  },
};

// JWT secret minimum 64 chars — fail fast
if (config.jwt.secret.length < 64) {
  throw new Error('JWT_SECRET must be at least 64 characters long');
}

module.exports = config;
