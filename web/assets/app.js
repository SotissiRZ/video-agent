// Video Agent web app: authentication, video creation, library, publishing, billing, admin.
import { $, api, ApiError, errorText, escapeHtml, getTheme, icon, initChrome, onLanguageChange, post, renderIcons, savedLang, setLang, setTheme, toast } from './common.js';
import { formatDate, formatDuration, getLang, SETTINGS_EN, STYLE_NAMES, t, TEMPLATE_NAMES } from './i18n.js';
import { formatMoney, renderPlans } from './plans.js';
import { openFile } from './viewer.js';

const STEPS = ['analyze', 'concept', 'script', 'storyboard', 'scenes', 'assets', 'animations', 'subtitles', 'audio', 'project', 'render', 'output'];
const PLATFORMS = { youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram', facebook: 'Facebook', linkedin: 'LinkedIn' };
const PROVIDER_INFO = { youtube: { name: 'YouTube', icon: 'youtube' }, tiktok: { name: 'TikTok', icon: 'tiktok' }, linkedin: { name: 'LinkedIn', icon: 'linkedin' }, meta: { name: 'Facebook + Instagram', icon: 'meta' } };
const PAGES = ['create', 'library', 'schedule', 'connections', 'brand', 'billing', 'account', 'admin'];

const state = { me: null, publicConfig: null, options: null, connections: null, job: null, source: null, publishJobId: null, brand: null };

// ---- Routing ------------------------------------------------------------------------------
const route = () => {
  const [page, query = ''] = location.hash.slice(1).split('?');
  return { page: page || 'create', params: new URLSearchParams(query) };
};
const go = (hash) => {
  if (location.hash === `#${hash}`) onRoute();
  else location.hash = hash;
};

const onRoute = () => {
  const { page, params } = route();
  if (!state.me) return showAuth(['login', 'signup', 'forgot', 'reset'].includes(page) ? page : 'login');
  if (['login', 'signup', 'forgot', 'reset'].includes(page)) return go('create');
  if (params.get('verified')) {
    toast(t(params.get('verified') === '1' ? 'verify.done' : 'verify.failed'), params.get('verified') === '1' ? 'success' : 'error');
    history.replaceState(null, '', `#${page}`);
    refreshMe().catch(() => undefined);
  }
  const name = PAGES.includes(page) && (page !== 'admin' || state.me.user.role === 'admin') ? page : 'create';
  document.querySelectorAll('.page').forEach((p) => p.classList.toggle('active', p.id === `page-${name}`));
  document.querySelectorAll('.nav a[data-page]').forEach((a) => a.classList.toggle('active', a.dataset.page === name));
  $('topTitle').textContent = t(name === 'schedule' ? 'nav.schedule' : `nav.${name}`);
  $('newVideoBtn').hidden = name === 'create';
  $('appView').classList.remove('menu-open');
  ({ create: () => openJobFromParams(params), library: loadLibrary, schedule: loadSchedule, connections: () => loadConnections(params), brand: loadBrand, billing: () => loadBilling(params), account: loadAccount, admin: loadAdmin })[name]?.();
};
window.addEventListener('hashchange', onRoute);

// ---- Authentication ---------------------------------------------------------------------------
const showAuth = (mode) => {
  $('appView').hidden = true;
  $('authView').hidden = false;
  ['login', 'signup', 'forgot', 'reset'].forEach((m) => ($(`${m}Form`).hidden = mode !== m));
  $('forgotForm').querySelector('[data-done]').hidden = true;
  const cfg = state.publicConfig;
  $('firstUserNote').hidden = !cfg?.firstUser;
  $('signupClosed').hidden = cfg?.signupOpen !== false;
  $('signupForm').querySelector('button[type=submit]').disabled = cfg?.signupOpen === false;
  document.title = `${t({ login: 'auth.login', signup: 'auth.signup', forgot: 'auth.forgot.title', reset: 'auth.reset.title' }[mode])} · Video Agent`;
};

const bindAuthForm = (form, path, extra = () => ({})) =>
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const error = form.querySelector('[data-error]');
    error.hidden = true;
    const data = Object.fromEntries(new FormData(form));
    const button = form.querySelector('button[type=submit]');
    button.disabled = true;
    try {
      await post(path, { ...data, ...extra() });
      await startApp();
    } catch (err) {
      error.textContent = errorText(err);
      error.hidden = false;
    } finally {
      button.disabled = false;
    }
  });
bindAuthForm($('loginForm'), '/api/auth/login');
bindAuthForm($('signupForm'), '/api/auth/signup', () => ({ locale: getLang() }));
bindAuthForm($('resetForm'), '/api/auth/reset', () => ({ token: route().params.get('token') ?? '' }));

$('forgotForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const error = form.querySelector('[data-error]');
  error.hidden = true;
  try {
    await post('/api/auth/forgot', { email: form.email.value });
    form.querySelector('[data-done]').hidden = false;
  } catch (err) {
    error.textContent = errorText(err);
    error.hidden = false;
  }
});

$('logout').addEventListener('click', async () => {
  await post('/api/auth/logout').catch(() => undefined);
  location.href = '/';
});

// ---- App shell ------------------------------------------------------------------------------
const startApp = async () => {
  state.me = await api('/api/me');
  // Signed up from a paid plan on the pricing page: continue to checkout.
  const { page, params } = route();
  if ((page === 'signup' || page === 'login') && params.get('plan') && params.get('plan') !== 'free') history.replaceState(null, '', '#billing');
  if (!savedLang() && state.me.user.locale !== getLang()) setLang(state.me.user.locale, false);
  $('authView').hidden = true;
  $('appView').hidden = false;
  document.title = 'Video Agent';
  renderShell();
  await loadOptions();
  loadConnectionsData().catch(() => undefined);
  loadBrandData().catch(() => undefined);
  refreshPendingCount();
  onRoute();
};

const refreshMe = async () => {
  state.me = await api('/api/me');
  renderShell();
};

const renderShell = () => {
  const { user, plan, usage } = state.me;
  $('verifyBanner').hidden = user.emailVerified;
  $('verifyText').textContent = t(state.me.requireVerification ? 'verify.required' : 'verify.banner', { email: user.email });
  $('adminLink').hidden = user.role !== 'admin';
  $('userName').textContent = user.name || user.email.split('@')[0];
  $('userEmail').textContent = user.email;
  $('avatar').textContent = (user.name || user.email).trim()[0].toUpperCase();
  $('usagePlan').textContent = t(`plan.${plan.id}`);
  $('usageUpgrade').hidden = plan.id === 'pro';
  $('usageVideos').textContent = `${usage.videos} / ${plan.videosPerMonth}`;
  $('usageBar').style.width = `${Math.min(100, (usage.videos / plan.videosPerMonth) * 100)}%`;
  $('usageCreditsRow').hidden = !user.credits;
  $('usageCredits').textContent = `+${user.credits ?? 0}`;
  $('durationHint').textContent = t('create.duration.hint', { max: formatDuration(plan.maxDurationSec) });
  $('duration').max = String(plan.maxDurationSec);
  $('planNote').hidden = !plan.badge;
  $('planNoteText').textContent = t('create.badgeNote', { d: formatDuration(plan.maxDurationSec) });
};

$('resendVerify').addEventListener('click', async () => {
  try {
    await post('/api/me/verify');
    toast(t('verify.sent'), 'success');
  } catch (err) {
    toast(errorText(err), 'error');
  }
});

$('menuBtn').addEventListener('click', () => $('appView').classList.toggle('menu-open'));
$('appView').addEventListener('click', (e) => {
  if (e.target === $('appView')) $('appView').classList.remove('menu-open');
});

// ---- Create ----------------------------------------------------------------------------------
const option = (value, label) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`;

const loadOptions = async () => {
  state.options = await api('/api/options');
  renderOptions();
};

const renderOptions = () => {
  const o = state.options;
  if (!o) return;
  const lang = getLang();
  const keep = (id, fn) => {
    const v = $(id).value;
    $(id).innerHTML = fn();
    if (v) $(id).value = v;
  };
  keep('style', () => option('auto', t('create.auto')) + o.styles.map((s) => option(s.id, STYLE_NAMES[lang][s.id] ?? s.label)).join(''));
  keep('template', () => option('auto', t('create.auto')) + o.templates.map((tp) => option(tp.id, TEMPLATE_NAMES[lang][tp.id] ?? tp.name)).join(''));
  if (!$('fps').options.length) {
    $('fps').innerHTML = o.fps.map((f) => option(f, `${f} fps`)).join('');
    $('fps').value = String(o.defaults.fps);
    $('outputFormat').innerHTML = o.outputFormats.map((f) => option(f, f.toUpperCase())).join('');
    $('outputFormat').value = o.defaults.outputFormat;
  }
  updateCapHints();
};

const updateCapHints = () => {
  const caps = state.options?.capabilities ?? {};
  const hints = [];
  if ($('voice').checked && !caps.voice) hints.push(t('create.cap.voice'));
  if ($('stock').checked && !caps.stock) hints.push(t('create.cap.stock'));
  $('capHints').innerHTML = hints.map((h) => `<div class="alert warning">${icon('alert', 16)}<span>${escapeHtml(h)}</span></div>`).join('');
};
['voice', 'stock'].forEach((id) => $(id).addEventListener('change', updateCapHints));

// Files open in the in-app viewer (formatted); Ctrl/Cmd-click still opens the raw file.
['fileStoryboard', 'fileScript', 'fileSrt', 'fileCredits'].forEach((id) =>
  $(id).addEventListener('click', (e) => {
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    openFile($(id).getAttribute('href'), $(id).textContent.trim());
  }),
);

// WhatsApp: share the MP4 itself (Status or chat) from a phone; elsewhere, download it.
let shareCache = null;
$('shareWhatsapp').addEventListener('click', async () => {
  const btn = $('shareWhatsapp');
  const url = $('download').href;
  const name = $('download').getAttribute('download') || 'video.mp4';
  if (!navigator.canShare) {
    $('download').click();
    toast(t('job.whatsapp.fallback'), 'success');
    return;
  }
  btn.disabled = true;
  try {
    if (shareCache?.url !== url) {
      toast(t('job.whatsapp.preparing'));
      const res = await fetch(url, { credentials: 'same-origin' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      shareCache = { url, file: new File([blob], name, { type: blob.type || 'video/mp4' }) };
    }
    if (!navigator.canShare({ files: [shareCache.file] })) {
      $('download').click();
      toast(t('job.whatsapp.fallback'), 'success');
      return;
    }
    await navigator.share({ files: [shareCache.file] });
  } catch (err) {
    // A long download can outlive the tap that allowed sharing: the file is ready, tap again.
    if (err?.name === 'NotAllowedError') toast(t('job.whatsapp.again'));
    else if (err?.name !== 'AbortError') toast(errorText(err), 'error');
  } finally {
    btn.disabled = false;
  }
});

document.querySelectorAll('[data-example]').forEach((b) =>
  b.addEventListener('click', () => {
    $('prompt').value = t(b.dataset.example);
    $('prompt').focus();
  }),
);

$('createForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('createError').hidden = true;
  const prompt = $('prompt').value.trim();
  if (prompt.length < 3) {
    $('prompt').focus();
    return;
  }
  const body = {
    prompt,
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
  if (!$('brandKitToggle').hidden) body.brandKit = $('brandKit').checked;
  const res = /^(\d{2,4})x(\d{2,4})$/.exec($('resolution').value.trim());
  if (res) Object.assign(body, { width: Number(res[1]), height: Number(res[2]) });
  $('submit').disabled = true;
  try {
    const job = await post('/api/jobs', body);
    history.replaceState(null, '', `#create?job=${job.id}`);
    showJob(job);
    follow(job.id);
    refreshMe().catch(() => undefined);
  } catch (err) {
    $('createError').innerHTML = `${icon('alert', 16)}<span>${escapeHtml(errorText(err))}</span>${err instanceof ApiError && err.status === 402 ? ` <a href="#billing">${escapeHtml(t('common.upgrade'))}</a>` : ''}`;
    $('createError').hidden = false;
  } finally {
    $('submit').disabled = false;
  }
});

// ---- Job view ---------------------------------------------------------------------------------
const STATUS_BADGE = { queued: 'info', running: 'primary', completed: 'success', failed: 'danger', cancelled: '' };

const openJobFromParams = async (params) => {
  const id = params.get('job');
  if (!id || state.job?.id === id) return;
  try {
    const job = await api(`/api/jobs/${encodeURIComponent(id)}`);
    showJob(job);
    if (job.status === 'queued' || job.status === 'running') follow(job.id);
  } catch {
    /* unknown job: keep the empty state */
  }
};

const friendlyWarning = (w) => {
  const m = /^LLM (?:concept|script|captions) failed, using procedural \w+: (.*)$/.exec(w);
  return m ? t('job.warn.llm', { detail: m[1] }) : w;
};

const showJob = (job) => {
  state.job = job;
  $('emptyJob').hidden = true;
  $('jobCard').hidden = false;
  const running = job.status === 'queued' || job.status === 'running';
  $('jobBadge').innerHTML = `<span class="badge ${STATUS_BADGE[job.status] ?? ''}">${running ? '<span class="spinner" style="width:10px;height:10px;border-width:1.5px"></span>' : '<span class="dot"></span>'}${escapeHtml(t(`job.status.${job.status}`))}</span>`;
  $('jobQueue').textContent = job.status === 'queued' && job.queuePosition ? t('job.queue', { n: job.queuePosition }) : job.createdAt ? formatDate(job.createdAt) : '';
  $('jobTitle').textContent = job.title || t(`job.status.${job.status}`);
  $('jobPrompt').textContent = job.prompt;
  $('cancelJob').hidden = !running;
  const pct = Math.round((job.overall || 0) * 100);
  $('jobProgress').hidden = job.status === 'completed';
  $('jobBar').style.width = `${pct}%`;
  $('jobPercent').textContent = running ? `${pct} %` : '';
  $('jobMessage').textContent = running && job.step ? t(`step.${job.step}`) : '';
  $('steps').innerHTML = STEPS.map((id) => {
    const s = job.steps?.[id];
    const st = s?.status ?? 'pending';
    const mark = st === 'completed' ? icon('check', 12) : st === 'failed' ? icon('x', 12) : st === 'started' || st === 'progress' ? '<span class="spinner" style="width:10px;height:10px;border-width:1.5px"></span>' : '';
    return `<li class="${st}"><span class="marker">${mark}</span><span class="name">${escapeHtml(t(`step.${id}`))}</span><span class="detail" title="${escapeHtml(s?.message ?? '')}">${escapeHtml(s?.message ?? '')}</span></li>`;
  }).join('');
  $('jobError').hidden = !job.error;
  $('jobError').innerHTML = job.error ? `${icon('alert', 16)}<span>${escapeHtml(t('job.failed', { error: job.error }))}</span>` : '';

  const done = job.status === 'completed' && job.videoUrl;
  $('jobResult').hidden = !done;
  if (!done) return;
  const player = $('player');
  if (player.dataset.job !== job.id) {
    player.src = job.videoUrl;
    player.poster = job.posterUrl ?? '';
    player.dataset.job = job.id;
  }
  $('download').href = job.downloadUrl;
  $('download').setAttribute('download', job.videoName ?? 'video.mp4');
  $('fileStoryboard').href = `/api/jobs/${job.id}/files/storyboard.json`;
  $('fileScript').href = `/api/jobs/${job.id}/files/script.md`;
  $('fileSrt').href = `/api/jobs/${job.id}/files/subtitles.srt`;
  $('fileCredits').hidden = !job.credits;
  $('fileCredits').href = `/api/jobs/${job.id}/files/credits.md`;
  $('jobWarnings').innerHTML = (job.warnings ?? []).map((w) => `<div class="alert warning">${icon('info', 16)}<span>${escapeHtml(friendlyWarning(w))}</span></div>`).join('');
  if (state.publishJobId !== job.id) resetPublish(job.id);
};

const follow = (id) => {
  state.source?.close();
  state.source = new EventSource(`/api/jobs/${encodeURIComponent(id)}/events`);
  state.source.onmessage = (e) => {
    const job = JSON.parse(e.data);
    if (state.job && state.job.id !== job.id) return;
    showJob(job);
    if (['completed', 'failed', 'cancelled'].includes(job.status)) {
      state.source.close();
      refreshMe().catch(() => undefined);
      if (job.status === 'completed') toast(t('job.status.completed'), 'success');
    }
  };
};

$('cancelJob').addEventListener('click', async () => {
  if (!state.job) return;
  await api(`/api/jobs/${state.job.id}`, { method: 'DELETE' }).catch((err) => toast(errorText(err), 'error'));
});

// ---- Publishing ------------------------------------------------------------------------------
const loadConnectionsData = async () => {
  state.connections = await api('/api/connections');
  return state.connections;
};

const resetPublish = async (jobId) => {
  state.publishJobId = jobId;
  $('captionEditors').innerHTML = '';
  $('publishActions').hidden = true;
  $('publishOutcomes').innerHTML = '';
  const canPublish = state.me.plan.publish;
  $('publishUpsell').hidden = canPublish;
  if (!canPublish) {
    $('publishForm').hidden = true;
    $('publishNoAccount').hidden = true;
    return;
  }
  const data = state.connections ?? (await loadConnectionsData().catch(() => ({ platforms: [] })));
  const available = data.platforms ?? [];
  $('publishNoAccount').hidden = available.length > 0;
  $('publishForm').hidden = available.length === 0;
  $('platformList').innerHTML = Object.entries(PLATFORMS)
    .filter(([id]) => available.includes(id))
    .map(([id, name]) => `<label class="chip chip-check"><input type="checkbox" value="${id}" />${icon(id, 15)}${escapeHtml(name)}</label>`)
    .join('');
  loadJobPublications(jobId);
};

const loadJobPublications = async (jobId) => {
  const list = await api(`/api/jobs/${jobId}/publications`).catch(() => []);
  if (!list.length || state.publishJobId !== jobId) return;
  $('publishOutcomes').innerHTML = `<div class="hint" style="margin-top:6px">${escapeHtml(t('publish.history'))}</div>` + list.map(publicationLine).join('');
};

const publicationLine = (p) =>
  `<div class="outcome">${pubBadge(p.status)}<span class="grow">${escapeHtml(p.platforms.map((x) => PLATFORMS[x] ?? x).join(', '))} · ${escapeHtml(formatDate(p.at))}${p.error ? ` · ${escapeHtml(p.error)}` : ''}</span>${(p.outcomes ?? [])
    .filter((o) => o.url)
    .map((o) => `<a class="btn btn-ghost btn-sm" href="${escapeHtml(o.url)}" target="_blank" rel="noopener">${escapeHtml(PLATFORMS[o.platform] ?? o.platform)} ${icon('external', 14)}</a>`)
    .join('')}</div>`;

const pubBadge = (status) => `<span class="badge ${{ pending: 'info', running: 'primary', done: 'success', partial: 'warning', failed: 'danger' }[status] ?? ''}"><span class="dot"></span>${escapeHtml(t(`pub.status.${status}`))}</span>`;

const selectedPlatforms = () => [...$('platformList').querySelectorAll('input:checked')].map((i) => i.value);

$('publishWhen').addEventListener('change', () => {
  const later = $('publishWhen').value === 'later';
  $('publishAtField').hidden = !later;
  $('publishBtnLabel').textContent = t(later ? 'publish.schedule' : 'publish.submit');
  if (later && !$('publishAt').value) {
    const d = new Date(Date.now() + 3600_000);
    d.setMinutes(0, 0, 0);
    $('publishAt').value = new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  }
});

$('prepareCaptions').addEventListener('click', async () => {
  const chosen = selectedPlatforms();
  if (!chosen.length) return toast(t('publish.selectOne'), 'error');
  const btn = $('prepareCaptions');
  btn.disabled = true;
  try {
    const captions = await api(`/api/jobs/${state.publishJobId}/captions?platforms=${chosen.join(',')}`);
    $('captionEditors').innerHTML = chosen
      .map(
        (p) => `<div class="caption-editor" data-platform="${p}">
          <div class="head">${icon(p, 16)}${escapeHtml(PLATFORMS[p])}</div>
          <input class="input" data-f="title" value="${escapeHtml(captions[p].title)}" placeholder="${escapeHtml(t('publish.titleField'))}" />
          <textarea class="textarea" data-f="caption" placeholder="${escapeHtml(t('publish.caption'))}">${escapeHtml(captions[p].caption)}</textarea>
          <input class="input" data-f="hashtags" value="${escapeHtml(captions[p].hashtags.join(' '))}" placeholder="#hashtags" />
        </div>`,
      )
      .join('');
    $('publishActions').hidden = false;
  } catch (err) {
    toast(errorText(err), 'error');
  } finally {
    btn.disabled = false;
  }
});

const editedCaptions = () =>
  Object.fromEntries(
    [...$('captionEditors').querySelectorAll('.caption-editor')].map((el) => [
      el.dataset.platform,
      { title: el.querySelector('[data-f=title]').value.trim(), caption: el.querySelector('[data-f=caption]').value.trim(), hashtags: el.querySelector('[data-f=hashtags]').value.split(/\s+/).filter(Boolean) },
    ]),
  );

const sendPublish = async (dryRun) => {
  const captions = editedCaptions();
  const platforms = Object.keys(captions);
  if (!platforms.length) return toast(t('publish.selectOne'), 'error');
  const later = $('publishWhen').value === 'later' && $('publishAt').value;
  const at = later ? new Date($('publishAt').value).toISOString() : undefined;
  const names = platforms.map((p) => PLATFORMS[p]).join(', ');
  if (!dryRun && !confirm(at ? t('publish.confirmLater', { platforms: names, date: formatDate(at) }) : t('publish.confirm', { platforms: names }))) return;
  $('publishBtn').disabled = $('dryRun').disabled = true;
  try {
    const result = await post(`/api/jobs/${state.publishJobId}/publish`, { platforms, captions, at, dryRun });
    if (dryRun) {
      $('publishOutcomes').innerHTML = result.outcomes
        .map((o) => `<div class="outcome">${icon(o.ok ? 'check' : 'alert', 16)}<b>${escapeHtml(PLATFORMS[o.platform])}</b><span class="grow muted">${escapeHtml(o.message ?? '')}${(o.warnings ?? []).map((w) => ` · ${escapeHtml(w)}`).join('')}</span></div>`)
        .join('');
    } else {
      toast(t(at ? 'publish.scheduled' : 'publish.queued'), 'success');
      refreshPendingCount();
      setTimeout(() => loadJobPublications(state.publishJobId), 800);
    }
  } catch (err) {
    toast(errorText(err), 'error');
  } finally {
    $('publishBtn').disabled = $('dryRun').disabled = false;
  }
};
$('dryRun').addEventListener('click', () => sendPublish(true));
$('publishBtn').addEventListener('click', () => sendPublish(false));

// ---- Library -----------------------------------------------------------------------------------
const loadLibrary = async () => {
  const jobs = await api('/api/jobs').catch(() => []);
  $('libraryEmpty').hidden = jobs.length > 0;
  $('videoGrid').innerHTML = jobs
    .map(
      (j) => `<div class="video-card" role="button" tabindex="0" data-job="${escapeHtml(j.id)}">
        <div class="thumb">${j.posterUrl ? `<img src="${escapeHtml(j.posterUrl)}" alt="" loading="lazy" />` : icon('film', 28)}
          <span class="badge ${STATUS_BADGE[j.status] ?? ''}"><span class="dot"></span>${escapeHtml(t(`job.status.${j.status}`))}</span></div>
        <div class="meta">
          <div class="title">${escapeHtml(j.title || j.prompt)}</div>
          <div class="sub"><span>${escapeHtml(formatDate(j.createdAt))}${j.durationSec ? ` · ${escapeHtml(formatDuration(Math.round(j.durationSec)))}` : ''}</span>
          ${['queued', 'running'].includes(j.status) ? '' : `<button type="button" class="btn btn-ghost btn-icon btn-sm" data-delete="${escapeHtml(j.id)}" title="${escapeHtml(t('common.delete'))}">${icon('trash', 15)}</button>`}</div>
        </div>
      </div>`,
    )
    .join('');
};
$('videoGrid').addEventListener('click', async (e) => {
  const del = e.target.closest('[data-delete]');
  if (del) {
    e.stopPropagation();
    if (!confirm(t('library.delete'))) return;
    await api(`/api/jobs/${del.dataset.delete}?remove=1`, { method: 'DELETE' }).catch((err) => toast(errorText(err), 'error'));
    if (state.job?.id === del.dataset.delete) {
      state.job = null;
      $('jobCard').hidden = true;
      $('emptyJob').hidden = false;
    }
    return loadLibrary();
  }
  const card = e.target.closest('[data-job]');
  if (card) go(`create?job=${card.dataset.job}`);
});
$('videoGrid').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.dataset.job) go(`create?job=${e.target.dataset.job}`);
});

// ---- Publications ---------------------------------------------------------------------------
const refreshPendingCount = async () => {
  const list = await api('/api/publications').catch(() => []);
  const pending = list.filter((p) => p.status === 'pending').length;
  $('pendingCount').hidden = !pending;
  $('pendingCount').textContent = String(pending);
  return list;
};

const loadSchedule = async () => {
  const list = await refreshPendingCount();
  $('scheduleEmpty').hidden = list.length > 0;
  $('scheduleRows').innerHTML = list
    .map(
      (p) => `<tr>
        <td>${escapeHtml(formatDate(p.at))}</td>
        <td><a href="#create?job=${escapeHtml(p.jobId)}">${escapeHtml(p.jobTitle ?? p.jobId)}</a></td>
        <td><div class="input-group">${p.platforms.map((x) => `<span title="${escapeHtml(PLATFORMS[x] ?? x)}">${icon(x, 16)}</span>`).join('')}</div></td>
        <td>${pubBadge(p.status)}${p.error ? `<div class="hint">${escapeHtml(p.error)}</div>` : ''}${(p.outcomes ?? []).filter((o) => !o.ok).map((o) => `<div class="hint">${escapeHtml(PLATFORMS[o.platform])} : ${escapeHtml(o.message ?? '')}</div>`).join('')}</td>
        <td style="text-align:right">${(p.outcomes ?? []).filter((o) => o.url).map((o) => `<a class="btn btn-ghost btn-sm" href="${escapeHtml(o.url)}" target="_blank" rel="noopener">${escapeHtml(t('pub.view'))} ${icon('external', 14)}</a>`).join('')}
          ${p.status === 'pending' ? `<button type="button" class="btn btn-secondary btn-sm" data-cancel-pub="${escapeHtml(p.id)}">${escapeHtml(t('common.cancel'))}</button>` : ''}</td>
      </tr>`,
    )
    .join('');
};
$('scheduleRows').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-cancel-pub]');
  if (!b || !confirm(t('schedule.cancelConfirm'))) return;
  await api(`/api/publications/${b.dataset.cancelPub}`, { method: 'DELETE' }).catch((err) => toast(errorText(err), 'error'));
  loadSchedule();
});

// ---- Connections ------------------------------------------------------------------------------
const loadConnections = async (params) => {
  if (params?.get('connected')) {
    toast(t('conn.success'), 'success');
    history.replaceState(null, '', '#connections');
  } else if (params?.get('error')) {
    toast(t('conn.failed', { error: params.get('error') }), 'error');
    history.replaceState(null, '', '#connections');
  }
  const data = await loadConnectionsData().catch(() => null);
  if (!data) return;
  const canPublish = state.me.plan.publish;
  $('connUpsell').hidden = canPublish;
  const byProvider = Object.fromEntries(data.connections.map((c) => [c.platform, c]));
  $('providerCards').innerHTML = data.providers
    .map(({ id, available }) => {
      const info = PROVIDER_INFO[id];
      const c = byProvider[id];
      let settings = '';
      if (c && id === 'youtube') {
        settings = `<label class="field"><span class="label">${escapeHtml(t('conn.privacy'))}</span><select class="select" data-conn-setting="privacy" data-provider="youtube">${['public', 'unlisted', 'private'].map((v) => `<option value="${v}" ${c.privacy === v ? 'selected' : ''}>${escapeHtml(t(`conn.privacy.${v}`))}</option>`).join('')}</select></label>`;
      } else if (c && id === 'tiktok') {
        settings = `<label class="field"><span class="label">${escapeHtml(t('conn.mode'))}</span><select class="select" data-conn-setting="mode" data-provider="tiktok">${['draft', 'direct'].map((v) => `<option value="${v}" ${c.mode === v ? 'selected' : ''}>${escapeHtml(t(`conn.mode.${v}`))}</option>`).join('')}</select></label>`;
      } else if (c && id === 'meta') {
        settings = `<label class="field"><span class="label">${escapeHtml(t('conn.page'))}</span><select class="select" data-conn-setting="pageId" data-provider="meta">${(c.pages ?? []).map((p) => `<option value="${escapeHtml(p.id)}" ${c.pageId === p.id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}</select>
          <span class="hint">${escapeHtml(c.instagram ? t('conn.instagram', { name: c.instagram }) : t('conn.noInstagram'))}</span></label>`;
      }
      const action = !available
        ? `<span class="hint">${escapeHtml(t('conn.unavailable'))}</span>`
        : c
          ? `<button type="button" class="btn btn-secondary btn-sm" data-connect="${id}" ${canPublish ? '' : 'disabled'}>${escapeHtml(t('conn.reconnect'))}</button><button type="button" class="btn btn-danger-ghost btn-sm" data-disconnect="${id}">${escapeHtml(t('conn.disconnect'))}</button>`
          : `<button type="button" class="btn btn-primary btn-sm" data-connect="${id}" ${canPublish ? '' : 'disabled'}>${icon('link', 15)}${escapeHtml(t('conn.connect'))}</button>`;
      return `<div class="card provider">
        <div class="card-body">
          <div class="provider-head">
            <div class="provider-logo ${id}">${icon(info.icon, 22)}</div>
            <div style="min-width:0;flex:1"><h3>${escapeHtml(info.name)}</h3><p class="muted small">${escapeHtml(c ? c.accountName : t(`conn.${id}`))}</p></div>
            ${c ? `<span class="badge success"><span class="dot"></span>${escapeHtml(t('conn.connected'))}</span>` : ''}
          </div>
          ${settings}
        </div>
        <div class="card-footer" style="justify-content:flex-start">${action}</div>
      </div>`;
    })
    .join('');
};

$('providerCards').addEventListener('click', async (e) => {
  const connect = e.target.closest('[data-connect]');
  const disconnect = e.target.closest('[data-disconnect]');
  try {
    if (connect) {
      connect.disabled = true;
      const { url } = await post(`/api/connections/${connect.dataset.connect}/start`);
      location.href = url;
    } else if (disconnect && confirm(t('conn.disconnectConfirm'))) {
      await api(`/api/connections/${disconnect.dataset.disconnect}`, { method: 'DELETE' });
      state.publishJobId = null;
      loadConnections();
    }
  } catch (err) {
    toast(errorText(err), 'error');
    if (connect) connect.disabled = false;
  }
});
$('providerCards').addEventListener('change', async (e) => {
  const sel = e.target.closest('[data-conn-setting]');
  if (!sel) return;
  try {
    await api(`/api/connections/${sel.dataset.provider}`, { method: 'PATCH', body: JSON.stringify({ [sel.dataset.connSetting]: sel.value }) });
    toast(t('common.saved'), 'success');
    state.publishJobId = null;
    loadConnections();
  } catch (err) {
    toast(errorText(err), 'error');
  }
});

// ---- Brand kit -------------------------------------------------------------------------------
const hasBrand = (kit) => Boolean(kit && (kit.name || kit.colors.length || kit.logoUrl));

const loadBrandData = async () => {
  state.brand = await api('/api/brand');
  $('brandKitToggle').hidden = !hasBrand(state.brand);
  return state.brand;
};

const colorRow = (value) => `<div class="color-item"><input type="color" value="${escapeHtml(value)}" data-color-picker /><input type="text" value="${escapeHtml(value)}" maxlength="7" data-color-text /><button type="button" class="btn btn-ghost btn-icon btn-sm" data-color-remove title="${escapeHtml(t('common.delete'))}">${icon('x', 14)}</button></div>`;

const renderBrandColors = (colors) => {
  $('brandColors').innerHTML =
    colors.map(colorRow).join('') + (colors.length < 4 ? `<button type="button" class="btn btn-secondary btn-sm" data-color-add>${icon('plus', 14)}</button>` : '');
};
const brandColorValues = () => [...$('brandColors').querySelectorAll('[data-color-text]')].map((i) => i.value.trim().toUpperCase()).filter(Boolean);

const loadBrand = async () => {
  const kit = await loadBrandData().catch(() => ({ name: '', colors: [] }));
  $('brandForm').name.value = kit.name ?? '';
  renderBrandColors(kit.colors ?? []);
  renderLogo(kit.logoUrl);
};

const renderLogo = (url) => {
  $('logoPreview').innerHTML = url ? `<img src="${escapeHtml(url)}" alt="" />` : icon('image', 28);
  $('logoRemove').hidden = !url;
};

$('brandColors').addEventListener('input', (e) => {
  const item = e.target.closest('.color-item');
  if (!item) return;
  if (e.target.matches('[data-color-picker]')) item.querySelector('[data-color-text]').value = e.target.value.toUpperCase();
  if (e.target.matches('[data-color-text]') && /^#[0-9a-f]{6}$/i.test(e.target.value)) item.querySelector('[data-color-picker]').value = e.target.value;
});
$('brandColors').addEventListener('click', (e) => {
  if (e.target.closest('[data-color-add]')) renderBrandColors([...brandColorValues(), state.brand?.colors?.length ? '#FFFFFF' : '#0B1C8C']);
  const remove = e.target.closest('[data-color-remove]');
  if (remove) {
    remove.closest('.color-item').remove();
    renderBrandColors(brandColorValues());
  }
});
$('brandForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    state.brand = await api('/api/brand', { method: 'PUT', body: JSON.stringify({ name: $('brandForm').name.value, colors: brandColorValues() }) });
    $('brandKitToggle').hidden = !hasBrand(state.brand);
    toast(t('brand.saved'), 'success');
  } catch (err) {
    toast(errorText(err), 'error');
  }
});
$('logoInput').addEventListener('change', async () => {
  const file = $('logoInput').files[0];
  if (!file) return;
  try {
    // Raw upload: the server checks the real image type and size.
    const res = await fetch('/api/brand/logo', { method: 'PUT', body: file, headers: { 'content-type': file.type || 'application/octet-stream' }, credentials: 'same-origin' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, body);
    state.brand = body;
    renderLogo(body.logoUrl);
    $('brandKitToggle').hidden = !hasBrand(state.brand);
    toast(t('brand.saved'), 'success');
  } catch (err) {
    toast(errorText(err), 'error');
  } finally {
    $('logoInput').value = '';
  }
});
$('logoRemove').addEventListener('click', async () => {
  try {
    state.brand = await api('/api/brand/logo', { method: 'DELETE' });
    renderLogo(undefined);
    $('brandKitToggle').hidden = !hasBrand(state.brand);
  } catch (err) {
    toast(errorText(err), 'error');
  }
});

// ---- Billing ----------------------------------------------------------------------------------
const PAY_STATUS = { pending: 'info', paid: 'success', failed: 'danger', cancelled: '' };
const payBadge = (status) => `<span class="badge ${PAY_STATUS[status] ?? ''}"><span class="dot"></span>${escapeHtml(t(`pay.status.${status}`))}</span>`;

/** Back from the payment page: ask the server (which asks the gateway) until the pass is active. */
const followPayment = async (ref) => {
  toast(t('billing.paymentPending'));
  for (let i = 0; i < 10; i++) {
    try {
      const r = await post(`/api/billing/payments/${encodeURIComponent(ref)}/refresh`);
      if (r.payment.status === 'paid') {
        state.me = r.account;
        renderShell();
        toast(t('billing.paymentDone'), 'success');
        return loadBilling();
      }
      if (r.payment.status === 'failed' || r.payment.status === 'cancelled') return toast(t('billing.paymentFailed'), 'error');
    } catch {
      /* keep trying */
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  toast(t('billing.paymentSlow'));
  loadBilling();
};

const loadBilling = async (params) => {
  if (params?.get('checkout') === 'success') toast(t('billing.success'), 'success');
  if (params?.get('checkout') === 'cancel') toast(t('billing.cancelled'));
  const payment = params?.get('payment');
  if (payment === 'success' && params.get('ref')) void followPayment(params.get('ref'));
  if (payment === 'error') toast(t('billing.paymentFailed'), 'error');
  if (params?.get('checkout') || payment) history.replaceState(null, '', '#billing');
  await refreshMe().catch(() => undefined);
  const { user, plan, usage, billing } = state.me;
  const providers = state.me.paymentProviders ?? [];
  const prepaid = user.subscriptionStatus === 'prepaid';
  $('billingDisabled').hidden = billing || providers.length > 0;
  $('portalBtn').hidden = !billing || !user.subscriptionStatus || prepaid;
  $('billingPlan').textContent = t(`plan.${plan.id}`);
  const expired = prepaid && user.currentPeriodEnd && new Date(user.currentPeriodEnd) < new Date();
  $('billingRenew').textContent = expired
    ? t('billing.expired', { date: formatDate(user.currentPeriodEnd, false) })
    : user.currentPeriodEnd && plan.id !== 'free'
      ? t(prepaid ? 'billing.activeUntil' : 'billing.renews', { date: formatDate(user.currentPeriodEnd, false) })
      : t(`plan.${plan.id}.desc`);
  const minutes = Math.round((usage.seconds / 60) * 10) / 10;
  $('meterVideosText').textContent = `${usage.videos} / ${plan.videosPerMonth}`;
  $('meterVideos').style.width = `${Math.min(100, (usage.videos / plan.videosPerMonth) * 100)}%`;
  $('meterMinutesText').textContent = `${minutes} / ${plan.minutesPerMonth}`;
  $('meterMinutes').style.width = `${Math.min(100, (minutes / plan.minutesPerMonth) * 100)}%`;
  const plans = state.publicConfig?.plans ?? [];
  const stripeSubscriber = Boolean(user.subscriptionStatus) && !prepaid;
  $('billingPlans').innerHTML = renderPlans(plans, {
    current: plan.id,
    action: (p) => {
      if (p.id === 'free') return p.id === plan.id ? { label: t('plan.current'), disabled: true } : stripeSubscriber ? { label: t('billing.manage'), attrs: 'data-portal' } : null;
      if (stripeSubscriber) return p.id === plan.id ? { label: t('plan.current'), disabled: true } : { label: t('plan.choose', { name: t(`plan.${p.id}`) }), attrs: 'data-portal' };
      const actions = [];
      // Local passes: one button per gateway (a running pass of this plan is extended).
      for (const provider of providers) {
        const label = p.id === plan.id && prepaid ? `${t('billing.renew')} · ${t(provider.id === 'geniuspay' ? 'billing.payMobile' : 'billing.payCard')}` : t(provider.id === 'geniuspay' ? 'billing.payMobile' : 'billing.payCard');
        actions.push({ label, icon: provider.id === 'geniuspay' ? 'phone' : 'card', attrs: `data-pay="${p.id}" data-provider="${provider.id}"`, primary: actions.length === 0 });
      }
      if (billing && !prepaid) actions.push({ label: t('billing.payStripe'), icon: 'card', attrs: `data-checkout="${p.id}"`, primary: actions.length === 0 });
      if (!actions.length) return p.id === plan.id ? { label: t('plan.current'), disabled: true } : { label: t('plan.contact'), disabled: true };
      return actions;
    },
  });
  renderCredits(user, providers);
  const payments = await api('/api/billing/payments').catch(() => []);
  $('paymentsCard').hidden = !payments.length;
  $('paymentRows').innerHTML = payments
    .map((p) => `<tr><td>${escapeHtml(formatDate(p.createdAt))}</td><td>${escapeHtml(p.credits ? t('credits.bought', { n: p.credits }) : `${t(`plan.${p.plan}`)} · ${t('billing.days', { n: p.months * 30 })}`)}</td><td>${escapeHtml(t(`pay.provider.${p.provider}`))}</td><td>${escapeHtml(formatMoney(p.amount, p.currency))}</td><td>${payBadge(p.status)}</td></tr>`)
    .join('');
};

// Packs of extra videos (beyond the monthly quota, never expire).
const renderCredits = (user, providers) => {
  const pack = state.publicConfig?.creditPack;
  $('creditsCard').hidden = !pack || !providers.length;
  if ($('creditsCard').hidden) return;
  $('creditsBalance').textContent = t('credits.count', { n: user.credits ?? 0 });
  $('creditsDesc').textContent = t('credits.desc', { n: pack.videos });
  const current = Number($('creditsPacks').value) || 1;
  $('creditsPacks').innerHTML = [1, 2, 3, 5, 10]
    .map((n) => `<option value="${n}" ${n === current ? 'selected' : ''}>${escapeHtml(t('credits.option', { n: n * pack.videos }))}</option>`)
    .join('');
  const draw = () => {
    const n = Number($('creditsPacks').value) || 1;
    $('creditsActions').innerHTML = providers
      .map((p, i) => `<button type="button" class="btn ${i ? 'btn-secondary' : 'btn-primary'}" data-buy-credits="${p.id}">${icon(p.id === 'geniuspay' ? 'phone' : 'card', 16)}<span>${escapeHtml(formatMoney((pack.prices[p.currency] ?? 0) * n, p.currency))} · ${escapeHtml(t(p.id === 'geniuspay' ? 'billing.payMobile' : 'billing.payCard'))}</span></button>`)
      .join('');
  };
  $('creditsPacks').onchange = draw;
  draw();
};
$('creditsActions').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-buy-credits]');
  if (!btn) return;
  btn.disabled = true;
  try {
    location.href = (await post('/api/billing/pay', { packs: Number($('creditsPacks').value) || 1, provider: btn.dataset.buyCredits })).url;
  } catch (err) {
    btn.disabled = false;
    toast(errorText(err), 'error');
  }
});

$('billingPlans').addEventListener('click', async (e) => {
  const checkout = e.target.closest('[data-checkout]');
  const portal = e.target.closest('[data-portal]');
  const pay = e.target.closest('[data-pay]');
  try {
    if (pay) {
      pay.disabled = true;
      location.href = (await post('/api/billing/pay', { plan: pay.dataset.pay, provider: pay.dataset.provider })).url;
    }
    if (checkout) location.href = (await post('/api/billing/checkout', { plan: checkout.dataset.checkout })).url;
    if (portal) location.href = (await post('/api/billing/portal')).url;
  } catch (err) {
    if (pay) pay.disabled = false;
    toast(errorText(err), 'error');
  }
});
$('portalBtn').addEventListener('click', async () => {
  try {
    location.href = (await post('/api/billing/portal')).url;
  } catch (err) {
    toast(errorText(err), 'error');
  }
});

// ---- Account -------------------------------------------------------------------------------
const loadAccount = () => {
  const f = $('profileForm');
  f.name.value = state.me.user.name ?? '';
  f.email.value = state.me.user.email;
  f.locale.value = getLang();
  f.theme.value = getTheme();
};
$('profileForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  try {
    state.me = await api('/api/me', { method: 'PATCH', body: JSON.stringify({ name: f.name.value, locale: f.locale.value }) });
    setLang(f.locale.value);
    setTheme(f.theme.value);
    renderShell();
    toast(t('common.saved'), 'success');
  } catch (err) {
    toast(errorText(err), 'error');
  }
});
$('passwordForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  try {
    await post('/api/me/password', { current: f.current.value, next: f.next.value });
    f.reset();
    toast(t('account.changed'), 'success');
  } catch (err) {
    toast(errorText(err), 'error');
  }
});
$('deleteAccount').addEventListener('click', async () => {
  const password = prompt(t('account.deleteConfirm'));
  if (!password) return;
  try {
    await api('/api/me', { method: 'DELETE', body: JSON.stringify({ password }) });
    location.href = '/';
  } catch (err) {
    toast(errorText(err), 'error');
  }
});

// ---- Admin ----------------------------------------------------------------------------------
const loadAdmin = async () => {
  const [stats, users, settings] = await Promise.all([api('/api/admin/stats').catch(() => null), api('/api/admin/users').catch(() => []), api('/api/admin/settings').catch((err) => ({ error: errorText(err) }))]);
  if (stats) {
    $('adminStats').innerHTML = [
      ['admin.stats.users', stats.users],
      ['admin.stats.paying', stats.paying],
      ['admin.stats.videos', stats.videos_month],
      ['admin.stats.queue', `${stats.queued} / ${stats.running}`],
      ...(stats.revenue_xof || stats.revenue_mad ? [['admin.revenue', [stats.revenue_xof ? formatMoney(stats.revenue_xof, 'XOF') : '', stats.revenue_mad ? formatMoney(stats.revenue_mad, 'MAD') : ''].filter(Boolean).join(' · ')]] : []),
    ]
      .map(([k, v]) => `<div class="card stat"><div class="k">${escapeHtml(t(k))}</div><div class="v">${escapeHtml(String(v))}</div></div>`)
      .join('');
  }
  const planIds = (state.publicConfig?.plans ?? []).map((p) => p.id);
  $('adminUsers').innerHTML = users
    .map(
      (u) => `<tr>
        <td><b>${escapeHtml(u.name || u.email.split('@')[0])}</b><div class="hint">${escapeHtml(u.email)}</div></td>
        <td><select class="select" data-user="${escapeHtml(u.id)}" data-field="plan">${planIds.map((p) => `<option value="${p}" ${u.plan === p ? 'selected' : ''}>${escapeHtml(t(`plan.${p}`))}</option>`).join('')}</select>${u.subscriptionStatus ? `<div class="hint">Stripe : ${escapeHtml(u.subscriptionStatus)}</div>` : ''}</td>
        <td><select class="select" data-user="${escapeHtml(u.id)}" data-field="role" ${u.id === state.me.user.id ? 'disabled' : ''}><option value="user" ${u.role === 'user' ? 'selected' : ''}>user</option><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>admin</option></select></td>
        <td>${u.videosThisMonth}</td>
        <td>${escapeHtml(formatDate(u.createdAt, false))}</td>
      </tr>`,
    )
    .join('');
  const payments = await api('/api/admin/payments').catch(() => []);
  $('adminPaymentsCard').hidden = !payments.length;
  $('adminPaymentRows').innerHTML = payments
    .slice(0, 50)
    .map((p) => `<tr><td>${escapeHtml(formatDate(p.createdAt))}</td><td>${escapeHtml(p.email ?? '')}</td><td>${escapeHtml(p.credits ? t('credits.bought', { n: p.credits }) : t(`plan.${p.plan}`))}</td><td>${escapeHtml(t(`pay.provider.${p.provider}`))}</td><td>${escapeHtml(formatMoney(p.amount, p.currency))}</td><td>${payBadge(p.status)}</td></tr>`)
    .join('');
  if (settings.error) {
    $('adminSettings').innerHTML = `<div class="alert warning">${escapeHtml(settings.error)}</div>`;
    return;
  }
  $('adminServicesText').innerHTML = escapeHtml(t('admin.servicesText', { file: '\u0000' })).replace('\u0000', `<code>${escapeHtml(settings.envFile)}</code>`);
  $('adminSettings').innerHTML = settings.groups.map(renderSettingGroup).join('');
};

$('adminUsers').addEventListener('change', async (e) => {
  const sel = e.target.closest('[data-user]');
  if (!sel) return;
  try {
    await api(`/api/admin/users/${sel.dataset.user}`, { method: 'PATCH', body: JSON.stringify({ [sel.dataset.field]: sel.value }) });
    toast(t('common.saved'), 'success');
    if (sel.dataset.user === state.me.user.id) refreshMe();
  } catch (err) {
    toast(errorText(err), 'error');
  }
});

const en = () => getLang() === 'en';
const groupText = (g) => (en() && SETTINGS_EN.groups[g.id] ? { title: SETTINGS_EN.groups[g.id][0], description: SETTINGS_EN.groups[g.id][1] } : { title: g.title, description: g.description });

const renderSettingGroup = (g) => {
  const configured = g.fields.filter((f) => f.configured && (f.secret || f.credential)).length;
  const text = groupText(g);
  return `<form class="card settings-card" data-group="${escapeHtml(g.id)}">
    <div class="card-header"><div><h2>${escapeHtml(text.title)}</h2><p>${escapeHtml(text.description)}</p></div>${configured ? `<span class="badge success">${escapeHtml(t('admin.configured', { n: configured }))}</span>` : ''}</div>
    <div class="card-body">${g.fields.map(renderSettingField).join('')}</div>
    <div class="card-footer"><button type="submit" class="btn btn-primary btn-sm">${escapeHtml(t('common.save'))}</button></div>
  </form>`;
};

const renderSettingField = (f) => {
  const label = en() ? (SETTINGS_EN.fields[f.key] ?? f.label) : f.label;
  const top = `<div class="top">${escapeHtml(label)}${f.free ? ` <span class="badge info">${escapeHtml(t('common.free'))}</span>` : ''}${f.secret && f.configured ? ` <span class="badge success">${escapeHtml(t('admin.configuredKey'))}</span>` : ''}${f.link ? `<a href="${escapeHtml(f.link)}" target="_blank" rel="noopener">${escapeHtml(t('admin.get'))} ${icon('external', 13)}</a>` : ''}</div>`;
  let input;
  if (f.options) {
    const values = f.options.map((o) => o.value);
    const opts = [...(values.includes(f.value) || !f.value ? [] : [{ value: f.value, label: f.value }]), ...f.options];
    input = `<select class="select" data-key="${escapeHtml(f.key)}">${opts.map((o) => `<option value="${escapeHtml(o.value)}" ${o.value === f.value ? 'selected' : ''}>${escapeHtml((en() && SETTINGS_EN.options[`${f.key}:${o.value}`]) || o.label)}</option>`).join('')}</select>`;
  } else if (f.secret) {
    input = `<div class="input-group"><input class="input" type="password" autocomplete="off" data-key="${escapeHtml(f.key)}" placeholder="${escapeHtml(f.configured ? t('admin.keep') : t('admin.paste'))}" />${f.configured ? `<button type="button" class="btn btn-ghost btn-icon btn-sm" data-clear="${escapeHtml(f.key)}" title="${escapeHtml(t('common.delete'))}">${icon('x', 15)}</button>` : ''}</div>`;
  } else {
    input = `<input class="input" data-key="${escapeHtml(f.key)}" value="${escapeHtml(f.value)}" placeholder="${escapeHtml(f.placeholder ?? '')}" />`;
  }
  return `<div class="setting">${top}${input}${f.help && !en() ? `<span class="hint">${escapeHtml(f.help)}</span>` : ''}</div>`;
};

const putSettings = async (updates) => {
  await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify(updates) });
  await loadOptions().catch(() => undefined);
  await loadConnectionsData().catch(() => undefined);
  loadAdmin();
};
$('adminSettings').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target.closest('form');
  const updates = Object.fromEntries([...form.querySelectorAll('[data-key]')].map((el) => [el.dataset.key, el.value]));
  try {
    await putSettings(updates);
    toast(t('common.saved'), 'success');
    if (updates.VIDEO_AGENT_WEB_PASSWORD) setTimeout(() => location.reload(), 1200);
  } catch (err) {
    toast(errorText(err), 'error');
  }
});
$('adminSettings').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-clear]');
  if (!b || !confirm(t('admin.clearConfirm', { key: b.dataset.clear }))) return;
  try {
    await putSettings({ [b.dataset.clear]: null });
  } catch (err) {
    toast(errorText(err), 'error');
  }
});

// ---- Language changes re-render dynamic content ----------------------------------------------------
onLanguageChange((lang) => {
  if (!state.me) return showAuth(['login', 'signup', 'forgot', 'reset'].includes(route().page) ? route().page : 'login');
  renderShell();
  renderOptions();
  if (state.job) showJob(state.job);
  state.publishJobId = null;
  if (state.job?.status === 'completed') resetPublish(state.job.id);
  const page = route().page;
  $('topTitle').textContent = t(`nav.${PAGES.includes(page) ? page : 'create'}`);
  ({ library: loadLibrary, schedule: loadSchedule, connections: loadConnections, brand: loadBrand, billing: loadBilling, account: loadAccount, admin: loadAdmin })[page]?.();
  if (lang !== state.me.user.locale) api('/api/me', { method: 'PATCH', body: JSON.stringify({ locale: lang }) }).then((me) => (state.me = me)).catch(() => undefined);
});

// ---- Boot -----------------------------------------------------------------------------------------
initChrome();
renderIcons();
(async () => {
  state.publicConfig = await api('/api/public/config').catch(() => null);
  try {
    await startApp();
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      state.me = null;
      onRoute();
    } else {
      document.body.innerHTML = `<div class="auth"><div class="card auth-card"><div class="alert danger">${escapeHtml(errorText(err))}</div></div></div>`;
    }
  }
})();
