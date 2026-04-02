'use strict';

const { z } = require('zod');

/**
 * Middleware de validation Zod.
 * Valide req.body contre un schéma avant d'atteindre le handler.
 * Retourne 400 avec les erreurs de validation détaillées.
 *
 * @param {z.ZodSchema} schema
 */
function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const errors = result.error.errors.map(e => ({
        field:   e.path.join('.'),
        message: e.message,
      }));
      return res.status(400).json({ error: 'Validation failed', details: errors });
    }
    req.body = result.data; // données nettoyées et typées
    next();
  };
}

// ── SCHÉMAS ──

const loginSchema = z.object({
  email:    z.string().email().max(255).toLowerCase(),
  password: z.string().min(8).max(128),
});

const createRiskSchema = z.object({
  name:         z.string().min(3).max(500).trim(),
  description:  z.string().max(5000).trim().optional(),
  asset:        z.string().max(255).trim().optional(),
  severity:     z.enum(['low', 'medium', 'high', 'critical']).optional(),
  likelihood:   z.number().int().min(1).max(5).optional(),
  impact:       z.number().int().min(1).max(5).optional(),
  decision:     z.enum(['Reduce', 'Accept', 'Transfer', 'Avoid']).optional(),
  visibility:   z.enum(['PRIVATE', 'TEAM']).default('PRIVATE'),
  review_date:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  tags:         z.array(z.string().max(100)).max(20).optional(),
});

const updateRiskSchema = createRiskSchema.partial().extend({
  status: z.enum([
    'DRAFT', 'IN ANALYSIS', 'IN REVIEW',
    'IN TREATMENT', 'PENDING APPROVAL', 'MONITORED'
  ]).optional(),
});

const createJournalEntrySchema = z.object({
  entry_text: z.string().min(1).max(10000).trim(),
});

const createUserSchema = z.object({
  email:      z.string().email().max(255).toLowerCase(),
  first_name: z.string().min(1).max(100).trim(),
  last_name:  z.string().min(1).max(100).trim(),
  role:       z.enum(['admin', 'risk_manager', 'analyst']),
  password:   z.string().min(12).max(128),
  job_title:  z.string().max(255).optional(),
});

const changePasswordSchema = z.object({
  current_password: z.string().min(1),
  new_password:     z.string().min(12).max(128),
}).refine(data => data.current_password !== data.new_password, {
  message: 'New password must differ from current password',
  path: ['new_password'],
});

module.exports = {
  validate,
  schemas: {
    login:            loginSchema,
    createRisk:       createRiskSchema,
    updateRisk:       updateRiskSchema,
    createJournalEntry: createJournalEntrySchema,
    createUser:       createUserSchema,
    changePassword:   changePasswordSchema,
  },
};
