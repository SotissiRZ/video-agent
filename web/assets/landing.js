import { api, initChrome, onLanguageChange, $ } from './common.js';
import { t } from './i18n.js';
import { renderPlans } from './plans.js';

let config = null;
let signedIn = false;

const render = () => {
  if (config) {
    $('plans').innerHTML = renderPlans(config.plans, {
      action: (p) => ({ label: p.id === 'free' ? t('landing.start') : t('plan.choose', { name: t(`plan.${p.id}`) }), href: signedIn ? `/app#billing` : `/app#signup?plan=${p.id}` }),
    });
  }
  if (signedIn) {
    $('loginLink').hidden = true;
    $('startLink').textContent = t('landing.openApp');
    $('startLink').href = '/app';
    document.querySelectorAll('[data-start]').forEach((a) => (a.href = '/app'));
  }
};

initChrome();
$('year').textContent = new Date().getFullYear();
onLanguageChange(render);
Promise.all([
  api('/api/public/config').then((c) => (config = c)).catch(() => undefined),
  api('/api/me').then(() => (signedIn = true)).catch(() => undefined),
]).then(render);
