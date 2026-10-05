// Video Agent — local web UI (vanilla JS, no build step).
const $ = (id) => document.getElementById(id);
const STEP_LABELS = {
  analyze: 'Analyse de la demande', concept: 'Concept', script: 'Script', storyboard: 'Storyboard', scenes: 'Scènes',
  assets: 'Visuels', animations: 'Animations', subtitles: 'Textes et sous-titres', audio: 'Voix-off et musique',
  project: 'Projet Remotion', render: 'Rendu', output: 'Fichier final',
};
const FREE = new Set(['groq', 'ollama', 'piper', 'cloudflare', 'huggingface', 'pexels', 'pixabay', 'unsplash', 'system', 'procedural']);
let currentJob = null;
let source = null;
let providers = {};

const api = async (path, init) => {
  const res = await fetch(path, { headers: { 'content-type': 'application/json' }, ...init });
  // Password just enabled (or changed): reload so the browser asks for it.
  if (res.status === 401) {
    window.location.reload();
    throw new Error('Authentification requise');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
};
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const option = (value, label) => Object.assign(document.createElement('option'), { value, textContent: label });
const toast = (msg) => {
  $('toast').textContent = msg;
  $('toast').hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => ($('toast').hidden = true), 3500);
};

// ---- Tabs ------------------------------------------------------------------------
function showTab(name) {
  if (!document.getElementById(`tab-${name}`)) name = 'create';
  if (location.hash !== `#${name}`) history.replaceState(null, '', `#${name}`);
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === `tab-${name}`));
  if (name === 'settings') loadSettings();
  if (name === 'schedule') loadSchedule();
  if (name === 'history') loadHistory();
}
document.querySelectorAll('.tab').forEach((t) => (t.onclick = () => showTab(t.dataset.tab)));
document.addEventListener('click', (e) => {
  const goto = e.target.closest('[data-goto]');
  if (goto) {
    e.preventDefault();
    showTab(goto.dataset.goto);
  }
});
$('status').onclick = () => showTab('settings');

// ---- Status pills ------------------------------------------------------------------
const firstWord = (v) => String(v ?? 'none').split(/[\s(,]/)[0];
function pill(label, value, kind) {
  const state = kind ?? (value === 'none' || value.startsWith('procedural') ? 'off' : value.startsWith('error') ? 'err' : FREE.has(firstWord(value)) ? 'free' : 'ok');
  const shown = state === 'off' ? 'non configuré' : value.replace(/\s*\(.*\)$/, '');
  return `<span class="pill" title="${escapeHtml(label + ' : ' + value)}"><span class="dot ${state}"></span>${label} <b>${escapeHtml(shown)}</b></span>`;
}
function renderStatus(p) {
  providers = p;
  $('status').innerHTML = [
    pill('Textes', p.llm),
    pill('Voix', p.voice),
    pill('Photos', p.stock),
    pill('Images IA', p.image),
    pill('Publication', p.platforms),
  ].join('');
  updateCapabilityHint();
}
function updateCapabilityHint() {
  const hints = [];
  if ($('voice').checked && (providers.voice ?? 'none') === 'none') hints.push('aucune voix-off configurée');
  if ($('stock').checked && (providers.stock ?? 'none') === 'none') hints.push('aucune banque de photos configurée (fonds animés à la place)');
  $('capabilityHint').hidden = !hints.length;
  $('capabilityHint').innerHTML = hints.length ? `⚠ ${hints.join(' · ')} — <a href="#" data-goto="settings">configurer gratuitement</a>` : '';
}
['voice', 'stock'].forEach((id) => $(id).addEventListener('change', updateCapabilityHint));

// ---- Form --------------------------------------------------------------------------
async function loadOptions() {
  const o = await api('/api/options');
  o.styles.forEach((s) => $('style').append(option(s.id, `${s.label} — ${s.description}`)));
  o.templates.forEach((t) => $('template').append(option(t.id, t.name)));
  o.fps.forEach((f) => $('fps').append(option(f, `${f} fps`)));
  $('fps').value = String(o.defaults.fps);
  o.outputFormats.forEach((f) => $('outputFormat').append(option(f, f.toUpperCase())));
  $('outputFormat').value = o.defaults.outputFormat;
  renderStatus(o.providers);
}

document.querySelectorAll('[data-example]').forEach((b) => (b.onclick = () => {
  $('prompt').value = b.dataset.example;
  $('prompt').focus();
}));

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
    stock: $('stock').checked,
    offline: $('offline').checked,
  };
  const format = document.querySelector('input[name=format]:checked').value;
  if (format) body.format = format;
  if ($('duration').value) body.durationSec = Number($('duration').value);
  if ($('mediaCoverage').value) body.mediaCoverage = $('mediaCoverage').value;
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

// ---- Job progress & result ------------------------------------------------------------
function renderSteps(job) {
  $('steps').innerHTML = Object.entries(STEP_LABELS).map(([id, label]) => {
    const s = job.steps?.[id];
    const status = s ? s.status : 'pending';
    return `<li class="${status}"><span>${label}</span><small title="${escapeHtml(s?.message || '')}">${s ? escapeHtml(s.message || '') : ''}</small></li>`;
  }).join('');
}

function showJob(job) {
  currentJob = job;
  $('emptyState').hidden = true;
  $('jobView').hidden = false;
  const running = job.status === 'running' || job.status === 'queued';
  $('jobTitle').textContent = job.title || ({ completed: '✅ Vidéo prête', failed: '❌ Échec', cancelled: 'Annulée', queued: '⏳ En attente…' }[job.status] ?? '⚙️ Génération…');
  $('jobPrompt').textContent = job.prompt;
  $('bar').style.width = `${Math.round((job.overall || 0) * 100)}%`;
  $('jobMessage').textContent = running ? `${Math.round((job.overall || 0) * 100)} % — ${job.message || ''}` : '';
  $('cancel').hidden = !running;
  $('steps').hidden = job.status === 'completed';
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
    $('creditsLink').hidden = !job.credits;
    $('creditsLink').href = `/api/jobs/${job.id}/files/credits.md`;
    $('warnings').innerHTML = (job.warnings || []).map((w) => `<li>${escapeHtml(w)}</li>`).join('');
    if (publishJobId !== job.id) resetPublish(job.id);
  }
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
    }
  };
}
$('cancel').addEventListener('click', () => currentJob && api(`/api/jobs/${currentJob.id}`, { method: 'DELETE' }));

// ---- Publication -----------------------------------------------------------------------
let platforms = [];
let publishJobId = null;

async function loadPlatforms() {
  platforms = await api('/api/platforms');
  $('platformList').innerHTML = platforms.map((p) => `<label class="${p.configured ? '' : 'off'}" title="${escapeHtml(p.configured ? p.notes.join(' · ') : 'Non configuré : ' + p.missing.join(', '))}">
    <input type="checkbox" value="${p.id}" ${p.configured ? '' : 'disabled'} /> ${p.label}</label>`).join('');
  $('platformHint').hidden = platforms.some((p) => p.configured);
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
  if (!chosen.length) return toast('Choisissez au moins une plateforme configurée.');
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
    toast(err.message);
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
  $('publishResults').innerHTML = '<li>⏳ Envoi en cours… (quelques minutes possibles)</li>';
  try {
    const { outcomes, warnings } = await api(`/api/jobs/${publishJobId}/publish`, { method: 'POST', body: JSON.stringify({ platforms: chosen, captions, at, dryRun }) });
    $('publishResults').innerHTML = [
      ...outcomes.map((o) => `<li>${o.ok ? (o.status === 'dry-run' ? '👁' : '✅') : '❌'} <b>${o.platform}</b> <span class="grow">${escapeHtml(o.status)}${o.message ? ` · ${escapeHtml(o.message)}` : ''}${o.warnings.map((w) => `<br>⚠ ${escapeHtml(w)}`).join('')}</span>${o.url ? `<a href="${escapeHtml(o.url)}" target="_blank" rel="noopener">voir</a>` : ''}</li>`),
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

// ---- Settings ---------------------------------------------------------------------------
async function loadSettings() {
  try {
    const { envFile, groups } = await api('/api/settings');
    $('envFile').textContent = envFile;
    $('settingsGroups').innerHTML = groups.map(renderGroup).join('');
    document.querySelectorAll('[data-save]').forEach((b) => (b.onclick = () => saveGroup(b.dataset.save)));
    document.querySelectorAll('[data-clear]').forEach((b) => (b.onclick = () => clearField(b.dataset.clear)));
  } catch (err) {
    $('settingsGroups').innerHTML = `<p class="error">${escapeHtml(err.message)}</p>`;
  }
}

function renderGroup(g) {
  const configured = g.fields.filter((f) => f.configured && (f.secret || f.credential)).length;
  return `<section class="panel card" data-group="${g.id}">
    <h2>${escapeHtml(g.title)} ${configured ? `<span class="badge ok">${configured} configuré${configured > 1 ? 's' : ''}</span>` : ''}</h2>
    <p class="desc">${escapeHtml(g.description)}</p>
    ${g.fields.map(renderField).join('')}
    <button type="button" class="primary small save" data-save="${g.id}">Enregistrer</button>
  </section>`;
}

function renderField(f) {
  const head = `<div class="head">${escapeHtml(f.label)} ${f.free ? '<span class="badge free">Gratuit</span>' : ''} ${f.secret && f.configured ? '<span class="badge ok">configurée</span>' : ''}
    ${f.link ? `<a href="${escapeHtml(f.link)}" target="_blank" rel="noopener">obtenir ↗</a>` : ''}</div>`;
  let input;
  if (f.options) {
    const values = f.options.map((o) => o.value);
    const opts = [...(values.includes(f.value) || !f.value ? [] : [{ value: f.value, label: f.value }]), ...f.options];
    input = `<select data-key="${f.key}">${opts.map((o) => `<option value="${escapeHtml(o.value)}" ${o.value === f.value ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}</select>`;
  } else if (f.secret) {
    input = `<div class="row"><input type="password" autocomplete="off" data-key="${f.key}" placeholder="${f.configured ? '•••••••• (laisser vide pour conserver)' : 'collez la clé ici'}" />${f.configured ? `<button type="button" class="ghost small" data-clear="${f.key}" title="Supprimer">✕</button>` : ''}</div>`;
  } else {
    input = `<input data-key="${f.key}" value="${escapeHtml(f.value)}" placeholder="${escapeHtml(f.placeholder || '')}" />`;
  }
  return `<div class="setting">${head}${input}${f.help ? `<span class="hint">${escapeHtml(f.help)}</span>` : ''}</div>`;
}

async function putSettings(updates) {
  const r = await api('/api/settings', { method: 'PUT', body: JSON.stringify(updates) });
  renderStatus(r.providers);
  loadPlatforms().catch(() => {});
  return r;
}

async function saveGroup(id) {
  const card = document.querySelector(`[data-group="${id}"]`);
  const updates = {};
  card.querySelectorAll('[data-key]').forEach((el) => (updates[el.dataset.key] = el.value));
  try {
    await putSettings(updates);
    if (updates.VIDEO_AGENT_WEB_PASSWORD) {
      toast('🔒 Mot de passe activé : le navigateur va vous le demander (nom d’utilisateur libre).');
      setTimeout(() => window.location.reload(), 1500);
      return;
    }
    toast('✅ Réglages enregistrés — appliqués aux prochaines vidéos.');
    loadSettings();
  } catch (err) {
    toast(`❌ ${err.message}`);
  }
}

async function clearField(key) {
  if (!confirm(`Supprimer ${key} ?`)) return;
  try {
    await putSettings({ [key]: null });
    toast('Clé supprimée.');
    loadSettings();
  } catch (err) {
    toast(`❌ ${err.message}`);
  }
}

// ---- Schedule & history -------------------------------------------------------------
async function loadSchedule() {
  const entries = (await api('/api/schedule')).filter((e) => e.status !== 'cancelled');
  const pending = entries.filter((e) => e.status === 'pending').length;
  $('scheduleCount').hidden = !pending;
  $('scheduleCount').textContent = pending;
  $('scheduleList').innerHTML = entries.length
    ? entries.map((e) => `<li><b>${new Date(e.at).toLocaleString()}</b> <span class="grow">${e.platforms.join(', ')} · ${escapeHtml(e.status)}${e.error ? ` — ${escapeHtml(e.error)}` : ''}</span>
      ${e.status === 'pending' ? `<button class="ghost small" data-cancel="${e.id}">Annuler</button>` : ''}</li>`).join('')
    : '<li class="muted">Aucune publication programmée.</li>';
  $('scheduleList').querySelectorAll('[data-cancel]').forEach((b) => (b.onclick = async () => {
    await api(`/api/schedule/${b.dataset.cancel}`, { method: 'DELETE' });
    loadSchedule();
  }));
}

async function loadHistory() {
  const jobs = await api('/api/jobs');
  if (!jobs.length) return;
  $('history').innerHTML = '';
  for (const job of jobs) {
    const card = document.createElement('button');
    card.className = 'card-video';
    card.type = 'button';
    card.innerHTML = `${job.posterUrl ? `<img src="${job.posterUrl}" alt="" loading="lazy" />` : '<img alt="" />'}
      <div><div class="st">${escapeHtml(job.status)}</div>${escapeHtml((job.title || job.prompt).slice(0, 90))}</div>`;
    card.onclick = () => {
      showTab('create');
      if (job.status === 'running' || job.status === 'queued') follow(job.id);
      else showJob(job);
    };
    $('history').append(card);
  }
}

showTab(location.hash.slice(1) || 'create');
loadOptions().catch((err) => { $('formError').hidden = false; $('formError').textContent = err.message; });
loadPlatforms().catch(() => {});
loadSchedule().catch(() => {});
