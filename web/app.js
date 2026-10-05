// Video Agent — local web UI (vanilla JS, no build step).
const $ = (id) => document.getElementById(id);
const STEP_LABELS = {
  analyze: 'Analyse de la demande', concept: 'Concept', script: 'Script', storyboard: 'Storyboard', scenes: 'Scènes',
  assets: 'Assets', animations: 'Animations', subtitles: 'Textes et sous-titres', audio: 'Voix-off et musique',
  project: 'Projet Remotion', render: 'Rendu', output: 'Fichier final',
};
let currentJob = null;
let source = null;

const api = async (path, init) => {
  const res = await fetch(path, { headers: { 'content-type': 'application/json' }, ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
};

const option = (value, label) => Object.assign(document.createElement('option'), { value, textContent: label });

async function loadOptions() {
  const o = await api('/api/options');
  o.formats.forEach((f) => $('format').append(option(f.id, f.label)));
  o.styles.forEach((s) => $('style').append(option(s.id, `${s.label} — ${s.description}`)));
  o.templates.forEach((t) => $('template').append(option(t.id, t.name)));
  o.fps.forEach((f) => $('fps').append(option(f, `${f} fps`)));
  $('fps').value = String(o.defaults.fps);
  o.outputFormats.forEach((f) => $('outputFormat').append(option(f, f.toUpperCase())));
  $('outputFormat').value = o.defaults.outputFormat;
  const p = o.providers;
  $('providers').innerHTML = [['LLM', p.llm], ['Voix', p.voice], ['Images', p.image], ['Musique', p.music]]
    .map(([k, v]) => `<span class="chip">${k}: <b>${escapeHtml(String(v))}</b></span>`).join('');
}

const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function renderSteps(job) {
  $('steps').innerHTML = Object.entries(STEP_LABELS).map(([id, label]) => {
    const s = job.steps?.[id];
    const status = s ? s.status : 'pending';
    return `<li class="${status}"><span>${label}</span><small>${s ? escapeHtml(s.message || '') : ''}</small></li>`;
  }).join('');
}

function showJob(job) {
  currentJob = job;
  $('current').hidden = false;
  $('jobTitle').textContent = job.title || (job.status === 'completed' ? 'Vidéo prête' : job.status === 'queued' ? 'En attente…' : 'Génération…');
  $('bar').style.width = `${Math.round((job.overall || 0) * 100)}%`;
  $('jobMessage').textContent = `${job.prompt}`;
  $('cancel').hidden = !(job.status === 'running' || job.status === 'queued');
  renderSteps(job);
  $('jobError').hidden = !job.error;
  $('jobError').textContent = job.error ? `Échec : ${job.error}` : '';
  const done = job.status === 'completed' && job.videoUrl;
  $('result').hidden = !done;
  if (done) {
    const player = $('player');
    if (player.dataset.job !== job.id) {
      player.src = job.videoUrl;
      player.poster = job.posterUrl || '';
      player.dataset.job = job.id;
    }
    $('download').href = job.downloadUrl;
    $('download').setAttribute('download', job.videoName || 'video.mp4');
    $('storyboardLink').href = `/api/jobs/${job.id}/files/storyboard.json`;
    $('scriptLink').href = `/api/jobs/${job.id}/files/script.md`;
    $('srtLink').href = `/api/jobs/${job.id}/files/subtitles.srt`;
    $('warnings').innerHTML = (job.warnings || []).map((w) => `<li>⚠ ${escapeHtml(w)}</li>`).join('');
    $('creditsLink').hidden = !job.credits;
    $('creditsLink').href = `/api/jobs/${job.id}/files/credits.md`;
    if (publishJobId !== job.id) resetPublish(job.id);
  }
}

// ---- Publication ---------------------------------------------------------------
let platforms = [];
let publishJobId = null;

async function loadPlatforms() {
  platforms = await api('/api/platforms');
  $('platformList').innerHTML = platforms.map((p) => `<label class="${p.configured ? '' : 'off'}" title="${escapeHtml(p.configured ? p.notes.join(' · ') : 'Non configuré : ' + p.missing.join(', '))}">
    <input type="checkbox" value="${p.id}" ${p.configured ? '' : 'disabled'} /> ${p.label}</label>`).join('');
}

function resetPublish(jobId) {
  publishJobId = jobId;
  $('captionEditors').innerHTML = '';
  $('publishActions').hidden = true;
  $('publishResults').innerHTML = '';
}

const selectedPlatforms = () => [...$('platformList').querySelectorAll('input:checked')].map((i) => i.value);

$('prepare').addEventListener('click', async () => {
  const chosen = selectedPlatforms();
  if (!chosen.length) return alert('Choisissez au moins une plateforme configurée.');
  $('prepare').disabled = true;
  try {
    const captions = await api(`/api/jobs/${publishJobId}/captions?platforms=${chosen.join(',')}`);
    $('captionEditors').innerHTML = chosen.map((p) => `<div class="editor" data-platform="${p}">
      <b>${p}</b>
      <input class="title" value="${escapeHtml(captions[p].title)}" placeholder="Titre" />
      <textarea class="caption">${escapeHtml(captions[p].caption)}</textarea>
      <input class="hashtags" value="${escapeHtml(captions[p].hashtags.join(' '))}" placeholder="#hashtags" />
    </div>`).join('');
    $('publishActions').hidden = false;
  } catch (err) {
    alert(err.message);
  } finally {
    $('prepare').disabled = false;
  }
});

function editedCaptions() {
  const out = {};
  for (const el of $('captionEditors').querySelectorAll('.editor')) {
    out[el.dataset.platform] = {
      title: el.querySelector('.title').value.trim(),
      caption: el.querySelector('.caption').value.trim(),
      hashtags: el.querySelector('.hashtags').value.split(/\s+/).filter(Boolean),
    };
  }
  return out;
}

async function sendPublish(dryRun) {
  const captions = editedCaptions();
  const chosen = Object.keys(captions);
  const at = $('publishAt').value ? new Date($('publishAt').value).toISOString() : undefined;
  if (!dryRun && !confirm(`${at ? 'Programmer' : 'Publier maintenant'} sur ${chosen.join(', ')} ?`)) return;
  $('publishBtn').disabled = $('dryRun').disabled = true;
  $('publishResults').innerHTML = '<li>⏳ Envoi en cours… (cela peut prendre quelques minutes)</li>';
  try {
    const { outcomes, warnings } = await api(`/api/jobs/${publishJobId}/publish`, { method: 'POST', body: JSON.stringify({ platforms: chosen, captions, at, dryRun }) });
    $('publishResults').innerHTML = [
      ...outcomes.map((o) => `<li>${o.ok ? (o.status === 'dry-run' ? '👁' : '✅') : '❌'} <b>${o.platform}</b> — ${escapeHtml(o.status)}${o.url ? ` · <a href="${escapeHtml(o.url)}" target="_blank" rel="noopener">voir</a>` : ''}${o.message ? ` · ${escapeHtml(o.message)}` : ''}${o.warnings.map((w) => `<br>⚠ ${escapeHtml(w)}`).join('')}</li>`),
      ...warnings.map((w) => `<li>⚠ ${escapeHtml(w)}</li>`),
    ].join('');
    loadSchedule();
  } catch (err) {
    $('publishResults').innerHTML = `<li>❌ ${escapeHtml(err.message)}</li>`;
  } finally {
    $('publishBtn').disabled = $('dryRun').disabled = false;
  }
}
$('dryRun').addEventListener('click', () => sendPublish(true));
$('publishBtn').addEventListener('click', () => sendPublish(false));

async function loadSchedule() {
  const entries = (await api('/api/schedule')).filter((e) => e.status !== 'cancelled');
  $('schedulePanel').hidden = !entries.length;
  $('scheduleList').innerHTML = entries.map((e) => `<li>${new Date(e.at).toLocaleString()} · <b>${e.platforms.join(', ')}</b> · ${e.status}${e.error ? ` — ${escapeHtml(e.error)}` : ''}
    ${e.status === 'pending' ? `<button class="ghost" data-cancel="${e.id}">Annuler</button>` : ''}</li>`).join('');
  $('scheduleList').querySelectorAll('[data-cancel]').forEach((b) => (b.onclick = async () => { await api(`/api/schedule/${b.dataset.cancel}`, { method: 'DELETE' }); loadSchedule(); }));
}

function follow(id) {
  source?.close();
  source = new EventSource(`/api/jobs/${id}/events`);
  source.onmessage = (e) => {
    const job = JSON.parse(e.data);
    showJob(job);
    if (['completed', 'failed', 'cancelled'].includes(job.status)) {
      source.close();
      $('submit').disabled = false;
      loadHistory();
    }
  };
}

async function loadHistory() {
  const jobs = await api('/api/jobs');
  if (!jobs.length) return;
  $('history').innerHTML = '';
  for (const job of jobs) {
    const card = document.createElement('button');
    card.className = 'card';
    card.type = 'button';
    card.innerHTML = `${job.posterUrl ? `<img src="${job.posterUrl}" alt="" loading="lazy" />` : '<img alt="" />'}
      <div><div class="status">${job.status}</div>${escapeHtml((job.title || job.prompt).slice(0, 90))}</div>`;
    card.onclick = () => (job.status === 'running' || job.status === 'queued' ? follow(job.id) : showJob(job));
    $('history').append(card);
  }
}

$('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('formError').hidden = true;
  const body = {
    prompt: $('prompt').value.trim(),
    style: $('style').value,
    template: $('template').value,
    fps: Number($('fps').value),
    outputFormat: $('outputFormat').value,
    language: $('language').value,
    subtitles: $('subtitles').checked,
    music: $('music').checked,
    voice: $('voice').checked,
    offline: $('offline').checked,
    stock: $('stock').checked,
  };
  if ($('format').value) body.format = $('format').value;
  if ($('duration').value) body.durationSec = Number($('duration').value);
  const res = /^(\d{2,5})x(\d{2,5})$/.exec($('resolution').value.trim());
  if (res) Object.assign(body, { width: Number(res[1]), height: Number(res[2]) });
  try {
    $('submit').disabled = true;
    const job = await api('/api/jobs', { method: 'POST', body: JSON.stringify(body) });
    showJob(job);
    follow(job.id);
  } catch (err) {
    $('submit').disabled = false;
    $('formError').hidden = false;
    $('formError').textContent = err.message;
  }
});

$('cancel').addEventListener('click', () => currentJob && api(`/api/jobs/${currentJob.id}`, { method: 'DELETE' }));

loadOptions().catch((err) => { $('formError').hidden = false; $('formError').textContent = err.message; });
loadHistory().catch(() => {});
loadPlatforms().catch(() => {});
loadSchedule().catch(() => {});
