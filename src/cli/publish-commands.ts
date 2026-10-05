/** CLI commands for social publishing: publish, captions, platforms, schedule, scheduler, auth. */
import path from 'node:path';
import readline from 'node:readline/promises';
import type { Command } from 'commander';
import { InvalidArgumentError } from 'commander';
import type { AppConfig } from '../config/config';
import { VideoAgentError } from '../core/errors';
import { createLogger } from '../core/logger';
import { resolveLLM } from '../llm/registry';
import { authLinkedIn, authMeta, authTikTok, authYouTube, updateEnvFile, type Credentials } from '../publish/auth';
import { platformStatus } from '../publish/registry';
import { ScheduleStore, startSchedulerLoop } from '../publish/scheduler';
import { ensureCaptions, loadJob, publishJob, type PublishOutcome } from '../publish/service';
import { composeText, isPlatformId, PLATFORM_IDS, type PlatformId } from '../publish/types';
import { PLATFORM_CONSTRAINTS } from '../publish/constraints';

/** "tiktok,instagram" | "all" → platform ids. */
export const parsePlatforms = (value: string): PlatformId[] => {
  if (value.trim() === 'all') return [...PLATFORM_IDS];
  const ids = value.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  for (const id of ids) if (!isPlatformId(id)) throw new InvalidArgumentError(`plateforme inconnue "${id}" (${PLATFORM_IDS.join(', ')}, all)`);
  return ids as PlatformId[];
};

/** ISO date or "YYYY-MM-DD HH:mm" (local time). */
export const parseDate = (value: string): Date => {
  const normalized = /^\d{4}-\d{2}-\d{2} \d{1,2}:\d{2}$/.test(value.trim()) ? value.trim().replace(' ', 'T') : value.trim();
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) throw new InvalidArgumentError('date invalide (ex. "2026-10-06 18:30" ou 2026-10-06T18:30:00+00:00)');
  return date;
};

const confirm = async (question: string): Promise<boolean> => {
  if (!process.stdin.isTTY) throw new VideoAgentError('Confirmation requise', 'Ajoutez --yes pour publier sans confirmation (scripts, tâches planifiées).');
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  const answer = await rl.question(`${question} (o/N) `);
  rl.close();
  return /^(o|oui|y|yes)$/i.test(answer.trim());
};

const printOutcomes = (outcomes: PublishOutcome[]) => {
  for (const o of outcomes) {
    const icon = o.ok ? (o.status === 'dry-run' ? '👁 ' : '✅') : '❌';
    process.stdout.write(`${icon} ${o.platform.padEnd(10)} ${o.status}${o.url ? `  ${o.url}` : ''}${o.message ? `  — ${o.message}` : ''}\n`);
    for (const w of o.warnings) process.stdout.write(`   ⚠ ${w}\n`);
  }
};

export interface PublishCliOptions {
  at?: Date;
  dryRun?: boolean;
  yes?: boolean;
  regenerateCaptions?: boolean;
}

/** Publish a job from the CLI: show captions, confirm, publish, print results. */
export const publishFromCli = async (config: AppConfig, jobDir: string, platforms: PlatformId[], opts: PublishCliOptions): Promise<boolean> => {
  const llm = (() => {
    try {
      return resolveLLM(config);
    } catch {
      return null;
    }
  })();
  const job = loadJob(jobDir);
  const captions = await ensureCaptions(config, job, platforms, { llm, regenerate: opts.regenerateCaptions });
  process.stderr.write(`\n📣 Publication de ${path.relative(process.cwd(), job.videoFile) || job.videoFile}${opts.at ? ` le ${opts.at.toLocaleString()}` : ''}\n`);
  for (const p of platforms) {
    process.stderr.write(`\n── ${p} ──\n${platforms.includes('youtube') && p === 'youtube' ? `Titre : ${captions[p]!.title}\n` : ''}${composeText(captions[p]!, PLATFORM_CONSTRAINTS[p].maxCaption)}\n`);
  }
  process.stderr.write(`\n(textes modifiables dans ${path.join(job.dir, 'captions.json')})\n\n`);
  if (!opts.dryRun && !opts.yes && !(await confirm(`Publier sur ${platforms.join(', ')} ?`))) {
    process.stderr.write('Publication annulée.\n');
    return false;
  }
  const { outcomes, warnings } = await publishJob(config, jobDir, {
    platforms,
    at: opts.at,
    dryRun: opts.dryRun,
    llm,
    onProgress: (platform, message) => process.stderr.write(`   ${platform} · ${message}\n`),
  });
  warnings.forEach((w) => process.stderr.write(`⚠  ${w}\n`));
  printOutcomes(outcomes);
  return outcomes.every((o) => o.ok);
};

export const registerPublishCommands = (program: Command, getConfig: () => AppConfig, envFile: () => string) => {
  program
    .command('publish')
    .description('publier une vidéo générée sur les réseaux sociaux')
    .argument('<job-dir>', 'dossier de la vidéo (output/<job>)')
    .option('--to <platforms>', `plateformes : ${PLATFORM_IDS.join(',')} ou all`, parsePlatforms)
    .option('--at <date>', 'date de publication programmée', parseDate)
    .option('--dry-run', 'afficher ce qui serait publié sans rien envoyer')
    .option('-y, --yes', 'ne pas demander de confirmation')
    .option('--regenerate-captions', 'réécrire les légendes (captions.json)')
    .action(async (jobDir: string, flags: { to?: PlatformId[]; at?: Date; dryRun?: boolean; yes?: boolean; regenerateCaptions?: boolean }) => {
      const config = getConfig();
      const platforms = flags.to ?? (config.env.VIDEO_AGENT_PUBLISH_PLATFORMS ? parsePlatforms(config.env.VIDEO_AGENT_PUBLISH_PLATFORMS) : []);
      if (!platforms.length) throw new VideoAgentError('Aucune plateforme', 'Utilisez --to tiktok,instagram ou définissez VIDEO_AGENT_PUBLISH_PLATFORMS.');
      const ok = await publishFromCli(config, jobDir, platforms, flags);
      process.exitCode = ok ? 0 : 1;
    });

  program
    .command('captions')
    .description('générer / afficher les légendes et hashtags de chaque plateforme')
    .argument('<job-dir>')
    .option('--to <platforms>', 'plateformes', parsePlatforms)
    .option('--regenerate', 'réécrire même si captions.json existe')
    .action(async (jobDir: string, flags: { to?: PlatformId[]; regenerate?: boolean }) => {
      const config = getConfig();
      const job = loadJob(jobDir);
      const platforms = flags.to ?? [...PLATFORM_IDS];
      const warnings: string[] = [];
      const captions = await ensureCaptions(config, job, platforms, { llm: (() => { try { return resolveLLM(config); } catch { return null; } })(), regenerate: flags.regenerate, warnings });
      warnings.forEach((w) => process.stderr.write(`⚠  ${w}\n`));
      for (const p of platforms) process.stdout.write(`\n── ${p} ── ${captions[p]!.title}\n${composeText(captions[p]!, PLATFORM_CONSTRAINTS[p].maxCaption)}\n`);
      process.stdout.write(`\n✏️  ${path.join(job.dir, 'captions.json')}\n`);
    });

  program
    .command('platforms')
    .description('état de la configuration des plateformes de publication')
    .action(() => {
      for (const s of platformStatus(getConfig())) {
        process.stdout.write(`${s.configured ? '✅' : '⬜'} ${s.label.padEnd(10)} ${s.configured ? s.notes.join(' · ') : `manque : ${s.missing.join(', ')}`}\n`);
      }
      process.stdout.write('\nConfiguration : "video-agent auth <youtube|tiktok|linkedin|meta>" et README § Publication.\n');
    });

  const schedule = program.command('schedule').description('publications programmées (planificateur local)');
  schedule
    .command('list', { isDefault: true })
    .description('lister les publications programmées')
    .action(() => {
      const entries = ScheduleStore.forConfig(getConfig()).list();
      if (!entries.length) process.stdout.write('Aucune publication programmée.\n');
      for (const e of entries) {
        process.stdout.write(`${e.id}  ${e.status.padEnd(9)} ${new Date(e.at).toLocaleString()}  ${e.platforms.join(',')}  ${path.basename(e.jobDir)}${e.error ? `  — ${e.error}` : ''}\n`);
      }
    });
  schedule
    .command('cancel')
    .argument('<id>')
    .description('annuler une publication programmée')
    .action((id: string) => {
      const ok = ScheduleStore.forConfig(getConfig()).cancel(id);
      process.stdout.write(ok ? `Publication ${id} annulée.\n` : `Aucune publication en attente avec l’id ${id}.\n`);
      process.exitCode = ok ? 0 : 1;
    });

  program
    .command('scheduler')
    .description('exécuter le planificateur local (publie les vidéos programmées à l’heure prévue)')
    .option('--interval <seconds>', 'intervalle de vérification', (v) => Number(v), 30)
    .action((flags: { interval: number }) => {
      const config = getConfig();
      const logger = createLogger(config.logLevel, 'scheduler');
      logger.info(`planificateur démarré (vérification toutes les ${flags.interval}s) — Ctrl+C pour arrêter`);
      startSchedulerLoop(
        ScheduleStore.forConfig(config),
        async (jobDir, platforms) => (await publishJob(config, jobDir, { platforms, llm: null })).outcomes,
        { intervalMs: flags.interval * 1000, logger },
      );
      setInterval(() => undefined, 1 << 30);
    });

  program
    .command('auth')
    .description('obtenir les jetons d’accès d’une plateforme (youtube, tiktok, linkedin, meta)')
    .argument('<platform>', 'youtube | tiktok | linkedin | meta')
    .option('--port <port>', 'port du serveur de retour local', (v) => Number(v), 8765)
    .option('--redirect-uri <uri>', 'redirect URI enregistrée dans votre application développeur')
    .option('--manual', 'coller l’URL de retour au lieu d’utiliser un serveur local')
    .option('--organization <id>', 'LinkedIn : publier au nom d’une page entreprise (id numérique)')
    .option('--token <token>', 'Meta : jeton utilisateur de courte durée (Graph API Explorer)')
    .option('--save', 'écrire les valeurs obtenues dans .env')
    .action(async (platform: string, flags: { port: number; redirectUri?: string; manual?: boolean; organization?: string; token?: string; save?: boolean }) => {
      const config = getConfig();
      const redirectUri = flags.redirectUri ?? `http://${platform === 'youtube' ? '127.0.0.1' : 'localhost'}:${flags.port}/callback`;
      const flow = {
        redirectUri,
        // In Docker the callback server must listen on all interfaces (port published by compose).
        bindHost: process.env.VIDEO_AGENT_AUTH_BIND_HOST || undefined,
        prompt: (url: string) => process.stderr.write(`\n1. Ouvrez cette adresse dans votre navigateur et autorisez l’application :\n\n${url}\n\n${flags.manual ? '2. Copiez l’URL complète de la page vers laquelle vous êtes redirigé.\n' : `2. Attente du retour sur ${redirectUri} …\n`}`),
        readRedirect: flags.manual
          ? async () => {
              const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
              const answer = await rl.question('URL de retour : ');
              rl.close();
              return answer.trim();
            }
          : undefined,
      };
      let credentials: Credentials;
      switch (platform) {
        case 'youtube':
          credentials = await authYouTube(config, flow);
          break;
        case 'linkedin':
          credentials = await authLinkedIn(config, flow, flags.organization);
          break;
        case 'tiktok':
          credentials = await authTikTok(config, flow);
          break;
        case 'meta': {
          if (!flags.token) throw new VideoAgentError('--token requis', 'Générez un jeton utilisateur dans le Graph API Explorer (permissions pages_manage_posts, pages_read_engagement, pages_show_list, instagram_basic, instagram_content_publish) puis : video-agent auth meta --token <jeton>');
          const accounts = await authMeta(config, flags.token);
          if (!accounts.length) throw new VideoAgentError('Aucune Page Facebook accessible avec ce jeton.');
          accounts.forEach((a, i) => process.stdout.write(`${i + 1}. Page "${a.pageName}" (${a.pageId})${a.instagramUserId ? ` — Instagram @${a.instagramUsername ?? '?'} (${a.instagramUserId})` : ' — pas de compte Instagram professionnel lié'}\n`));
          const chosen = accounts[0]!;
          if (accounts.length > 1) process.stdout.write(`\nPage retenue : "${chosen.pageName}" (modifiez FACEBOOK_PAGE_ID/FACEBOOK_PAGE_ACCESS_TOKEN pour en choisir une autre)\n`);
          credentials = {
            FACEBOOK_PAGE_ID: chosen.pageId,
            FACEBOOK_PAGE_ACCESS_TOKEN: chosen.pageToken,
            ...(chosen.instagramUserId ? { INSTAGRAM_USER_ID: chosen.instagramUserId } : {}),
          };
          break;
        }
        default:
          throw new VideoAgentError(`Plateforme inconnue : ${platform}`, 'youtube | tiktok | linkedin | meta');
      }
      if (flags.save) {
        updateEnvFile(envFile(), credentials);
        process.stdout.write(`\n✅ ${Object.keys(credentials).join(', ')} enregistré(s) dans ${envFile()}\n`);
      } else {
        process.stdout.write(`\n✅ Ajoutez ceci à votre fichier .env (ou relancez avec --save) :\n\n${Object.entries(credentials).map(([k, v]) => `${k}=${v}`).join('\n')}\n`);
      }
    });
};
