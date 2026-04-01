/* ============================================
   RISK MANAGER — config.js
   ONE CIRCLE IT SOLUTIONS
   NE JAMAIS COMMITTER LES VRAIES CLÉS
   ============================================ */

const CONFIG = {
  ENV: window.location.hostname.includes('beta') || !window.location.hostname.includes('www') ? 'beta' : 'prod',

  SUPABASE_URL:  'VOTRE_SUPABASE_URL',
  SUPABASE_ANON: 'VOTRE_SUPABASE_ANON_KEY',

  RS_API_URL:    'https://api.riskstudio.io/v1',
  RS_API_TOKEN:  'VOTRE_RS_API_TOKEN',

  GROQ_ENDPOINT: 'https://api.groq.com/openai/v1/chat/completions',
  GROQ_MODEL:    'llama3-8b-8192',

  APP_VERSION:   '0.1.0',
};
