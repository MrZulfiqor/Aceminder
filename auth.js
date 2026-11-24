'use strict';

/* The sign-in page: sign up, log in, six-digit email codes, forgot password, Google and Apple.
   Opens full screen at #signup, #login and #forgot, so it can be linked to and the Back button
   closes it. account.js keeps the signed-in user; this file only gets them in. */

(function () {
  const tr = (key, vars) => window.AceI18n.t(key, vars);
  const $ = selector => document.querySelector(selector);
  const account = () => window.AceAccount;
  const page = $('#auth-page');
  if (!page) return;

  const VIEWS = ['signup', 'login', 'forgot', 'code'];
  const PENDING = 'aceminder.pendingCode';
  const NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N}_.]{2,19}$/u;
  const EMAIL_PATTERN = /^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$/;
  const form = $('#auth-form');
  const username = $('#auth-username');
  const email = $('#auth-email');
  const password = $('#auth-password');
  const forgotForm = $('#auth-forgot-form');
  const forgotEmail = $('#auth-forgot-email');
  const codeForm = $('#auth-code-form');
  const code = $('#auth-code');
  const newPassword = $('#auth-new-password');
  const owl = $('#auth-owl');

  let view = 'signup';
  let pending = null;      /* { ticket, purpose, email, delivery, resendAt, expiresAt } */
  let pushed = false;
  let busy = false;
  let ticker = 0;
  let alertAction = null;

  /* ---------- Small helpers ---------- */

  function language() {
    return window.AceI18n.apiLanguage();
  }

  function setStatus(input, text, bad = true) {
    const status = document.getElementById(input.getAttribute('aria-describedby'));
    if (bad && text) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
    if (!status) return;
    status.textContent = text || '';
    status.className = `name-status${text && bad ? ' is-bad' : ''}`;
  }

  function fieldError(input, text) {
    setStatus(input, text, true);
    input.focus();
    react('no');
  }

  function showAlert(text, tone = 'error', action = null) {
    const box = $('#auth-alert');
    const button = $('#auth-alert-action');
    $('#auth-alert-text').textContent = text || '';
    box.hidden = !text;
    box.classList.toggle('is-ok', tone === 'ok');
    alertAction = action;
    button.hidden = !action;
    button.textContent = action ? action.label : '';
    if (text) box.scrollIntoView({ block: 'nearest' });
  }

  function clearErrors() {
    showAlert('');
    [email, password, forgotEmail, code, newPassword].forEach(input => setStatus(input, ''));
    username.removeAttribute('aria-invalid');
    $('#auth-code-boxes').classList.remove('is-bad');
  }

  function setBusy(value, scope) {
    busy = value;
    page.setAttribute('aria-busy', value ? 'true' : 'false');
    const button = scope.querySelector('button[type="submit"]');
    button.disabled = value;
    button.classList.toggle('is-loading', value);
  }

  function readPending() {
    try {
      const saved = JSON.parse(window.sessionStorage.getItem(PENDING) || 'null');
      return saved && saved.ticket && saved.expiresAt > Date.now() ? saved : null;
    } catch {
      return null;
    }
  }

  function savePending(value) {
    pending = value;
    try {
      if (value) window.sessionStorage.setItem(PENDING, JSON.stringify(value));
      else window.sessionStorage.removeItem(PENDING);
    } catch { /* storage blocked: the code step just will not survive a reload */ }
  }

  function fromServer(verify) {
    const now = Date.now();
    return {
      ticket: verify.ticket,
      purpose: verify.purpose,
      email: verify.email,
      delivery: verify.delivery,
      resendAt: now + verify.resendIn * 1000,
      expiresAt: now + verify.expiresIn * 1000
    };
  }

  /* ---------- Ace reacts ---------- */

  function drawOwl(mood = 'normal', acc = []) {
    if (!window.AceOwl) return;
    const key = `${mood}|${acc.join()}`;
    if (owl.dataset.key === key) return;
    owl.dataset.key = key;
    owl.innerHTML = window.AceOwl.svg({ mood, acc: [...acc, 'shy'], live: true, wave: mood === 'happy' });
  }

  function react(kind) {
    owl.classList.remove('is-nod', 'is-no');
    void owl.offsetWidth;
    if (kind === 'no') {
      drawOwl('sad');
      owl.classList.add('is-no');
      window.setTimeout(() => drawOwl(restingMood()), 1600);
    } else {
      drawOwl('happy', ['party']);
      owl.classList.add('is-nod');
    }
  }

  const restingMood = () => (view === 'signup' ? 'happy' : view === 'forgot' ? 'sad' : 'normal');

  function updateShy() {
    const field = document.activeElement;
    const typing = field === password || field === newPassword;
    owl.classList.toggle('is-shy', typing);
    owl.classList.toggle('is-peeking', typing && field.type === 'text');
  }

  /* ---------- Views ---------- */

  function render() {
    page.dataset.view = view;
    page.querySelectorAll('[data-for]').forEach(node => {
      node.hidden = !node.dataset.for.split(' ').includes(view);
    });
    page.querySelectorAll('[data-auth-view]').forEach(button => {
      const active = button.dataset.authView === view;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });

    const reset = pending && pending.purpose === 'reset';
    const byConsole = Boolean(pending && pending.delivery === 'console');
    const text = {
      signup: ['auth.signupTitle', 'auth.signupSub'],
      login: ['auth.loginTitle', 'auth.loginSub'],
      forgot: ['auth.forgotTitle', 'auth.forgotSub'],
      code: [reset ? 'auth.resetTitle' : byConsole ? 'auth.consoleTitle' : 'auth.verifyTitle',
        byConsole ? 'auth.consoleSub' : reset ? 'auth.resetSub' : 'auth.verifySub']
    }[view];
    $('#auth-title').textContent = tr(text[0]);
    $('#auth-sub').textContent = tr(text[1], { email: pending ? pending.email : '' });

    const signup = view === 'signup';
    $('#auth-email-label').textContent = tr(signup ? 'acct.email' : 'acct.emailOrName');
    email.type = signup ? 'email' : 'text';
    password.autocomplete = signup ? 'new-password' : 'current-password';
    $('#auth-submit-label').textContent = tr(signup ? 'acct.create' : 'acct.submitLogin');
    $('#auth-back').textContent = `← ${tr(view === 'forgot' || (view === 'code' && reset) ? 'auth.backLogin'
      : view === 'code' && pending && pending.purpose === 'signup' ? 'auth.changeEmail' : 'auth.back')}`;

    if (view === 'code' && pending) {
      $('#auth-console-note').hidden = !byConsole;
      $('#auth-new-field').hidden = !reset;
      $('#auth-code-label').textContent = tr(reset ? 'auth.savePassword' : 'auth.confirm');
      $('#auth-skip').hidden = pending.purpose !== 'verify';
      $('#auth-gmail').hidden = byConsole || !/@(gmail|googlemail)\.com$/i.test(pending.email);
      if (!$('#auth-code-status').textContent && !byConsole) setStatus(code, tr('auth.spam'), false);
      tickResend();
    }
    page.querySelectorAll('.auth-reveal').forEach(labelReveal);
    ['auth-password', 'auth-new-password'].forEach(id => updateMeter(document.getElementById(id)));
    renderSocial();
  }

  function show(next, options = {}) {
    if (next === 'code' && !pending) next = 'login';
    const changed = next !== view;
    view = next;
    if (!options.keep) clearErrors();
    if (view === 'code' && changed) {
      code.value = '';
      newPassword.value = '';
      paintCode();
    }
    render();
    drawOwl(restingMood());
    if (page.open) {
      if (window.location.hash !== `#${view}`) {
        window.history.replaceState(window.history.state, '', `#${view}`);
      }
      focusFirst();
    }
  }

  function focusFirst() {
    const target = { signup: username, login: email, forgot: forgotEmail, code }[view];
    window.setTimeout(() => {
      if (page.open && !busy) target.focus({ preventScroll: true });
    }, 60);
  }

  function open(next = 'signup') {
    const target = VIEWS.includes(next) ? next : 'signup';
    /* Someone part-way through confirming their email goes back to the code step. */
    const saved = pending || readPending();
    if (saved && saved.purpose === 'signup' && target === 'signup') pending = saved;
    document.querySelectorAll('dialog[open]').forEach(dialog => {
      if (dialog !== page) dialog.close();
    });
    if (!page.open) {
      if (!VIEWS.includes(window.location.hash.slice(1))) {
        window.history.pushState({ auth: true }, '', `#${target}`);
        pushed = true;
      }
      page.showModal();
    }
    show(pending && pending.purpose === 'signup' && target === 'signup' ? 'code' : target);
  }

  function openCode(verify) {
    savePending(fromServer(verify));
    open('code');
  }

  function close() {
    if (page.open) page.close();
  }

  page.addEventListener('close', () => {
    window.clearInterval(ticker);
    ticker = 0;
    password.value = '';
    newPassword.value = '';
    showAlert('');
    if (!VIEWS.includes(window.location.hash.slice(1))) {
      pushed = false;
      return;
    }
    if (pushed) {
      pushed = false;
      window.history.back();
    } else {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  });

  window.addEventListener('popstate', () => {
    const hash = window.location.hash.slice(1);
    if (VIEWS.includes(hash)) {
      if (!page.open && !account().user) open(hash);
      else if (page.open && hash !== view) show(hash);
    } else if (page.open) {
      pushed = false;
      page.close();
    }
  });

  function finish(data) {
    savePending(null);
    react('yes');
    form.reset();
    codeForm.reset();
    forgotForm.reset();
    updateShy();
    close();
    /* Let the page close first, so a "choose a username" window can open on top. */
    window.setTimeout(() => account().signedIn(data), 60);
  }

  /* ---------- Password: show / hide and strength ---------- */

  function labelReveal(button) {
    const input = document.getElementById(button.dataset.revealFor);
    const shown = input.type === 'text';
    button.textContent = tr(shown ? 'key.hide' : 'key.show');
    button.setAttribute('aria-label', tr(shown ? 'auth.hidePassword' : 'auth.showPassword'));
  }

  page.querySelectorAll('.auth-reveal').forEach(button => {
    const input = document.getElementById(button.dataset.revealFor);
    button.addEventListener('mousedown', event => event.preventDefault());
    button.addEventListener('click', () => {
      input.type = input.type === 'text' ? 'password' : 'text';
      labelReveal(button);
      input.focus({ preventScroll: true });
      updateShy();
    });
  });

  function strength(value) {
    if (value.length < 8) return value ? 1 : 0;
    const kinds = [/\p{Ll}/u, /\p{Lu}/u, /\p{N}/u, /[^\p{L}\p{N}]/u].filter(kind => kind.test(value)).length;
    const variety = new Set(value.toLowerCase()).size;
    let score = 1;
    if (variety >= 5) score += 1;
    if (value.length >= 12 && variety >= 7) score += 1;
    if (kinds >= 3 && variety >= 6) score += 1;
    if (/^(password|qwerty|12345|abc123|iloveyou|letmein|welcome)/i.test(value)) score = 1;
    return Math.min(4, score);
  }

  function updateMeter(input) {
    const meter = page.querySelector(`[data-meter-for="${input.id}"]`);
    const score = strength(input.value);
    meter.dataset.score = String(score);
    if (input.getAttribute('aria-invalid') || meter.hidden) return;
    setStatus(input, input.value
      ? input.value.length < 8 ? tr('acct.passwordHint') : tr(`auth.strength${score}`)
      : tr('acct.passwordHint'), false);
  }

  [password, newPassword].forEach(input => {
    input.addEventListener('input', () => {
      input.removeAttribute('aria-invalid');
      if (input === password && view === 'login') setStatus(input, '');
      updateMeter(input);
    });
    input.addEventListener('focus', updateShy);
    input.addEventListener('blur', () => window.setTimeout(updateShy, 0));
  });

  /* ---------- Email: catch common typos ---------- */

  const DOMAIN_FIXES = {
    'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gamil.com': 'gmail.com', 'gmal.com': 'gmail.com',
    'gnail.com': 'gmail.com', 'gmail.co': 'gmail.com', 'gmail.con': 'gmail.com', 'gmail.cm': 'gmail.com',
    'gmaill.com': 'gmail.com', 'gmail.ru': 'gmail.com', 'gmali.com': 'gmail.com', 'gmil.com': 'gmail.com',
    'hotmial.com': 'hotmail.com', 'hotmail.con': 'hotmail.com', 'yaho.com': 'yahoo.com',
    'yahoo.con': 'yahoo.com', 'outlok.com': 'outlook.com', 'mail.ri': 'mail.ru', 'yandex.ri': 'yandex.ru'
  };

  function suggestEmail() {
    const button = $('#auth-suggest');
    const [name, domain] = email.value.trim().split('@');
    const fixed = view === 'signup' && name && domain ? DOMAIN_FIXES[domain.toLowerCase()] : '';
    button.hidden = !fixed;
    if (!fixed) return;
    button.dataset.value = `${name}@${fixed}`;
    button.textContent = tr('auth.didYouMean', { email: button.dataset.value });
  }

  email.addEventListener('blur', suggestEmail);
  email.addEventListener('input', () => {
    setStatus(email, '');
    $('#auth-suggest').hidden = true;
  });
  $('#auth-suggest').addEventListener('click', event => {
    email.value = event.currentTarget.dataset.value;
    event.currentTarget.hidden = true;
    password.focus();
  });
  forgotEmail.addEventListener('input', () => setStatus(forgotEmail, ''));
  username.addEventListener('input', () => {
    username.removeAttribute('aria-invalid');
    account().checkUsername(username, $('#auth-username-status'));
  });

  /* ---------- Errors from the server, shown where they belong ---------- */

  function handleError(error) {
    const fields = {
      username: view === 'signup' && username, taken: view === 'signup' && username,
      email: view === 'forgot' ? forgotEmail : email,
      password: view === 'code' ? newPassword : password,
      passwordWeak: view === 'code' ? newPassword : password,
      passwordChars: view === 'code' ? newPassword : password
    };
    if (fields[error.code]) {
      fieldError(fields[error.code], error.message);
      return;
    }
    if (['code', 'codeWrong', 'codeExpired'].includes(error.code) && view === 'code') {
      code.value = '';
      paintCode();
      const boxes = $('#auth-code-boxes');
      boxes.classList.remove('is-bad');
      void boxes.offsetWidth;
      boxes.classList.add('is-bad');
      fieldError(code, error.message);
      return;
    }
    let action = null;
    if (error.code === 'emailUsed') {
      setStatus(email, ' ');
      action = { label: tr('auth.loginInstead'), run: () => show('login') };
    } else if (error.code === 'socialOnly') {
      action = { label: tr('auth.setPassword'), run: () => goForgot() };
    } else if (error.code === 'wrong') {
      action = { label: tr('acct.forgot'), run: () => goForgot() };
    }
    showAlert(error.message, 'error', action);
    react('no');
  }

  $('#auth-alert-action').addEventListener('click', () => alertAction && alertAction.run());

  /* ---------- Sign up and log in ---------- */

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy) return;
    showAlert('');
    const address = email.value.trim();
    if (view === 'signup') {
      if (!NAME_PATTERN.test(username.value.trim())) return fieldError(username, tr('acct.invalid'));
      if (!EMAIL_PATTERN.test(address)) return fieldError(email, tr('err.auth.email'));
      if (password.value.length < 8) return fieldError(password, tr('err.auth.password'));
    } else {
      if (!address) return fieldError(email, tr('auth.needEmail'));
      if (!password.value) return fieldError(password, tr('auth.needPassword'));
    }

    setBusy(true, form);
    let failure = null;
    try {
      const owls = account().config.avatars.filter(item => item.startsWith('owl:'));
      const choices = owls.length ? owls : account().config.avatars;
      const data = view === 'signup'
        ? await account().api('/api/auth/signup', {
            username: username.value.trim(),
            email: address,
            password: password.value,
            avatar: choices[Math.floor(Math.random() * choices.length)],
            language: language()
          })
        : await account().api('/api/auth/login', { identifier: address, password: password.value });
      if (data.user) {
        if (data.verify) {
          /* Signed in already; confirming the email is offered but can be skipped. */
          account().signedIn(data);
          form.reset();
          savePending(fromServer(data.verify));
          show('code');
        } else {
          finish(data);
        }
      } else if (data.verify) {
        password.value = '';
        savePending(fromServer(data.verify));
        show('code');
      }
    } catch (error) {
      failure = error;
    } finally {
      setBusy(false, form);
    }
    if (failure) handleError(failure);
    else if (page.open) focusFirst();
  });

  /* ---------- Forgot password ---------- */

  function goForgot() {
    if (email.value.includes('@')) forgotEmail.value = email.value.trim();
    show('forgot');
  }

  $('#auth-forgot').addEventListener('click', goForgot);

  forgotForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy) return;
    showAlert('');
    const address = forgotEmail.value.trim();
    if (!EMAIL_PATTERN.test(address)) return fieldError(forgotEmail, tr('err.auth.email'));
    setBusy(true, forgotForm);
    let failure = null;
    try {
      const data = await account().api('/api/auth/forgot', { email: address, language: language() });
      savePending(fromServer(data.verify));
      show('code');
    } catch (error) {
      failure = error;
    } finally {
      setBusy(false, forgotForm);
    }
    if (failure) handleError(failure);
    else focusFirst();
  });

  /* ---------- The six-digit code ---------- */

  function paintCode() {
    const digits = code.value;
    page.querySelectorAll('.auth-code-cells i').forEach((cell, index) => {
      cell.textContent = digits[index] || '';
      cell.classList.toggle('is-filled', index < digits.length);
      cell.classList.toggle('is-next', index === Math.min(digits.length, 5));
    });
  }

  code.addEventListener('input', () => {
    code.value = code.value.replace(/\D/g, '').slice(0, 6);
    $('#auth-code-boxes').classList.remove('is-bad');
    if (code.getAttribute('aria-invalid')) setStatus(code, '');
    paintCode();
    if (code.value.length !== 6 || !pending || busy) return;
    if (pending.purpose === 'reset') {
      if (!newPassword.value) newPassword.focus();
    } else {
      codeForm.requestSubmit();
    }
  });

  codeForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || !pending) return;
    showAlert('');
    if (code.value.length !== 6) return fieldError(code, tr('err.auth.code'));
    const reset = pending.purpose === 'reset';
    if (reset && newPassword.value.length < 8) return fieldError(newPassword, tr('err.auth.password'));
    setBusy(true, codeForm);
    let failure = null;
    try {
      const data = reset
        ? await account().api('/api/auth/reset', { ticket: pending.ticket, code: code.value, password: newPassword.value })
        : await account().api('/api/auth/verify', { ticket: pending.ticket, code: code.value });
      if (pending.purpose === 'verify') {
        savePending(null);
        if (data.user) account().setUser(data.user, { quiet: true });
        react('yes');
        close();
        window.AceToast?.(tr('auth.verified'), '✅');
      } else {
        finish(data);
        if (reset) window.setTimeout(() => window.AceToast?.(tr('acct.passwordChanged'), '🔐'), 200);
      }
    } catch (error) {
      failure = error;
    } finally {
      setBusy(false, codeForm);
    }
    if (failure) handleError(failure);
  });

  function tickResend() {
    const button = $('#auth-resend');
    const update = () => {
      if (!pending || view !== 'code') {
        window.clearInterval(ticker);
        ticker = 0;
        return;
      }
      const seconds = Math.ceil((pending.resendAt - Date.now()) / 1000);
      button.disabled = seconds > 0 || busy;
      button.textContent = seconds > 0 ? tr('auth.resendIn', { s: seconds }) : tr('auth.resend');
    };
    update();
    if (!ticker) ticker = window.setInterval(update, 1000);
  }

  $('#auth-resend').addEventListener('click', async () => {
    if (!pending || busy) return;
    const button = $('#auth-resend');
    button.disabled = true;
    try {
      const data = await account().api('/api/auth/resend', { ticket: pending.ticket });
      savePending(fromServer(data.verify));
      clearErrors();
      code.value = '';
      paintCode();
      render();
      showAlert(tr('auth.resent'), 'ok');
      code.focus();
    } catch (error) {
      if (error.data && error.data.retryIn && error.code === 'codeWait') {
        pending.resendAt = Date.now() + error.data.retryIn * 1000;
      }
      showAlert(error.message, 'error', error.code === 'codeExpired' || error.code === 'codeSends'
        ? { label: tr('auth.startAgain'), run: startAgain } : null);
      tickResend();
    }
  });

  function startAgain() {
    const last = pending;
    savePending(null);
    if (last && last.purpose === 'reset') {
      forgotEmail.value = last.email;
      show('forgot');
    } else if (last && last.purpose === 'signup') {
      show('signup');
    } else {
      close();
    }
  }

  $('#auth-skip').addEventListener('click', () => {
    savePending(null);
    close();
  });

  /* ---------- Page buttons ---------- */

  page.querySelectorAll('[data-auth-view]').forEach(button => {
    button.addEventListener('click', () => show(button.dataset.authView));
  });
  $('#auth-close').addEventListener('click', () => {
    /* Closed on purpose: a reload must not bring the code step back (sign-up can still resume it). */
    if (pending && pending.purpose === 'signup') savePending(Object.assign(pending, { dismissed: true }));
    else savePending(null);
    close();
  });
  $('#auth-back').addEventListener('click', () => {
    if (view === 'forgot') show('login');
    else if (view === 'code' && pending && pending.purpose === 'reset') {
      savePending(null);
      show('login');
    } else if (view === 'code' && pending && pending.purpose === 'signup') {
      savePending(null);
      show('signup');
    } else {
      $('#auth-close').click();
    }
  });

  /* ---------- Google and Apple ---------- */

  let googleReady = false;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = resolve;
      script.onerror = () => {
        script.remove();
        reject(new Error('script'));
      };
      document.head.append(script);
    });
  }

  let googleLoading = null;
  function setupGoogle() {
    const config = account().config.google;
    if (!config || googleReady) return Promise.resolve();
    if (!googleLoading) {
      googleLoading = loadScript('https://accounts.google.com/gsi/client').then(() => {
        window.google.accounts.id.initialize({
          client_id: config.clientId,
          callback: response => social('/api/auth/google', { credential: response.credential }),
          ux_mode: 'popup',
          auto_select: false
        });
        googleReady = true;
        if (page.open) renderSocial();
      }).catch(() => { googleLoading = null; });
    }
    return googleLoading;
  }

  function renderSocial() {
    const { google, apple } = account().config;
    const fallback = $('#google-fallback');
    const slot = $('#google-slot');
    const appleButton = $('#apple-button');
    fallback.hidden = Boolean(google && googleReady);
    fallback.disabled = !google;
    slot.hidden = !(google && googleReady);
    appleButton.disabled = !apple;
    const missing = [!google && 'Google', !apple && 'Apple'].filter(Boolean).join(', ');
    $('#social-note').hidden = !missing;
    $('#social-note').textContent = missing ? tr('auth.socialOff', { list: missing }) : '';
    if (google && googleReady && (view === 'signup' || view === 'login') && page.open) {
      slot.replaceChildren();
      window.google.accounts.id.renderButton(slot, {
        theme: 'filled_black',
        size: 'large',
        shape: 'pill',
        text: view === 'signup' ? 'signup_with' : 'signin_with',
        width: Math.max(220, Math.min(400, Math.round(slot.parentElement.clientWidth))),
        locale: window.AceI18n.lang
      });
    } else if (google) {
      setupGoogle();
    }
  }

  $('#google-fallback').addEventListener('click', async () => {
    await setupGoogle();
    if (!googleReady) showAlert(tr('err.auth.provider'));
  });

  $('#apple-button').addEventListener('click', async () => {
    const config = account().config.apple;
    if (!config) return;
    try {
      if (!window.AppleID) {
        await loadScript('https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js');
      }
      window.AppleID.auth.init({
        clientId: config.clientId,
        scope: 'name email',
        redirectURI: config.redirectUri || `${window.location.origin}/`,
        usePopup: true
      });
      const result = await window.AppleID.auth.signIn();
      const idToken = result && result.authorization && result.authorization.id_token;
      if (idToken) await social('/api/auth/apple', { idToken });
    } catch (error) {
      if (error && error.error === 'popup_closed_by_user') return;
      showAlert(tr('err.auth.provider'));
    }
  });

  async function social(path, body) {
    showAlert(tr('acct.checking'), 'ok');
    try {
      finish(await account().api(path, body));
    } catch (error) {
      handleError(error);
    }
  }

  /* ---------- Start ---------- */

  window.AceAuth = { open, openCode, close };

  window.addEventListener('aceminder:language', () => {
    if (!page.open) return;
    clearErrors();
    $('#auth-username-status').textContent = tr('acct.usernameHint');
    render();
  });
  window.addEventListener('aceminder:config', () => {
    if (page.open) render();
  });

  document.addEventListener('DOMContentLoaded', () => {
    drawOwl('happy');
    const hash = window.location.hash.slice(1);
    const saved = readPending();
    if (saved && saved.purpose !== 'verify' && !saved.dismissed) {
      /* Phones often reload the tab after a trip to the mail app: continue where they were. */
      pending = saved;
      open('code');
    } else if (VIEWS.includes(hash)) {
      if (hash === 'code') window.history.replaceState(null, '', window.location.pathname);
      else open(hash);
    }
  });

  /* Already signed in (for example an old #login link): no need for this page. */
  window.addEventListener('aceminder:account', event => {
    const user = event.detail && event.detail.user;
    if (user && page.open && ['signup', 'login', 'forgot'].includes(view) && !busy) close();
  });
})();
