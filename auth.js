/* ============================================
   RISK MANAGER — auth.js
   Gestion auth via Supabase
   ============================================ */

let _supabase = null;

function getSupabase() {
  if (!_supabase) {
    _supabase = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON);
  }
  return _supabase;
}

// ── État de l'utilisateur courant ──
let currentUser  = null;
let currentEnv   = null;
let currentRole  = null;

/**
 * Login
 */
async function login(email, password) {
  const sb = getSupabase();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;

  // Récupérer le profil RM
  await loadUserProfile(data.user.id);
  return currentUser;
}

/**
 * Logout
 */
async function logout() {
  const sb = getSupabase();
  await sb.auth.signOut();
  currentUser = null;
  currentEnv  = null;
  currentRole = null;
  window.location.href = 'index.html';
}

/**
 * Charger le profil utilisateur depuis rm_users
 */
async function loadUserProfile(authUserId) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('rm_users')
    .select('*, rm_environments(id, name, risk_prefix)')
    .eq('auth_user_id', authUserId)
    .eq('active', true)
    .single();

  if (error || !data) throw new Error('User profile not found');

  currentUser = data;
  currentEnv  = data.rm_environments;
  currentRole = data.role;

  // Stocker en session
  sessionStorage.setItem('rm_user', JSON.stringify(currentUser));
  sessionStorage.setItem('rm_env',  JSON.stringify(currentEnv));

  return currentUser;
}

/**
 * Vérifier si l'utilisateur est connecté
 * À appeler sur chaque page protégée
 */
async function requireAuth() {
  const sb = getSupabase();
  const { data: { session } } = await sb.auth.getSession();

  if (!session) {
    window.location.href = 'index.html';
    return null;
  }

  // Charger depuis session storage si dispo
  const cached = sessionStorage.getItem('rm_user');
  if (cached) {
    currentUser = JSON.parse(cached);
    currentEnv  = JSON.parse(sessionStorage.getItem('rm_env'));
    currentRole = currentUser.role;
    return currentUser;
  }

  await loadUserProfile(session.user.id);
  return currentUser;
}

/**
 * Getters
 */
function getUser()        { return currentUser; }
function getEnvironment() { return currentEnv; }
function getRole()        { return currentRole; }
function getEnvId()       { return currentEnv?.id; }
function isAdmin()        { return currentRole === 'admin'; }
function isRiskManager()  { return currentRole === 'risk_manager' || currentRole === 'admin'; }

/**
 * Client Supabase pour les autres modules
 */
function getClient() { return getSupabase(); }
