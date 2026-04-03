/* ============================================
   RISK MANAGER — auth.js
   ONE CIRCLE IT SOLUTIONS
   Auth via Supabase
   ============================================ */

let _supabase   = null;
let currentUser = null;
let currentEnv  = null;
let currentRole = null;

function getClient() {
  if (!_supabase) {
    const { createClient } = window.supabase;
    _supabase = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON, {
      auth: {
        autoRefreshToken:   true,
        persistSession:     true,
        detectSessionInUrl: false,
      },
    });
  }
  return _supabase;
}

async function login(email, password) {
  const sb = getClient();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  await loadUserProfile(data.user.id);
  return currentUser;
}

async function logout() {
  const sb = getClient();
  await sb.auth.signOut({ scope: 'global' });
  currentUser = null;
  currentEnv  = null;
  currentRole = null;
  sessionStorage.clear();
  window.location.href = 'index.html';
}

async function loadUserProfile(authUserId) {
  const sb = getClient();
  const { data, error } = await sb
    .from('rm_users')
    .select('*')
    .eq('auth_user_id', authUserId)
    .eq('active', true)
    .single();

  if (error || !data) throw new Error('User profile not found in RM');

  currentUser = data;
  currentRole = data.role;

  const { data: env } = await sb
    .from('rm_environments')
    .select('*')
    .eq('id', data.environment_id)
    .single();

  currentEnv = env;

  sessionStorage.setItem('rm_user', JSON.stringify(currentUser));
  sessionStorage.setItem('rm_env',  JSON.stringify(currentEnv));

  return currentUser;
}

/**
 * requireAuth — vérifie la session côté SERVEUR via getUser().
 * Pas de cache local — vrai appel API Supabase.
 * Redirige vers index.html si pas authentifié.
 */
async function requireAuth() {
  const sb = getClient();

  const { data: { user }, error } = await sb.auth.getUser();

  if (error || !user) {
    window.location.href = 'index.html';
    return null;
  }

  const cached = sessionStorage.getItem('rm_user');
  if (cached) {
    currentUser = JSON.parse(cached);
    currentEnv  = JSON.parse(sessionStorage.getItem('rm_env') || 'null');
    currentRole = currentUser.role;
    return currentUser;
  }

  try {
    await loadUserProfile(user.id);
    return currentUser;
  } catch (e) {
    console.error('Profile load failed:', e.message);
    window.location.href = 'index.html';
    return null;
  }
}

function getUser()        { return currentUser; }
function getEnvironment() { return currentEnv; }
function getRole()        { return currentRole; }
function getEnvId()       { return currentEnv?.id || currentUser?.environment_id; }
function isAdmin()        { return currentRole === 'risk_leader'; }
function isRiskManager()  { return currentRole === 'risk_leader'; }
function isRiskLeader()   { return currentRole === 'risk_leader'; }
function isRiskOwner()    { return currentRole === 'risk_owner' || currentRole === 'risk_leader'; }
function isAnalyst()      { return currentRole === 'analyst'; }
