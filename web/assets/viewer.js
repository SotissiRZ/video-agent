// In-app viewer for the files of a video: script and credits (Markdown), storyboard (JSON), subtitles (SRT).
import { escapeHtml, icon } from './common.js';
import { t } from './i18n.js';

/** Inline Markdown: **bold**, `code`, [links](https://…), *emphasis* (highlighted words of the video). */
const inline = (text) =>
  escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<mark>$1</mark>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

/** Small, safe Markdown renderer (everything is escaped first): headings, quotes, lists, paragraphs. */
export const renderMarkdown = (md) => {
  const out = [];
  let list = null;
  let quote = null;
  let para = [];
  const flush = () => {
    if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`);
    para = [];
    if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`);
    list = null;
    if (quote) out.push(`<blockquote>${quote.map(inline).join('<br>')}</blockquote>`);
    quote = null;
  };
  for (const raw of md.replace(/\r/g, '').split('\n')) {
    const line = raw.trimEnd();
    let m;
    if (!line.trim()) flush();
    else if ((m = /^(#{1,4})\s+(.*)$/.exec(line))) {
      flush();
      out.push(`<h${m[1].length + 1}>${inline(m[2])}</h${m[1].length + 1}>`);
    } else if ((m = /^>\s?(.*)$/.exec(line))) {
      if (!quote) flush();
      (quote ??= []).push(m[1]);
    } else if ((m = /^\s*(?:[-*•]|(\d+)\.)\s+(.*)$/.exec(line))) {
      const tag = m[1] ? 'ol' : 'ul';
      if (!list || list.tag !== tag) {
        flush();
        list = { tag, items: [] };
      }
      list.items.push(m[2]);
    } else if (quote) quote.push(line);
    else {
      if (list) flush();
      para.push(line);
    }
  }
  flush();
  return out.join('\n');
};

const seconds = (frames, fps) => `${(frames / fps).toFixed(1).replace(/\.0$/, '')} s`;

const renderStoryboard = (sb) => {
  const fps = sb.format?.fps ?? 30;
  let from = 0;
  const facts = [
    [t('viewer.format'), `${sb.format.width}×${sb.format.height} · ${fps} fps`],
    [t('viewer.duration'), seconds(sb.format.durationInFrames, fps)],
    [t('viewer.scenes'), String(sb.scenes.length)],
    [t('viewer.style'), sb.meta?.style ?? '—'],
    [t('viewer.language'), sb.meta?.language ?? '—'],
    [t('viewer.music'), sb.audio?.music ? sb.audio.music.src.split('/').pop() : '—'],
  ];
  const palette = Object.values(sb.theme?.palette ?? {})
    .filter((c) => /^#[0-9a-f]{3,8}$/i.test(c))
    .map((c) => `<span class="swatch" style="background:${c}" title="${c}"></span>`)
    .join('');
  const scenes = sb.scenes
    .map((s, i) => {
      const start = from;
      // Transitions overlap two scenes (same maths as the composition's timeline).
      const next = sb.scenes[i + 1];
      const tr = next && s.transitionOut && s.transitionOut.type !== 'none' ? Math.max(0, Math.min(s.transitionOut.durationInFrames ?? 0, Math.min(s.durationInFrames, next.durationInFrames) - 1)) : 0;
      from += s.durationInFrames - tr;
      const lines = [
        s.subheadline && `<div class="sc-sub">${inline(s.subheadline)}</div>`,
        `<div class="sc-title">${inline(s.headline ?? '')}</div>`,
        s.body && `<p>${inline(s.body)}</p>`,
        s.items?.length && `<ul>${s.items.map((it) => `<li>${inline(it)}</li>`).join('')}</ul>`,
        s.stat && `<p><strong>${escapeHtml(s.stat.value)}</strong> ${escapeHtml(s.stat.label ?? '')}</p>`,
        s.narration && `<div class="sc-voice">${icon('mic', 14)}<span>${escapeHtml(s.narration)}</span></div>`,
        s.media && `<div class="sc-media">${icon('image', 14)}<span>${escapeHtml(s.media.origin ?? '')} · ${escapeHtml(String(s.media.src).split('/').pop())}</span></div>`,
      ].filter(Boolean);
      return `<li class="scene-card">
        <div class="sc-head"><span class="sc-num">${i + 1}</span><b>${escapeHtml(s.role ?? s.kind)}</b><span class="badge">${escapeHtml(s.kind)}</span><span class="sc-time">${seconds(start, fps)} → ${seconds(start + s.durationInFrames, fps)}</span></div>
        ${lines.join('')}
      </li>`;
    })
    .join('');
  return `<dl class="facts">${facts.map(([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`).join('')}${palette ? `<div><dt>${t('viewer.palette')}</dt><dd>${palette}</dd></div>` : ''}</dl>
    <ol class="scene-list">${scenes}</ol>
    <details class="raw"><summary>${t('viewer.raw')}</summary><pre>${escapeHtml(JSON.stringify(sb, null, 2))}</pre></details>`;
};

const renderSrt = (srt) => {
  const cues = srt
    .replace(/\r/g, '')
    .split(/\n{2,}/)
    .map((block) => block.split('\n').filter(Boolean))
    .filter((l) => l.length >= 2 && l[1].includes('-->'))
    .map((l) => ({ time: l[1].replace(/,\d{3}/g, '').replace(/^00:/, '').replace('--> 00:', '→ '), text: l.slice(2).join(' ') }));
  if (!cues.length) return `<p class="muted">${t('viewer.empty')}</p>`;
  return `<table class="cues">${cues.map((c) => `<tr><td class="cue-time">${escapeHtml(c.time)}</td><td>${escapeHtml(c.text)}</td></tr>`).join('')}</table>`;
};

let dialog;
const ensureDialog = () => {
  if (dialog) return dialog;
  dialog = document.createElement('dialog');
  dialog.className = 'viewer';
  dialog.innerHTML = `<div class="viewer-head"><h3 class="viewer-title"></h3><div class="viewer-actions">
      <a class="btn btn-secondary btn-sm viewer-download" download>${icon('download', 15)}<span>${t('viewer.download')}</span></a>
      <button type="button" class="btn btn-ghost btn-sm viewer-close" aria-label="${t('viewer.close')}">${icon('x', 16)}</button></div></div>
    <div class="viewer-body"></div>`;
  dialog.querySelector('.viewer-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close(); // click on the backdrop
  });
  document.body.append(dialog);
  return dialog;
};

/** Opens a job file in the viewer. `url` is the raw file URL. */
export const openFile = async (url, title) => {
  const d = ensureDialog();
  d.querySelector('.viewer-title').textContent = title;
  d.querySelector('.viewer-download').href = `${url}?download=1`;
  d.querySelector('.viewer-download span').textContent = t('viewer.download');
  const body = d.querySelector('.viewer-body');
  body.innerHTML = `<p class="muted">${t('viewer.loading')}</p>`;
  d.showModal();
  try {
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const name = url.split('/').pop();
    body.innerHTML = name.endsWith('.json') ? renderStoryboard(JSON.parse(text)) : name.endsWith('.srt') ? renderSrt(text) : `<div class="md">${renderMarkdown(text)}</div>`;
    body.scrollTop = 0;
  } catch (err) {
    body.innerHTML = `<div class="alert error">${icon('alert', 16)}<span>${escapeHtml(t('viewer.error'))} (${escapeHtml(err.message)})</span></div>`;
  }
};
