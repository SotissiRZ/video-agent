/**
 * E-mail reminders for prepaid passes (mobile money does not renew by itself):
 * a few days before the end, then on expiry. Each reminder is sent once per pass period,
 * even with several server processes (the reminders table is the lock).
 */
import type { AppConfig } from '../config/config';
import type { Logger } from '../core/logger';
import { errorMessage } from '../core/errors';
import type { Db } from './db';
import { buildEmail, type Mailer } from './mail';
import { getPlan, PREPAID } from './plans';

interface Candidate {
  id: string;
  email: string;
  locale: string;
  plan: string;
  current_period_end: Date | string;
}

const DAY = 86_400_000;

export const sendPassReminders = async (db: Db, config: AppConfig, mailer: Mailer, baseUrl: string, logger: Logger, now = new Date()): Promise<number> => {
  const days = config.env.PASS_REMINDER_DAYS;
  if (!days) return 0;
  const select = (from: Date, to: Date) =>
    db.query<Candidate>(
      'SELECT id, email, locale, plan, current_period_end FROM users WHERE subscription_status = $1 AND current_period_end > $2 AND current_period_end <= $3',
      [PREPAID, from.toISOString(), to.toISOString()],
    );
  const batches: Array<['pass_soon' | 'pass_expired', Candidate[]]> = [
    ['pass_soon', await select(now, new Date(now.getTime() + days * DAY))],
    // Expired in the last 3 days (a server down at that moment still sends it).
    ['pass_expired', await select(new Date(now.getTime() - 3 * DAY), now)],
  ];
  let sent = 0;
  for (const [kind, users] of batches) {
    for (const user of users) {
      const end = new Date(user.current_period_end);
      const claimed = await db.query('INSERT INTO reminders (user_id, kind, period_end) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING user_id', [user.id, kind, end.toISOString()]);
      if (!claimed.length) continue;
      const locale = user.locale === 'en' ? 'en' : 'fr';
      const date = end.toLocaleDateString(locale === 'en' ? 'en-GB' : 'fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
      try {
        await mailer.send(buildEmail(kind, locale, `${baseUrl}/app#billing`, config.env.COMPANY_NAME, user.email, { plan: getPlan(config, user.plan).name, date }));
        sent++;
      } catch (err) {
        // Let the next run try again.
        await db.query('DELETE FROM reminders WHERE user_id = $1 AND kind = $2 AND period_end = $3', [user.id, kind, end.toISOString()]);
        logger.warn(`reminder ${kind} to ${user.email} failed: ${errorMessage(err)}`);
      }
    }
  }
  return sent;
};
