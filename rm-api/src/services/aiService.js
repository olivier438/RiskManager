'use strict';

const config = require('../config/env');
const logger = require('../utils/logger');

/**
 * Service IA — Infomaniak AI (openai/gpt-oss-120b).
 * Utilisé pour la détection automatique de tags sur les risques.
 *
 * Règles de sécurité :
 * - Jamais de donnée personnelle envoyée à l'IA
 * - Jamais de token ou credential dans les prompts
 * - Timeout strict pour éviter les blocages
 * - Fallback silencieux si l'IA est indisponible
 */

const ALLOWED_TAGS = [
  '#access-control', '#iam', '#mfa', '#authentication',
  '#network', '#firewall', '#vpn', '#segmentation',
  '#patch', '#vulnerability', '#cve',
  '#backup', '#bcm', '#bcp', '#continuity',
  '#cloud', '#saas', '#paas',
  '#data-exposure', '#dlp', '#encryption',
  '#supply-chain', '#vendor', '#third-party',
  '#ransomware', '#malware', '#phishing',
  '#irt', '#incident', '#detection',
  '#governance', '#policy', '#compliance',
  '#nis2', '#gdpr', '#iso27001',
  '#physical', '#server', '#endpoint',
  '#asset-management', '#cmdb',
];

/**
 * Détecte les tags pertinents depuis le texte d'un risque.
 * Retourne un tableau de tags normalisés.
 *
 * @param {string} name        - Nom du risque
 * @param {string} description - Description du risque
 * @returns {Promise<string[]>}
 */
async function detectTags(name, description = '') {
  if (!name?.trim()) return [];

  const prompt = buildPrompt(name, description);

  try {
    const response = await fetchWithTimeout(
      config.ai.apiUrl,
      {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${config.ai.apiKey}`,
        },
        body: JSON.stringify({
          model:      config.ai.model,
          max_tokens: 150,
          temperature: 0,
          messages: [
            {
              role: 'system',
              content: 'You are a cybersecurity risk classification assistant. Respond only with a JSON array of tags. No explanation.',
            },
            { role: 'user', content: prompt },
          ],
        }),
      },
      5000 // 5 secondes timeout
    );

    if (!response.ok) {
      logger.warn('AI API non-200 response', { status: response.status });
      return [];
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content?.trim();
    if (!content) return [];

    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed)) return [];

    // Filtrer : uniquement les tags de la liste autorisée
    return parsed
      .filter(tag => ALLOWED_TAGS.includes(tag))
      .slice(0, 10);

  } catch (err) {
    // Fallback silencieux — l'IA est optionnelle
    logger.warn('AI tag detection failed, continuing without tags', {
      error: err.message,
    });
    return [];
  }
}

function buildPrompt(name, description) {
  const text = [name, description].filter(Boolean).join('. ');
  return `Analyze this cybersecurity risk and return a JSON array of relevant tags.

Risk: "${text.substring(0, 500)}"

Choose only from these tags:
${ALLOWED_TAGS.join(', ')}

Return ONLY a JSON array like: ["#access-control", "#mfa"]
Maximum 5 tags. Only tags that clearly apply.`;
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { detectTags };
