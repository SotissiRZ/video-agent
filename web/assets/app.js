// SOVID AI web app: authentication, video creation, library, publishing, billing, admin.
import { $, api, ApiError, errorText, escapeHtml, friendlyText, getTheme, icon, initChrome, onLanguageChange, post, renderIcons, savedLang, setLang, setTheme, toast } from './common.js';
import { formatDate, formatDuration, getLang, SETTINGS_EN, STYLE_NAMES, t, TEMPLATE_NAMES } from './i18n.js';
import { formatMoney, renderPlans } from './plans.js';
import { openFile } from './viewer.js';

const STEPS = ['analyze', 'concept', 'script', 'storyboard', 'scenes', 'assets', 'animations', 'subtitles', 'audio', 'project', 'render', 'output'];
const PLATFORMS = { youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram', facebook: 'Facebook', linkedin: 'LinkedIn' };
const PROVIDER_INFO = {
  youtube: { name: 'YouTube', icon: 'youtube', setupUrl: 'https://console.cloud.google.com/apis/credentials' },
  tiktok: { name: 'TikTok', icon: 'tiktok', setupUrl: 'https://developers.tiktok.com/' },
  linkedin: { name: 'LinkedIn', icon: 'linkedin', setupUrl: 'https://www.linkedin.com/developers/apps' },
  meta: { name: 'Facebook + Instagram', icon: 'meta', setupUrl: 'https://developers.facebook.com/apps/' },
};
const PAGES = ['create', 'songs', 'library', 'schedule', 'connections', 'brand', 'billing', 'account', 'admin'];

const state = { voice: null, me: null, publicConfig: null, options: null, connections: null, job: null, source: null, publishJobId: null, brand: null, song: null, songPoll: null, productImages: [] };

const addPasswordVisibilityControls = () => {
  document.querySelectorAll('input[type="password"]').forEach((input) => {
    if (input.parentElement.classList.contains('password-input-group') || input.parentElement.querySelector('[data-toggle-password]')) return;
    const group = document.createElement('div');
    group.className = 'input-group password-input-group';
    input.before(group);
    group.append(input);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-ghost btn-icon btn-sm password-toggle';
    button.setAttribute('aria-label', t('admin.showPassword'));
    button.setAttribute('aria-pressed', 'false');
    button.title = t('admin.showPassword');
    button.innerHTML = icon('eye', 16);
    button.addEventListener('click', () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      button.innerHTML = icon(show ? 'eyeOff' : 'eye', 16);
      button.setAttribute('aria-pressed', String(show));
      button.setAttribute('aria-label', t(show ? 'admin.hidePassword' : 'admin.showPassword'));
      button.title = t(show ? 'admin.hidePassword' : 'admin.showPassword');
    });
    group.append(button);
  });
};

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
  clearTimeout(state.songPoll);
  state.songPoll = null;
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
  $('newVideoBtn').hidden = name === 'create' || name === 'songs';
  $('appView').classList.remove('menu-open');
  ({ create: () => openJobFromParams(params), songs: loadSongs, library: loadLibrary, schedule: loadSchedule, connections: () => loadConnections(params), brand: loadBrand, billing: () => loadBilling(params), account: loadAccount, admin: loadAdmin })[name]?.();
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
  document.title = `${t({ login: 'auth.login', signup: 'auth.signup', forgot: 'auth.forgot.title', reset: 'auth.reset.title' }[mode])} · SOVID AI`;
};

const bindAuthForm = (form, path, extra = () => ({})) =>
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const error = form.querySelector('[data-error]');
    error.hidden = true;
    const data = Object.fromEntries(new FormData(form));
    if (form.id === 'signupForm' && data.password !== data.confirmPassword) {
      error.textContent = t('auth.passwordMismatch');
      error.hidden = false;
      form.querySelector('[name="confirmPassword"]').focus();
      return;
    }
    delete data.confirmPassword;
    if (form.id === 'signupForm') {
      if (!form.elements.namedItem('acceptTerms').checked) {
        error.textContent = t('auth.acceptTermsRequired');
        error.hidden = false;
        return;
      }
      data.acceptTerms = true;
    }
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
  document.title = 'SOVID AI';
  renderShell();
  await loadOptions();
  loadConnectionsData().catch(() => undefined);
  loadBrandData().catch(() => undefined);
  loadProductImages().catch(() => undefined);
  loadVoice().catch(() => undefined);
  refreshPendingCount();
  onRoute();
};

const refreshMe = async () => {
  state.me = await api('/api/me');
  renderShell();
};

const renderShell = () => {
  const { user, plan, usage } = state.me;
  $('verifyBanner').hidden = user.emailVerified || (state.me.mail !== 'smtp' && !state.me.requireVerification);
  $('verifyText').textContent = t(state.me.requireVerification ? 'verify.required' : 'verify.banner', { email: user.email });
  $('adminLink').hidden = user.role !== 'admin';
  // Pages for services this server does not offer stay out of the way (admins still see them to set up).
  const features = state.publicConfig?.features;
  if (features) {
    const admin = user.role === 'admin';
    $('scheduleLink').hidden = !features.publish?.length && !admin;
    $('connectionsLink').hidden = !features.publish?.length && !admin;
    $('songsLink').hidden = !features.songs && !admin;
  }
  $('userName').textContent = user.name || user.email.split('@')[0];
  $('userEmail').textContent = user.email;
  $('avatar').textContent = (user.name || user.email).trim()[0].toUpperCase();
  $('usagePlan').textContent = t(`plan.${plan.id}`);
  $('usageUpgrade').hidden = plan.id === 'pro';
  $('usageVideos').textContent = `${usage.videos} / ${plan.videosPerMonth}`;
  $('usageBar').style.width = `${Math.min(100, (usage.videos / plan.videosPerMonth) * 100)}%`;
  $('usageSongs').textContent = `${usage.songs} / ${plan.songsPerMonth}`;
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

// ---- Songs ---------------------------------------------------------------------------------
const SONG_STATUS = { draft: 'songs.status.draft', queued: 'songs.status.queued', running: 'songs.status.running', completed: 'songs.status.completed', failed: 'songs.status.failed' };

const renderExportActions = (container, product, targetId, unlocked) => {
  if (state.me.plan.id !== 'free' || unlocked) {
    container.innerHTML = '';
    return;
  }
  const providers = state.me.paymentProviders ?? [];
  const prices = state.me.commerce ?? state.publicConfig?.commerce;
  const amount = (currency) => product === 'video'
    ? currency === 'XOF' ? prices?.videoPriceXof : prices?.videoPriceMad
    : currency === 'XOF' ? prices?.songPriceXof : prices?.songPriceMad;
  container.innerHTML = providers.map((provider, index) =>
    `<button type="button" class="btn ${index ? 'btn-secondary' : 'btn-primary'} btn-sm" data-export-pay="${product}" data-target="${escapeHtml(targetId)}" data-provider="${escapeHtml(provider.id)}">${icon(provider.id === 'geniuspay' ? 'phone' : 'card', 15)}<span>${escapeHtml(t('export.unlock'))} · ${escapeHtml(formatMoney(amount(provider.currency), provider.currency))}</span></button>`,
  ).join('') + (providers.length ? `<p class="hint" style="flex-basis: 100%">${escapeHtml(t('export.consent'))} <a href="/legal#sales" target="_blank">${escapeHtml(t('legal.sales'))}</a></p>` : '');
};

const showSong = (song) => {
  state.song = song;
  $('songEditorCard').hidden = false;
  $('songTitle').value = song.title;
  $('songLyrics').value = song.lyrics;
  const running = song.status === 'queued' || song.status === 'running';
  const correctionLimit = state.me.commerce?.correctionsPerSong ?? 1;
  const editable = !running && (song.status !== 'completed' || song.correctionsUsed < correctionLimit);
  $('songTitle').disabled = !editable;
  $('songLyrics').disabled = !editable;
  $('songSaveLyrics').hidden = !editable;
  $('songGenerate').hidden = song.status === 'completed';
  $('songGenerate').disabled = running;
  $('songGenerate').querySelector('[data-i18n]').textContent = t(song.status === 'failed' ? 'songs.retry' : 'songs.generate');
  $('songRunStatus').textContent = t(SONG_STATUS[song.status] ?? 'songs.status.draft');
  $('songGenerateError').hidden = !song.error;
  $('songGenerateError').textContent = song.error ? t(`songs.error.${song.error}`) : '';
  $('songAudioResult').hidden = song.status !== 'completed' || !song.audioUrl;
  $('songDownload').hidden = state.me.plan.id === 'free' && !song.exportPaid;
  $('songPreviewNote').hidden = state.me.plan.id !== 'free' || song.exportPaid;
  renderExportActions($('songExportPay'), 'song', song.id, song.exportPaid);
  if (song.audioUrl) {
    // Reload when the excerpt becomes the full song (payment) or a corrected version is generated.
    const audioKey = `${song.id}:${song.exportPaid}:${song.finishedAt ?? ''}`;
    if ($('songAudio').dataset.song !== audioKey) {
      $('songAudio').src = `${song.audioUrl}?v=${encodeURIComponent(audioKey)}`;
      $('songAudio').dataset.song = audioKey;
    }
    $('songDownload').href = song.downloadUrl;
    $('songDownload').setAttribute('download', `${song.title.replace(/[^\p{L}\p{N}-]+/gu, '-').replace(/^-|-$/g, '') || 'song'}.mp3`);
  }
};

/** Free plan: only the song lengths it allows (the server caps them anyway). */
const applySongDurationLimit = () => {
  const max = state.me?.plan?.id === 'free' ? state.me?.commerce?.freeSongMaxSec ?? 60 : 120;
  const select = $('songDuration');
  for (const option of select.options) option.disabled = Number(option.value) > max;
  if (Number(select.value) > max) select.value = [...select.options].filter((o) => !o.disabled).at(-1)?.value ?? select.value;
};

const loadSongs = async () => {
  applySongDurationLimit();
  const songs = await api('/api/songs');
  $('songsEmpty').hidden = songs.length > 0;
  $('songHistory').innerHTML = songs.map((song) => `<div class="video-card" role="button" tabindex="0" data-song-id="${escapeHtml(song.id)}">
    <div class="thumb">${icon('mic', 28)}<span class="badge ${song.status === 'completed' ? 'success' : song.status === 'failed' ? 'danger' : 'info'}">${escapeHtml(t(SONG_STATUS[song.status] ?? 'songs.status.draft'))}</span></div>
    <div class="meta"><div class="title">${escapeHtml(song.title)}</div><div class="sub"><span>${escapeHtml(song.style)} · ${escapeHtml(song.mood)}</span>
      ${['queued', 'running'].includes(song.status) ? '' : `<button type="button" class="btn btn-ghost btn-icon btn-sm" data-song-delete="${escapeHtml(song.id)}" title="${escapeHtml(t('common.delete'))}" aria-label="${escapeHtml(t('common.delete'))}">${icon('trash', 15)}</button>`}</div></div>
  </div>`).join('');
  if (state.song) {
    const latest = songs.find((song) => song.id === state.song.id);
    if (latest) showSong(latest);
  }
  if (state.song && ['queued', 'running'].includes(state.song.status)) pollSong(state.song.id);
};

const pollSong = (id) => {
  clearTimeout(state.songPoll);
  state.songPoll = setTimeout(async () => {
    try {
      const song = await api(`/api/songs/${encodeURIComponent(id)}`);
      showSong(song);
      await loadSongs();
      if (['queued', 'running'].includes(song.status)) pollSong(id);
      else refreshMe().catch(() => undefined);
    } catch (err) {
      toast(errorText(err), 'error');
    }
  }, 2000);
};

$('songBriefForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('songDraftError').hidden = true;
  const button = $('songDraftSubmit');
  button.disabled = true;
  try {
    const song = await post('/api/songs', {
      prompt: $('songPrompt').value.trim(),
      style: $('songStyle').value,
      mood: $('songMood').value,
      durationSec: Number($('songDuration').value),
    });
    showSong(song);
    await loadSongs();
  } catch (err) {
    $('songDraftError').textContent = errorText(err);
    $('songDraftError').hidden = false;
  } finally {
    button.disabled = false;
  }
});

$('songSaveLyrics').addEventListener('click', async () => {
  if (!state.song) return;
  $('songGenerateError').hidden = true;
  try {
    const song = await api(`/api/songs/${encodeURIComponent(state.song.id)}/lyrics`, {
      method: 'PUT',
      body: JSON.stringify({ title: $('songTitle').value.trim(), lyrics: $('songLyrics').value }),
    });
    showSong(song);
    await loadSongs();
    toast(t('songs.lyricsSaved'), 'success');
  } catch (err) {
    $('songGenerateError').textContent = errorText(err);
    $('songGenerateError').hidden = false;
  }
});

$('songGenerate').addEventListener('click', async () => {
  if (!state.song) return;
  $('songGenerateError').hidden = true;
  $('songGenerate').disabled = true;
  try {
    const song = await api(`/api/songs/${encodeURIComponent(state.song.id)}/lyrics`, {
      method: 'PUT',
      body: JSON.stringify({ title: $('songTitle').value.trim(), lyrics: $('songLyrics').value }),
    });
    showSong(await post(`/api/songs/${encodeURIComponent(song.id)}/generate`));
    pollSong(song.id);
    refreshMe().catch(() => undefined);
  } catch (err) {
    $('songGenerateError').textContent = errorText(err);
    $('songGenerateError').hidden = false;
    $('songGenerate').disabled = false;
  }
});

$('songHistory').addEventListener('click', async (e) => {
  const del = e.target.closest('[data-song-delete]');
  if (del) {
    e.stopPropagation();
    if (!confirm(t('songs.deleteConfirm'))) return;
    try {
      await api(`/api/songs/${encodeURIComponent(del.dataset.songDelete)}`, { method: 'DELETE' });
      if (state.song?.id === del.dataset.songDelete) {
        clearTimeout(state.songPoll);
        state.song = null;
        $('songEditorCard').hidden = true;
        $('songAudio').pause();
        $('songAudio').removeAttribute('src');
      }
      await loadSongs();
      toast(t('songs.deleted'), 'success');
    } catch (err) {
      toast(errorText(err), 'error');
    }
    return;
  }
  const card = e.target.closest('[data-song-id]');
  if (!card) return;
  try {
    showSong(await api(`/api/songs/${encodeURIComponent(card.dataset.songId)}`));
    if (['queued', 'running'].includes(state.song.status)) pollSong(state.song.id);
  } catch (err) {
    toast(errorText(err), 'error');
  }
});
$('songHistory').addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('[data-song-id]') && !e.target.closest('[data-song-delete]')) {
    e.preventDefault();
    e.target.closest('[data-song-id]').click();
  }
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

// Product photos: a tile per photo (click to include it or not) and a "+" frame to add more.
const renderProductImages = () => {
  const images = state.productImages;
  const limit = state.me?.commerce?.maxProductImages ?? 4;
  const tiles = images.map((image) => `<label class="product-tile" title="${escapeHtml(image.description || image.name)}">
    <input type="checkbox" value="${escapeHtml(image.id)}" checked hidden />
    <img src="/api/product-images/${encodeURIComponent(image.id)}/file" alt="${escapeHtml(image.name)}" loading="lazy" />
    <span class="product-tile-check">${icon('check', 12)}</span>
    <button type="button" class="product-tile-delete" data-product-image-delete="${escapeHtml(image.id)}" title="${escapeHtml(t('common.delete'))}" aria-label="${escapeHtml(t('common.delete'))}">${icon('trash', 14)}</button>
  </label>`);
  const add = images.length < limit
    ? `<label class="product-tile product-add${images.length ? '' : ' is-alone'}" for="productImageInput" tabindex="0" role="button">${icon('plus', 28)}<span>${escapeHtml(t(images.length ? 'create.productImagesAdd' : 'create.productImagesDrop'))}</span></label>`
    : '';
  $('productImagesList').innerHTML = tiles.join('') + add;
  $('productImageNotes').innerHTML = images
    .filter((image) => image.description)
    .map((image) => `<p class="hint"><b>${escapeHtml(image.name)}</b> — ${escapeHtml(t('create.productImageSeen'))} ${escapeHtml(image.description)}</p>`)
    .join('');
};

const loadProductImages = async () => {
  state.productImages = await api('/api/product-images');
  renderProductImages();
};

const uploadProductImages = async (files) => {
  const images = [...files].filter((file) => /^image\/(png|jpeg|webp)$/.test(file.type));
  if (!images.length) return;
  const add = $('productImagesList').querySelector('.product-add');
  add?.classList.add('is-busy');
  if (add) add.querySelector('span').textContent = t('create.productImagesUploading');
  try {
    for (const file of images) {
      await api(`/api/product-images?filename=${encodeURIComponent(file.name)}`, { method: 'POST', body: file });
    }
    toast(t('create.productImagesUploaded'), 'success');
  } catch (err) {
    toast(errorText(err), 'error');
  } finally {
    await loadProductImages().catch(() => renderProductImages());
  }
};

$('productImageInput').addEventListener('change', async (event) => {
  const input = event.currentTarget;
  await uploadProductImages(input.files);
  input.value = '';
});

$('productImagesList').addEventListener('keydown', (event) => {
  if (!event.target.matches('.product-add') || !['Enter', ' '].includes(event.key)) return;
  event.preventDefault();
  $('productImageInput').click();
});
$('productImagesList').addEventListener('dragover', (event) => {
  event.preventDefault();
  $('productImagesList').classList.add('is-dragover');
});
$('productImagesList').addEventListener('dragleave', (event) => {
  if (!$('productImagesList').contains(event.relatedTarget)) $('productImagesList').classList.remove('is-dragover');
});
$('productImagesList').addEventListener('drop', (event) => {
  event.preventDefault();
  $('productImagesList').classList.remove('is-dragover');
  void uploadProductImages(event.dataTransfer?.files ?? []);
});

$('productImagesList').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-product-image-delete]');
  if (!button) return;
  event.preventDefault();
  try {
    await api(`/api/product-images/${encodeURIComponent(button.dataset.productImageDelete)}`, { method: 'DELETE' });
    await loadProductImages();
  } catch (err) {
    toast(errorText(err), 'error');
  }
});
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

$('businessModel').addEventListener('change', (e) => {
  const model = e.currentTarget.value;
  if (!model) return;
  $('prompt').value = t(model);
  $('prompt').focus();
  e.currentTarget.value = '';
});

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
    ...(() => {
      const choice = document.querySelector('input[name=voiceChoice]:checked')?.value ?? 'female';
      return choice === 'clone' ? { voiceClone: true } : { voiceGender: choice };
    })(),
    stock: $('stock').checked,
  };
  const format = document.querySelector('input[name=format]:checked').value;
  if (format) body.format = format;
  if ($('duration').value) body.durationSec = Number($('duration').value);
  if ($('mediaCoverage').value) body.mediaCoverage = $('mediaCoverage').value;
  if (!$('brandKitToggle').hidden) body.brandKit = $('brandKit').checked;
  const res = /^(\d{2,4})x(\d{2,4})$/.exec($('resolution').value.trim());
  if (res) Object.assign(body, { width: Number(res[1]), height: Number(res[2]) });
  body.productImageIds = [...$('productImagesList').querySelectorAll('input[type="checkbox"]:checked')].map((input) => input.value);
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
  return friendlyText(w);
};

const showJob = (job) => {
  state.job = job;
  $('emptyJob').hidden = true;
  $('jobCard').hidden = false;
  const running = job.status === 'queued' || job.status === 'running';
  $('jobBadge').innerHTML = `<span class="badge ${STATUS_BADGE[job.status] ?? ''}">${running ? '<span class="spinner" style="width:10px;height:10px;border-width:1.5px"></span>' : '<span class="dot"></span>'}${escapeHtml(t(`job.status.${job.status}`))}</span>`;
  $('jobQueue').textContent = job.status === 'queued' && job.queuePosition ? t('job.queue', { n: job.queuePosition }) : job.createdAt ? formatDate(job.createdAt) : '';
  $('jobTitle').textContent = job.title || t(`job.status.${job.status}`);
  $('cancelJob').hidden = !running;
  $('retryJob').hidden = job.status !== 'failed';
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
  $('jobError').innerHTML = job.error ? `${icon('alert', 16)}<span>${escapeHtml(t('job.failed', { error: friendlyText(job.error) }))}</span>` : '';

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
  $('download').hidden = state.me.plan.id === 'free' && !job.exportPaid;
  $('shareWhatsapp').hidden = state.me.plan.id === 'free' && !job.exportPaid;
  renderExportActions($('videoExportPay'), 'video', job.id, job.exportPaid);
  $('jobCorrection').hidden = (job.correctionsUsed ?? 0) >= (state.me.commerce?.correctionsPerVideo ?? 1);
  const pronLeft = (state.me.commerce?.pronunciationFixesPerVideo ?? 3) - (job.pronunciationFixesUsed ?? 0);
  $('jobPronunciation').hidden = !job.providers?.voice || job.providers.voice === 'none' || pronLeft <= 0;
  $('jobPronHint').textContent = t('job.pron.left', { n: pronLeft });
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
$('retryJob').addEventListener('click', async () => {
  if (!state.job || state.job.status !== 'failed') return;
  $('retryJob').disabled = true;
  try {
    const job = await post(`/api/jobs/${encodeURIComponent(state.job.id)}/retry`);
    history.replaceState(null, '', `#create?job=${job.id}`);
    showJob(job);
    follow(job.id);
    loadLibrary().catch((err) => toast(errorText(err), 'error'));
    refreshMe().catch(() => undefined);
  } catch (err) {
    toast(errorText(err), 'error');
  } finally {
    $('retryJob').disabled = false;
  }
});
$('correctJob').addEventListener('click', async () => {
  if (!state.job || !state.job.videoUrl) return;
  const instruction = $('jobCorrectionText').value.trim();
  if (instruction.length < 5) return toast(t('job.correctTooShort'), 'error');
  const button = $('correctJob');
  button.disabled = true;
  try {
    const job = await post(`/api/jobs/${encodeURIComponent(state.job.id)}/correct`, { instruction });
    $('jobCorrectionText').value = '';
    history.replaceState(null, '', `#create?job=${job.id}`);
    showJob(job);
    follow(job.id);
    loadLibrary().catch((err) => toast(errorText(err), 'error'));
    refreshMe().catch(() => undefined);
  } catch (err) {
    toast(errorText(err), 'error');
  } finally {
    button.disabled = false;
  }
});

// ---- Voices: narrator choice, cloned voice, pronunciation dictionary ----------------------
const loadVoice = async () => {
  state.voice = await api('/api/voice');
  renderVoiceChoice();
  return state.voice;
};

const renderVoiceChoice = () => {
  const clone = $('voiceChoice').querySelector('input[value="clone"]');
  const available = Boolean(state.voice?.clone);
  clone.disabled = !available;
  if (!available && clone.checked) $('voiceChoice').querySelector('input[value="female"]').checked = true;
  $('voiceChoiceHint').textContent = available ? t('create.voice.cloneReady', { name: state.voice.clone.name }) : state.voice?.cloneAvailable ? t('create.voice.cloneSetup') : '';
  $('voiceChoiceField').hidden = !$('voice').checked;
};
$('voice').addEventListener('change', renderVoiceChoice);

const renderVoiceCard = () => {
  const v = state.voice;
  if (!v) return;
  $('voiceStatus').innerHTML = v.clone
    ? `<div class="alert success">${icon('check', 16)}<span>${escapeHtml(t('voice.ready', { name: v.clone.name }))}</span><button type="button" class="btn btn-danger-ghost btn-sm" id="voiceDelete" style="margin-left: auto">${icon('trash', 14)}<span>${escapeHtml(t('common.delete'))}</span></button></div>`
    : '';
  $('voiceLocked').hidden = v.cloneAvailable || Boolean(v.clone);
  $('voiceCloneForm').hidden = !v.cloneAvailable;
  renderPronunciations(v.pronunciations);
};

const renderPronunciations = (entries) => {
  const rows = entries.length ? entries : [{ word: '', spoken: '' }];
  $('pronunciationRows').innerHTML = rows.map((entry) => `<div class="pron-row">
    <input class="input" name="word" maxlength="60" value="${escapeHtml(entry.word)}" placeholder="${escapeHtml(t('job.pron.word'))}" />
    <span class="pron-arrow">→</span>
    <input class="input" name="spoken" maxlength="120" value="${escapeHtml(entry.spoken)}" placeholder="${escapeHtml(t('job.pron.spoken'))}" />
    <button type="button" class="btn btn-ghost btn-icon btn-sm" data-pron-remove title="${escapeHtml(t('common.delete'))}" aria-label="${escapeHtml(t('common.delete'))}">${icon('trash', 14)}</button>
  </div>`).join('');
};

const pronunciationEntries = () => [...$('pronunciationRows').querySelectorAll('.pron-row')]
  .map((row) => ({ word: row.querySelector('[name=word]').value.trim(), spoken: row.querySelector('[name=spoken]').value.trim() }))
  .filter((entry) => entry.word && entry.spoken);

$('pronunciationAdd').addEventListener('click', () => {
  renderPronunciations([...pronunciationEntries(), { word: '', spoken: '' }]);
  [...$('pronunciationRows').querySelectorAll('[name=word]')].at(-1)?.focus();
});
$('pronunciationRows').addEventListener('click', (e) => {
  const button = e.target.closest('[data-pron-remove]');
  if (!button) return;
  button.closest('.pron-row').remove();
  if (!$('pronunciationRows').children.length) renderPronunciations([]);
});
$('pronunciationForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    state.voice.pronunciations = await api('/api/voice/pronunciations', { method: 'PUT', body: JSON.stringify({ entries: pronunciationEntries() }) });
    renderPronunciations(state.voice.pronunciations);
    toast(t('common.saved'), 'success');
  } catch (err) {
    toast(errorText(err), 'error');
  }
});

// Voice sample: recorded in the browser or imported, then sent to the cloning service.
const voiceSample = { blob: null, recorder: null, stream: null, timer: null, started: 0 };
const setVoiceSample = (blob) => {
  voiceSample.blob = blob;
  $('voicePreview').hidden = !blob;
  if (blob) $('voicePreview').src = URL.createObjectURL(blob);
  $('voiceSubmit').disabled = !blob || !$('voiceConsent').checked;
};
$('voiceConsent').addEventListener('change', () => setVoiceSample(voiceSample.blob));
$('voiceFile').addEventListener('change', (e) => {
  const file = e.currentTarget.files[0];
  if (file) setVoiceSample(file);
  e.currentTarget.value = '';
});
$('voiceRecord').addEventListener('click', async () => {
  if (voiceSample.recorder) {
    voiceSample.recorder.stop();
    return;
  }
  try {
    voiceSample.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch {
    return toast(t('voice.micDenied'), 'error');
  }
  const chunks = [];
  const recorder = new MediaRecorder(voiceSample.stream);
  voiceSample.recorder = recorder;
  recorder.ondataavailable = (ev) => ev.data.size && chunks.push(ev.data);
  recorder.onstop = () => {
    clearInterval(voiceSample.timer);
    voiceSample.stream.getTracks().forEach((track) => track.stop());
    voiceSample.recorder = null;
    $('voiceRecordLabel').textContent = t('voice.recordAgain');
    setVoiceSample(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }));
  };
  recorder.start();
  voiceSample.started = Date.now();
  const tick = () => ($('voiceRecordLabel').textContent = t('voice.stop', { s: Math.round((Date.now() - voiceSample.started) / 1000) }));
  tick();
  voiceSample.timer = setInterval(tick, 1000);
});
$('voiceSubmit').addEventListener('click', async () => {
  if (!voiceSample.blob) return;
  const button = $('voiceSubmit');
  button.disabled = true;
  button.querySelector('span').textContent = t('voice.creating');
  try {
    const params = new URLSearchParams({ consent: '1', name: $('voiceName').value.trim() });
    await api(`/api/voice/clone?${params}`, { method: 'POST', body: voiceSample.blob, headers: { 'content-type': voiceSample.blob.type || 'audio/webm' } });
    setVoiceSample(null);
    $('voiceConsent').checked = false;
    await loadVoice();
    renderVoiceCard();
    toast(t('voice.created'), 'success');
  } catch (err) {
    toast(errorText(err), 'error');
  } finally {
    button.querySelector('span').textContent = t('voice.create');
    button.disabled = !voiceSample.blob || !$('voiceConsent').checked;
  }
});
$('voiceStatus').addEventListener('click', async (e) => {
  if (!e.target.closest('#voiceDelete') || !confirm(t('voice.deleteConfirm'))) return;
  try {
    await api('/api/voice/clone', { method: 'DELETE' });
    await loadVoice();
    renderVoiceCard();
  } catch (err) {
    toast(errorText(err), 'error');
  }
});

// Pronunciation fix of a finished video: only the sentences with the word are recorded again.
$('fixPronunciation').addEventListener('click', async () => {
  if (!state.job) return;
  const word = $('jobPronWord').value.trim();
  const spoken = $('jobPronSpoken').value.trim();
  if (!word || !spoken) return toast(t('job.pron.missing'), 'error');
  const button = $('fixPronunciation');
  button.disabled = true;
  try {
    const job = await post(`/api/jobs/${encodeURIComponent(state.job.id)}/pronunciation`, { word, spoken, save: $('jobPronSave').checked });
    $('jobPronWord').value = '';
    $('jobPronSpoken').value = '';
    if ($('jobPronSave').checked) loadVoice().catch(() => undefined);
    history.replaceState(null, '', `#create?job=${job.id}`);
    showJob(job);
    follow(job.id);
    loadLibrary().catch((err) => toast(errorText(err), 'error'));
  } catch (err) {
    toast(errorText(err), 'error');
  } finally {
    button.disabled = false;
  }
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
  const canPublish = state.me.plan.publish || Boolean(state.job?.exportPaid);
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
  `<div class="outcome">${pubBadge(p.status)}<span class="grow">${escapeHtml(p.platforms.map((x) => PLATFORMS[x] ?? x).join(', '))} · ${escapeHtml(formatDate(p.at))}${p.error ? ` · ${escapeHtml(friendlyText(p.error))}` : ''}</span>${(p.outcomes ?? [])
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
        .map((o) => `<div class="outcome">${icon(o.ok ? 'check' : 'alert', 16)}<b>${escapeHtml(PLATFORMS[o.platform])}</b><span class="grow muted">${escapeHtml(friendlyText(o.message))}${(o.warnings ?? []).map((w) => ` · ${escapeHtml(friendlyText(w))}`).join('')}</span></div>`)
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

document.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-export-pay]');
  if (!button) return;
  button.disabled = true;
  try {
    const response = await post('/api/billing/pay', {
      export: { product: button.dataset.exportPay, targetId: button.dataset.target },
      provider: button.dataset.provider,
    });
    location.href = response.url;
  } catch (err) {
    button.disabled = false;
    toast(errorText(err), 'error');
  }
});

// ---- Library -----------------------------------------------------------------------------------
const loadLibrary = async () => {
  const retention = state.publicConfig?.retentionDays ?? 0;
  $('retentionNote').hidden = !retention;
  $('retentionNoteText').textContent = t('library.retention', { n: retention });
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
    try {
      await api(`/api/jobs/${del.dataset.delete}?remove=1`, { method: 'DELETE' });
    } catch (err) {
      toast(errorText(err), 'error');
      return;
    }
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
        <td>${pubBadge(p.status)}${p.error ? `<div class="hint">${escapeHtml(friendlyText(p.error))}</div>` : ''}${(p.outcomes ?? []).filter((o) => !o.ok).map((o) => `<div class="hint">${escapeHtml(PLATFORMS[o.platform])} : ${escapeHtml(friendlyText(o.message))}</div>`).join('')}</td>
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
    toast(t('conn.failed', { error: friendlyText(params.get('error')) }), 'error');
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
        ? `<div class="provider-unavailable"><span class="hint">${escapeHtml(t('conn.unavailable'))}</span><a class="btn btn-secondary btn-sm" href="${escapeHtml(info.setupUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(t('conn.configureApp'))}${icon('external', 14)}</a><span class="hint">${escapeHtml(t('conn.configureHint'))}</span></div>`
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
  loadVoice().then(renderVoiceCard).catch((err) => toast(errorText(err), 'error'));
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
        const isExport = r.payment.plan === 'export_video' || r.payment.plan === 'export_song';
        toast(t(isExport ? 'billing.exportDone' : 'billing.paymentDone'), 'success');
        await loadBilling();
        if (r.payment.plan === 'export_video' && state.job) showJob(await api(`/api/jobs/${encodeURIComponent(state.job.id)}`));
        if (r.payment.plan === 'export_song' && state.song) showSong(await api(`/api/songs/${encodeURIComponent(state.song.id)}`));
        return;
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
  $('meterSongsText').textContent = `${usage.songs} / ${plan.songsPerMonth}`;
  $('meterSongs').style.width = `${Math.min(100, (usage.songs / plan.songsPerMonth) * 100)}%`;
  const plans = state.publicConfig?.plans ?? [];
  const stripeSubscriber = Boolean(user.subscriptionStatus) && !prepaid;
  $('billingPlans').innerHTML = renderPlans(plans, {
    current: plan.id,
    features: state.publicConfig?.features,
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
    .map((p) => `<tr><td>${escapeHtml(formatDate(p.createdAt))}</td><td>${escapeHtml(p.credits ? t('credits.bought', { n: p.credits }) : p.plan.startsWith('export_') ? t(`payment.${p.plan}`) : `${t(`plan.${p.plan}`)} · ${t('billing.days', { n: p.months * 30 })}`)}</td><td>${escapeHtml(t(`pay.provider.${p.provider}`))}</td><td>${escapeHtml(formatMoney(p.amount, p.currency))}</td><td>${payBadge(p.status)}</td></tr>`)
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
const renderAdminSettings = (settings) => {
  if (settings.error) {
    $('adminSettings').innerHTML = `<div class="alert warning">${escapeHtml(friendlyText(settings.error))}</div>`;
    return;
  }
  $('adminSettings').innerHTML = settings.groups.map(renderSettingGroup).join('');
};

const adminResult = (request) => request.then((value) => ({ value })).catch((err) => ({ error: errorText(err) }));

const loadAdmin = async () => {
  const [statsResult, usersResult, settingsResult, commerceResult] = await Promise.all([
    adminResult(api('/api/admin/stats')),
    adminResult(api('/api/admin/users')),
    adminResult(api('/api/admin/settings')),
    adminResult(api('/api/admin/commerce')),
  ]);
  renderAdminCommerce(commerceResult);
  renderAdminProviders(commerceResult);
  // The public legal pages need the publisher's identity: remind the admin until it is complete.
  const company = state.publicConfig?.company ?? {};
  const missing = [['email', 'contact'], ['address', 'address'], ['registration', 'registration'], ['director', 'director'], ['country', 'country'], ['hosting', 'hosting']]
    .filter(([field]) => !company[field])
    .map(([, label]) => t(`admin.legal.${label}`));
  $('adminLegal').hidden = !missing.length;
  $('adminLegalText').textContent = t('admin.legal.missing', { fields: missing.join(', ') });
  void loadAdminCosts();
  if ('error' in statsResult) {
    $('adminStats').innerHTML = `<div class="alert danger">${escapeHtml(friendlyText(statsResult.error))}</div>`;
  } else {
    const stats = statsResult.value;
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
  $('adminUsers').innerHTML = 'error' in usersResult
    ? `<tr><td colspan="5"><div class="alert danger">${escapeHtml(friendlyText(usersResult.error))}</div></td></tr>`
    : usersResult.value
      .map((u) => `<tr>
        <td><b>${escapeHtml(u.name || u.email.split('@')[0])}</b><div class="hint">${escapeHtml(u.email)}</div></td>
        <td><select class="select" data-user="${escapeHtml(u.id)}" data-field="plan">${planIds.map((p) => `<option value="${p}" ${u.plan === p ? 'selected' : ''}>${escapeHtml(t(`plan.${p}`))}</option>`).join('')}</select>${u.subscriptionStatus ? `<div class="hint">Stripe : ${escapeHtml(u.subscriptionStatus)}</div>` : ''}</td>
        <td><select class="select" data-user="${escapeHtml(u.id)}" data-field="role" ${u.id === state.me.user.id ? 'disabled' : ''}><option value="user" ${u.role === 'user' ? 'selected' : ''}>user</option><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>admin</option></select></td>
        <td>${u.videosThisMonth}</td>
        <td>${escapeHtml(formatDate(u.createdAt, false))}</td>
      </tr>`)
      .join('');
  const paymentsResult = await adminResult(api('/api/admin/payments'));
  $('adminPaymentsCard').hidden = !('error' in paymentsResult) && !paymentsResult.value.length;
  $('adminPaymentRows').innerHTML = 'error' in paymentsResult
    ? `<tr><td colspan="6"><div class="alert danger">${escapeHtml(friendlyText(paymentsResult.error))}</div></td></tr>`
    : paymentsResult.value
      .slice(0, 50)
      .map((p) => `<tr><td>${escapeHtml(formatDate(p.createdAt))}</td><td>${escapeHtml(p.email ?? '')}</td><td>${escapeHtml(p.credits ? t('credits.bought', { n: p.credits }) : p.plan.startsWith('export_') ? t(`payment.${p.plan}`) : t(`plan.${p.plan}`))}</td><td>${escapeHtml(t(`pay.provider.${p.provider}`))}</td><td>${escapeHtml(formatMoney(p.amount, p.currency))}</td><td>${payBadge(p.status)}</td></tr>`)
      .join('');
  const settings = 'error' in settingsResult ? { error: settingsResult.error } : settingsResult.value;
  if (!settings.error) {
    $('adminServicesText').innerHTML = escapeHtml(t('admin.servicesText', { file: '\u0000' })).replace('\u0000', `<code>${escapeHtml(settings.envFile)}</code>`);
  }
  renderAdminSettings(settings);
};

const COMMERCE_FIELDS = [
  ['videoPriceXof', 'admin.commerce.videoPriceXof'],
  ['videoPriceMad', 'admin.commerce.videoPriceMad'],
  ['songPriceXof', 'admin.commerce.songPriceXof'],
  ['songPriceMad', 'admin.commerce.songPriceMad'],
  ['freeVideosPerMonth', 'admin.commerce.freeVideos'],
  ['freeMinutesPerMonth', 'admin.commerce.freeMinutes'],
  ['freeSongsPerMonth', 'admin.commerce.freeSongs'],
  ['freeMaxDurationSec', 'admin.commerce.freeDuration'],
  ['freeSongMaxSec', 'admin.commerce.freeSongMax'],
  ['creatorVideosPerMonth', 'admin.commerce.creatorVideos'],
  ['creatorMinutesPerMonth', 'admin.commerce.creatorMinutes'],
  ['creatorSongsPerMonth', 'admin.commerce.creatorSongs'],
  ['creatorMaxDurationSec', 'admin.commerce.creatorDuration'],
  ['proVideosPerMonth', 'admin.commerce.proVideos'],
  ['proMinutesPerMonth', 'admin.commerce.proMinutes'],
  ['proSongsPerMonth', 'admin.commerce.proSongs'],
  ['proMaxDurationSec', 'admin.commerce.proDuration'],
  ['correctionsPerVideo', 'admin.commerce.videoCorrections'],
  ['correctionsPerSong', 'admin.commerce.songCorrections'],
  ['pronunciationFixesPerVideo', 'admin.commerce.pronunciationFixes'],
  ['songPreviewSec', 'admin.commerce.songPreview'],
  ['maxProductImages', 'admin.commerce.maxImages'],
  ['maxProductImageMb', 'admin.commerce.maxImageSize'],
  ['usdRateXof', 'admin.commerce.usdRateXof'],
  ['usdRateMad', 'admin.commerce.usdRateMad'],
];

const renderAdminCommerce = (result) => {
  if ('error' in result) {
    $('adminCommerce').innerHTML = `<div class="alert danger">${escapeHtml(friendlyText(result.error))}</div>`;
    return;
  }
  $('adminCommerce').innerHTML = `<form class="card" id="adminCommerceForm">
    <div class="card-header"><div><h2>${escapeHtml(t('admin.commerce.title'))}</h2><p>${escapeHtml(t('admin.commerce.subtitle'))}</p></div></div>
    <div class="card-body form-grid">${COMMERCE_FIELDS.map(([key, label]) => `<label class="field"><span class="label">${escapeHtml(t(label))}</span><input class="input" type="number" min="0" step="1" required name="${key}" value="${escapeHtml(result.value[key])}" /></label>`).join('')}</div>
    <div class="card-footer"><button class="btn btn-primary" type="submit">${escapeHtml(t('common.save'))}</button></div>
  </form>`;
};

$('adminCommerce').addEventListener('submit', async (e) => {
  if (e.target.id !== 'adminCommerceForm') return;
  e.preventDefault();
  const form = e.target;
  const settings = Object.fromEntries(COMMERCE_FIELDS.map(([key]) => [key, Number(form.elements.namedItem(key).value)]));
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    const saved = await api('/api/admin/commerce', { method: 'PUT', body: JSON.stringify(settings) });
    renderAdminCommerce({ value: saved });
    state.publicConfig = await api('/api/public/config');
    toast(t('common.saved'), 'success');
  } catch (err) {
    toast(errorText(err), 'error');
  } finally {
    button.disabled = false;
  }
});

// ---- Services per plan and cost dashboard --------------------------------------------
const PROVIDER_FIELDS = [
  ['llm', ['env', 'auto', 'anthropic', 'groq', 'openai', 'openai-compatible', 'ollama', 'local']],
  ['claudeModel', ['env', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5']],
  ['voice', ['env', 'auto', 'elevenlabs', 'openai', 'piper', 'system', 'none']],
  ['elevenLabsModel', ['env', 'eleven_multilingual_v2', 'eleven_flash_v2_5']],
  ['music', ['env', 'none', 'auto', 'elevenlabs', 'stability', 'replicate']],
];
const PLAN_COLUMNS = ['free', 'creator', 'pro'];
const optionLabel = (value) => (value === 'env' ? t('admin.providers.env') : value === 'none' ? t('admin.providers.none') : value === 'local' ? t('admin.providers.local') : value);

const renderAdminProviders = (result) => {
  if ('error' in result) {
    $('adminProviders').innerHTML = '';
    return;
  }
  const providers = result.value.providers;
  $('adminProviders').innerHTML = `<form class="card" id="adminProvidersForm">
    <div class="card-header"><div><h2>${escapeHtml(t('admin.providers.title'))}</h2><p>${escapeHtml(t('admin.providers.subtitle'))}</p></div></div>
    <div class="card-body" style="padding: 8px 6px 6px"><div class="table-wrap"><table class="table">
      <thead><tr><th></th>${PLAN_COLUMNS.map((plan) => `<th>${escapeHtml(t(`plan.${plan}`))}</th>`).join('')}</tr></thead>
      <tbody>${PROVIDER_FIELDS.map(([field, values]) => `<tr><td><b>${escapeHtml(t(`admin.providers.${field}`))}</b></td>${PLAN_COLUMNS.map((plan) => `<td><select class="select" name="${plan}.${field}">${values.map((v) => `<option value="${escapeHtml(v)}" ${providers[plan][field] === v ? 'selected' : ''}>${escapeHtml(optionLabel(v))}</option>`).join('')}</select></td>`).join('')}</tr>`).join('')}</tbody>
    </table></div></div>
    <div class="card-footer"><button class="btn btn-primary" type="submit">${escapeHtml(t('common.save'))}</button></div>
  </form>`;
};

$('adminProviders').addEventListener('submit', async (e) => {
  if (e.target.id !== 'adminProvidersForm') return;
  e.preventDefault();
  const form = e.target;
  const providers = Object.fromEntries(PLAN_COLUMNS.map((plan) => [plan, Object.fromEntries(PROVIDER_FIELDS.map(([field]) => [field, form.elements.namedItem(`${plan}.${field}`).value]))]));
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    renderAdminProviders({ value: await api('/api/admin/commerce', { method: 'PUT', body: JSON.stringify({ providers }) }) });
    toast(t('common.saved'), 'success');
  } catch (err) {
    toast(errorText(err), 'error');
  } finally {
    button.disabled = false;
  }
});

const usd = (n) => (n === null || n === undefined ? '—' : `${new Intl.NumberFormat(getLang() === 'fr' ? 'fr-FR' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: n !== 0 && Math.abs(n) < 0.1 ? 3 : 2 }).format(n)} $`);
const quantity = (line) => [
  line.inputTokens || line.outputTokens ? t('admin.costs.tokens', { input: (line.inputTokens ?? 0).toLocaleString(), output: (line.outputTokens ?? 0).toLocaleString() }) : '',
  line.characters ? t('admin.costs.characters', { n: line.characters.toLocaleString() }) : '',
  line.seconds && line.kind === 'music' ? t('admin.costs.seconds', { n: Math.round(line.seconds) }) : '',
  line.images ? t('admin.costs.images', { n: line.images }) : '',
].filter(Boolean).join(' · ');
let costDays = 30;

const loadAdminCosts = async () => {
  const result = await adminResult(api(`/api/admin/costs?days=${costDays}`));
  if ('error' in result) {
    $('adminCosts').innerHTML = `<div class="alert danger">${escapeHtml(friendlyText(result.error))}</div>`;
    return;
  }
  const r = result.value;
  const table = (head, rows) => `<div class="table-wrap"><table class="table"><thead><tr>${head.map((h) => `<th>${escapeHtml(t(h))}</th>`).join('')}</tr></thead><tbody>${rows.join('') || `<tr><td colspan="${head.length}" class="hint">${escapeHtml(t('admin.costs.empty'))}</td></tr>`}</tbody></table></div>`;
  $('adminCosts').innerHTML = `<div class="card">
    <div class="card-header"><div><h2>${escapeHtml(t('admin.costs.title'))}</h2><p>${escapeHtml(t('admin.costs.subtitle', { xof: r.rates.XOF, mad: r.rates.MAD }))}</p></div>
      <select class="select" id="adminCostDays" style="width: auto">${[7, 30, 90].map((d) => `<option value="${d}" ${d === costDays ? 'selected' : ''}>${escapeHtml(t('admin.costs.days', { n: d }))}</option>`).join('')}</select></div>
    <div class="card-body form-stack">
      <div class="grid-3" style="grid-template-columns: repeat(auto-fill, minmax(180px, 1fr))">${[
        ['admin.costs.cost', usd(r.totals.costUsd)],
        ['admin.costs.revenue', usd(r.totals.revenueUsd)],
        ['admin.costs.margin', usd(r.totals.marginUsd)],
      ].map(([k, v]) => `<div class="card stat"><div class="k">${escapeHtml(t(k))}</div><div class="v">${escapeHtml(v)}</div></div>`).join('')}</div>
      <h3>${escapeHtml(t('admin.costs.byPlan'))}</h3>
      ${table(['admin.plan', 'admin.costs.activeUsers', 'admin.costs.videos', 'admin.costs.minutes', 'admin.costs.songs', 'admin.costs.cost', 'admin.costs.perVideo', 'admin.costs.perMinute', 'admin.costs.perSong'], r.byPlan.map((p) => `<tr><td>${escapeHtml(PLAN_COLUMNS.includes(p.plan) ? t(`plan.${p.plan}`) : p.plan)}</td><td>${p.activeUsers}</td><td>${p.videos}</td><td>${p.minutes}</td><td>${p.songs}</td><td><b>${usd(p.costUsd)}</b></td><td>${usd(p.costPerVideoUsd)}</td><td>${usd(p.costPerMinuteUsd)}</td><td>${usd(p.costPerSongUsd)}</td></tr>`))}
      <h3>${escapeHtml(t('admin.costs.byService'))}</h3>
      ${table(['admin.costs.service', 'admin.costs.calls', 'admin.costs.usage', 'admin.costs.cost'], r.byService.map((s) => `<tr><td>${escapeHtml(t(`admin.costs.kind.${s.kind}`))} · <b>${escapeHtml(s.provider)}</b>${s.model ? `<div class="hint">${escapeHtml(s.model)}</div>` : ''}</td><td>${s.calls}</td><td>${escapeHtml(quantity(s))}</td><td>${usd(s.usd)}${s.unpriced ? ` <span class="hint">${escapeHtml(t('admin.costs.unpriced'))}</span>` : s.estimate ? ` <span class="hint">${escapeHtml(t('admin.costs.estimate'))}</span>` : ''}</td></tr>`))}
      <h3>${escapeHtml(t('admin.costs.topUsers'))}</h3>
      ${table(['admin.user', 'admin.plan', 'admin.costs.videos', 'admin.costs.songs', 'admin.costs.cost', 'admin.costs.revenue', 'admin.costs.margin'], r.topUsers.map((u) => `<tr><td>${escapeHtml(u.email)}</td><td>${escapeHtml(PLAN_COLUMNS.includes(u.plan) ? t(`plan.${u.plan}`) : u.plan)}</td><td>${u.videos}</td><td>${u.songs}</td><td>${usd(u.costUsd)}</td><td>${usd(u.revenueUsd)}</td><td><b style="color: ${u.marginUsd < 0 ? 'var(--danger)' : 'inherit'}">${usd(u.marginUsd)}</b></td></tr>`))}
      <p class="hint">${escapeHtml(t('admin.costs.note'))}</p>
    </div>
  </div>`;
};

$('adminCosts').addEventListener('change', (e) => {
  if (e.target.id !== 'adminCostDays') return;
  costDays = Number(e.target.value);
  void loadAdminCosts();
});

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
  const configuredFields = g.configuredFields ?? [];
  const configured = configuredFields.length;
  const text = groupText(g);
  return `<form class="card settings-card" data-group="${escapeHtml(g.id)}">
    <div class="card-header"><div><h2>${escapeHtml(text.title)}</h2><p>${escapeHtml(text.description)}</p>${configured ? `<div class="settings-configured" aria-label="${escapeHtml(t('admin.configured'))}">${configuredFields.map((label) => `<span class="badge success">${escapeHtml(label)} · ${escapeHtml(t('admin.configuredKey'))}</span>`).join('')}</div>` : ''}</div>${configured ? `<span class="badge success">${escapeHtml(t('admin.configured', { n: configured }))}</span>` : ''}</div>
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
    input = `<div class="input-group"><div class="password-input-group"><input class="input" type="password" autocomplete="new-password" data-key="${escapeHtml(f.key)}" placeholder="${escapeHtml(f.configured ? t('admin.keep') : t('admin.paste'))}" /><button type="button" class="btn btn-ghost btn-icon btn-sm" data-toggle-password aria-label="${escapeHtml(t('admin.showPassword'))}" aria-pressed="false" title="${escapeHtml(t('admin.showPassword'))}">${icon('eye', 16)}</button></div>${f.configured ? `<button type="button" class="btn btn-ghost btn-icon btn-sm" data-clear="${escapeHtml(f.key)}" title="${escapeHtml(t('common.delete'))}">${icon('x', 15)}</button>` : ''}</div>`;
  } else {
    input = `<input class="input" data-key="${escapeHtml(f.key)}" value="${escapeHtml(f.value)}" placeholder="${escapeHtml(f.placeholder ?? '')}" />`;
  }
  return `<div class="setting">${top}${input}${f.help && !en() ? `<span class="hint">${escapeHtml(f.help)}</span>` : ''}</div>`;
};

const putSettings = async (updates) => {
  const saved = await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify(updates) });
  renderAdminSettings(saved);
  const results = await Promise.allSettled([loadOptions(), loadConnectionsData()]);
  const failed = results.find((result) => result.status === 'rejected');
  return failed?.status === 'rejected' ? errorText(failed.reason) : null;
};
$('adminSettings').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target.closest('form');
  const updates = Object.fromEntries([...form.querySelectorAll('[data-key]')].map((el) => [el.dataset.key, el.value]));
  try {
    const refreshError = await putSettings(updates);
    toast(refreshError ? t('admin.savedRefreshFailed', { error: refreshError }) : t('common.saved'), refreshError ? 'error' : 'success');
    if (updates.VIDEO_AGENT_WEB_PASSWORD) setTimeout(() => location.reload(), 1200);
  } catch (err) {
    toast(errorText(err), 'error');
  }
});
$('adminSettings').addEventListener('click', async (e) => {
  const toggle = e.target.closest('[data-toggle-password]');
  if (toggle) {
    const input = toggle.parentElement.querySelector('input[data-key]');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    toggle.innerHTML = icon(show ? 'eyeOff' : 'eye', 16);
    toggle.setAttribute('aria-pressed', String(show));
    toggle.setAttribute('aria-label', t(show ? 'admin.hidePassword' : 'admin.showPassword'));
    toggle.title = t(show ? 'admin.hidePassword' : 'admin.showPassword');
    return;
  }
  const b = e.target.closest('[data-clear]');
  if (!b || !confirm(t('admin.clearConfirm', { key: b.dataset.clear }))) return;
  try {
    const refreshError = await putSettings({ [b.dataset.clear]: null });
    toast(refreshError ? t('admin.savedRefreshFailed', { error: refreshError }) : t('common.saved'), refreshError ? 'error' : 'success');
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
  ({ songs: loadSongs, library: loadLibrary, schedule: loadSchedule, connections: loadConnections, brand: loadBrand, billing: loadBilling, account: loadAccount, admin: loadAdmin })[page]?.();
  if (lang !== state.me.user.locale) api('/api/me', { method: 'PATCH', body: JSON.stringify({ locale: lang }) }).then((me) => (state.me = me)).catch(() => undefined);
});

// ---- Boot -----------------------------------------------------------------------------------------
initChrome();
renderIcons();
addPasswordVisibilityControls();
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
