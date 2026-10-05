// Plan cards shared by the pricing section (landing) and the Billing page (app).
import { escapeHtml, icon } from './common.js';
import { formatDuration, t } from './i18n.js';

const priceLabel = (plan) => (plan.price === '0' ? '0' : plan.price);

/**
 * @param plans plans from /api/public/config
 * @param opts.current id of the user's plan (app), opts.action(plan) → {label, href?, attrs?, disabled?}
 */
export const renderPlans = (plans, opts = {}) =>
  plans
    .map((p) => {
      const featured = p.id === 'creator';
      const features = [
        [true, t('plan.videos', { n: p.videosPerMonth })],
        [true, t('plan.minutes', { n: p.minutesPerMonth })],
        [true, t('plan.maxDuration', { d: formatDuration(p.maxDurationSec) })],
        [p.publish, t('plan.publish')],
        [!p.badge, p.badge ? t('plan.badge') : t('plan.noBadge')],
      ];
      const action = opts.action?.(p);
      const button = action
        ? action.href
          ? `<a class="btn ${featured ? 'btn-primary' : 'btn-secondary'} btn-block" href="${escapeHtml(action.href)}">${escapeHtml(action.label)}</a>`
          : `<button type="button" class="btn ${featured ? 'btn-primary' : 'btn-secondary'} btn-block" ${action.disabled ? 'disabled' : ''} ${action.attrs ?? ''}>${escapeHtml(action.label)}</button>`
        : '';
      return `<div class="card plan-card ${featured ? 'featured' : ''}">
        ${featured ? `<span class="badge primary ribbon">${escapeHtml(t('plan.popular'))}</span>` : ''}
        <div>
          <h3>${escapeHtml(t(`plan.${p.id}`))} ${opts.current === p.id ? `<span class="badge success">${escapeHtml(t('plan.current'))}</span>` : ''}</h3>
          <p class="muted small">${escapeHtml(t(`plan.${p.id}.desc`))}</p>
        </div>
        <div class="price">${escapeHtml(priceLabel(p))}${p.price === '0' ? ' €' : ''} <small>${escapeHtml(t('common.perMonth'))}</small></div>
        <ul>${features.map(([on, text]) => `<li class="${on ? '' : 'off'}">${icon(on ? 'check' : 'x', 16)}<span>${escapeHtml(text)}</span></li>`).join('')}</ul>
        ${button}
      </div>`;
    })
    .join('');
