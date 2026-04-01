/* ============================================
   RISK MANAGER — i18n.js
   ONE CIRCLE IT SOLUTIONS
   ============================================ */

const i18n = (() => {

  let _locale = 'en';
  let _strings = {};

  // Charge le fichier de locale
  async function load(locale = 'en') {
    try {
      const res = await fetch(`/locales/${locale}.json`);
      if (!res.ok) throw new Error(`Locale ${locale} not found`);
      _strings = await res.json();
      _locale = locale;
      document.documentElement.lang = locale;
    } catch (e) {
      console.warn(`i18n: failed to load ${locale}, falling back to en`);
      if (locale !== 'en') await load('en');
    }
  }

  // Traduit une clé avec interpolation optionnelle
  // t('pulse.updated', { n: 5 }) → "5 min ago"
  function t(key, vars = {}) {
    let str = _strings[key] ?? key;
    Object.entries(vars).forEach(([k, v]) => {
      str = str.replace(`{{${k}}}`, v);
    });
    return str;
  }

  // Langue courante
  function locale() { return _locale; }

  // Liste des langues disponibles
  const AVAILABLE = [
    { code: 'en', label: 'English' },
    { code: 'fr', label: 'Français' },
    { code: 'nl', label: 'Nederlands' },
    { code: 'de', label: 'Deutsch' },
  ];

  // Met à jour le bouton de langue courant
  function renderLangSwitcher() {
    const btn = document.getElementById('langCurrentBtn');
    if (btn) btn.textContent = _locale.toUpperCase();
  }

  // Applique les traductions sur tous les éléments [data-i18n]
  function applyDOM() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
      el.textContent = t(el.getAttribute('data-i18n'));
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
    });
  }

  // Initialise depuis localStorage ou navigateur
  async function init() {
    const saved = localStorage.getItem('rm_locale');
    const browser = navigator.language?.split('-')[0];
    const supported = AVAILABLE.map(l => l.code);
    const locale = saved || (supported.includes(browser) ? browser : 'en');
    await load(locale);
    applyDOM();
    renderLangSwitcher();
  }

  // Change la langue
  async function setLocale(locale) {
    localStorage.setItem('rm_locale', locale);
    await load(locale);
    applyDOM();
    renderLangSwitcher();
  }

  return { init, load, t, locale: () => _locale, setLocale, applyDOM, AVAILABLE };

})();
