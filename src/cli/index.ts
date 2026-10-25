/**
 * video-agent CLI.
 *
 *   video-agent "Crée une vidéo verticale de 30 secondes pour promouvoir Sirago..."
 *   video-agent templates | styles | formats | providers | doctor
 *   video-agent render <job-dir>      re-render an edited storyboard
 *   video-agent studio <job-dir>      open the job in Remotion Studio
 *   video-agent web                   local web interface
 */
import { LANGUAGE_CODES } from '../core/languages';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command, InvalidArgumentError, Option } from 'commander';
import { runDoctor, providerStatus } from '../agent/doctor';
import { jobPaths } from '../agent/job';
import { VideoAgent } from '../agent/orchestrator';
import { findPackageRoot, loadConfig, type AppConfig } from '../config/config';
import { VideoAgentError, errorMessage } from '../core/errors';
import { FORMAT_PRESETS, OUTPUT_FORMATS, isOutputFormat, type OutputFormat } from '../core/formats';
import type { VideoOptions } from '../core/types';
import { remotionEntryPoint, renderStoryboard } from '../render/renderer';
import { STYLES } from '../remotion/contract/styles';
import { validateStoryboard } from '../storyboard/validator';
import { listTemplates } from '../templates/registry';
import { startSaasServer } from '../saas/server';
import { connectDatabase } from '../saas/db';
import { resolveAppSecret, Vault } from '../saas/crypto';
import { Worker } from '../saas/worker';
import { createLogger } from '../core/logger';
import { createProgressPrinter } from './progress';
import { parseDate, parsePlatforms, publishFromCli, registerPublishCommands } from './publish-commands';
import { PLATFORM_IDS, type PlatformId } from '../publish/types';

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = findPackageRoot(here);
const version = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8')).version as string;
  } catch {
    return '0.0.0';
  }
})();

const config = (): AppConfig => loadConfig({ packageRoot });

const positiveInt = (name: string) => (value: string) => {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new InvalidArgumentError(`${name} must be a positive integer`);
  return n;
};

const outputFormat = (value: string): OutputFormat => {
  if (!isOutputFormat(value)) throw new InvalidArgumentError(`expected one of ${OUTPUT_FORMATS.join(', ')}`);
  return value;
};

const resolution = (value: string) => {
  const m = /^(\d{2,5})x(\d{2,5})$/i.exec(value.trim());
  if (!m) throw new InvalidArgumentError('expected WIDTHxHEIGHT, e.g. 1920x1080');
  return { width: Number(m[1]), height: Number(m[2]) };
};

interface GenerateFlags {
  format?: string;
  resolution?: { width: number; height: number };
  duration?: number;
  fps?: number;
  style?: string;
  template?: string;
  language?: string;
  outputFormat?: OutputFormat;
  voice?: boolean;
  music?: boolean;
  subtitles?: boolean;
  images?: boolean;
  aiVideo?: boolean;
  llm?: string;
  render?: boolean;
  out?: string;
  offline?: boolean;
  json?: boolean;
  stock?: boolean;
  media?: 'all' | 'visual' | 'none';
  publish?: PlatformId[] | true;
  publishAt?: Date;
  yes?: boolean;
}

const generate = async (promptParts: string[], flags: GenerateFlags) => {
  const prompt = promptParts.join(' ').trim();
  if (!prompt) {
    program.help({ error: true });
  }
  const cfg = config();
  const options: VideoOptions = {
    format: flags.format,
    width: flags.resolution?.width,
    height: flags.resolution?.height,
    durationSec: flags.duration,
    fps: flags.fps,
    style: flags.style,
    template: flags.template,
    language: flags.language,
    outputFormat: flags.outputFormat,
    voice: flags.voice,
    music: flags.music,
    subtitles: flags.subtitles,
    generateImages: flags.images,
    generateVideo: flags.aiVideo,
    llmProvider: flags.llm,
    skipRender: flags.render === false,
    outDir: flags.out ? path.resolve(flags.out) : undefined,
    offline: flags.offline,
    stock: flags.stock,
    mediaCoverage: flags.media,
  };
  const controller = new AbortController();
  process.once('SIGINT', () => {
    process.stderr.write('\nCancelling…\n');
    controller.abort(new Error('Cancelled by user'));
  });
  const agent = new VideoAgent(cfg);
  const result = await agent.run({ prompt, options }, { onProgress: createProgressPrinter(), signal: controller.signal });

  if (flags.json) {
    process.stdout.write(
      `${JSON.stringify({ jobId: result.jobId, jobDir: result.jobDir, videoFile: result.videoFile, posterFile: result.posterFile, storyboardFile: result.storyboardFile, providers: result.providers, warnings: result.warnings }, null, 2)}\n`,
    );
    return;
  }
  const rel = (p?: string) => (p ? path.relative(process.cwd(), p) || p : '—');
  process.stderr.write('\n');
  for (const w of result.warnings) process.stderr.write(`⚠  ${w}\n`);
  process.stdout.write(
    [
      `✅ ${result.concept.title}`,
      `   Vidéo       : ${rel(result.videoFile)}`,
      `   Miniature   : ${rel(result.posterFile)}`,
      `   Storyboard  : ${rel(result.storyboardFile)}`,
      `   Dossier     : ${rel(result.jobDir)}`,
      `   Fournisseurs: planner=${result.providers.planner} stock=${result.providers.stock} images IA=${result.providers.image} voix=${result.providers.voice} musique=${result.providers.music}`,
      ...(result.credits.length ? [`   Crédits     : ${rel(path.join(result.jobDir, 'credits.md'))}`] : []),
      '',
    ].join('\n'),
  );

  if (flags.publish && result.videoFile) {
    const platforms = flags.publish === true ? (cfg.env.VIDEO_AGENT_PUBLISH_PLATFORMS ? parsePlatforms(cfg.env.VIDEO_AGENT_PUBLISH_PLATFORMS) : []) : flags.publish;
    if (!platforms.length) throw new VideoAgentError('Aucune plateforme de publication', 'Utilisez --publish tiktok,instagram ou définissez VIDEO_AGENT_PUBLISH_PLATFORMS.');
    const ok = await publishFromCli(cfg, result.jobDir, platforms, { at: flags.publishAt, yes: flags.yes });
    process.exitCode = ok ? 0 : 1;
  }
};

const program = new Command();
program
  .name('video-agent')
  .description('Autonomous video generation agent powered by Remotion.')
  .version(version)
  .showHelpAfterError();

program
  .command('generate', { isDefault: true })
  .description('generate a video from a natural-language brief')
  .argument('[prompt...]', 'what the video should be about')
  .addOption(new Option('-f, --format <format>', `format preset (${FORMAT_PRESETS.map((f) => f.id).join(', ')}) or WIDTHxHEIGHT`))
  .option('-r, --resolution <WxH>', 'exact resolution, e.g. 1080x1920', resolution)
  .option('-d, --duration <seconds>', 'duration in seconds', positiveInt('duration'))
  .option('--fps <fps>', 'frames per second', positiveInt('fps'))
  .addOption(new Option('-s, --style <style>', 'visual style').choices(['auto', ...Object.keys(STYLES)]))
  .addOption(new Option('-t, --template <template>', 'video template').choices(['auto', ...listTemplates().map((t) => t.id)]))
  .addOption(new Option('-l, --language <lang>', 'language of the copy').choices(['auto', ...LANGUAGE_CODES]))
  .option('-o, --output-format <format>', `output container (${OUTPUT_FORMATS.join(', ')})`, outputFormat)
  .option('--voice', 'force voice-over (needs a voice provider)')
  .option('--no-voice', 'disable voice-over')
  .option('--music', 'force background music')
  .option('--no-music', 'disable background music')
  .option('--subtitles', 'force burned-in subtitles')
  .option('--no-subtitles', 'disable subtitles')
  .option('--no-images', 'never call the image generation provider')
  .option('--ai-video', 'generate clips with the configured video provider')
  .addOption(new Option('--llm <provider>', 'LLM provider').choices(['auto', 'local', 'anthropic', 'openai', 'groq', 'openai-compatible']))
  .option('--offline', 'procedural planning only (no LLM call)')
  .option('--no-render', 'stop after writing the Remotion project (storyboard, script, assets)')
  .option('--out <dir>', 'job output directory')
  .option('--json', 'print the result as JSON on stdout')
  .option('--no-stock', 'do not search stock libraries (Pexels, Pixabay, Unsplash)')
  .addOption(new Option('--media <coverage>', 'which scenes get a photo/clip').choices(['all', 'visual', 'none']))
  .option('--publish [platforms]', `publish after rendering (${PLATFORM_IDS.join(',')}, all)`, parsePlatforms)
  .option('--publish-at <date>', 'schedule the publication', parseDate)
  .option('-y, --yes', 'publish without confirmation')
  .action(generate);

registerPublishCommands(program, config, () => path.join(process.cwd(), '.env'));

program
  .command('render')
  .description('render (again) a job directory or a storyboard.json')
  .argument('<path>', 'job directory or storyboard.json')
  .option('-o, --output-format <format>', 'output container', outputFormat)
  .option('--out <file>', 'output file')
  .action(async (target: string, flags: { outputFormat?: OutputFormat; out?: string }) => {
    const cfg = config();
    const file = fs.statSync(target).isDirectory() ? path.join(target, 'storyboard.json') : target;
    const dir = path.dirname(path.resolve(file));
    const paths = jobPaths(dir);
    const validation = validateStoryboard(JSON.parse(fs.readFileSync(file, 'utf8')), { publicDir: paths.publicDir });
    validation.warnings.forEach((w) => process.stderr.write(`⚠  ${w}\n`));
    if (!validation.valid) throw new VideoAgentError(`Invalid storyboard:\n - ${validation.errors.join('\n - ')}`);
    const format = flags.outputFormat ?? cfg.env.VIDEO_AGENT_DEFAULT_OUTPUT_FORMAT;
    const output = path.resolve(flags.out ?? paths.videoFile(format));
    const print = createProgressPrinter();
    const result = await renderStoryboard({
      storyboard: validation.storyboard!,
      publicDir: paths.publicDir,
      outputFile: output,
      outputFormat: format,
      posterFile: paths.posterFile,
      browserExecutable: cfg.browserExecutable,
      concurrency: cfg.env.VIDEO_AGENT_RENDER_CONCURRENCY,
      crf: cfg.env.VIDEO_AGENT_CRF,
      x264Preset: cfg.env.VIDEO_AGENT_X264_PRESET,
      gl: cfg.env.VIDEO_AGENT_RENDER_GL,
      onProgress: ({ stage, progress }) =>
        print({ step: 'render', stepIndex: 10, totalSteps: 12, status: 'progress', message: `${stage} ${Math.round(progress * 100)}%`, overall: progress }),
    });
    process.stdout.write(`\n✅ ${path.relative(process.cwd(), result.file)} (${result.durationSec.toFixed(1)}s)\n`);
  });

program
  .command('studio')
  .description('open a job (or the demo) in Remotion Studio for live preview and tweaking')
  .argument('[job-dir]', 'job directory')
  .action((jobDir?: string) => {
    const require = createRequire(import.meta.url);
    const cli = path.join(path.dirname(require.resolve('@remotion/cli/package.json')), 'remotion-cli.js');
    const args = [cli, 'studio', remotionEntryPoint()];
    if (jobDir) {
      const paths = jobPaths(jobDir);
      args.push(`--props=${paths.propsFile}`, `--public-dir=${paths.publicDir}`);
    }
    const browser = config().browserExecutable;
    if (browser) args.push(`--browser-executable=${browser}`);
    spawn(process.execPath, args, { stdio: 'inherit', cwd: packageRoot }).on('exit', (code) => process.exit(code ?? 0));
  });

program
  .command('validate')
  .description('validate a storyboard.json')
  .argument('<file>')
  .action((file: string) => {
    const result = validateStoryboard(JSON.parse(fs.readFileSync(file, 'utf8')), { publicDir: path.join(path.dirname(path.resolve(file)), 'public') });
    result.warnings.forEach((w) => process.stdout.write(`⚠  ${w}\n`));
    result.errors.forEach((e) => process.stdout.write(`✖  ${e}\n`));
    process.stdout.write(result.valid ? '✅ storyboard is valid\n' : '❌ storyboard is invalid\n');
    process.exitCode = result.valid ? 0 : 1;
  });

program
  .command('templates')
  .description('list templates')
  .action(() => {
    for (const t of listTemplates()) {
      process.stdout.write(`${t.id.padEnd(22)} ${t.name} — ${t.description}\n${''.padEnd(22)} scènes : ${t.scenes.map((s) => `${s.role}${s.optional ? '?' : ''}`).join(' → ')}\n`);
    }
  });

program
  .command('styles')
  .description('list visual styles')
  .action(() => {
    for (const s of Object.values(STYLES)) process.stdout.write(`${s.id.padEnd(12)} ${s.description}\n`);
  });

program
  .command('formats')
  .description('list format presets')
  .action(() => {
    for (const f of FORMAT_PRESETS) process.stdout.write(`${f.id.padEnd(10)} ${String(f.width).padStart(4)}×${f.height}  ${f.aspect.padEnd(5)} aliases: ${f.aliases.join(', ')}\n`);
    process.stdout.write(`\nOutput formats: ${OUTPUT_FORMATS.join(', ')}. Any WIDTHxHEIGHT is accepted with --resolution.\n`);
  });

program
  .command('providers')
  .description('show which providers are configured')
  .action(() => {
    process.stdout.write(`${JSON.stringify(providerStatus(config()), null, 2)}\n`);
  });

program
  .command('doctor')
  .description('check the installation')
  .action(() => {
    const checks = runDoctor(config());
    const icon = { ok: '✅', warn: '⚠️ ', error: '❌', info: 'ℹ️ ' };
    for (const c of checks) process.stdout.write(`${icon[c.status]} ${c.name.padEnd(30)} ${c.detail}\n`);
    process.exitCode = checks.some((c) => c.status === 'error') ? 1 : 0;
  });

program
  .command('web')
  .description('start the web app (SaaS): accounts, videos, publishing, billing')
  .option('-p, --port <port>', 'port', positiveInt('port'))
  .option('--host <host>', 'host (default 127.0.0.1)')
  .action(async (flags: { port?: number; host?: string }) => {
    const cfg = config();
    const { url, app } = await startSaasServer(cfg, { port: flags.port, host: flags.host, webRoot: path.join(packageRoot, 'web') });
    process.stdout.write(`🎬 SOVID AI : ${url}\n`);
    process.stdout.write(`   Base de données : ${app.db.kind === 'pglite' ? `intégrée (${path.join(cfg.paths.data, 'db')})` : 'PostgreSQL'} · rendu : ${app.worker ? 'dans ce processus' : 'workers séparés ("video-agent worker")'}\n`);
    const shutdown = () => void app.close().finally(() => process.exit(0));
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  });

program
  .command('worker')
  .description('render worker for the web app: renders queued videos and runs due publications (needs DATABASE_URL)')
  .action(async () => {
    const cfg = config();
    if (!cfg.env.DATABASE_URL) throw new VideoAgentError('Le worker séparé nécessite DATABASE_URL (PostgreSQL)', 'Sans PostgreSQL, "video-agent web" rend les vidéos lui-même.');
    const db = await connectDatabase(cfg);
    const logger = createLogger(cfg.logLevel);
    // Fresh configuration for every job: changes made in the admin Settings page apply without restart.
    const worker = new Worker({ db, vault: new Vault(resolveAppSecret(cfg)), config: () => { try { return config(); } catch { return cfg; } }, logger });
    worker.start();
    process.stdout.write(`🛠  Worker ${worker.id} prêt\n`);
    const shutdown = () => void worker.stop().then(() => db.close()).finally(() => process.exit(0));
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  process.stderr.write(`\n❌ ${errorMessage(err)}\n`);
  if (err instanceof VideoAgentError && err.hint) process.stderr.write(`   💡 ${err.hint}\n`);
  if (process.env.VIDEO_AGENT_LOG_LEVEL === 'debug' && err instanceof Error) process.stderr.write(`${err.stack}\n`);
  process.exit(1);
});
