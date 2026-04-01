/* ============================================
   RISK MANAGER — auth.js
   ONE CIRCLE IT SOLUTIONS
   ============================================ */

const Auth = (() => {

  // Connexion via Supabase Auth
  async function login(email, password) {
    // TODO: brancher sur Supabase
    // const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    // if (error) throw error;
    // return data;
    throw new Error('Auth not yet connected');
  }

  // Déconnexion
  async function logout() {
    // TODO: await supabase.auth.signOut();
    window.location.href = '/index.html';
  }

  // Récupère la session courante
  async function getSession() {
    // TODO: return await supabase.auth.getSession();
    return null;
  }

  // Récupère le user courant
  async function getUser() {
    // TODO: const { data } = await supabase.auth.getUser();
    // return data.user;
    return null;
  }

  // Vérifie si l'user est ADMIN de son environment
  async function isAdmin(environmentId) {
    // TODO: vérifier le rôle dans la table users via RLS
    return false;
  }

  // Redirige vers login si pas de session
  async function requireAuth() {
    const session = await getSession();
    if (!session) {
      window.location.href = '/index.html';
    }
    return session;
  }

  return { login, logout, getSession, getUser, isAdmin, requireAuth };

})();
