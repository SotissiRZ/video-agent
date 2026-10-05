/** Job directory layout and helpers. */
import fs from 'node:fs';
import path from 'node:path';

export interface JobPaths {
  id: string;
  dir: string;
  publicDir: string;
  jobFile: string;
  briefFile: string;
  conceptFile: string;
  scriptFile: string;
  storyboardFile: string;
  propsFile: string;
  srtFile: string;
  vttFile: string;
  readmeFile: string;
  posterFile: string;
  videoFile(ext: string): string;
}

export const slugify = (s: string, max = 40): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/, '') || 'video';

export const newJobId = (label: string, date = new Date()): string => {
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
  return `${stamp}-${slugify(label)}`;
};

export const jobPaths = (dir: string): JobPaths => {
  const abs = path.resolve(dir);
  return {
    id: path.basename(abs),
    dir: abs,
    publicDir: path.join(abs, 'public'),
    jobFile: path.join(abs, 'job.json'),
    briefFile: path.join(abs, 'brief.json'),
    conceptFile: path.join(abs, 'concept.json'),
    scriptFile: path.join(abs, 'script.md'),
    storyboardFile: path.join(abs, 'storyboard.json'),
    propsFile: path.join(abs, 'props.json'),
    srtFile: path.join(abs, 'subtitles.srt'),
    vttFile: path.join(abs, 'subtitles.vtt'),
    readmeFile: path.join(abs, 'README.md'),
    posterFile: path.join(abs, 'poster.jpg'),
    videoFile: (ext: string) => path.join(abs, `video.${ext}`),
  };
};

export const ensureJobDirs = (paths: JobPaths): void => {
  for (const d of [paths.dir, paths.publicDir, path.join(paths.publicDir, 'media'), path.join(paths.publicDir, 'voice'), path.join(paths.publicDir, 'music')]) {
    fs.mkdirSync(d, { recursive: true });
  }
};

export const writeJson = (file: string, data: unknown): void => {
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
};
