// Public site. Every promise follows /api/public/config: features that are not configured on this
// server (payments, publishing, songs, voice cloning) are not advertised, and every figure (quotas,
// durations, prices) comes from the admin settings.
import { api, escapeHtml, initChrome, onLanguageChange, $ } from './common.js';
import { formatDuration, t } from './i18n.js';
import { formatMoney, renderPlans } from './plans.js';

let config = null;
let signedIn = false;

const PLATFORM_NAMES = { youtube: 'YouTube', tiktok: 'TikTok', meta: 'Facebook, Instagram', linkedin: 'LinkedIn' };

const faqItems = (features) => [
  ['landing.faq.skills.q', 'landing.faq.skills.a'],
  ['landing.faq.free.q', 'landing.faq.free.a'],
  ['landing.faq.commercial.q', 'landing.faq.commercial.a'],
  features.voiceClone && ['landing.faq.voice.q', 'landing.faq.voice.a'],
  ['landing.faq.pay.q', features.cardSubscriptions ? 'landing.faq.pay.aCard' : 'landing.faq.pay.a'],
  ['landing.faq.lang.q', 'landing.faq.lang.a'],
  ['landing.faq.data.q', 'landing.faq.data.a'],
].filter(Boolean);

const render = () => {
  const features = config?.features ?? {};
  const commerce = config?.commerce ?? {};
  const plans = config?.plans ?? [];
  const free = plans.find((p) => p.id === 'free');
  const longest = Math.max(0, ...plans.map((p) => p.maxDurationSec ?? 0));
  const currency = features.mobileMoney || !features.moroccoPayments ? 'XOF' : 'MAD';
  const videoPrice = currency === 'XOF' ? commerce.videoPriceXof : commerce.videoPriceMad;
  const hasPayment = features.mobileMoney || features.moroccoPayments;

  $('heroNote').textContent = free ? t('landing.hero.note', { n: free.videosPerMonth }) : t('landing.hero.noteShort');
  $('howStep3').textContent = t(features.publish?.length ? 'landing.how.3.textPublish' : 'landing.how.3.text');
  $('featureVoice').textContent = t(features.voiceClone ? 'landing.f.voice.textClone' : 'landing.f.voice.text');
  $('featureFormats').textContent = t('landing.f.formats.text', { d: longest ? formatDuration(longest) : '5 min' });
  $('featurePublish').textContent = t('landing.f.publish.text', { platforms: (features.publish ?? []).map((p) => PLATFORM_NAMES[p] ?? p).join(', ') });
  $('africaPay').textContent = features.mobileMoney
    ? t('landing.africa.pay.mobile')
    : features.moroccoPayments
      ? t('landing.africa.pay.morocco')
      : t('landing.africa.pay.soon');
  $('pricingSubtitle').textContent = hasPayment && videoPrice ? t('landing.pricing.subtitle', { price: formatMoney(videoPrice, currency) }) : t('landing.pricing.subtitleShort');
  const on = (name) => {
    const value = features[name];
    return Boolean(Array.isArray(value) ? value.length : value);
  };
  document.querySelectorAll('[data-feature]').forEach((el) => (el.hidden = !on(el.dataset.feature)));
  document.querySelectorAll('[data-feature-off]').forEach((el) => (el.hidden = on(el.dataset.featureOff)));
  $('faqList').innerHTML = faqItems(features)
    .map(([q, a]) => `<details><summary>${escapeHtml(t(q))}</summary><p>${escapeHtml(t(a, { n: free?.videosPerMonth ?? 3, price: videoPrice ? formatMoney(videoPrice, currency) : '' }))}</p></details>`)
    .join('');

  if (config) {
    $('plans').innerHTML = renderPlans(plans, {
      features,
      action: (p) => ({ label: p.id === 'free' ? t('landing.start') : t('plan.choose', { name: t(`plan.${p.id}`) }), href: signedIn ? `/app#billing` : `/app#signup?plan=${p.id}` }),
    });
    const company = config.company ?? {};
    $('footerCompany').textContent = company.name || 'SOVID AI';
    if (company.email) {
      $('footerContact').hidden = false;
      $('footerContact').href = `mailto:${company.email}`;
      $('footerContact').textContent = t('landing.footer.contact');
    }
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
render();
Promise.all([
  api('/api/public/config').then((c) => (config = c)).catch(() => undefined),
  api('/api/me').then(() => (signedIn = true)).catch(() => undefined),
]).then(render);
