'use strict';

/* Aceminder language layer: dictionaries, translation helper and the header switcher. */

(function () {
  const LANG_COOKIE = 'aceminder_lang';
  const LANG_STORAGE = 'aceminder.lang';
  const COOKIE_DAYS = 365;

  const LANGUAGES = [
    { code: 'en', label: 'English', native: 'English', api: 'English' },
    { code: 'uz', label: 'Uzbek', native: "O‘zbekcha", api: 'Uzbek' },
    { code: 'ru', label: 'Russian', native: 'Русский', api: 'Russian' },
    { code: 'es', label: 'Spanish', native: 'Español', api: 'Spanish' },
    { code: 'de', label: 'German', native: 'Deutsch', api: 'German' },
    { code: 'fr', label: 'French', native: 'Français', api: 'French' }
  ];

  /* SVG flags so they render identically on every OS (Windows has no flag emoji). */
  const FLAGS = {
    en: '<svg viewBox="0 0 20 14" aria-hidden="true"><rect width="20" height="14" fill="#012169"/><path d="M0 0 20 14M20 0 0 14" stroke="#fff" stroke-width="2.6"/><path d="M0 0 20 14M20 0 0 14" stroke="#C8102E" stroke-width="1.1"/><path d="M10 0v14M0 7h20" stroke="#fff" stroke-width="4.4"/><path d="M10 0v14M0 7h20" stroke="#C8102E" stroke-width="2.4"/></svg>',
    uz: '<svg viewBox="0 0 20 14" aria-hidden="true"><rect width="20" height="14" fill="#fff"/><rect width="20" height="4.6" fill="#0099B5"/><rect y="9.4" width="20" height="4.6" fill="#1EB53A"/><rect y="4.6" width="20" height="0.9" fill="#CE1126"/><rect y="8.5" width="20" height="0.9" fill="#CE1126"/><circle cx="4.7" cy="2.3" r="1.7" fill="#fff"/><circle cx="5.7" cy="2.3" r="1.7" fill="#0099B5"/></svg>',
    ru: '<svg viewBox="0 0 20 14" aria-hidden="true"><rect width="20" height="4.67" fill="#fff"/><rect y="4.67" width="20" height="4.67" fill="#0039A6"/><rect y="9.33" width="20" height="4.67" fill="#D52B1E"/></svg>',
    es: '<svg viewBox="0 0 20 14" aria-hidden="true"><rect width="20" height="14" fill="#AA151B"/><rect y="3.5" width="20" height="7" fill="#F1BF00"/></svg>',
    de: '<svg viewBox="0 0 20 14" aria-hidden="true"><rect width="20" height="4.67" fill="#000"/><rect y="4.67" width="20" height="4.67" fill="#DD0000"/><rect y="9.33" width="20" height="4.67" fill="#FFCE00"/></svg>',
    fr: '<svg viewBox="0 0 20 14" aria-hidden="true"><rect width="20" height="14" fill="#fff"/><rect width="6.67" height="14" fill="#0055A4"/><rect x="13.33" width="6.67" height="14" fill="#EF4135"/></svg>'
  };

  const DICT = {
    en: {
      'meta.title': 'Aceminder — Revision, your way',
      'meta.description': 'Aceminder turns a topic, your notes, or a PDF into a practice test in the formats and difficulty you choose.',

      'skip': 'Skip to content',
      'brand.home': 'Aceminder home',
      'nav.builder': 'Question builder',
      'nav.how': 'How it works',
      'nav.way': 'Your way',
      'nav.cta': 'Try the builder',
      'ui.language': 'Language',
      'key.add': 'Add Gemini key',
      'key.saved': 'Gemini key saved',

      'hero.eyebrow': 'AI study builder',
      'hero.titleA': 'Revision,',
      'hero.titleB': 'your way.',
      'hero.desc': 'Choose a topic, add your notes or a PDF, and get a practice test shaped around the formats and difficulty that work for you.',
      'hero.cta1': 'Build a practice test',
      'hero.cta2': 'See how it works',
      'hero.stat1': 'difficulty levels',
      'hero.stat2': 'question formats',
      'hero.stat3': '& image aware',
      'hero.note': 'Your own Gemini key · kept in this browser.',
      'hero.chip': 'AI draft ready in seconds',

      'prev.kicker': 'Practice test preview',
      'prev.concept': 'AI draft',
      'prev.topicLabel': 'Your topic',
      'prev.topic': 'Cell structure',
      'prev.topicSub': 'Biology · Chapter 4',
      'prev.source': 'Study material',
      'prev.sourceValue': 'Biology notes.pdf · pages 8–16',
      'prev.questions': 'Questions',
      'prev.questionsValue': '12 questions',
      'prev.difficulty': 'Difficulty',
      'prev.difficultyValue': 'Medium',
      'prev.style': 'Practice style',
      'prev.mc': 'Multiple choice',
      'prev.short': 'Short answer',
      'prev.sample': 'Sample question',
      'prev.samplePrompt': 'Which cell structure releases usable energy?',
      'prev.a': 'Nucleus',
      'prev.b': 'Mitochondrion',
      'prev.c': 'Cell membrane',
      'prev.d': 'Ribosome',
      'prev.footer': 'Illustrative example · no test generated yet',

      'builder.eyebrow': 'The question builder',
      'builder.title': 'Build a test around the way you learn.',
      'builder.intro': 'Pick what you are studying, attach the material if you have it, then choose how many questions you want and how each one should be asked.',
      'builder.meta': 'Topic, notes and attachments are sent to Gemini through this local server.',
      'status.checking': 'Checking the AI connection...',

      'hint.title': 'Add your Gemini API key to start',
      'hint.body': 'Every test you build runs on your own free Gemini quota, so there is no shared limit to queue behind. Paste your key once and Aceminder remembers it in this browser.',
      'hint.button': 'Add my Gemini key',
      'hint.link': 'Get a free key ↗',

      'form.material': 'Start with your material',
      'form.topic': 'Topic or subject',
      'form.topicPh': 'e.g. Cell structure',
      'form.notes': 'Notes or source text',
      'form.notesHint': 'Optional · add key facts to guide the test',
      'form.notesPh': 'Paste a passage, notes, or a few ideas to revise...',
      'form.notesCount': '{n} / 20,000 characters',
      'form.files': 'PDF or screenshot',
      'form.filesHint': 'Up to 4 files · PDFs to 500 MB · images to 1 GB · paste with Ctrl+V',
      'form.dropTitle': 'Drop a PDF or image here',
      'form.dropHint': 'click to browse, or paste a screenshot (Ctrl+V) · PDF, PNG, JPG, WebP, GIF',
      'form.noFiles': 'No files attached.',
      'form.fileCount': '{n} of {max} files attached · {size}',
      'form.count': 'Number of questions',
      'form.difficulty': 'Difficulty',
      'form.styles': 'Choose each question style',
      'form.legend': 'Assign formats to question ranges',
      'form.legendHint': 'Ranges must cover every question once. Add a range to mix formats within one test.',
      'form.rangeLabel': 'Question numbers',
      'form.from': 'From question',
      'form.through': 'Through question',
      'form.typeLabel': 'Question type',
      'form.customPh': 'e.g. Matching, label the diagram',
      'form.remove': 'Remove',
      'form.addType': 'Add a question type',
      'form.generate': 'Generate my questions',
      'form.generating': 'Building your test...',
      'form.attachNote': 'Attachments are read by Gemini for this request. Nothing is stored on the server.',

      'diff.tooeasy': 'Too easy',
      'diff.easy': 'Easy',
      'diff.easyMedium': 'Easy-Medium',
      'diff.medium': 'Medium',
      'diff.mediumHard': 'Medium-Hard',
      'diff.hard': 'Hard',
      'diff.toohard': 'Too Hard',

      'type.multiple-choice': 'Multiple choice',
      'type.true-false': 'True / false',
      'type.short-answer': 'Short answer',
      'type.fill-blanks': 'Fill in the blanks',
      'type.table': 'Table / comparison',
      'type.graph': 'Graph / data interpretation',
      'type.image': 'Image-based question',
      'type.custom': 'Custom type',

      'plan.eyebrow': 'Generated practice test',
      'plan.title': 'Your questions',
      'plan.titleOf': '{topic} practice test',
      'plan.download': 'Download test',
      'plan.summary': '{count} questions · {difficulty}',
      'plan.summary.one': '{count} question · {difficulty}',
      'plan.summaryGroups': '{n} format groups',
      'plan.summaryGroups.one': '{n} format group',
      'plan.summaryFiles': '{n} files',
      'plan.summaryFiles.one': '{n} file',
      'plan.note': 'Write your answers above, then submit to see your score. Correct answers and explanations appear after marking.',

      'mark.eyebrow': 'Mark your work',
      'mark.title': 'Answered everything? Check your score.',
      'mark.progress': '{answered} of {total} answered',
      'mark.submit': 'Submit answers',
      'mark.checking': 'Checking your answers...',
      'mark.again': 'Check my score again',
      'score.eyebrow': 'Your result',
      'score.word': 'score',
      'score.correct': 'correct',
      'score.retry': 'Clear answers & try again',
      'score.note90': 'Excellent. You have this topic well covered.',
      'score.note75': 'Strong work. Review the ones you missed and try again.',
      'score.note50': 'A solid start. Read the explanations, then retake the test.',
      'score.note0': 'Keep going. Review each explanation, then try the test again.',

      'how.eyebrow': 'A study flow with you in mind',
      'how.title': 'Your material. Your kind of practice.',
      'how.desc': 'From a class topic to a page of notes or a PDF, Aceminder turns what you have into a focused revision session.',
      'how.s1t': 'Start with what you are studying',
      'how.s1p': 'Type a topic, paste your notes, or attach a PDF or screenshot. Gemini reads the material when you generate.',
      'how.s2t': 'Set the shape of your test',
      'how.s2p': 'Choose how many questions you need, the difficulty, and a mix of formats that keeps the session interesting.',
      'how.s3t': 'Write, submit, review',
      'how.s3p': 'Write your answers under each question, submit once for a score by fraction and percentage, then review the explanations.',

      'way.eyebrow': 'A little more personal',
      'way.title': 'Revision should fit the learner.',
      'way.desc': 'Aceminder is built around the choices that make a study session feel useful, not one-size-fits-all.',
      'way.challenge': 'Choose a challenge',
      'way.format': 'Choose a format',
      'way.focus': 'Choose your focus',
      'way.note': 'From a quick check-in to a deeper review, the goal is simple: make your next study session feel more like yours.',
      'way.cta': 'Start building',
      'chip.tooeasy': 'Too easy',
      'chip.easy': 'Easy',
      'chip.easyMedium': 'Easy–Medium',
      'chip.medium': 'Medium',
      'chip.mediumHard': 'Medium–Hard',
      'chip.hard': 'Hard',
      'chip.toohard': 'Too hard',
      'chip.mc': 'Multiple choice',
      'chip.short': 'Short answer',
      'chip.truefalse': 'True / false',
      'chip.fill': 'Fill in the blanks',
      'chip.table': 'Table',
      'chip.graph': 'Graph',
      'chip.image': 'Image-based',
      'chip.custom': 'Custom',
      'chip.any': 'Any topic',
      'chip.notes': 'Your own notes',
      'chip.pdf': 'PDF or screenshot',
      'chip.formats': '8 question formats',

      'footer.rights': '© 2026 Aceminder',
      'footer.tag': 'Revision, your way.',

      'cookie.title': 'Cookies keep your key ready',
      'cookie.body': 'Aceminder stores your Gemini API key in a cookie on this device so your practice tests are ready every visit. The key is only ever sent to Gemini.',
      'cookie.accept': 'Accept cookies',
      'cookie.decline': 'Not now',

      'key.eyebrow': 'Two-minute setup',
      'key.title': 'Connect your Gemini API key',
      'key.intro': 'Aceminder asks Gemini to write and mark your questions. With your own key, every test runs on your own quota — no monthly ceiling and no waiting on anyone else.',
      'key.s1t': 'Open Google AI Studio',
      'key.s1p': 'Sign in with your Google account and choose Create API key.',
      'key.s2t': 'Copy the whole key',
      'key.s2p': 'It starts with AIza and is about 39 characters long. Copy all of it, with no spaces.',
      'key.s3t': 'Paste it here once',
      'key.s3p': 'Save it and Aceminder remembers it in this browser, so you never have to type it again on this device.',
      'key.field': 'Your Gemini API key',
      'key.show': 'Show',
      'key.hide': 'Hide',
      'key.remember': 'Remember my key in this browser (cookie)',
      'key.rememberOff': 'Cookies are off, so the key is kept only until you close this tab.',
      'key.save': 'Save & continue',
      'key.remove': 'Remove saved key',
      'key.privacy': "Your key stays in this browser and is sent only to this local server, which forwards it to Google's Gemini API. It is never written to a file or shared. Testing it uses no generation quota.",

      'q.number': 'Question {n}',
      'answer.label': 'Your answer',
      'answer.select': 'Select one option',
      'answer.true': 'True',
      'answer.false': 'False',
      'answer.aria': 'Your answer for question {n}',
      'ph.mc': 'Type the letter (A–D) or the correct choice...',
      'ph.tf': 'Type true or false...',
      'ph.fill': 'Write the missing word or words...',
      'ph.table': 'Write your table or comparison here...',
      'ph.graph': 'Describe the trend, comparison or value shown...',
      'ph.image': 'Write your answer about the visual...',
      'ph.default': 'Write your answer here...',
      'verdict.correct': 'Correct',
      'verdict.wrong': 'Not quite',
      'fb.correctAnswer': 'Correct answer. ',
      'fb.why': 'Why. ',
      'fb.review': 'Review the model answer for this question.',

      'status.offline': 'The local AI server is offline. Run python server.py in the Aceminder folder, then open the address it prints.',
      'status.fileProto': 'Open Aceminder through the local server: run python server.py, then open the address it prints.',
      'status.needKey': 'Add your own Gemini API key to start building tests.',
      'status.readyOwn': 'AI ready · your Gemini key',
      'status.readyServer': 'AI ready · this computer’s key',
      'status.ready': 'Your practice test is ready',
      'status.asking': 'Asking Gemini to build your test...',
      'status.reading': 'Reading your attachments...',
      'status.writing': 'Gemini is writing your questions...',
      'status.uploading': 'Uploading {name} · {percent}%',
      'status.generationStopped': 'Question generation stopped. See the message in the builder.',
      'status.markingStopped': 'Marking stopped. See the message in your test.',
      'status.checked': 'Answers checked · {n} marked',
      'status.cookiesOn': 'Cookies accepted · your Gemini key will be remembered on this device.',
      'status.answersChanged': 'Answers changed. Submit again to update your score.',
      'status.keyNotSaved': 'Your key was not saved. See the key panel for the message.',
      'status.languageChanged': 'Language changed. Submit again to see your score.',

      'err.topic': 'Add a topic or subject so the AI knows what to focus on.',
      'err.countRange': 'Choose a whole number from 1 to {max}.',
      'err.group': 'Group {i} must continue at question {n} and stay within your question count.',
      'err.custom': 'Write a custom question type for group {i}.',
      'err.missing': 'Add a question type for question {from} through {to}.',
      'err.addType': 'Increase the question count or shorten another range before adding a type.',
      'err.fileType': '{name} is not a PDF or supported image.',
      'err.fileEmpty': '{name} is empty.',
      'err.fileBig': '{name} is larger than {max} MB.',
      'err.pdfBig': '{name} is over {max} MB. Split it into smaller parts.',
      'err.uploadFailed': 'Could not upload {name} to Gemini (HTTP {code}).',
      'err.fileCount': 'You can attach up to {max} files.',
      'err.fileTotal': 'Attachments are limited to {size} in total.',
      'err.readFile': 'Could not read {name}.',
      'err.noAnswer': 'Write at least one answer before submitting.',
      'err.serverUnexpected': 'The server sent an unexpected response (HTTP {code}). Restart server.py and reload.',
      'err.endpoint': 'The AI endpoint was not found. Restart server.py and reload this page.',
      'err.generateFailed': 'Question generation failed (HTTP {code}).',
      'err.wrongCount': 'The AI returned the wrong number of questions. Try again.',
      'err.timeout': 'Question generation timed out. Try fewer questions or fewer attachments, then try again.',
      'err.unreachable': 'The local AI server could not be reached. Run python server.py and open the address it prints.',
      'err.generic': 'An unexpected error interrupted question generation. Please try again.',
      'err.gradeEndpoint': 'The marking endpoint was not found. Restart server.py and reload this page.',
      'err.gradeFailed': 'Could not check your answers (HTTP {code}).',
      'err.gradeIncomplete': 'The marking came back incomplete. Try again.',
      'err.gradeTimeout': 'Checking your answers timed out. Try again.',
      'err.gradeGeneric': 'Could not check your answers. Try again.',
      'err.keyRejected': 'Gemini rejected that key (HTTP {code}).',
      'err.keyServer': 'The local AI server could not be reached. Run python server.py and reload this page.',
      'err.keyEmpty': 'Paste your Gemini API key first.',
      'err.keyFormat': 'That does not look like a full Gemini key. It starts with AIza and is about 39 characters — copy it again from AI Studio.',
      'err.keyNotAccepted': 'Gemini did not accept that key (HTTP {code}).',
      'err.keyNotChecked': 'Could not check that key. Try again.',

      'key.savedOk': 'Key saved. You are ready to build a test.',
      'key.removed': 'Key removed from this browser.',
      'key.checking': 'Checking your key...',

      'unit.groups': 'format groups',
      'download.title': 'ACEMINDER PRACTICE TEST',
      'download.formats': 'Formats',
      'download.sourceFiles': 'Source files',
      'download.answer': 'Answer',
      'download.why': 'Why',
      'download.visual': 'Visual brief',
      'download.table': 'Table',
      'download.graph': 'Graph data'
    }
  };

  function readCookie(name) {
    const match = document.cookie.split('; ').find(row => row.startsWith(`${name}=`));
    if (!match) return '';
    try {
      return decodeURIComponent(match.slice(name.length + 1));
    } catch {
      return '';
    }
  }

  function readStorage(name) {
    try {
      return window.localStorage.getItem(name) || '';
    } catch {
      return '';
    }
  }

  function store(name, value) {
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${name}=${encodeURIComponent(value)}; max-age=${COOKIE_DAYS * 86400}; path=/; SameSite=Strict${secure}`;
    try {
      window.localStorage.setItem(name === LANG_COOKIE ? LANG_STORAGE : name, value);
    } catch {
      /* storage can be blocked; the choice still lasts for this page */
    }
  }

  function detectLanguage() {
    const saved = (readCookie(LANG_COOKIE) || readStorage(LANG_STORAGE)).trim().toLowerCase();
    if (DICT[saved]) return saved;
    const browser = (navigator.languages && navigator.languages[0]) || navigator.language || 'en';
    const short = browser.slice(0, 2).toLowerCase();
    return DICT[short] ? short : 'en';
  }

  let current = detectLanguage();

  function pluralForm(count) {
    if (current === 'ru') {
      const mod10 = count % 10;
      const mod100 = count % 100;
      if (mod10 === 1 && mod100 !== 11) return 'one';
      if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'few';
      return 'many';
    }
    return count === 1 ? 'one' : 'many';
  }

  function lookup(key) {
    const dict = DICT[current] || DICT.en;
    return dict[key] !== undefined ? dict[key] : DICT.en[key];
  }

  function t(key, vars) {
    let resolved = key;
    if (vars) {
      const dict = DICT[current] || DICT.en;
      const amount = typeof vars.count === 'number' ? vars.count : typeof vars.n === 'number' ? vars.n : null;
      if (amount !== null) {
        const formKey = `${key}.${pluralForm(amount)}`;
        if (dict[formKey] !== undefined) resolved = formKey;
      }
    }
    let value = lookup(resolved);
    if (value === undefined) return key;
    if (vars) {
      for (const name of Object.keys(vars)) {
        value = value.split(`{${name}}`).join(String(vars[name]));
      }
    }
    return value;
  }

  function language() {
    return LANGUAGES.find(item => item.code === current) || LANGUAGES[0];
  }

  function apply(root) {
    const scope = root || document;
    scope.querySelectorAll('[data-i18n]').forEach(node => {
      node.textContent = t(node.dataset.i18n);
    });
    scope.querySelectorAll('[data-i18n-ph]').forEach(node => {
      node.setAttribute('placeholder', t(node.dataset.i18nPh));
    });
    scope.querySelectorAll('[data-i18n-aria]').forEach(node => {
      node.setAttribute('aria-label', t(node.dataset.i18nAria));
    });
    scope.querySelectorAll('[data-i18n-title]').forEach(node => {
      node.setAttribute('title', t(node.dataset.i18nTitle));
    });
    document.documentElement.lang = current;
    document.title = t('meta.title');
    const description = document.querySelector('meta[name="description"]');
    if (description) description.setAttribute('content', t('meta.description'));
    renderSwitcher();
  }

  function renderSwitcher() {
    const label = document.querySelector('#lang-current');
    const flag = document.querySelector('#lang-current-flag');
    if (label) label.textContent = language().native;
    if (flag) flag.innerHTML = FLAGS[current] || '';
    document.querySelectorAll('[data-lang-code]').forEach(button => {
      const active = button.dataset.langCode === current;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-checked', active ? 'true' : 'false');
    });
  }

  function setLanguage(code) {
    if (!DICT[code] || code === current) {
      if (DICT[code]) closeMenu();
      return;
    }
    current = code;
    store(LANG_COOKIE, code);
    apply(document);
    closeMenu();
    window.dispatchEvent(new CustomEvent('aceminder:language', { detail: { code } }));
  }

  function closeMenu() {
    const menu = document.querySelector('#lang-menu');
    const button = document.querySelector('#lang-button');
    if (!menu) return;
    menu.hidden = true;
    if (button) button.setAttribute('aria-expanded', 'false');
  }

  function buildSwitcher() {
    const button = document.querySelector('#lang-button');
    const menu = document.querySelector('#lang-menu');
    if (!button || !menu) return;

    menu.replaceChildren();
    LANGUAGES.forEach(item => {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'lang-option';
      option.dataset.langCode = item.code;
      option.setAttribute('role', 'menuitemradio');
      option.setAttribute('aria-checked', item.code === current ? 'true' : 'false');
      const flag = document.createElement('span');
      flag.className = 'lang-flag';
      flag.setAttribute('aria-hidden', 'true');
      flag.innerHTML = FLAGS[item.code] || '';
      const names = document.createElement('span');
      names.className = 'lang-option-names';
      const native = document.createElement('strong');
      native.textContent = item.native;
      const english = document.createElement('small');
      english.textContent = item.label;
      names.append(native, english);
      const check = document.createElement('span');
      check.className = 'lang-option-check';
      check.setAttribute('aria-hidden', 'true');
      check.textContent = '✓';
      option.append(flag, names, check);
      option.addEventListener('click', () => setLanguage(item.code));
      menu.append(option);
    });

    button.addEventListener('click', event => {
      event.stopPropagation();
      const open = menu.hidden;
      menu.hidden = !open;
      button.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) menu.querySelector('.lang-option.is-active')?.focus();
    });

    menu.addEventListener('keydown', event => {
      const options = [...menu.querySelectorAll('.lang-option')];
      const index = options.indexOf(document.activeElement);
      if (event.key === 'Escape') {
        closeMenu();
        button.focus();
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        options[(index + 1) % options.length]?.focus();
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        options[(index - 1 + options.length) % options.length]?.focus();
      }
    });

    document.addEventListener('click', event => {
      if (!menu.hidden && !menu.contains(event.target) && event.target !== button) closeMenu();
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !menu.hidden) closeMenu();
    });
  }

  window.AceI18n = {
    languages: LANGUAGES,
    dicts: DICT,
    t,
    apply,
    setLanguage,
    language,
    apiLanguage: () => language().api,
    get lang() {
      return current;
    },
    difficultyKey(value) {
      const map = {
        'Too easy': 'diff.tooeasy',
        'Easy': 'diff.easy',
        'Easy-Medium': 'diff.easyMedium',
        'Medium': 'diff.medium',
        'Medium-Hard': 'diff.mediumHard',
        'Hard': 'diff.hard',
        'Too Hard': 'diff.toohard'
      };
      return map[value] || 'diff.medium';
    }
  };

  document.addEventListener('DOMContentLoaded', () => {
    /* The other dictionaries load after this file, so the saved or browser language
       can only be resolved once every script has run. */
    const detected = detectLanguage();
    const changed = detected !== current;
    current = detected;
    buildSwitcher();
    apply(document);
    if (changed) {
      window.dispatchEvent(new CustomEvent('aceminder:language', { detail: { code: current } }));
    }
  });
})();
