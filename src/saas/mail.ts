/**
 * Transactional e-mails (address verification, password reset) through any SMTP server
 * (Brevo, Resend, Mailjet, OVH, Gmail…). Without SMTP_URL the links are written to the logs.
 */
import type { AppConfig } from '../config/config';
import type { Logger } from '../core/logger';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  readonly kind: 'smtp' | 'log';
  send(message: MailMessage): Promise<void>;
}

export const createMailer = (config: AppConfig, logger: Logger): Mailer => {
  const url = config.env.SMTP_URL;
  if (!url) {
    return {
      kind: 'log',
      send: async (m) => logger.info(`✉️  E-mail (SMTP_URL non configuré) à ${m.to} — ${m.subject}\n${m.text}`),
    };
  }
  let transport: Promise<{ sendMail: (o: Record<string, unknown>) => Promise<unknown> }> | undefined;
  return {
    kind: 'smtp',
    send: async (m) => {
      transport ??= import('nodemailer').then((n) => n.default.createTransport(url));
      await (await transport).sendMail({ from: config.env.MAIL_FROM, to: m.to, subject: m.subject, text: m.text, html: m.html });
    },
  };
};

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const COPY = {
  verify: {
    fr: { subject: 'Confirmez votre adresse e-mail', intro: 'Bienvenue ! Confirmez votre adresse pour profiter pleinement de votre compte.', button: 'Confirmer mon adresse', outro: 'Ce lien est valable 48 heures. Si vous n’avez pas créé de compte, ignorez ce message.' },
    en: { subject: 'Confirm your email address', intro: 'Welcome! Confirm your address to get the most out of your account.', button: 'Confirm my address', outro: 'This link is valid for 48 hours. If you did not create an account, ignore this message.' },
  },
  reset: {
    fr: { subject: 'Réinitialisez votre mot de passe', intro: 'Vous avez demandé à changer votre mot de passe.', button: 'Choisir un nouveau mot de passe', outro: 'Ce lien est valable 1 heure. Si vous n’êtes pas à l’origine de cette demande, ignorez ce message : votre mot de passe reste inchangé.' },
    en: { subject: 'Reset your password', intro: 'You asked to change your password.', button: 'Choose a new password', outro: 'This link is valid for 1 hour. If you did not ask for it, ignore this message: your password stays the same.' },
  },
};

export const buildEmail = (kind: keyof typeof COPY, locale: string, link: string, company: string, to: string): MailMessage => {
  const c = COPY[kind][locale === 'en' ? 'en' : 'fr'];
  const subject = `${c.subject} — ${company}`;
  const text = `${c.intro}\n\n${c.button} : ${link}\n\n${c.outro}\n\n— ${company}`;
  const html = `<!doctype html><html><body style="margin:0;background:#f6f7f9;font-family:Segoe UI,Arial,sans-serif;color:#0e1525">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px"><tr><td align="center">
    <table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border:1px solid #e3e6ec;border-radius:14px;padding:32px">
      <tr><td style="font-size:18px;font-weight:700;padding-bottom:16px">${escape(company)}</td></tr>
      <tr><td style="font-size:15px;line-height:1.6;padding-bottom:24px">${escape(c.intro)}</td></tr>
      <tr><td style="padding-bottom:24px"><a href="${escape(link)}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:10px">${escape(c.button)}</a></td></tr>
      <tr><td style="font-size:13px;color:#6b7386;line-height:1.5">${escape(c.outro)}<br><br><span style="word-break:break-all">${escape(link)}</span></td></tr>
    </table>
  </td></tr></table></body></html>`;
  return { to, subject, text, html };
};
