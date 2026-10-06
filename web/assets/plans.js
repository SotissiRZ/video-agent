// Plan cards shared by the pricing section (landing) and the Billing page (app).
import { escapeHtml, icon } from './common.js';
import { formatDuration, getLang, t } from './i18n.js';

const CURRENCY_LABEL = { XOF: 'FCFA', MAD: 'MAD' };

/** "10 000 FCFA" */
export const formatMoney = (amount, currency) => `${new Intl.NumberFormat(getLang() === 'fr' ? 'fr-FR' : 'en-US').format(amount)} ${CURRENCY_LABEL[currency] ?? currency}`;

/** Main price + alternatives: local passes (FCFA, MAD) first, else the card subscription label. */
const priceHtml = (p) => {
  if (p.price === '0') return `<div class="price">0 <small>${escapeHtml(t('common.perMonth'))}</small></div>`;
  const local = Object.entries(p.localPrices ?? {});
  if (local.length) {
    const [[cur, amount], ...others] = local;
    return `<div class="price">${escapeHtml(formatMoney(amount, cur))} <small>${escapeHtml(t('plan.perPass'))}</small></div>${others.length ? `<div class="hint">${escapeHtml(t('plan.or', { price: others.map(([c, a]) => formatMoney(a, c)).join(' · ') }))}</div>` : ''}`;
  }
  return `<div class="price">${escapeHtml(p.price)} <small>${escapeHtml(t('common.perMonth'))}</small></div>`;
};

/**
 * @param plans plans from /api/public/config
 * @param opts.current id of the user's plan (app), opts.action(plan) → one action or an array of
 *        actions {label, href?, attrs?, disabled?, primary?}
 */
export const renderPlans = (plans, opts = {}) =>
  plans
    .map((p) => {
      const featured = p.id === 'creator';
      const features = [
        [true, t('plan.videos', { n: p.videosPerMonth })],
        [true, t('plan.songs', { n: p.songsPerMonth })],
        [true, t('plan.minutes', { n: p.minutesPerMonth })],
        [true, t('plan.maxDuration', { d: formatDuration(p.maxDurationSec) })],
        [p.publish, t('plan.publish')],
        [!p.badge, p.badge ? t('plan.badge') : t('plan.noBadge')],
      ];
      const raw = opts.action?.(p);
      const actions = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter(Boolean);
      const buttons = actions
        .map((a, i) => {
          const cls = `btn ${a.primary ?? (featured && i === 0) ? 'btn-primary' : 'btn-secondary'} btn-block`;
          const inner = `${a.icon ? icon(a.icon, 16) : ''}<span>${escapeHtml(a.label)}</span>`;
          return a.href ? `<a class="${cls}" href="${escapeHtml(a.href)}">${inner}</a>` : `<button type="button" class="${cls}" ${a.disabled ? 'disabled' : ''} ${a.attrs ?? ''}>${inner}</button>`;
        })
        .join('');
      return `<div class="card plan-card ${featured ? 'featured' : ''}">
        ${featured ? `<span class="badge primary ribbon">${escapeHtml(t('plan.popular'))}</span>` : ''}
        <div>
          <h3>${escapeHtml(t(`plan.${p.id}`))} ${opts.current === p.id ? `<span class="badge success">${escapeHtml(t('plan.current'))}</span>` : ''}</h3>
          <p class="muted small">${escapeHtml(t(`plan.${p.id}.desc`))}</p>
        </div>
        <div>${priceHtml(p)}</div>
        <ul>${features.map(([on, text]) => `<li class="${on ? '' : 'off'}">${icon(on ? 'check' : 'x', 16)}<span>${escapeHtml(text)}</span></li>`).join('')}</ul>
        <div style="display:grid;gap:8px">${buttons}</div>
      </div>`;
    })
    .join('');
