'use strict';

/* Aceminder accounts in the browser: sign up / log in (email, Google, Apple), usernames and
   avatars, the profile sheet and the leaderboard (the sign-in page itself is auth.js). Sessions live in an
   HttpOnly cookie set by the server, so this file never sees or stores a password or token. */

(function () {
  const tr = (key, vars) => window.AceI18n.t(key, vars);
  const $ = selector => document.querySelector(selector);
  const toast = (text, icon) => window.AceToast && window.AceToast(text, icon);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const state = {
    config: { google: null, apple: null, email: true, mail: 'console', avatars: ['🦉'] },
    user: null,
    loaded: false,
    board: 'week',
    boardData: null,
    pickAvatar: '🦉'
  };

  window.AceAccount = {
    get user() { return state.user; },
    get loaded() { return state.loaded; },
    get config() { return state.config; },
    api: (path, body) => api(path, body),
    checkUsername: (input, status) => checkUsername(input, status),
    signedIn: data => signedIn(data),
    setUser: (user, options) => setUser(user, options),
    openAuth: mode => openAuth(mode),
    openProfile: () => openProfile(),
    refreshBoard: () => loadBoard()
  };

  /* ---------- API helper ---------- */

  async function api(path, body) {
    const options = body === undefined
      ? { cache: 'no-store', credentials: 'same-origin' }
      : {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        };
    let response;
    try {
      response = await fetch(path, options);
    } catch {
      const error = new Error(tr('err.auth.offline'));
      error.code = 'offline';
      throw error;
    }
    const data = await response.json().catch(() => null);
    /* No account system behind this address: an old copy of the server, or another program. */
    if (!data || (response.status === 404 && !data.code)) {
      const error = new Error(tr(response.status >= 500 ? 'err.auth.generic' : 'err.auth.oldServer'));
      error.code = 'oldServer';
      error.status = response.status;
      throw error;
    }
    if (!response.ok) {
      const error = new Error(errorText(data));
      error.code = data.code || '';
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  function errorText(data) {
    if (data && data.code === 'rate' && data.retryIn) {
      return tr('err.auth.rateIn', { m: Math.max(1, Math.ceil(data.retryIn / 60)) });
    }
    if (data && data.code === 'codeWrong') return tr('err.auth.codeWrong', { left: data.left });
    if (data && data.code) {
      const key = `err.auth.${data.code}`;
      const text = tr(key);
      if (text !== key) return text;
    }
    return (data && data.error) || tr('err.auth.generic');
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) {
        if (existing.dataset.loaded) resolve();
        else existing.addEventListener('load', () => resolve(), { once: true });
        return;
      }
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = () => {
        script.dataset.loaded = 'yes';
        resolve();
      };
      script.onerror = () => reject(new Error('script'));
      document.head.append(script);
    });
  }

  function showMessage(node, text, tone) {
    if (!node) return;
    node.textContent = text || '';
    node.hidden = !text;
    node.className = `key-message${tone ? ` is-${tone}` : ''}`;
  }

  function openDialog(dialog) {
    if (!dialog) return;
    document.querySelectorAll('dialog[open]').forEach(open => {
      if (open !== dialog) open.close();
    });
    if (!dialog.open) dialog.showModal();
  }

  function closeOnBackdrop(dialog) {
    dialog?.addEventListener('click', event => {
      if (event.target === dialog) dialog.close();
    });
  }

  /* ---------- Signed-in user ---------- */

  function setUser(user, options = {}) {
    state.user = user || null;
    renderHeader();
    renderBoard();
    window.dispatchEvent(new CustomEvent('aceminder:account', { detail: { user: state.user } }));
    if (!options.quiet && state.user && state.user.needsUsername) openUsername(true);
  }

  async function loadMe() {
    try {
      const data = await api('/api/auth/me');
      setUser(data.user, { quiet: false });
      const fresh = data.user && Array.isArray(data.user.newBadges) ? data.user.newBadges : [];
      if (fresh.length) window.setTimeout(() => window.AceAchievements?.celebrate(fresh), 1800);
    } catch {
      setUser(null, { quiet: true });
    } finally {
      state.loaded = true;
    }
  }

  async function loadConfig() {
    try {
      state.config = Object.assign(state.config, await api('/api/auth/config'));
    } catch {
      /* server offline: email form still shows and reports the problem on submit */
    }
    window.dispatchEvent(new CustomEvent('aceminder:config', { detail: state.config }));
  }

  const paintAvatar = (node, who) => {
    if (window.AceOwl) window.AceOwl.avatar(node, who);
    else if (node) node.textContent = (who && who.avatar && !who.avatar.startsWith('owl:')) ? who.avatar : '🦉';
  };

  function renderHeader() {
    const avatar = $('#account-avatar');
    const name = $('#account-name');
    const button = $('#account-button');
    if (!button) return;
    const user = state.user;
    paintAvatar(avatar, user || { avatar: '👤' });
    name.textContent = user ? (user.username || tr('acct.pickTitle')) : tr('acct.signIn');
    button.classList.toggle('is-signed-in', Boolean(user));
    button.setAttribute('aria-label', user ? tr('acct.profile') : tr('acct.signIn'));
    paintAvatar($('#tab-me-avatar'), user || { avatar: '👤' });
  }

  /* ---------- Sign up / log in lives in auth.js ---------- */

  const openAuth = (mode = 'signup') => window.AceAuth?.open(mode);

  let checkTimer = 0;
  let checkSeq = 0;
  function checkUsername(input, status) {
    window.clearTimeout(checkTimer);
    const value = input.value.trim();
    status.className = 'name-status';
    if (!value) {
      status.textContent = tr('acct.usernameHint');
      return;
    }
    if (!/^[\p{L}\p{N}][\p{L}\p{N}_.]{2,19}$/u.test(value)) {
      status.textContent = tr('acct.invalid');
      status.classList.add('is-bad');
      return;
    }
    status.textContent = tr('acct.checking');
    const seq = ++checkSeq;
    checkTimer = window.setTimeout(async () => {
      try {
        const data = await api(`/api/account/username-check?name=${encodeURIComponent(value)}`);
        if (seq !== checkSeq) return;
        status.textContent = data.available ? tr('acct.available') : (data.code === 'username' ? tr('acct.invalid') : tr('acct.taken'));
        status.classList.add(data.available ? 'is-good' : 'is-bad');
      } catch {
        if (seq === checkSeq) status.textContent = tr('acct.usernameHint');
      }
    }, 350);
  }

  /* Called by auth.js once the server has started a session. */
  function signedIn(data) {
    setUser(data.user);
    const name = data.user.username || '';
    toast(data.created ? tr('acct.welcome', { name }) : tr('acct.welcomeBack', { name }), '🦉');
    loadBoard();
  }

  /* ---------- Username and avatar ---------- */

  const nameDialog = $('#username-dialog');
  const pickInput = $('#pick-username');
  const pickStatus = $('#pick-status');
  const pickMessage = $('#pick-message');

  function suggestName() {
    const email = state.user && state.user.email ? state.user.email.split('@')[0] : '';
    const base = email.replace(/[^\p{L}\p{N}_.]/gu, '').replace(/^[_.]+/, '').slice(0, 14);
    return base.length >= 3 ? base : `ace${Math.floor(1000 + Math.random() * 9000)}`;
  }

  function renderAvatars() {
    const owlGrid = $('#pick-owls');
    const grid = $('#pick-avatars');
    owlGrid.replaceChildren();
    grid.replaceChildren();
    state.config.avatars.forEach(choice => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `avatar-choice${choice === state.pickAvatar ? ' is-selected' : ''}`;
      paintAvatar(button, { avatar: choice });
      button.setAttribute('aria-pressed', choice === state.pickAvatar ? 'true' : 'false');
      button.setAttribute('aria-label', choice.startsWith('owl:') ? `Ace · ${choice.slice(4)}` : choice);
      button.addEventListener('click', () => {
        state.pickAvatar = choice;
        window.AceDevice?.vibrate(8);
        renderAvatars();
        renderPhotoPreview();
      });
      (choice.startsWith('owl:') ? owlGrid : grid).append(button);
    });
  }

  function renderPhotoPreview() {
    const user = state.user;
    paintAvatar($('#photo-preview'), user && user.avatarUrl ? user : { avatar: state.pickAvatar });
    $('#photo-remove').hidden = !(user && user.avatarUrl);
  }

  /* ---------- Profile photo: pick, crop to a circle, upload ---------- */

  const crop = { image: null, zoom: 1, x: 0, y: 0, drag: null };
  const cropCanvas = $('#crop-canvas');

  function drawCrop(context, size, overlay) {
    const image = crop.image;
    if (!image) return;
    const base = Math.max(size / image.width, size / image.height);
    const scale = base * crop.zoom;
    const width = image.width * scale;
    const height = image.height * scale;
    const maxX = Math.max(0, (width - size) / 2);
    const maxY = Math.max(0, (height - size) / 2);
    crop.x = Math.max(-maxX, Math.min(maxX, crop.x));
    crop.y = Math.max(-maxY, Math.min(maxY, crop.y));
    const ratio = size / cropCanvas.width;
    context.clearRect(0, 0, size, size);
    context.drawImage(image, (size - width) / 2 + crop.x * ratio, (size - height) / 2 + crop.y * ratio, width, height);
    if (overlay) {
      context.save();
      context.fillStyle = 'rgba(5, 8, 20, .62)';
      context.beginPath();
      context.rect(0, 0, size, size);
      context.arc(size / 2, size / 2, size / 2 - 6, 0, Math.PI * 2, true);
      context.fill('evenodd');
      context.strokeStyle = '#f6c453';
      context.lineWidth = 3;
      context.beginPath();
      context.arc(size / 2, size / 2, size / 2 - 6, 0, Math.PI * 2);
      context.stroke();
      context.restore();
    }
  }

  function redrawCrop() {
    drawCrop(cropCanvas.getContext('2d'), cropCanvas.width, true);
  }

  async function startCrop(file) {
    const message = $('#pick-message');
    showMessage(message, '');
    if (!file || !/^image\//.test(file.type)) {
      showMessage(message, tr('acct.photoBad'), 'error');
      return;
    }
    try {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.decoding = 'async';
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = reject;
        image.src = url;
      });
      URL.revokeObjectURL(url);
      crop.image = image;
      crop.zoom = 1;
      crop.x = 0;
      crop.y = 0;
      $('#crop-zoom').value = '1';
      $('#cropper').hidden = false;
      $('#pick-main').hidden = true;
      redrawCrop();
    } catch {
      showMessage(message, tr('acct.photoBad'), 'error');
    }
  }

  function closeCrop() {
    $('#cropper').hidden = true;
    $('#pick-main').hidden = false;
    crop.image = null;
  }

  function exportCrop() {
    const out = document.createElement('canvas');
    out.width = 320;
    out.height = 320;
    const context = out.getContext('2d');
    context.fillStyle = '#0c1330';
    context.fillRect(0, 0, 320, 320);
    drawCrop(context, 320, false);
    return new Promise(resolve => {
      out.toBlob(blob => resolve(blob), 'image/jpeg', 0.86);
    });
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  $('#photo-input')?.addEventListener('change', event => {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';
    startCrop(file);
  });
  $('#crop-zoom')?.addEventListener('input', event => {
    crop.zoom = Number(event.target.value) || 1;
    redrawCrop();
  });
  cropCanvas?.addEventListener('pointerdown', event => {
    crop.drag = { x: event.clientX, y: event.clientY, ox: crop.x, oy: crop.y };
    cropCanvas.setPointerCapture(event.pointerId);
  });
  cropCanvas?.addEventListener('pointermove', event => {
    if (!crop.drag) return;
    const box = cropCanvas.getBoundingClientRect();
    const factor = cropCanvas.width / box.width;
    crop.x = crop.drag.ox + (event.clientX - crop.drag.x) * factor;
    crop.y = crop.drag.oy + (event.clientY - crop.drag.y) * factor;
    redrawCrop();
  });
  ['pointerup', 'pointercancel'].forEach(name => cropCanvas?.addEventListener(name, () => { crop.drag = null; }));
  cropCanvas?.addEventListener('wheel', event => {
    event.preventDefault();
    crop.zoom = Math.max(1, Math.min(4, crop.zoom - event.deltaY * 0.0015));
    $('#crop-zoom').value = String(crop.zoom);
    redrawCrop();
  }, { passive: false });
  $('#crop-cancel')?.addEventListener('click', closeCrop);
  $('#crop-use')?.addEventListener('click', async () => {
    const button = $('#crop-use');
    button.disabled = true;
    button.classList.add('is-loading');
    try {
      const blob = await exportCrop();
      const image = await blobToBase64(blob);
      const data = await api('/api/account/photo', { image });
      closeCrop();
      setUser(data.user, { quiet: true });
      renderPhotoPreview();
      toast(tr('acct.photoSaved'), '📸');
      loadBoard();
    } catch (error) {
      showMessage($('#pick-message'), error.code === 'photo' ? tr('acct.photoBad') : error.message, 'error');
    } finally {
      button.disabled = false;
      button.classList.remove('is-loading');
    }
  });
  $('#photo-remove')?.addEventListener('click', async () => {
    try {
      const data = await api('/api/account/photo-remove', {});
      setUser(data.user, { quiet: true });
      renderPhotoPreview();
      loadBoard();
    } catch (error) {
      showMessage($('#pick-message'), error.message, 'error');
    }
  });

  function openUsername(required = false) {
    if (!state.user) return;
    nameDialog.dataset.required = required ? 'yes' : 'no';
    pickInput.value = state.user.username || suggestName();
    state.pickAvatar = state.user.avatar;
    closeCrop();
    renderAvatars();
    renderPhotoPreview();
    showMessage(pickMessage, '');
    openDialog(nameDialog);
    checkUsername(pickInput, pickStatus);
    window.setTimeout(() => pickInput.focus({ preventScroll: true }), 80);
  }

  pickInput?.addEventListener('input', () => checkUsername(pickInput, pickStatus));
  $('#pick-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const save = $('#pick-save');
    save.disabled = true;
    try {
      const data = await api('/api/account/profile', { username: pickInput.value.trim(), avatar: state.pickAvatar });
      nameDialog.close();
      setUser(data.user, { quiet: true });
      toast(tr('acct.saved'), '✨');
      loadBoard();
    } catch (error) {
      showMessage(pickMessage, error.message, 'error');
    } finally {
      save.disabled = false;
    }
  });
  $('#pick-close')?.addEventListener('click', () => nameDialog.close());
  closeOnBackdrop(nameDialog);

  /* ---------- Profile ---------- */

  const profileDialog = $('#profile-dialog');

  async function openProfile() {
    if (!state.user) {
      openAuth('login');
      return;
    }
    renderProfile();
    openDialog(profileDialog);
    try {
      const data = await api('/api/account/history');
      renderHistory(data.history || []);
    } catch {
      renderHistory([]);
    }
  }

  function renderProfile() {
    const user = state.user;
    if (!user) return;
    const p = user.progress;
    paintAvatar($('#profile-avatar'), user);
    $('#profile-name').textContent = user.username || '—';
    const providers = [];
    if (user.providers.google) providers.push('Google');
    if (user.providers.apple) providers.push('Apple');
    if (user.providers.password) providers.push(tr('acct.email'));
    $('#profile-email').textContent = [user.email, providers.length ? tr('acct.signedInWith', { list: providers.join(', ') }) : '']
      .filter(Boolean).join(' · ');
    /* Numeric dates: some browsers have no month names for Uzbek ("M11"). */
    const since = new Date(user.createdAt * 1000).toLocaleDateString(window.AceI18n.lang, { day: '2-digit', month: '2-digit', year: 'numeric' });
    $('#profile-since').textContent = tr('acct.memberSince', { date: since });
    $('#profile-unverified').hidden = !user.email || user.emailVerified;
    $('#profile-level').textContent = String(p.level);
    $('#profile-xp').textContent = p.xp.toLocaleString(window.AceI18n.lang);
    $('#profile-streak').textContent = String(p.streak);
    $('#profile-tests').textContent = String(p.tests);
  }

  function renderHistory(items) {
    const list = $('#profile-history');
    list.replaceChildren();
    if (!items.length) {
      const empty = document.createElement('li');
      empty.className = 'history-empty';
      empty.textContent = tr('acct.noHistory');
      list.append(empty);
      return;
    }
    items.forEach(item => {
      const row = document.createElement('li');
      row.className = 'history-row';
      const score = document.createElement('span');
      score.className = `history-score${item.percent >= 75 ? ' is-high' : item.percent < 50 ? ' is-low' : ''}`;
      score.textContent = `${item.percent}%`;
      const copy = document.createElement('span');
      copy.className = 'history-copy';
      const topic = document.createElement('strong');
      topic.textContent = item.topic;
      const meta = document.createElement('small');
      const diffKey = window.AceI18n.difficultyKey(item.difficulty);
      const when = new Date(item.created_at * 1000).toLocaleDateString(window.AceI18n.lang, { day: '2-digit', month: '2-digit' });
      meta.textContent = `${item.correct}/${item.total} · ${tr(diffKey)} · ${when}`;
      copy.append(topic, meta);
      const xp = document.createElement('span');
      xp.className = 'history-xp';
      xp.textContent = `+${item.xp} XP`;
      row.append(score, copy, xp);
      list.append(row);
    });
  }

  $('#profile-close')?.addEventListener('click', () => profileDialog.close());
  $('#profile-verify')?.addEventListener('click', async () => {
    const button = $('#profile-verify');
    button.disabled = true;
    try {
      const data = await api('/api/auth/verify-start', { language: window.AceI18n.apiLanguage() });
      profileDialog.close();
      window.AceAuth?.openCode(data.verify);
    } catch (error) {
      toast(error.message, '⚠️');
    } finally {
      button.disabled = false;
    }
  });
  $('#profile-edit')?.addEventListener('click', () => openUsername(false));
  $('#profile-key')?.addEventListener('click', () => {
    profileDialog.close();
    $('#open-key-dialog')?.click();
  });
  $('#profile-signout')?.addEventListener('click', async () => {
    try {
      await api('/api/auth/logout', {});
    } catch {
      /* the cookie is cleared server-side; still forget the user here */
    }
    profileDialog.close();
    setUser(null);
    toast(tr('acct.signedOut'), '👋');
    loadBoard();
  });
  $('#profile-delete')?.addEventListener('click', async () => {
    if (!window.confirm(tr('acct.deleteConfirm'))) return;
    try {
      await api('/api/account/delete', { confirm: 'DELETE' });
      profileDialog.close();
      setUser(null);
      toast(tr('acct.deleted'), '🗑️');
      loadBoard();
    } catch (error) {
      toast(error.message, '⚠️');
    }
  });
  closeOnBackdrop(profileDialog);

  /* ---------- Leaderboard ---------- */

  let boardSeq = 0;
  async function loadBoard() {
    const list = $('#board-list');
    if (!list) return;
    const seq = ++boardSeq;
    list.setAttribute('aria-busy', 'true');
    try {
      const data = await api(`/api/leaderboard?period=${state.board}`);
      if (seq !== boardSeq) return;
      state.boardData = data;
    } catch {
      if (seq !== boardSeq) return;
      state.boardData = { entries: [], me: null, error: true };
    } finally {
      list.removeAttribute('aria-busy');
    }
    renderBoard();
  }

  function renderBoard() {
    const list = $('#board-list');
    if (!list) return;
    const data = state.boardData;
    $('#board-section')?.querySelectorAll('[data-board]').forEach(button => {
      const active = button.dataset.board === state.board;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    list.replaceChildren();
    if (!data) {
      const loading = document.createElement('li');
      loading.className = 'board-empty';
      loading.textContent = tr('board.loading');
      list.append(loading);
    } else if (!data.entries.length) {
      const empty = document.createElement('li');
      empty.className = 'board-empty';
      const owl = document.createElement('span');
      owl.className = 'board-empty-owl';
      if (window.AceOwl) owl.innerHTML = window.AceOwl.svg({ mood: data.error ? 'sad' : 'wink', live: true });
      const text = document.createElement('span');
      text.textContent = data.error ? tr('board.error') : tr('board.empty');
      empty.append(owl, text);
      list.append(empty);
    } else {
      const medals = ['🥇', '🥈', '🥉'];
      data.entries.forEach((entry, index) => {
        const row = document.createElement('li');
        row.className = `board-row${entry.isMe ? ' is-me' : ''}${entry.rank <= 3 ? ` is-top is-top-${entry.rank}` : ''}`;
        row.style.animationDelay = reducedMotion ? '0s' : `${Math.min(index, 12) * 0.04}s`;
        const rank = document.createElement('span');
        rank.className = 'board-rank';
        rank.textContent = entry.rank <= 3 ? medals[entry.rank - 1] : `#${entry.rank}`;
        const avatar = document.createElement('span');
        avatar.className = 'board-avatar';
        paintAvatar(avatar, entry);
        const who = document.createElement('span');
        who.className = 'board-who';
        const name = document.createElement('strong');
        name.textContent = entry.username;
        if (entry.isMe) {
          const you = document.createElement('em');
          you.textContent = tr('board.you');
          name.append(' ', you);
        }
        const meta = document.createElement('small');
        meta.textContent = `${tr('board.level', { n: entry.level })}${entry.streak ? ` · 🔥${entry.streak}` : ''}`;
        who.append(name, meta);
        const score = document.createElement('span');
        score.className = 'board-score';
        score.textContent = tr('board.xp', { n: Number(entry.score).toLocaleString(window.AceI18n.lang) });
        row.append(rank, avatar, who, score);
        list.append(row);
      });
    }

    const me = $('#board-me');
    const join = $('#board-join');
    if (state.user) {
      join.hidden = true;
      me.hidden = false;
      const mine = data && data.me;
      if (state.user.needsUsername) {
        me.textContent = tr('acct.pickSub');
      } else if (mine && mine.rank) {
        me.textContent = `${tr('board.yourRank', { rank: mine.rank })} · ${tr('board.xp', { n: Number(mine.score).toLocaleString(window.AceI18n.lang) })}`;
      } else {
        me.textContent = tr('board.unranked');
      }
    } else {
      me.hidden = true;
      join.hidden = false;
    }
  }

  $('#board-section')?.querySelectorAll('[data-board]').forEach(button => {
    button.addEventListener('click', () => {
      if (state.board === button.dataset.board) return;
      state.board = button.dataset.board;
      state.boardData = null;
      renderBoard();
      loadBoard();
    });
  });
  $('#board-join')?.addEventListener('click', () => openAuth('signup'));

  /* ---------- Wiring ---------- */

  $('#account-button')?.addEventListener('click', () => openProfile());
  $('#tab-me')?.addEventListener('click', () => openProfile());

  window.addEventListener('aceminder:graded', event => {
    const detail = event.detail || {};
    if (state.user && detail.progress) {
      state.user = Object.assign({}, state.user, { progress: detail.progress });
      renderHeader();
    }
    if (detail.award && !detail.award.repeat) window.setTimeout(loadBoard, 600);
  });

  window.addEventListener('aceminder:language', () => {
    renderHeader();
    renderBoard();
    if (profileDialog?.open) renderProfile();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') loadBoard();
  });

  document.addEventListener('DOMContentLoaded', async () => {
    renderHeader();
    renderBoard();
    await loadConfig();
    await loadMe();
    loadBoard();
  });
})();
