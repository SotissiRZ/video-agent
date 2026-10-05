// Shared UI helpers: icons, theme, language, API calls, toasts.
import { applyTranslations, getLang, t } from './i18n.js';

// Stroke icons (24×24, Lucide-style paths).
const ICONS = {
  logo: '<rect x="2.5" y="2.5" width="19" height="19" rx="5" fill="currentColor" stroke="none"/><path d="M10 8.5v7l6-3.5z" fill="var(--logo-play, #fff)" stroke="none"/>',
  sparkles: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z"/>',
  film: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18M3 7.5h4M3 12h18M3 16.5h4M17 7.5h4M17 16.5h4"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  send: '<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  trash: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  play: '<path d="M6 4l14 8-14 8z"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20z"/>',
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M19 10a7 7 0 0 1-14 0M12 17v5"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>',
  type: '<path d="M4 7V4h16v3M9 20h6M12 4v16"/>',
  layout: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>',
  zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  settings: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  external: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  youtube: '<rect x="2" y="5" width="20" height="14" rx="4"/><path d="m10 9 5 3-5 3z" fill="currentColor"/>',
  tiktok: '<path d="M14 3v11.5a3.5 3.5 0 1 1-3.5-3.5"/><path d="M14 3c.5 2.5 2.5 4.5 5 5"/>',
  linkedin: '<rect x="2" y="2" width="20" height="20" rx="3"/><path d="M7 10v7M7 7v.01M11 17v-4a2 2 0 0 1 4 0v4M11 10v7"/>',
  meta: '<path d="M3 15c0-4 2-8 4.5-8 3 0 5 8 7.5 8S21 13 21 11s-1-4-3-4c-2.5 0-4.5 4-6 6.5"/>',
  facebook: '<path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/>',
  instagram: '<rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><path d="M17.5 6.5h.01"/>',
};

export const icon = (name, size = 18) =>
  `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] ?? ''}</svg>`;

/** Replace <i data-icon="name"> placeholders. */
export const renderIcons = (root = document) => root.querySelectorAll('i[data-icon]').forEach((el) => (el.outerHTML = icon(el.dataset.icon, Number(el.dataset.size) || 18)));

export const $ = (id) => document.getElementById(id);
export const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const store = {
  get: (k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* private mode */
    }
  },
};

// ---- Theme ----------------------------------------------------------------------------
export const getTheme = () => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
export const setTheme = (theme) => {
  document.documentElement.dataset.theme = theme;
  store.set('va.theme', theme);
  document.querySelectorAll('[data-theme-toggle]').forEach(updateThemeButton);
};
const updateThemeButton = (btn) => {
  const dark = getTheme() === 'dark';
  btn.innerHTML = icon(dark ? 'sun' : 'moon');
  btn.title = t(dark ? 'common.light' : 'common.dark');
  btn.setAttribute('aria-label', `${t('common.theme')} : ${btn.title}`);
};

// ---- Language ---------------------------------------------------------------------------
const langListeners = new Set();
export const onLanguageChange = (fn) => langListeners.add(fn);
export const setLang = (lang, persist = true) => {
  document.documentElement.lang = lang;
  if (persist) store.set('va.lang', lang);
  applyTranslations();
  document.querySelectorAll('[data-lang-switch] button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
  document.querySelectorAll('[data-theme-toggle]').forEach(updateThemeButton);
  langListeners.forEach((fn) => fn(lang));
};
export const savedLang = () => store.get('va.lang');

/** Wire every theme toggle and FR/EN switch present in the page. */
export const initChrome = () => {
  renderIcons();
  document.querySelectorAll('[data-theme-toggle]').forEach((btn) => {
    updateThemeButton(btn);
    btn.addEventListener('click', () => setTheme(getTheme() === 'dark' ? 'light' : 'dark'));
  });
  document.querySelectorAll('[data-lang-switch]').forEach((group) => {
    group.innerHTML = ['fr', 'en'].map((l) => `<button type="button" data-lang="${l}" aria-pressed="${l === getLang()}">${l.toUpperCase()}</button>`).join('');
    group.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-lang]');
      if (b) setLang(b.dataset.lang);
    });
  });
  applyTranslations();
};

// ---- API ------------------------------------------------------------------------------
export class ApiError extends Error {
  constructor(status, body) {
    super(body.error || `HTTP ${status}`);
    this.status = status;
    this.code = body.code;
    this.body = body;
  }
}

export const api = async (path, init = {}) => {
  const res = await fetch(path, { ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) }, credentials: 'same-origin' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body);
  return body;
};
export const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body ?? {}) });

/** Translated message for an API error (known codes), else the server message. */
export const errorText = (err) => {
  if (err instanceof ApiError && err.code) {
    const key = `err.${err.code}`;
    const params = { ...err.body, platforms: (err.body.platforms ?? []).join(', ') };
    const text = t(key, params);
    if (text !== key) return text;
  }
  return err?.message || t('common.error');
};

// ---- Toasts ---------------------------------------------------------------------------
export const toast = (message, kind = 'info') => {
  let host = $('toasts');
  if (!host) {
    host = Object.assign(document.createElement('div'), { id: 'toasts', className: 'toasts' });
    host.setAttribute('role', 'status');
    document.body.append(host);
  }
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = `${icon(kind === 'error' ? 'alert' : kind === 'success' ? 'check' : 'info')}<span>${escapeHtml(message)}</span>`;
  host.append(el);
  setTimeout(() => el.classList.add('leaving'), 4200);
  setTimeout(() => el.remove(), 4600);
};
