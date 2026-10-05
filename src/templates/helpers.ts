import type { CopyContext } from './types';

export const cap = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** Pick the French or English variant. */
export const tr = (ctx: CopyContext) => (fr: string, en: string): string => (ctx.lang === 'fr' ? fr : en);

/** "Chauffeurs au Burkina Faso" / "Small shop owners in Nigeria" / "" */
export const audienceLine = (ctx: CopyContext): string =>
  [cap(ctx.audience), ctx.locationPhrase].filter(Boolean).join(' ').trim();

/** "pour les chauffeurs" / "for small shop owners" / "pour vous" */
export const forAudience = (ctx: CopyContext): string => {
  const t = tr(ctx);
  if (!ctx.audience) return t('pour vous', 'for you');
  return t(`pour les ${ctx.audience}`, `for ${ctx.audience}`);
};

/** Join non-empty sentences with a space, ensuring final punctuation. */
export const sentences = (...parts: Array<string | undefined | false>): string =>
  parts
    .filter((p): p is string => Boolean(p && p.trim()))
    .map((p) => p.trim().replace(/\*/g, ''))
    .map((p) => (/[.!?…]$/.test(p) ? p : `${p}.`))
    .join(' ');
