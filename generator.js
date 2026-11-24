'use strict';

const t = (key, vars) => window.AceI18n.t(key, vars);
const MAX_QUESTION_COUNT = 30;
const MAX_FILES = 4;
/* Anything above this goes through Gemini's Files API instead of the request body. */
const FILES_API_FILE_BYTES = 20 * 1024 * 1024;
/* Gemini's inline ceiling: 50 MB per file and about 60 MB of files per request. */
const INLINE_FILE_BYTES = 50 * 1024 * 1024;
const INLINE_TOTAL_BYTES = 60 * 1024 * 1024;
/* Gemini cannot read PDFs over 50 MB or 1000 pages, on any route. */
const PDF_MAX_BYTES = 50 * 1024 * 1024;
/* Bigger PDFs are cut down to chosen pages in the browser first (pdf-pages.js). */
const PDF_SOURCE_MAX_BYTES = 500 * 1024 * 1024;
/* Files API ceiling, still far above anything a revision sheet needs. */
const MAX_FILE_BYTES = 1024 * 1024 * 1024;
const MAX_FILES_BYTES = 1024 * 1024 * 1024;
/* Gemini can queue for minutes when it is busy, and the server tries fallback models. */
const REQUEST_TIMEOUT_MS = 420000;
const ACCEPTED_FILE_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif'
]);
const KEY_COOKIE = 'aceminder_gemini_key';
const CONSENT_COOKIE = 'aceminder_key_consent';
const KEY_STORAGE = 'aceminder.geminiKey';
const CONSENT_STORAGE = 'aceminder.keyConsent';
const DISMISS_STORAGE = 'aceminder.consentDismissed';
const KEY_PATTERN = /^[A-Za-z0-9._-]{20,200}$/;
const COOKIE_DAYS = 365;

const questionCount = document.querySelector('#question-count');
const groupList = document.querySelector('#type-group-list');
const rangeError = document.querySelector('#range-error');
const formError = document.querySelector('#form-error');
const generatorForm = document.querySelector('#generator-form');
const planOutput = document.querySelector('#plan-output');
const sourceFiles = document.querySelector('#source-files');
const fileStatus = document.querySelector('#file-status');
const fileList = document.querySelector('#file-list');
const fileError = document.querySelector('#file-error');
const dropzone = document.querySelector('#dropzone');
const setupHint = document.querySelector('#setup-hint');
const aiStatus = document.querySelector('#ai-status');
const studyTopic = document.querySelector('#study-topic');
const studyNotes = document.querySelector('#study-notes');
const notesCount = document.querySelector('#notes-count');
const difficulty = document.querySelector('#difficulty');
const planGroups = document.querySelector('#plan-groups');
const planTitle = document.querySelector('#plan-title');
const planSummary = document.querySelector('#plan-summary');
const generateButton = generatorForm.querySelector('button[type="submit"]');
const buttonLabel = generateButton.querySelector('.button-label');
const downloadPlan = document.querySelector('#download-plan');
const submitAnswersButton = document.querySelector('#submit-answers');
const submitAnswersLabel = submitAnswersButton.querySelector('.button-label');
const scorePanel = document.querySelector('#score-panel');
const scorePercent = document.querySelector('#score-percent');
const scoreFraction = document.querySelector('#score-fraction');
const scoreNote = document.querySelector('#score-note');
const answerProgress = document.querySelector('#answer-progress');
const quizStatus = document.querySelector('#quiz-status');
const resetAnswersButton = document.querySelector('#reset-answers');
const keyDialog = document.querySelector('#key-dialog');
const keyForm = document.querySelector('#key-form');
const keyInput = document.querySelector('#key-input');
const keyRemember = document.querySelector('#key-remember');
const keyRememberNote = document.querySelector('#key-remember-note');
const keyMessage = document.querySelector('#key-message');
const keySaveButton = document.querySelector('#key-save');
const keyRemoveButton = document.querySelector('#key-remove');
const keyRevealButton = document.querySelector('#key-reveal');
const keyPill = document.querySelector('#open-key-dialog');
const keyPillLabel = document.querySelector('#key-pill-label');
const keyDialogClose = document.querySelector('#key-dialog-close');
const cookieBanner = document.querySelector('#cookie-banner');
const cookieAccept = document.querySelector('#cookie-accept');
const cookieDecline = document.querySelector('#cookie-decline');
const setupHintButton = document.querySelector('#setup-hint-button');
let currentQuestions = [];
let currentTestId = '';
let currentDifficulty = 'Medium';
let currentMeta = { topic: '', language: 'English', files: 0, formats: 1 };
let selectedFiles = [];
let lastModel = '';
let sessionKey = '';
let healthStatus = null;
let serverKeyAvailable = false;
const questionTypes = [
  ['multiple-choice', 'type.multiple-choice'],
  ['true-false', 'type.true-false'],
  ['short-answer', 'type.short-answer'],
  ['fill-blanks', 'type.fill-blanks'],
  ['table', 'type.table'],
  ['graph', 'type.graph'],
  ['image', 'type.image'],
  ['custom', 'type.custom']
];
let groups = [
  { start: 1, end: 5, type: 'multiple-choice', custom: '' },
  { start: 6, end: 10, type: 'true-false', custom: '' }
];

function makeLabel(text, className) {
  const label = document.createElement('label');
  label.className = className;
  label.append(document.createTextNode(text));
  return label;
}

function renderGroups() {
  groupList.replaceChildren();
  groups.forEach((group, index) => {
    const row = document.createElement('div');
    row.className = 'type-group';
    const rangeLabel = makeLabel(t('form.rangeLabel'), 'type-range');
    const rangeInputs = document.createElement('span');
    rangeInputs.className = 'range-inputs';

    for (const [property, labelText] of [['start', t('form.from')], ['end', t('form.through')]]) {
      if (property === 'end') rangeInputs.append(document.createTextNode('→'));
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '1';
      input.max = questionCount.value;
      input.step = '1';
      input.value = group[property];
      input.setAttribute('aria-label', `${labelText}, group ${index + 1}`);
      input.addEventListener('input', () => {
        group[property] = Number(input.value);
        formError.hidden = true;
        planOutput.hidden = true;
      });
      rangeInputs.append(input);
    }
    rangeLabel.append(rangeInputs);
    row.append(rangeLabel);

    const formatLabel = makeLabel(t('form.typeLabel'), 'type-format');
    const select = document.createElement('select');
    select.setAttribute('aria-label', `Question type, group ${index + 1}`);
    questionTypes.forEach(([value, labelKey]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = t(labelKey);
      select.append(option);
    });
    select.value = group.type;
    select.addEventListener('change', () => {
      group.type = select.value;
      renderGroups();
      planOutput.hidden = true;
    });
    formatLabel.append(select);
    row.append(formatLabel);

    if (group.type === 'custom') {
      const customLabel = makeLabel(t('form.typeLabel'), 'custom-format-field');
      const customInput = document.createElement('input');
      customInput.type = 'text';
      customInput.maxLength = 80;
      customInput.placeholder = t('form.customPh');
      customInput.value = group.custom;
      customInput.required = true;
      customInput.setAttribute('aria-label', `Custom question type, group ${index + 1}`);
      customInput.addEventListener('input', () => {
        group.custom = customInput.value;
        planOutput.hidden = true;
      });
      customLabel.append(customInput);
      row.append(customLabel);
    }

    const removeButton = document.createElement('button');
    removeButton.className = 'remove-type';
    removeButton.type = 'button';
    removeButton.textContent = t('form.remove');
    removeButton.disabled = groups.length === 1;
    removeButton.setAttribute('aria-label', `Remove question type group ${index + 1}`);
    removeButton.addEventListener('click', () => {
      if (index > 0) groups[index - 1].end = group.end;
      else if (groups.length > 1) groups[1].start = group.start;
      groups.splice(index, 1);
      renderGroups();
      planOutput.hidden = true;
    });
    row.append(removeButton);
    groupList.append(row);
  });
}

function rangeProblem() {
  const total = Number(questionCount.value);
  if (!Number.isInteger(total) || total < 1 || total > MAX_QUESTION_COUNT) {
    return t('err.countRange', { max: MAX_QUESTION_COUNT });
  }
  let nextQuestion = 1;
  for (let index = 0; index < groups.length; index += 1) {
    const group = groups[index];
    if (!Number.isInteger(group.start) || !Number.isInteger(group.end) || group.start !== nextQuestion || group.end < group.start || group.end > total) {
      return t('err.group', { i: index + 1, n: nextQuestion });
    }
    if (group.type === 'custom' && !group.custom.trim()) return t('err.custom', { i: index + 1 });
    nextQuestion = group.end + 1;
  }
  return nextQuestion === total + 1 ? '' : t('err.missing', { from: nextQuestion, to: total });
}

function displayType(group) {
  if (group.type === 'custom') return group.custom.trim();
  const key = questionTypes.find(([value]) => value === group.type)?.[1];
  return key ? t(key) : '';
}

function setAiStatus(message, state) {
  aiStatus.textContent = message;
  aiStatus.classList.remove('is-online', 'is-offline', 'is-busy', 'is-error');
  if (state) aiStatus.classList.add(state);
}

function updateNotesCount() {
  notesCount.textContent = t('form.notesCount', { n: studyNotes.value.length.toLocaleString() });
}

/* Gemini API key, cookie consent and the setup tutorial */

function readCookie(name) {
  const match = document.cookie.split('; ').find(row => row.startsWith(`${name}=`));
  if (!match) return '';
  try {
    return decodeURIComponent(match.slice(name.length + 1));
  } catch {
    return '';
  }
}

function writeCookie(name, value) {
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${name}=${encodeURIComponent(value)}; max-age=${COOKIE_DAYS * 86400}; path=/; SameSite=Strict${secure}`;
}

function removeCookie(name) {
  document.cookie = `${name}=; max-age=0; path=/; SameSite=Strict`;
}

function readStorage(name) {
  try {
    return window.localStorage.getItem(name) || '';
  } catch {
    return '';
  }
}

function writeStorage(name, value) {
  try {
    window.localStorage.setItem(name, value);
  } catch {
    /* storage can be blocked; the key still works for this tab */
  }
}

function removeStorage(name) {
  try {
    window.localStorage.removeItem(name);
  } catch {
    /* ignore */
  }
}

function hasConsent() {
  return readCookie(CONSENT_COOKIE) === 'yes' || readStorage(CONSENT_STORAGE) === 'yes';
}

function apiKey() {
  return (readCookie(KEY_COOKIE) || readStorage(KEY_STORAGE) || sessionKey).trim();
}

function apiHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  const key = apiKey();
  if (key) headers['X-Gemini-Key'] = key;
  return headers;
}

function applyHealthStatus() {
  if (!healthStatus) return;
  const model = healthStatus.model ? ` · ${healthStatus.model}` : '';
  if (apiKey()) {
    setupHint.hidden = true;
    setAiStatus(`${t('status.readyOwn')}${model}`, 'is-online');
    return;
  }
  if (healthStatus.aiConfigured) {
    setupHint.hidden = true;
    setAiStatus(`${t('status.readyServer')}${model}`, 'is-online');
    return;
  }
  setupHint.hidden = false;
  setAiStatus(t('status.needKey'), 'is-offline');
}

function updateKeyUi() {
  const saved = Boolean(apiKey());
  keyPill.classList.toggle('is-ready', saved);
  keyPillLabel.textContent = saved ? t('key.saved') : t('key.add');
  keyPill.title = t('key.add');
  keyRemoveButton.hidden = !saved;
  keyRemember.disabled = !hasConsent();
  keyRememberNote.hidden = hasConsent();
  if (!hasConsent()) keyRemember.checked = false;
  applyHealthStatus();
}

function saveApiKey(key) {
  const remember = keyRemember.checked && hasConsent();
  sessionKey = key;
  if (remember) {
    writeCookie(KEY_COOKIE, key);
    writeStorage(KEY_STORAGE, key);
  } else {
    removeCookie(KEY_COOKIE);
    removeStorage(KEY_STORAGE);
  }
  updateKeyUi();
}

function clearApiKey() {
  sessionKey = '';
  removeCookie(KEY_COOKIE);
  removeStorage(KEY_STORAGE);
  updateKeyUi();
}

function showKeyMessage(message, tone) {
  keyMessage.textContent = message;
  keyMessage.hidden = !message;
  keyMessage.className = `key-message${tone ? ` is-${tone}` : ''}`;
}

function openKeyDialog(message = '') {
  if (typeof keyDialog.showModal !== 'function') {
    document.querySelector('#generator').scrollIntoView();
    return;
  }
  keyInput.value = apiKey();
  keyInput.type = 'password';
  keyRevealButton.textContent = t('key.show');
  keyRevealButton.setAttribute('aria-label', t('key.show'));
  keyRemember.checked = hasConsent();
  keyRemember.disabled = !hasConsent();
  keyRememberNote.hidden = hasConsent();
  showKeyMessage(message, message ? 'error' : '');
  if (!keyDialog.open) keyDialog.showModal();
  window.setTimeout(() => keyInput.focus({ preventScroll: true }), 60);
}

function closeKeyDialog() {
  if (keyDialog.open) keyDialog.close();
}

async function saveKeyFromDialog(event) {
  event.preventDefault();
  const candidate = keyInput.value.replace(/\s+/g, '');
  if (!candidate) {
    showKeyMessage(t('err.keyEmpty'), 'error');
    keyInput.focus();
    return;
  }
  if (!KEY_PATTERN.test(candidate)) {
    showKeyMessage(t('err.keyFormat'), 'error');
    return;
  }

  keySaveButton.disabled = true;
  keySaveButton.textContent = t('key.checking');
  showKeyMessage('');

  try {
    const response = await fetch('/api/check-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Gemini-Key': candidate },
      body: '{}'
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result.error || t('err.keyNotAccepted', { code: response.status }));
    }
    saveApiKey(candidate);
    showKeyMessage(t('key.savedOk'), 'ok');
    window.setTimeout(() => {
      closeKeyDialog();
      showKeyMessage('');
      document.querySelector('#generator').scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        block: 'start'
      });
    }, 900);
  } catch (error) {
    const message = error instanceof TypeError
      ? t('err.keyServer')
      : error instanceof Error
        ? error.message
        : t('err.keyNotChecked');
    showKeyMessage(message, 'error');
    setAiStatus(t('status.keyNotSaved'), 'is-error');
  } finally {
    keySaveButton.disabled = false;
    keySaveButton.textContent = t('key.save');
  }
}

function showCookieBannerIfNeeded() {
  let dismissed = false;
  try {
    dismissed = window.sessionStorage.getItem(DISMISS_STORAGE) === 'yes';
  } catch {
    dismissed = false;
  }
  cookieBanner.hidden = hasConsent() || dismissed;
}

cookieAccept.addEventListener('click', () => {
  writeCookie(CONSENT_COOKIE, 'yes');
  writeStorage(CONSENT_STORAGE, 'yes');
  cookieBanner.hidden = true;
  const existing = apiKey();
  if (existing) {
    writeCookie(KEY_COOKIE, existing);
    writeStorage(KEY_STORAGE, existing);
    updateKeyUi();
    setAiStatus(t('status.cookiesOn'), 'is-online');
    return;
  }
  updateKeyUi();
  openKeyDialog();
});

cookieDecline.addEventListener('click', () => {
  cookieBanner.hidden = true;
  try {
    window.sessionStorage.setItem(DISMISS_STORAGE, 'yes');
  } catch {
    /* ignore */
  }
  updateKeyUi();
});

keyForm.addEventListener('submit', saveKeyFromDialog);
keyDialogClose.addEventListener('click', closeKeyDialog);
keyPill.addEventListener('click', () => openKeyDialog());
setupHintButton.addEventListener('click', () => openKeyDialog());
keyDialog.addEventListener('click', event => {
  if (event.target === keyDialog) closeKeyDialog();
});
keyRevealButton.addEventListener('click', () => {
  const showing = keyInput.type === 'text';
  keyInput.type = showing ? 'password' : 'text';
  keyRevealButton.textContent = showing ? t('key.show') : t('key.hide');
  keyRevealButton.setAttribute('aria-label', showing ? t('key.show') : t('key.hide'));
});
keyRemoveButton.addEventListener('click', () => {
  clearApiKey();
  keyInput.value = '';
  showKeyMessage(t('key.removed'), 'ok');
});

questionCount.addEventListener('change', () => {
  const count = Math.min(MAX_QUESTION_COUNT, Math.max(1, Math.floor(Number(questionCount.value) || 1)));
  questionCount.value = count;
  syncGroupsToCount(count);
  rangeError.hidden = true;
  formError.hidden = true;
  planOutput.hidden = true;
  renderGroups();
});

document.querySelector('#add-type').addEventListener('click', () => {
  const last = groups.at(-1);
  if (last.end - last.start < 1) {
    rangeError.textContent = t('err.addType');
    rangeError.hidden = false;
    return;
  }
  const previousEnd = last.end;
  const splitAt = Math.floor((last.start + last.end) / 2);
  const usedTypes = new Set(groups.map(group => group.type));
  const newType = questionTypes
    .map(([value]) => value)
    .find(value => value !== 'custom' && !usedTypes.has(value)) || 'short-answer';
  last.end = splitAt;
  groups.push({ start: splitAt + 1, end: previousEnd, type: newType, custom: '' });
  rangeError.hidden = true;
  formError.hidden = true;
  planOutput.hidden = true;
  renderGroups();
});

function formatLimit(bytes) {
  if (bytes >= 1024 * 1024 * 1024) return `${Math.round(bytes / (1024 * 1024 * 1024))} GB`;
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function mimeTypeFor(file) {
  if (ACCEPTED_FILE_TYPES.has(file.type)) return file.type;
  const extension = file.name.split('.').pop().toLowerCase();
  return {
    pdf: 'application/pdf',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif'
  }[extension] || '';
}

function fileBadge(file) {
  if (mimeTypeFor(file) === 'application/pdf') return 'PDF';
  const extension = file.name.split('.').pop().toUpperCase();
  return extension === 'JPEG' ? 'JPG' : extension;
}

function updateFileStatus() {
  const total = selectedFiles.reduce((sum, file) => sum + file.size, 0);
  fileStatus.textContent = selectedFiles.length
    ? t('form.fileCount', { n: selectedFiles.length, max: MAX_FILES, size: formatBytes(total) })
    : t('form.noFiles');
}

function renderFiles() {
  fileList.replaceChildren();
  selectedFiles.forEach((file, index) => {
    const item = document.createElement('li');
    item.className = 'file-chip';
    const badge = document.createElement('span');
    badge.className = 'file-chip-type';
    badge.textContent = fileBadge(file);
    const name = document.createElement('span');
    name.className = 'file-chip-name';
    name.textContent = file.name;
    name.title = file.name;
    const size = document.createElement('span');
    size.className = 'file-chip-size';
    size.textContent = formatBytes(file.size);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'file-chip-remove';
    remove.setAttribute('aria-label', `${t('form.remove')} ${file.name}`);
    remove.textContent = '×';
    remove.addEventListener('click', () => {
      selectedFiles.splice(index, 1);
      fileError.hidden = true;
      renderFiles();
      planOutput.hidden = true;
    });
    item.append(badge, name, size, remove);
    fileList.append(item);
  });
  updateFileStatus();
}

function addFiles(incoming) {
  const problems = [];
  for (const file of Array.from(incoming || [])) {
    const mimeType = mimeTypeFor(file);
    if (!mimeType) {
      problems.push(t('err.fileType', { name: file.name }));
      continue;
    }
    if (!file.size) {
      problems.push(t('err.fileEmpty', { name: file.name }));
      continue;
    }
    if (mimeType === 'application/pdf' ? file.size > PDF_SOURCE_MAX_BYTES : file.size > MAX_FILE_BYTES) {
      problems.push(mimeType === 'application/pdf'
        ? t('err.pdfBig', { name: file.name, max: Math.round(PDF_SOURCE_MAX_BYTES / (1024 * 1024)) })
        : t('err.fileBig', { name: file.name, max: Math.round(MAX_FILE_BYTES / (1024 * 1024)) }));
      continue;
    }
    if (selectedFiles.some(existing => existing.name === file.name && existing.size === file.size && existing.lastModified === file.lastModified)) {
      continue;
    }
    if (selectedFiles.length >= MAX_FILES) {
      problems.push(t('err.fileCount', { max: MAX_FILES }));
      break;
    }
    if (mimeType === 'application/pdf' && file.size > PDF_MAX_BYTES) {
      window.AcePdf.pick(file).then(smaller => { if (smaller) addFiles([smaller]); });
      continue;
    }
    const total = selectedFiles.reduce((sum, existing) => sum + existing.size, 0) + file.size;
    if (total > MAX_FILES_BYTES) {
      problems.push(t('err.fileTotal', { size: formatLimit(MAX_FILES_BYTES) }));
      continue;
    }
    selectedFiles.push(file);
  }
  renderFiles();
  fileError.textContent = problems.join(' ');
  fileError.hidden = problems.length === 0;
  planOutput.hidden = true;
}

sourceFiles.addEventListener('change', () => {
  addFiles(sourceFiles.files);
  sourceFiles.value = '';
});

['dragenter', 'dragover'].forEach(eventName => {
  dropzone.addEventListener(eventName, event => {
    event.preventDefault();
    dropzone.classList.add('is-dragging');
  });
});

['dragleave', 'dragend'].forEach(eventName => {
  dropzone.addEventListener(eventName, () => dropzone.classList.remove('is-dragging'));
});

dropzone.addEventListener('drop', event => {
  event.preventDefault();
  dropzone.classList.remove('is-dragging');
  if (event.dataTransfer) addFiles(event.dataTransfer.files);
});

function clipboardFiles(data) {
  if (!data) return [];
  const files = [];
  if (data.files && data.files.length) {
    for (const file of data.files) files.push(file);
  } else if (data.items) {
    for (const item of data.items) {
      if (item.kind !== 'file') continue;
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }
  return files.map(file => {
    if (file.name && file.name.trim()) return file;
    const extension = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
    return new File([file], `pasted-image-${Date.now()}.${extension}`, { type: file.type });
  });
}

document.addEventListener('paste', event => {
  const target = event.target;
  if (target instanceof Element && target.closest('input, textarea, [contenteditable="true"]')) return;
  const files = clipboardFiles(event.clipboardData);
  if (!files.length) return;
  event.preventDefault();
  addFiles(files);
  dropzone.classList.add('is-dragging');
  window.setTimeout(() => dropzone.classList.remove('is-dragging'), 450);
});

function readFileAttachment(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const comma = result.indexOf(',');
      if (comma === -1) {
        reject(new Error(t('err.readFile', { name: file.name })));
        return;
      }
      resolve({
        name: file.name,
        mimeType: mimeTypeFor(file),
        data: result.slice(comma + 1)
      });
    };
    reader.onerror = () => reject(new Error(t('err.readFile', { name: file.name })));
    reader.readAsDataURL(file);
  });
}

/* Files API route: stream the raw file to the local server, which forwards it to Gemini. */
function uploadFileAttachment(file) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const query = `name=${encodeURIComponent(file.name)}&mimeType=${encodeURIComponent(mimeTypeFor(file))}`;
    xhr.open('POST', `/api/upload?${query}`);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    const key = apiKey();
    if (key) xhr.setRequestHeader('X-Gemini-Key', key);
    xhr.responseType = 'json';
    xhr.upload.onprogress = event => {
      if (!event.lengthComputable) return;
      const percent = Math.min(100, Math.round((event.loaded / event.total) * 100));
      setAiStatus(t('status.uploading', { name: file.name, percent }), 'is-busy');
    };
    xhr.onload = () => {
      const result = xhr.response || {};
      if (xhr.status >= 200 && xhr.status < 300 && typeof result.fileUri === 'string') {
        resolve(result);
        return;
      }
      if (result.keyProblem) openKeyDialog(result.error);
      if (result.setupRequired) setupHint.hidden = false;
      reject(new Error(result.error || t('err.uploadFailed', { name: file.name, code: xhr.status })));
    };
    xhr.onerror = () => reject(new Error(t('err.uploadFailed', { name: file.name, code: 0 })));
    xhr.send(file);
  });
}

async function readAttachments() {
  const attachments = [];
  let inlineBytes = 0;
  for (const file of selectedFiles) {
    const mustUseFilesApi = file.size > FILES_API_FILE_BYTES;
    const inlineRoom = inlineBytes + file.size <= INLINE_TOTAL_BYTES && file.size <= INLINE_FILE_BYTES;
    if (mustUseFilesApi || !inlineRoom) {
      try {
        setAiStatus(t('status.uploading', { name: file.name, percent: 0 }), 'is-busy');
        attachments.push(await uploadFileAttachment(file));
      } catch (error) {
        if (!inlineRoom) throw error;
        /* Files API unavailable: the inline route still carries this file. */
        attachments.push(await readFileAttachment(file));
        inlineBytes += file.size;
      }
      continue;
    }
    attachments.push(await readFileAttachment(file));
    inlineBytes += file.size;
  }
  return attachments;
}

renderFiles();

function normaliseText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isTrueFalseQuestion(question) {
  const value = normaliseText(question.format);
  if (!value) return false;
  return Object.values(window.AceI18n.dicts).some(dict => dict['type.true-false'] && normaliseText(dict['type.true-false']) === value);
}

function selectableChoices(question) {
  return Array.isArray(question.choices)
    ? question.choices.filter(choice => String(choice).trim()).length >= 2
    : false;
}

function buildOptionGroup(question, trueFalse) {
  const group = document.createElement('div');
  group.className = `answer-options${trueFalse ? ' answer-options--inline' : ''}`;
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', t('answer.select'));

  const options = trueFalse
    ? [
        { label: t('answer.true'), value: 'true' },
        { label: t('answer.false'), value: 'false' }
      ]
    : question.choices.map((choice, index) => ({
        label: String(choice),
        value: `${String.fromCharCode(65 + index)}. ${choice}`
      }));

  options.forEach((option, index) => {
    const label = document.createElement('label');
    label.className = 'answer-option';
    label.dataset.index = String(index);

    const input = document.createElement('input');
    input.type = 'radio';
    input.name = `question-${question.number}`;
    input.value = option.value;
    input.dataset.index = String(index);

    const key = document.createElement('span');
    key.className = 'answer-option-key';
    key.setAttribute('aria-hidden', 'true');
    key.textContent = trueFalse ? (index === 0 ? '✓' : '✕') : String.fromCharCode(65 + index);

    const text = document.createElement('span');
    text.className = 'answer-option-text';
    text.textContent = option.label;

    const mark = document.createElement('span');
    mark.className = 'answer-option-mark';
    mark.setAttribute('aria-hidden', 'true');

    label.append(input, key, text, mark);
    group.append(label);
  });

  group.addEventListener('change', () => {
    group.querySelectorAll('.answer-option').forEach(option => {
      option.classList.toggle('is-selected', Boolean(option.querySelector('input:checked')));
    });
    const item = group.closest('.generated-question');
    if (item) clearGradeFor(item);
    updateAnswerProgress();
  });

  return group;
}

function answerItem(number) {
  return planGroups.querySelector(`.generated-question[data-question-number="${number}"]`);
}

function currentAnswer(number) {
  const item = answerItem(number);
  if (!item) return '';
  const input = item.querySelector('.answer-input');
  if (input) return input.value.trim();
  const checked = item.querySelector('.answer-option input:checked');
  return checked ? checked.value : '';
}

function currentChoiceIndex(number) {
  const checked = answerItem(number)?.querySelector('.answer-option input:checked');
  return checked ? Number(checked.dataset.index) : null;
}

function selectedAnswers() {
  return currentQuestions.map(question => ({
    number: question.number,
    answer: currentAnswer(question.number)
  }));
}

function firstAnswerControl() {
  return planGroups.querySelector('.answer-input, .answer-option input');
}

function optionCorrectIndex(question) {
  const raw = String(question.answer || '').trim();
  if (!raw) return null;

  if (!Array.isArray(question.choices) || !question.choices.length) {
    const value = normaliseText(raw);
    const falseWords = ['false', 'f', 'incorrect', 'неверно', 'ложь', 'xato', 'notogri', 'falsch', 'faux', 'falso'];
    const trueWords = ['true', 't', 'correct', 'верно', 'тўғри', 'togri', 'richtig', 'wahr', 'vrai', 'verdadero'];
    const starts = words => words.some(word => value === word || value.startsWith(`${word} `));
    if (starts(falseWords.map(normaliseText))) return 1;
    if (starts(trueWords.map(normaliseText))) return 0;
    return null;
  }

  const match = /^\(?([A-Ha-h])\)?\s*[.:)\u2013\-]?\s*(.*)$/.exec(raw);
  if (match) {
    const index = match[1].toUpperCase().charCodeAt(0) - 65;
    if (index >= 0 && index < question.choices.length) {
      const rest = normaliseText(match[2]);
      const choiceText = normaliseText(question.choices[index]);
      if (!rest || !choiceText || rest === choiceText || choiceText.includes(rest) || rest.includes(choiceText)) {
        return index;
      }
    }
  }

  const answer = normaliseText(raw);
  if (!answer) return null;
  const exact = question.choices.findIndex(choice => normaliseText(choice) === answer);
  if (exact !== -1) return exact;
  const partial = question.choices.findIndex(choice => {
    const text = normaliseText(choice);
    return Boolean(text) && (text.includes(answer) || answer.includes(text));
  });
  return partial === -1 ? null : partial;
}

function renderQuestions(questions) {
  const list = planGroups;
  list.replaceChildren();
  list.classList.add('question-results');
  resetScoreUi();

  questions.forEach(question => {
    const item = document.createElement('li');
    item.className = 'generated-question';
    item.dataset.questionNumber = String(question.number);
    const heading = document.createElement('div');
    heading.className = 'generated-question-heading';
    const number = document.createElement('span');
    number.className = 'generated-question-number';
    number.textContent = t('q.number', { n: question.number });
    const format = document.createElement('span');
    format.className = 'generated-question-format';
    format.textContent = question.format;
    heading.append(number, format);
    item.append(heading);

    const prompt = document.createElement('p');
    prompt.className = 'generated-question-prompt';
    prompt.textContent = question.prompt;
    item.append(prompt);

    const trueFalse = isTrueFalseQuestion(question);
    const selectable = !trueFalse && selectableChoices(question);

    if (!selectable && !trueFalse && Array.isArray(question.choices) && question.choices.length) {
      const choices = document.createElement('ol');
      choices.className = 'generated-choices';
      choices.type = 'A';
      question.choices.forEach(choice => {
        const option = document.createElement('li');
        option.textContent = choice;
        choices.append(option);
      });
      item.append(choices);
    }

    if (question.table && Array.isArray(question.table.headers) && Array.isArray(question.table.rows)) {
      const wrapper = document.createElement('div');
      wrapper.className = 'generated-table-scroll';
      const table = document.createElement('table');
      table.className = 'generated-table';
      if (question.table.title) {
        const caption = table.createCaption();
        caption.textContent = question.table.title;
      }
      const headerRow = table.createTHead().insertRow();
      question.table.headers.forEach(value => {
        const cell = document.createElement('th');
        cell.scope = 'col';
        cell.textContent = value;
        headerRow.append(cell);
      });
      const body = table.createTBody();
      question.table.rows.forEach(values => {
        const row = body.insertRow();
        values.forEach(value => {
          const cell = row.insertCell();
          cell.textContent = value;
        });
      });
      wrapper.append(table);
      item.append(wrapper);
    }

    if (question.graph && Array.isArray(question.graph.data) && question.graph.data.length) {
      const figure = document.createElement('figure');
      figure.className = 'generated-graph';
      const caption = document.createElement('figcaption');
      caption.textContent = question.graph.title || t('download.graph');
      figure.append(caption);
      const values = question.graph.data.filter(point => Number.isFinite(Number(point.value))).slice(0, 12);
      const maximum = Math.max(1, ...values.map(point => Number(point.value)));
      const bars = document.createElement('ol');
      bars.className = 'generated-bars';
      bars.setAttribute('aria-label', `${question.graph.xLabel || 'Category'} compared by ${question.graph.yLabel || 'value'}`);
      values.forEach(point => {
        const row = document.createElement('li');
        const label = document.createElement('span');
        label.textContent = point.label;
        const track = document.createElement('span');
        track.className = 'generated-bar-track';
        const bar = document.createElement('span');
        bar.className = 'generated-bar';
        bar.style.width = `${Math.max(0, Number(point.value) / maximum * 100)}%`;
        track.append(bar);
        const value = document.createElement('strong');
        value.textContent = String(point.value);
        row.append(label, track, value);
        bars.append(row);
      });
      figure.append(bars);
      item.append(figure);
    }

    if (question.imagePrompt) {
      const imageNote = document.createElement('p');
      imageNote.className = 'generated-image-note';
      imageNote.textContent = `${t('download.visual')}: ${question.imagePrompt}`;
      item.append(imageNote);
    }

    const answerField = document.createElement('div');
    answerField.className = `answer-field${selectable || trueFalse ? ' answer-field--choice' : ''}`;
    const answerFieldLabel = document.createElement('span');
    answerFieldLabel.className = 'answer-field-label';
    answerFieldLabel.textContent = selectable || trueFalse ? t('answer.select') : t('answer.label');
    answerField.append(answerFieldLabel);

    if (selectable || trueFalse) {
      answerField.append(buildOptionGroup(question, trueFalse));
    } else {
      const answerInput = document.createElement('textarea');
      answerInput.className = 'answer-input';
      answerInput.rows = 2;
      answerInput.maxLength = 1500;
      answerInput.placeholder = answerPlaceholder(question.format);
      answerInput.dataset.questionNumber = String(question.number);
      answerInput.setAttribute('aria-label', t('answer.aria', { n: question.number }));
      answerInput.addEventListener('input', () => {
        autoGrowAnswer(answerInput);
        clearGradeFor(item);
        updateAnswerProgress();
      });
      answerInput.addEventListener('keydown', event => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          submitAnswersButton.click();
        }
      });
      answerField.append(answerInput);
      requestAnimationFrame(() => autoGrowAnswer(answerInput));
    }

    const feedback = document.createElement('div');
    feedback.className = 'answer-feedback';
    feedback.hidden = true;

    item.append(answerField, feedback);
    list.append(item);
  });
  updateAnswerProgress();
}

function answerPlaceholder(format) {
  const value = String(format || '').toLowerCase();
  const codes = ['multiple-choice', 'true-false', 'short-answer', 'fill-blanks', 'table', 'graph', 'image'];
  const keys = { 'multiple-choice': 'ph.mc', 'true-false': 'ph.tf', 'short-answer': 'ph.default', 'fill-blanks': 'ph.fill', table: 'ph.table', graph: 'ph.graph', image: 'ph.image' };
  const match = codes.find(code => t(`type.${code}`).toLowerCase() === value);
  if (match) return t(keys[match]);
  if (value.includes('multiple') || value.includes('choice')) return t('ph.mc');
  if (value.includes('true') || value.includes('false')) return t('ph.tf');
  if (value.includes('fill') || value.includes('blank')) return t('ph.fill');
  if (value.includes('table')) return t('ph.table');
  if (value.includes('graph')) return t('ph.graph');
  if (value.includes('image')) return t('ph.image');
  return t('ph.default');
}

function autoGrowAnswer(field) {
  field.style.height = 'auto';
  field.style.height = `${Math.max(64, Math.min(field.scrollHeight + 2, 260))}px`;
}

function answerFields() {
  return Array.from(planGroups.querySelectorAll('.answer-input'));
}

function updateAnswerProgress() {
  const answered = currentQuestions.filter(question => currentAnswer(question.number)).length;
  answerProgress.textContent = t('mark.progress', { answered, total: currentQuestions.length });
}

function showQuizStatus(message) {
  quizStatus.textContent = message;
  quizStatus.hidden = !message;
}

function resetScoreUi() {
  scorePanel.hidden = true;
  showQuizStatus('');
  submitAnswersButton.disabled = false;
  submitAnswersButton.classList.remove('is-loading');
  submitAnswersLabel.textContent = t('mark.submit');
}

function setChecking(isChecking) {
  submitAnswersButton.disabled = isChecking;
  submitAnswersButton.classList.toggle('is-loading', isChecking);
  submitAnswersLabel.textContent = isChecking ? t('mark.checking') : t('mark.submit');
}

function clearGradeFor(item) {
  item.classList.remove('is-correct', 'is-incorrect');
  const feedback = item.querySelector('.answer-feedback');
  if (feedback) {
    feedback.hidden = true;
    feedback.replaceChildren();
  }
  if (!scorePanel.hidden) {
    scorePanel.hidden = true;
    showQuizStatus(t('status.answersChanged'));
  }
}

function scoreMessage(percent) {
  if (percent >= 90) return t('score.note90');
  if (percent >= 75) return t('score.note75');
  if (percent >= 50) return t('score.note50');
  return t('score.note0');
}

function renderGrade(results, score) {
  const byNumber = new Map(results.map(result => [result.number, result]));
  planGroups.querySelectorAll('.generated-question').forEach(item => {
    const number = Number(item.dataset.questionNumber);
    const question = currentQuestions.find(candidate => candidate.number === number);
    const result = byNumber.get(number);
    const feedback = item.querySelector('.answer-feedback');
    if (!question || !result || !feedback) return;

    item.classList.toggle('is-correct', result.correct);
    item.classList.toggle('is-incorrect', !result.correct);

    const answerOptions = Array.from(item.querySelectorAll('.answer-option'));
    if (answerOptions.length) {
      const answerIndex = optionCorrectIndex(question);
      answerOptions.forEach(option => {
        const input = option.querySelector('input');
        option.classList.remove('is-answer', 'is-wrong');
        if (!input || answerIndex === null) return;
        if (Number(input.dataset.index) === answerIndex) option.classList.add('is-answer');
        else if (input.checked) option.classList.add('is-wrong');
      });
    }
    feedback.hidden = false;
    feedback.className = `answer-feedback ${result.correct ? 'is-correct' : 'is-incorrect'}`;
    feedback.replaceChildren();

    const verdict = document.createElement('p');
    verdict.className = 'answer-verdict';
    const icon = document.createElement('span');
    icon.className = 'answer-verdict-icon';
    icon.textContent = result.correct ? '✓' : '×';
    const verdictText = document.createElement('strong');
    verdictText.textContent = result.correct ? t('verdict.correct') : t('verdict.wrong');
    verdict.append(icon, verdictText);

    const feedbackText = document.createElement('p');
    feedbackText.textContent = result.feedback;

    const correctLine = document.createElement('p');
    correctLine.className = 'answer-correct-line';
    const correctLabel = document.createElement('strong');
    correctLabel.textContent = t('fb.correctAnswer');
    correctLine.append(correctLabel, document.createTextNode(question.answer));

    const whyLine = document.createElement('p');
    const whyLabel = document.createElement('strong');
    whyLabel.textContent = t('fb.why');
    whyLine.append(whyLabel, document.createTextNode(question.explanation));

    feedback.append(verdict, feedbackText, correctLine, whyLine);
  });

  scoreFraction.textContent = `${score.correct} / ${score.total}`;
  scorePercent.textContent = `${score.percent}%`;
  scoreNote.textContent = scoreMessage(score.percent);
  scorePanel.style.setProperty('--score', String(score.percent));
  scorePanel.hidden = false;
  showQuizStatus('');
  submitAnswersButton.disabled = false;
  submitAnswersButton.classList.remove('is-loading');
  submitAnswersLabel.textContent = t('mark.again');
  scorePanel.scrollIntoView({
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    block: 'center'
  });
}

async function submitCurrentAnswers() {
  if (!currentQuestions.length) return;
  if (!apiKey() && !serverKeyAvailable) {
    openKeyDialog(t('hint.title'));
    return;
  }
  const answers = selectedAnswers();
  if (!answers.some(item => item.answer)) {
    showQuizStatus(t('err.noAnswer'));
    firstAnswerControl()?.focus();
    return;
  }

  showQuizStatus('');
  setChecking(true);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch('/api/grade', {
      method: 'POST',
      headers: apiHeaders(),
      signal: controller.signal,
      body: JSON.stringify({
        language: window.AceI18n.apiLanguage(),
        testId: currentTestId,
        difficulty: currentDifficulty,
        day: localDay(),
        hour: new Date().getHours(),
        questions: currentQuestions.map(question => ({
          number: question.number,
          format: question.format,
          prompt: question.prompt,
          answer: question.answer,
          explanation: question.explanation,
          choices: question.choices || []
        })),
        answers
      })
    });

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      throw new Error(response.status === 404
        ? t('err.gradeEndpoint')
        : t('err.serverUnexpected', { code: response.status }));
    }
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (result.keyProblem) openKeyDialog(result.error);
      throw new Error(result.error || t('err.gradeFailed', { code: response.status }));
    }
    if (!Array.isArray(result.results) || result.results.length !== currentQuestions.length) {
      throw new Error(t('err.gradeIncomplete'));
    }

    const results = result.results.map(item => ({
      number: Number(item.number),
      correct: item.correct === true,
      feedback: typeof item.feedback === 'string' && item.feedback.trim()
        ? item.feedback.trim()
        : (item.correct === true ? t('verdict.correct') : t('fb.review'))
    }));
    const correct = results.filter(item => item.correct).length;
    const total = currentQuestions.length;
    const percent = Math.round(correct / total * 100);
    renderGrade(results, { correct, total, percent });
    setAiStatus(t('status.checked', { n: total }), 'is-online');
    window.dispatchEvent(new CustomEvent('aceminder:graded', {
      detail: {
        testId: currentTestId,
        correct,
        total,
        percent,
        difficulty: currentDifficulty,
        topic: currentMeta.topic,
        language: currentMeta.language,
        files: currentMeta.files,
        formats: currentMeta.formats,
        signedIn: result.signedIn === true,
        award: result.award || null,
        progress: result.progress || null
      }
    }));
  } catch (error) {
    const message = error instanceof Error && error.name === 'AbortError'
      ? t('err.gradeTimeout')
      : error instanceof Error
        ? error.message
        : t('err.gradeGeneric');
    showQuizStatus(message);
    submitAnswersLabel.textContent = t('mark.submit');
    setAiStatus(t('status.markingStopped'), 'is-error');
  } finally {
    clearTimeout(timeout);
  }
}

function localDay() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function resetQuiz() {
  answerFields().forEach(field => {
    field.value = '';
    autoGrowAnswer(field);
  });
  planGroups.querySelectorAll('.answer-option input:checked').forEach(input => {
    input.checked = false;
  });
  planGroups.querySelectorAll('.answer-option').forEach(option => {
    option.classList.remove('is-selected', 'is-answer', 'is-wrong');
  });
  planGroups.querySelectorAll('.generated-question').forEach(item => {
    item.classList.remove('is-correct', 'is-incorrect');
    const feedback = item.querySelector('.answer-feedback');
    if (feedback) {
      feedback.hidden = true;
      feedback.replaceChildren();
    }
  });
  resetScoreUi();
  updateAnswerProgress();
  firstAnswerControl()?.focus();
  setAiStatus(`${t('status.ready')}${lastModel ? ` · ${lastModel}` : ''}`, 'is-online');
}

function downloadGeneratedTest() {
  if (!currentQuestions.length) return;
  const topic = studyTopic.value.trim() || t('plan.title');
  const formatSummary = groups.map(group => `Q${group.start}–Q${group.end}: ${displayType(group)}`).join('; ');
  const lines = [
    t('download.title'),
    topic,
    t('plan.summary', { count: currentQuestions.length, difficulty: difficulty.options[difficulty.selectedIndex].textContent }),
    `${t('download.formats')}: ${formatSummary}`,
    ''
  ];
  if (selectedFiles.length) {
    lines.push(`${t('download.sourceFiles')}: ${selectedFiles.map(file => file.name).join(', ')}`, '');
  }
  currentQuestions.forEach(question => {
    lines.push(`${question.number}. [${question.format}] ${question.prompt}`);
    (question.choices || []).forEach((choice, index) => lines.push(`   ${String.fromCharCode(65 + index)}. ${choice}`));
    if (question.table) {
      lines.push(question.table.title || t('download.table'));
      lines.push(question.table.headers.join(' | '));
      question.table.rows.forEach(row => lines.push(row.join(' | ')));
    }
    if (question.graph) {
      lines.push(question.graph.title || t('download.graph'));
      question.graph.data.forEach(point => lines.push(`${point.label}: ${point.value}`));
    }
    if (question.imagePrompt) lines.push(`${t('download.visual')}: ${question.imagePrompt}`);
    lines.push(`${t('download.answer')}: ${question.answer}`, `${t('download.why')}: ${question.explanation}`, '');
  });
  const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  const slug = topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'practice-test';
  link.download = `aceminder-${slug}-${new Date().toISOString().slice(0, 10)}.txt`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function checkAiService() {
  if (window.location.protocol === 'file:') {
    setupHint.hidden = false;
    setAiStatus(t('status.fileProto'), 'is-offline');
    return;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch('/api/health', { cache: 'no-store', signal: controller.signal });
    const contentType = response.headers.get('content-type') || '';
    if (!response.ok || !contentType.includes('application/json')) {
      throw new Error(`Unexpected health response (HTTP ${response.status}).`);
    }
    healthStatus = await response.json();
    serverKeyAvailable = Boolean(healthStatus.aiConfigured);
    applyHealthStatus();
  } catch {
    healthStatus = null;
    setupHint.hidden = true;
    setAiStatus(t('status.offline'), 'is-offline');
  } finally {
    clearTimeout(timeout);
  }
}

function setGenerating(isGenerating) {
  window.dispatchEvent(new CustomEvent('aceminder:generating', { detail: { active: isGenerating } }));
  generateButton.disabled = isGenerating;
  generateButton.classList.toggle('is-loading', isGenerating);
  buttonLabel.textContent = isGenerating ? t('form.generating') : t('form.generate');
  if (isGenerating) {
    generatorForm.setAttribute('aria-busy', 'true');
  } else {
    generatorForm.removeAttribute('aria-busy');
  }
}

function showFormError(message) {
  formError.textContent = message;
  formError.hidden = false;
  formError.scrollIntoView({
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    block: 'center'
  });
}

function syncGroupsToCount(count) {
  while (groups.length > 1 && groups[groups.length - 1].start > count) groups.pop();
  const last = groups[groups.length - 1];
  if (last.start > count) last.start = count;
  if (last.end < last.start || last.end > count) last.end = count;
  if (last.end < count) last.end = count;
}

generatorForm.addEventListener('submit', async event => {
  event.preventDefault();
  formError.hidden = true;
  rangeError.hidden = true;

  if (!apiKey() && !serverKeyAvailable) {
    openKeyDialog(t('hint.title'));
    return;
  }

  const topic = studyTopic.value.trim();
  if (!topic) {
    showFormError(t('err.topic'));
    studyTopic.focus();
    return;
  }

  const count = Math.min(MAX_QUESTION_COUNT, Math.max(1, Math.floor(Number(questionCount.value) || 1)));
  questionCount.value = count;
  syncGroupsToCount(count);
  renderGroups();

  const problem = rangeProblem();
  if (problem) {
    rangeError.textContent = problem;
    rangeError.hidden = false;
    showFormError(problem);
    return;
  }

  setGenerating(true);
  planOutput.hidden = true;
  setAiStatus(selectedFiles.length ? t('status.reading') : t('status.asking'), 'is-busy');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const startedAt = Date.now();
  let waitTicker = 0;

  try {
    let files = [];
    if (selectedFiles.length) {
      files = await readAttachments();
      setAiStatus(t('status.writing'), 'is-busy');
    }
    /* Gemini can take a while when it is busy: show that work is still happening. */
    waitTicker = window.setInterval(() => {
      const seconds = Math.round((Date.now() - startedAt) / 1000);
      if (seconds >= 12) setAiStatus(t('status.wait', { s: seconds }), 'is-busy');
    }, 1000);

    const response = await fetch('/api/generate', {
      method: 'POST',
      headers: apiHeaders(),
      signal: controller.signal,
      body: JSON.stringify({
        topic,
        notes: studyNotes.value.trim(),
        questionCount: count,
        difficulty: difficulty.value,
        language: window.AceI18n.apiLanguage(),
        groups: groups.map(group => ({ start: group.start, end: group.end, type: displayType(group) })),
        files
      })
    });

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      throw new Error(response.status === 404
        ? t('err.endpoint')
        : t('err.serverUnexpected', { code: response.status }));
    }
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (result.keyProblem) openKeyDialog(result.error);
      if (result.setupRequired) setupHint.hidden = false;
      throw new Error(result.error || t('err.generateFailed', { code: response.status }));
    }
    if (!Array.isArray(result.questions) || result.questions.length !== count) {
      throw new Error(t('err.wrongCount'));
    }

    window.clearInterval(waitTicker);
    currentQuestions = result.questions;
    /* Signed-in players get a server test id, so their XP is checked on the server. */
    currentTestId = typeof result.testId === 'string'
      ? result.testId
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    currentDifficulty = difficulty.value;
    currentMeta = {
      topic,
      language: window.AceI18n.apiLanguage(),
      files: selectedFiles.length,
      formats: new Set(groups.map(group => displayType(group).toLowerCase())).size
    };
    lastModel = result.model || '';
    planTitle.textContent = t('plan.titleOf', { topic });
    planSummary.textContent = planSummaryText(count);
    renderQuestions(currentQuestions);
    planOutput.hidden = false;
    setAiStatus(`${t('status.ready')} · ${result.model || 'Gemini'}`, 'is-online');
    window.dispatchEvent(new CustomEvent('aceminder:generated', {
      detail: { testId: currentTestId, count, difficulty: currentDifficulty }
    }));
    planOutput.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'start'
    });
  } catch (error) {
    const message = error instanceof Error && error.name === 'AbortError'
      ? t('err.timeout')
      : error instanceof TypeError
        ? t('err.unreachable')
        : error instanceof Error
          ? error.message
          : t('err.generic');
    showFormError(message);
    setAiStatus(t('status.generationStopped'), 'is-error');
  } finally {
    clearTimeout(timeout);
    window.clearInterval(waitTicker);
    setGenerating(false);
  }
});

downloadPlan.addEventListener('click', downloadGeneratedTest);
submitAnswersButton.addEventListener('click', submitCurrentAnswers);
resetAnswersButton.addEventListener('click', resetQuiz);
generatorForm.addEventListener('input', event => {
  if (['study-topic', 'study-notes'].includes(event.target.id)) planOutput.hidden = true;
});
studyNotes.addEventListener('input', updateNotesCount);
difficulty.addEventListener('change', () => { planOutput.hidden = true; });

function planSummaryText(count) {
  const difficultyText = difficulty.options[difficulty.selectedIndex].textContent;
  let text = t('plan.summary', { count, difficulty: difficultyText });
  text += ` · ${t('plan.summaryGroups', { n: groups.length })}`;
  if (selectedFiles.length) text += ` · ${t('plan.summaryFiles', { n: selectedFiles.length })}`;
  return text;
}

window.addEventListener('aceminder:language', () => {
  renderGroups();
  updateNotesCount();
  updateFileStatus();
  updateKeyUi();
  keySaveButton.textContent = t('key.save');
  keyRevealButton.textContent = keyInput.type === 'text' ? t('key.hide') : t('key.show');
  if (currentQuestions.length) {
    const savedAnswers = currentQuestions.map(question => ({
      number: question.number,
      text: answerItem(question.number)?.querySelector('.answer-input')?.value || '',
      choice: currentChoiceIndex(question.number)
    }));
    const hadScore = !scorePanel.hidden;
    renderQuestions(currentQuestions);
    savedAnswers.forEach(saved => {
      const item = answerItem(saved.number);
      if (!item) return;
      const field = item.querySelector('.answer-input');
      if (field) {
        field.value = saved.text;
        autoGrowAnswer(field);
      }
      if (saved.choice !== null) {
        const option = item.querySelector(`.answer-option input[data-index="${saved.choice}"]`);
        if (option) {
          option.checked = true;
          option.closest('.answer-option')?.classList.add('is-selected');
        }
      }
    });
    updateAnswerProgress();
    planTitle.textContent = t('plan.titleOf', { topic: studyTopic.value.trim() || t('plan.title') });
    planSummary.textContent = planSummaryText(currentQuestions.length);
    submitAnswersLabel.textContent = hadScore ? t('mark.again') : t('mark.submit');
    if (hadScore) showQuizStatus(t('status.languageChanged'));
  }
  applyHealthStatus();
});

function updateScrollProgress() {
  const bar = document.querySelector('#scroll-progress');
  if (!bar) return;
  const doc = document.documentElement;
  const max = doc.scrollHeight - doc.clientHeight;
  const ratio = max > 0 ? Math.min(1, Math.max(0, doc.scrollTop / max)) : 0;
  bar.style.transform = `scaleX(${ratio})`;
}

document.addEventListener('scroll', updateScrollProgress, { passive: true });
window.addEventListener('resize', updateScrollProgress);
updateScrollProgress();

const revealTargets = document.querySelectorAll('[data-reveal]');
if (revealTargets.length) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) {
    revealTargets.forEach(element => element.classList.add('is-visible'));
  } else {
    document.documentElement.classList.add('reveal-on');
    const revealObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          revealObserver.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.05 });
    revealTargets.forEach(element => revealObserver.observe(element));
  }
}

renderGroups();
updateNotesCount();
showCookieBannerIfNeeded();
updateKeyUi();
checkAiService();
