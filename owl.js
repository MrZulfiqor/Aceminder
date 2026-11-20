'use strict';

/* Ace the Owl: Aceminder's mascot, drawn in SVG so it can blink, look around, change mood,
   wear accessories, appear on every achievement and keep you company while you scroll. */

(function () {
  const tr = (key, vars) => window.AceI18n.t(key, vars);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const NAVY = '#13254a';
  const WING = '#0c1a38';
  const CREAM = '#f8ecc9';
  const FACE = '#fff8e6';
  const GOLD = '#f2b84b';
  const GOLD_DEEP = '#c98a1e';
  const INK = '#0b1324';

  /* ---------- Shared gradients (one hidden <svg> for the whole page) ---------- */

  function ensureDefs() {
    if (document.getElementById('ace-defs')) return;
    const holder = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    holder.id = 'ace-defs';
    holder.setAttribute('aria-hidden', 'true');
    holder.setAttribute('width', '0');
    holder.setAttribute('height', '0');
    holder.style.position = 'absolute';
    holder.innerHTML = `<defs>
      <linearGradient id="ace-body" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#22417c"/><stop offset="1" stop-color="#0f1e3d"/></linearGradient>
      <linearGradient id="ace-fire" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#dc2626"/><stop offset=".45" stop-color="#f97316"/><stop offset="1" stop-color="#fde047"/></linearGradient>
      <linearGradient id="ace-gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff1b8"/><stop offset=".5" stop-color="#f6c453"/><stop offset="1" stop-color="#c98a1e"/></linearGradient>
      <linearGradient id="tier-bronze" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffd2a8"/><stop offset=".5" stop-color="#d4884a"/><stop offset="1" stop-color="#8a4b1f"/></linearGradient>
      <linearGradient id="tier-silver" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".5" stop-color="#c2cede"/><stop offset="1" stop-color="#6b7a90"/></linearGradient>
      <linearGradient id="tier-gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff3b0"/><stop offset=".5" stop-color="#f6c453"/><stop offset="1" stop-color="#b7791f"/></linearGradient>
      <linearGradient id="tier-diamond" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#cffafe"/><stop offset=".35" stop-color="#67e8f9"/><stop offset=".7" stop-color="#a78bfa"/><stop offset="1" stop-color="#f0abfc"/></linearGradient>
      <linearGradient id="tier-locked" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4b5575"/><stop offset="1" stop-color="#252c45"/></linearGradient>
      <radialGradient id="medal-inner" cx=".5" cy=".35" r=".75"><stop offset="0" stop-color="#26346b"/><stop offset="1" stop-color="#0a1028"/></radialGradient>
      <radialGradient id="ace-glow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fde68a" stop-opacity=".9"/><stop offset="1" stop-color="#fde68a" stop-opacity="0"/></radialGradient>
    </defs>`;
    document.body.prepend(holder);
  }

  /* ---------- Ace's body, face and moods ---------- */

  const EYES = {
    normal: `<g class="owl-pupils"><circle cx="44" cy="49" r="9" fill="${INK}"/><circle cx="76" cy="49" r="9" fill="${INK}"/><circle cx="47.5" cy="45.5" r="3.2" fill="#fff"/><circle cx="79.5" cy="45.5" r="3.2" fill="#fff"/></g>`,
    wow: `<g class="owl-pupils"><circle cx="44" cy="49" r="11.5" fill="${INK}"/><circle cx="76" cy="49" r="11.5" fill="${INK}"/><circle cx="48" cy="44.5" r="4" fill="#fff"/><circle cx="80" cy="44.5" r="4" fill="#fff"/><circle cx="41" cy="53" r="1.6" fill="#fff"/><circle cx="73" cy="53" r="1.6" fill="#fff"/></g>`,
    happy: `<path d="M34 53 Q44 40 54 53 M66 53 Q76 40 86 53" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>`,
    sleep: `<path d="M34 49 Q44 57 54 49 M66 49 Q76 57 86 49" fill="none" stroke="${INK}" stroke-width="4.5" stroke-linecap="round"/>`,
    wink: `<path d="M34 53 Q44 40 54 53" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round"/><g class="owl-pupils"><circle cx="76" cy="49" r="9" fill="${INK}"/><circle cx="79.5" cy="45.5" r="3.2" fill="#fff"/></g>`,
    sad: `<g class="owl-pupils"><circle cx="44" cy="52" r="8" fill="${INK}"/><circle cx="76" cy="52" r="8" fill="${INK}"/><circle cx="47" cy="49" r="2.6" fill="#fff"/><circle cx="79" cy="49" r="2.6" fill="#fff"/></g><path d="M30 36 L52 42 M90 36 L68 42" stroke="${GOLD_DEEP}" stroke-width="3" stroke-linecap="round"/>`
  };

  const ACCESSORIES = {
    cap: { front: `<path d="M60 4 L100 19 L60 34 L20 19 Z" fill="${INK}"/><path d="M38 25 v10 c0 7 44 7 44 0 v-10 L60 33 Z" fill="#1d2b52"/><path d="M100 19 v17" stroke="${GOLD}" stroke-width="2.5"/><circle cx="100" cy="38" r="4" fill="${GOLD}"/>` },
    crown: { front: `<path d="M36 24 L40 2 L51 15 L60 -2 L69 15 L80 2 L84 24 Z" fill="url(#ace-gold)" stroke="${GOLD_DEEP}" stroke-width="2" stroke-linejoin="round"/><circle cx="60" cy="13" r="3.5" fill="#f472b6"/><circle cx="44" cy="17" r="2.4" fill="#67e8f9"/><circle cx="76" cy="17" r="2.4" fill="#67e8f9"/>` },
    cool: { front: `<rect x="25" y="39" width="31" height="19" rx="8" fill="${INK}"/><rect x="64" y="39" width="31" height="19" rx="8" fill="${INK}"/><path d="M56 46 h8 M25 44 l-6 -3 M95 44 l6 -3" stroke="${INK}" stroke-width="4" stroke-linecap="round"/><path d="M30 44 h9 M69 44 h9" stroke="#fff" stroke-width="2.5" stroke-linecap="round" opacity=".55"/>` },
    nerd: { front: `<circle cx="44" cy="49" r="16" fill="none" stroke="${GOLD_DEEP}" stroke-width="3"/><circle cx="76" cy="49" r="16" fill="none" stroke="${GOLD_DEEP}" stroke-width="3"/><path d="M60 47 h0" stroke="${GOLD_DEEP}" stroke-width="3"/>` },
    wizard: { front: `<path d="M30 26 L64 -22 L88 26 Z" fill="#6d4aff"/><path d="M24 26 h72" stroke="#5b3bd6" stroke-width="7" stroke-linecap="round"/><path d="M60 -2 l2.5 5 5.5 .8 -4 3.9 1 5.5 -5 -2.6 -5 2.6 1 -5.5 -4 -3.9 5.5 -.8z" fill="#fde68a"/><circle cx="72" cy="10" r="2" fill="#fde68a"/><circle cx="50" cy="16" r="1.6" fill="#fde68a"/>` },
    party: { front: `<path d="M46 24 L62 -16 L78 24 Z" fill="#f472b6"/><path d="M52 10 L72 14 M56 0 L68 3" stroke="#fde68a" stroke-width="3"/><circle cx="62" cy="-17" r="5" fill="#fde68a"/>` },
    heart: { front: `<path d="M60 108 C38 93 42 76 53 78 C57 79 60 84 60 84 C60 84 63 79 67 78 C78 76 82 93 60 108Z" fill="#fb7185" stroke="#be123c" stroke-width="2"/>` },
    book: { front: `<path d="M34 86 L60 92 L86 86 L86 108 L60 114 L34 108 Z" fill="#8b5cf6"/><path d="M60 92 V114" stroke="#4c1d95" stroke-width="2.5"/><path d="M39 91 l17 4 M39 97 l17 4 M39 103 l17 4 M64 95 l17 -4 M64 101 l17 -4" stroke="#ede9fe" stroke-width="1.8"/>` },
    stack: { front: `<rect x="22" y="104" width="76" height="9" rx="2" fill="#38bdf8"/><rect x="28" y="112" width="68" height="9" rx="2" fill="#f472b6"/><rect x="18" y="120" width="80" height="9" rx="2" fill="#fbbf24"/><path d="M26 108 h64 M32 116 h56 M22 124 h70" stroke="#fff" stroke-width="1.4" opacity=".6"/>` },
    moon: { back: `<circle cx="96" cy="16" r="22" fill="url(#ace-glow)"/><path d="M98 0 a16 16 0 1 0 14 24 a12 12 0 1 1 -14 -24z" fill="#fde68a"/><path d="M14 10 l1.5 3 3 1.5 -3 1.5 -1.5 3 -1.5 -3 -3 -1.5 3 -1.5z M24 34 l1 2 2 1 -2 1 -1 2 -1 -2 -2 -1 2 -1z M106 46 l1 2 2 1 -2 1 -1 2 -1 -2 -2 -1 2 -1z" fill="#fef9c3"/>` },
    sun: { back: `<g stroke="#fbbf24" stroke-width="3.5" stroke-linecap="round"><path d="M104 -2 v-6 M104 34 v6 M86 16 h-6 M122 16 h6 M91 3 l-4 -4 M117 3 l4 -4 M91 29 l-4 4 M117 29 l4 4"/></g><circle cx="104" cy="16" r="12" fill="#fbbf24"/>`, front: `<rect x="48" y="88" width="22" height="20" rx="4" fill="#fff"/><path d="M70 92 h4 a5 5 0 0 1 0 10 h-4" stroke="#fff" stroke-width="3.5" fill="none"/><rect x="48" y="88" width="22" height="5" fill="#a16207"/><path d="M54 84 q3 -4 0 -8 M63 84 q3 -4 0 -8" stroke="#e2e8f0" stroke-width="2.2" fill="none" stroke-linecap="round"/>` },
    sparkle: { back: `<path d="M100 8 l4 10 10 4 -10 4 -4 10 -4 -10 -10 -4 10 -4z" fill="#a5f3fc"/><path d="M16 22 l3 7 7 3 -7 3 -3 7 -3 -7 -7 -3 7 -3z" fill="#f0abfc"/><path d="M106 62 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2z" fill="#fde68a"/>` },
    lightning: { back: `<path d="M100 -6 L84 30 H97 L88 62 L116 18 H102 L111 -6 Z" fill="#facc15" stroke="#a16207" stroke-width="2" stroke-linejoin="round"/><path d="M14 30 L6 48 H13 L8 64 L22 40 H15 L20 30 Z" fill="#facc15" stroke="#a16207" stroke-width="1.6" stroke-linejoin="round"/>` },
    flame: { back: `<path d="M60 124 C14 124 4 82 22 54 C26 70 36 74 36 74 C32 48 44 24 62 4 C62 28 78 36 82 54 C86 46 88 38 86 28 C110 54 108 124 60 124Z" fill="url(#ace-fire)"/>` },
    phoenix: { back: `<path d="M60 124 C14 124 4 82 22 54 C26 70 36 74 36 74 C32 48 44 24 62 4 C62 28 78 36 82 54 C86 46 88 38 86 28 C110 54 108 124 60 124Z" fill="url(#ace-fire)"/><path d="M22 70 C-6 60 -10 30 -4 14 C6 34 16 40 28 44 Z M98 70 C126 60 130 30 124 14 C114 34 104 40 92 44 Z" fill="url(#ace-fire)"/>`, front: `<path d="M36 24 L40 2 L51 15 L60 -2 L69 15 L80 2 L84 24 Z" fill="url(#ace-gold)" stroke="${GOLD_DEEP}" stroke-width="2" stroke-linejoin="round"/>` },
    rocket: { back: `<g transform="rotate(38 102 30)"><path d="M102 -4 c10 10 10 30 0 44 c-10 -14 -10 -34 0 -44z" fill="#e2e8f0"/><circle cx="102" cy="16" r="4.5" fill="#38bdf8" stroke="#0369a1" stroke-width="1.5"/><path d="M95 32 l-7 10 h9z M109 32 l7 10 h-9z" fill="#f472b6"/><path d="M98 42 q4 14 8 0" fill="#f59e0b"/></g><path d="M8 70 h16 M4 80 h18 M10 90 h12" stroke="#a5f3fc" stroke-width="3" stroke-linecap="round" opacity=".7"/>` },
    compass: { front: `<circle cx="60" cy="96" r="15" fill="#f8fafc" stroke="${GOLD}" stroke-width="3.5"/><path d="M60 84 l5 12 -5 12 -5 -12z" fill="#ef4444"/><path d="M60 96 l5 0 -5 12 -5 -12z" fill="#1e3a8a"/><circle cx="60" cy="96" r="2.4" fill="${INK}"/>` },
    scroll: { front: `<rect x="38" y="86" width="44" height="24" rx="3" fill="#fef3c7"/><rect x="33" y="84" width="8" height="28" rx="4" fill="#fcd34d"/><rect x="79" y="84" width="8" height="28" rx="4" fill="#fcd34d"/><path d="M45 92 h30 M45 98 h24 M45 104 h28" stroke="#b45309" stroke-width="2" stroke-linecap="round"/>` },
    rise: { back: `<path d="M100 66 L100 30 L90 30 L106 6 L122 30 L112 30 L112 66 Z" fill="#34d399" stroke="#047857" stroke-width="2" stroke-linejoin="round"/>` },
    hatch: { front: `<path d="M16 76 L27 66 L36 77 L46 64 L56 77 L66 64 L76 77 L86 64 L95 76 L104 70 C106 102 88 122 60 122 C32 122 14 102 16 76 Z" fill="#fff7e6" stroke="#e7cf9f" stroke-width="2.5" stroke-linejoin="round"/><circle cx="38" cy="98" r="4" fill="#fde68a"/><circle cx="78" cy="104" r="5" fill="#fde68a"/><circle cx="62" cy="112" r="3" fill="#fde68a"/><path d="M38 18 C42 2 78 2 82 18 L74 12 L67 19 L60 11 L53 19 L46 12 Z" fill="#fff7e6" stroke="#e7cf9f" stroke-width="2.5" stroke-linejoin="round" transform="rotate(-14 60 12)"/>` },
    trophy: { front: `<path d="M44 84 h32 v6 c0 12 -7 18 -16 18 c-9 0 -16 -6 -16 -18z" fill="url(#ace-gold)" stroke="${GOLD_DEEP}" stroke-width="2"/><path d="M56 108 h8 v6 h6 v5 h-20 v-5 h6z" fill="${GOLD_DEEP}"/>` },
    wave: { wave: true }
  };

  /* Owl variants used for avatars and artwork. */
  const VARIANTS = {
    classic: { mood: 'normal' },
    cap: { mood: 'happy', acc: ['cap'] },
    crown: { mood: 'happy', acc: ['crown'] },
    cool: { mood: 'normal', acc: ['cool'] },
    night: { mood: 'wow', acc: ['moon'] },
    wizard: { mood: 'wink', acc: ['wizard'] },
    party: { mood: 'happy', acc: ['party'] },
    heart: { mood: 'happy', acc: ['heart'], blush: true }
  };

  function owlMarkup(options = {}) {
    const mood = EYES[options.mood] ? options.mood : 'normal';
    const accessories = (options.acc || []).map(name => ACCESSORIES[name]).filter(Boolean);
    const blush = options.blush || mood === 'happy' || mood === 'wink';
    const back = accessories.map(item => item.back || '').join('');
    const front = accessories.map(item => item.front || '').join('');
    const lids = mood === 'normal' || mood === 'wow' || mood === 'sad'
      ? `<ellipse class="owl-lid" cx="44" cy="49" rx="18.5" ry="18.5" fill="${NAVY}"/><ellipse class="owl-lid" cx="76" cy="49" rx="18.5" ry="18.5" fill="${NAVY}"/>`
      : mood === 'wink'
        ? `<ellipse class="owl-lid" cx="76" cy="49" rx="18.5" ry="18.5" fill="${NAVY}"/>`
        : '';
    return `${back}
      <g class="owl-figure">
        <path d="M30 36 L22 8 L48 26 Z M90 36 L98 8 L72 26 Z" fill="${NAVY}"/>
        <path d="M27 24 L24 12 M93 24 L96 12" stroke="${GOLD}" stroke-width="2" stroke-linecap="round"/>
        <path class="owl-wing owl-wing-l" d="M26 56 C9 64 7 92 20 106 C27 98 31 80 31 62 Z" fill="${WING}"/>
        <path class="owl-wing owl-wing-r${options.wave ? ' owl-wave' : ''}" d="M94 56 C111 64 113 92 100 106 C93 98 89 80 89 62 Z" fill="${WING}"/>
        <path d="M60 18 C89 18 99 40 99 66 C99 95 83 113 60 113 C37 113 21 95 21 66 C21 40 31 18 60 18 Z" fill="url(#ace-body)"/>
        <path d="M60 64 C79 64 85 80 85 92 C85 105 75 111 60 111 C45 111 35 105 35 92 C35 80 41 64 60 64 Z" fill="${CREAM}"/>
        <path d="M49 81 q5 5 10 0 M61 81 q5 5 10 0 M43 91 q5 5 10 0 M55 91 q5 5 10 0 M67 91 q5 5 10 0 M49 101 q5 5 10 0 M61 101 q5 5 10 0" stroke="#dcae55" stroke-width="2" fill="none" stroke-linecap="round"/>
        <circle cx="44" cy="49" r="18" fill="${FACE}" stroke="${GOLD}" stroke-width="3"/>
        <circle cx="76" cy="49" r="18" fill="${FACE}" stroke="${GOLD}" stroke-width="3"/>
        <path d="M28 33 Q44 25 60 37 Q76 25 92 33" fill="none" stroke="${GOLD}" stroke-width="3" stroke-linecap="round"/>
        <g class="owl-eyes">${EYES[mood]}${lids}</g>
        ${blush ? `<ellipse cx="29" cy="64" rx="5.5" ry="3.2" fill="#fb7185" opacity=".5"/><ellipse cx="91" cy="64" rx="5.5" ry="3.2" fill="#fb7185" opacity=".5"/>` : ''}
        <path d="M53 59 L67 59 L60 72 Z" fill="${GOLD}" stroke="${GOLD_DEEP}" stroke-width="1.6" stroke-linejoin="round"/>
        <path d="M47 112 l-4 6 M52 112 v7 M57 112 l4 6 M63 112 l-4 6 M68 112 v7 M73 112 l4 6" stroke="${GOLD}" stroke-width="3.2" stroke-linecap="round"/>
        ${front}
      </g>`;
  }

  /* Returns a full <svg> string for Ace. options: mood, acc[], live, wave, className, title */
  function owlSvg(options = {}) {
    const classes = ['ace-owl', options.live ? 'owl-live' : '', options.className || ''].filter(Boolean).join(' ');
    const label = options.title ? `role="img" aria-label="${options.title}"` : 'aria-hidden="true"';
    return `<svg class="${classes}" viewBox="-8 -24 136 150" ${label}>${owlMarkup(options)}</svg>`;
  }

  function variantSvg(name, options = {}) {
    const variant = VARIANTS[name] || VARIANTS.classic;
    return owlSvg(Object.assign({}, variant, options));
  }

  /* ---------- Achievement artwork ---------- */

  const OWL_ART = {
    'owl-hatch': { mood: 'happy', acc: ['hatch'] },
    'owl-book': { mood: 'normal', acc: ['nerd', 'book'] },
    'owl-stack': { mood: 'happy', acc: ['stack'] },
    'owl-cap': { mood: 'happy', acc: ['cap'] },
    'owl-sparkle': { mood: 'wow', acc: ['sparkle'] },
    'owl-crown': { mood: 'happy', acc: ['crown', 'sparkle'] },
    'owl-lightning': { mood: 'wow', acc: ['lightning', 'cool'] },
    'owl-flame': { mood: 'happy', acc: ['flame'] },
    phoenix: { mood: 'wow', acc: ['phoenix'] },
    'owl-rocket': { mood: 'wow', acc: ['rocket', 'cool'] },
    'owl-compass': { mood: 'normal', acc: ['compass'] },
    'owl-moon': { mood: 'wow', acc: ['moon'] },
    'owl-sun': { mood: 'sleep', acc: ['sun'] },
    'owl-scroll': { mood: 'normal', acc: ['nerd', 'scroll'] },
    'owl-rise': { mood: 'happy', acc: ['rise'] }
  };

  const ICON_ART = {
    target: `<circle cx="60" cy="62" r="44" fill="#fff"/><circle cx="60" cy="62" r="34" fill="#ef4444"/><circle cx="60" cy="62" r="24" fill="#fff"/><circle cx="60" cy="62" r="14" fill="#ef4444"/><circle cx="60" cy="62" r="5" fill="#fff"/><path d="M60 62 L104 18" stroke="${INK}" stroke-width="5" stroke-linecap="round"/><path d="M104 18 l-2 -14 12 4 z M104 18 l14 -2 -4 12 z" fill="${GOLD}"/>`,
    hundred: `<text x="60" y="78" text-anchor="middle" font-family="Bricolage Grotesque, Inter, sans-serif" font-weight="800" font-size="50" fill="url(#ace-gold)" stroke="${GOLD_DEEP}" stroke-width="1.5">100</text><path d="M18 90 h84" stroke="#ef4444" stroke-width="6" stroke-linecap="round"/><path d="M24 100 h72" stroke="#ef4444" stroke-width="4" stroke-linecap="round" opacity=".7"/>`,
    chest: `<circle cx="40" cy="34" r="9" fill="url(#ace-gold)"/><circle cx="62" cy="26" r="10" fill="url(#ace-gold)"/><circle cx="82" cy="36" r="8" fill="url(#ace-gold)"/><path d="M18 52 C18 34 102 34 102 52 V60 H18 Z" fill="#92400e"/><rect x="18" y="58" width="84" height="44" rx="5" fill="#b45309"/><path d="M18 70 h84 M40 58 v44 M80 58 v44" stroke="${GOLD}" stroke-width="5"/><rect x="52" y="62" width="16" height="18" rx="3" fill="${GOLD}"/><circle cx="60" cy="71" r="3" fill="${INK}"/>`,
    shield: `<path d="M60 8 L102 22 V56 C102 84 84 104 60 114 C36 104 18 84 18 56 V22 Z" fill="#2563eb" stroke="#bfdbfe" stroke-width="4"/><path d="M60 22 L90 32 V56 C90 76 78 90 60 98 Z" fill="#1e40af"/><path d="M60 38 l7 14 15 2 -11 10 3 15 -14 -8 -14 8 3 -15 -11 -10 15 -2z" fill="${GOLD}" stroke="${GOLD_DEEP}" stroke-width="1.5"/>`,
    flame: `<path d="M60 116 C26 116 18 86 30 62 C34 74 42 78 42 78 C38 54 48 30 64 10 C64 34 80 42 84 58 C88 50 90 42 88 32 C108 58 104 116 60 116Z" fill="url(#ace-fire)"/><path d="M60 116 C44 116 40 102 46 90 C50 98 54 98 54 98 C52 86 58 74 64 66 C66 80 76 84 76 96 C76 108 70 116 60 116Z" fill="#fde047"/>`,
    star: `<path d="M60 6 L75 42 L114 45 L84 70 L94 108 L60 87 L26 108 L36 70 L6 45 L45 42 Z" fill="url(#ace-gold)" stroke="${GOLD_DEEP}" stroke-width="3" stroke-linejoin="round"/><path d="M48 50 l6 6 M66 50 l6 6" stroke="${INK}" stroke-width="4" stroke-linecap="round"/><path d="M50 70 q10 8 20 0" stroke="${INK}" stroke-width="4" fill="none" stroke-linecap="round"/>`,
    trophy: `<path d="M34 14 h52 v22 c0 24 -12 38 -26 38 c-14 0 -26 -14 -26 -38z" fill="url(#ace-gold)" stroke="${GOLD_DEEP}" stroke-width="3"/><path d="M34 22 h-14 c0 18 8 26 18 28 M86 22 h14 c0 18 -8 26 -18 28" fill="none" stroke="${GOLD_DEEP}" stroke-width="5"/><path d="M52 74 h16 v14 h-16z" fill="${GOLD_DEEP}"/><rect x="34" y="88" width="52" height="16" rx="4" fill="#7c2d12"/><rect x="44" y="92" width="32" height="7" rx="2" fill="${GOLD}"/><path d="M60 28 l4 8 9 1 -7 6 2 9 -8 -5 -8 5 2 -9 -7 -6 9 -1z" fill="#fff7d6"/>`,
    globe: `<circle cx="60" cy="60" r="48" fill="#0ea5e9"/><path d="M30 34 c10 4 14 14 8 20 c-6 6 2 14 10 12 c8 -2 10 8 4 14 M76 20 c-6 8 2 14 10 12 c8 -2 14 6 8 14 M70 78 c8 -4 18 2 16 12" fill="#22c55e" stroke="#15803d" stroke-width="2"/><ellipse cx="60" cy="60" rx="20" ry="48" fill="none" stroke="#e0f2fe" stroke-width="2" opacity=".6"/><path d="M12 60 h96 M18 36 h84 M18 84 h84" stroke="#e0f2fe" stroke-width="2" opacity=".6"/>`,
    stopwatch: `<rect x="52" y="4" width="16" height="10" rx="3" fill="${GOLD_DEEP}"/><path d="M90 24 l8 -8" stroke="${GOLD_DEEP}" stroke-width="6" stroke-linecap="round"/><circle cx="60" cy="64" r="46" fill="#f8fafc" stroke="url(#ace-gold)" stroke-width="8"/><path d="M60 64 L60 30" stroke="${INK}" stroke-width="5" stroke-linecap="round"/><path d="M60 64 L84 76" stroke="#ef4444" stroke-width="4" stroke-linecap="round"/><circle cx="60" cy="64" r="5" fill="${INK}"/><path d="M60 24 v6 M100 64 h-6 M60 104 v-6 M20 64 h6" stroke="${INK}" stroke-width="3"/>`,
    calendar: `<rect x="14" y="20" width="92" height="86" rx="10" fill="#f8fafc"/><rect x="14" y="20" width="92" height="24" rx="10" fill="#ef4444"/><rect x="14" y="34" width="92" height="10" fill="#ef4444"/><path d="M36 12 v18 M84 12 v18" stroke="${INK}" stroke-width="6" stroke-linecap="round"/><g fill="#cbd5e1"><rect x="24" y="54" width="14" height="12" rx="2"/><rect x="42" y="54" width="14" height="12" rx="2"/><rect x="60" y="54" width="14" height="12" rx="2"/><rect x="24" y="74" width="14" height="12" rx="2"/><rect x="42" y="74" width="14" height="12" rx="2"/><rect x="60" y="74" width="14" height="12" rx="2"/></g><rect x="78" y="54" width="20" height="32" rx="3" fill="url(#ace-gold)"/><path d="M83 70 l4 4 8 -9" stroke="${INK}" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
    speech: `<path d="M10 18 h62 a8 8 0 0 1 8 8 v32 a8 8 0 0 1 -8 8 h-38 l-14 14 v-14 h-10 a8 8 0 0 1 -8 -8 v-32 a8 8 0 0 1 8 -8z" fill="#a78bfa"/><text x="41" y="53" text-anchor="middle" font-family="Bricolage Grotesque, Inter, sans-serif" font-weight="800" font-size="26" fill="#fff">Aa</text><path d="M110 50 h-54 a8 8 0 0 0 -8 8 v30 a8 8 0 0 0 8 8 h34 l14 14 v-14 h6 a8 8 0 0 0 8 -8 v-30 a8 8 0 0 0 -8 -8z" fill="#22d3ee"/><text x="83" y="84" text-anchor="middle" font-family="Bricolage Grotesque, Inter, sans-serif" font-weight="800" font-size="26" fill="${INK}">Яё</text>`,
    brain: `<path d="M58 14 C44 6 26 14 26 30 C12 34 10 52 18 60 C8 70 14 90 30 92 C34 106 52 110 58 100 Z" fill="#f9a8d4" stroke="#be185d" stroke-width="3"/><path d="M62 14 C76 6 94 14 94 30 C108 34 110 52 102 60 C112 70 106 90 90 92 C86 106 68 110 62 100 Z" fill="#f9a8d4" stroke="#be185d" stroke-width="3"/><path d="M30 40 c8 0 10 8 18 6 M24 66 c10 -4 16 4 24 0 M36 84 c6 -6 14 -2 18 -6 M90 40 c-8 0 -10 8 -18 6 M96 66 c-10 -4 -16 4 -24 0 M84 84 c-6 -6 -14 -2 -18 -6" stroke="#be185d" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M98 8 l3 7 7 3 -7 3 -3 7 -3 -7 -7 -3 7 -3z" fill="#fde68a"/>`,
    palette: `<path d="M60 10 C28 10 8 32 8 60 C8 88 30 110 58 110 C70 110 72 100 66 92 C60 84 66 76 76 76 H90 C104 76 112 66 112 54 C112 28 88 10 60 10Z" fill="#fcd9a8" stroke="#b45309" stroke-width="3"/><circle cx="34" cy="48" r="9" fill="#ef4444"/><circle cx="54" cy="30" r="9" fill="#f59e0b"/><circle cx="80" cy="32" r="9" fill="#22c55e"/><circle cx="94" cy="54" r="8" fill="#3b82f6"/><circle cx="32" cy="76" r="9" fill="#a855f7"/><circle cx="52" cy="92" r="5" fill="#fff" stroke="#b45309" stroke-width="2"/>`
  };

  function artMarkup(art) {
    if (OWL_ART[art]) return owlMarkup(OWL_ART[art]);
    return ICON_ART[art] || ICON_ART.star;
  }

  let edgeCache = '';
  function medalEdge() {
    if (edgeCache) return edgeCache;
    const points = [];
    for (let i = 0; i < 48; i += 1) {
      const angle = (Math.PI * 2 * i) / 48 - Math.PI / 2;
      const radius = i % 2 === 0 ? 49 : 45.5;
      points.push(`${(50 + radius * Math.cos(angle)).toFixed(2)},${(50 + radius * Math.sin(angle)).toFixed(2)}`);
    }
    edgeCache = `M${points.join('L')}Z`;
    return edgeCache;
  }

  /* A round medallion: tier-coloured scalloped edge, dark centre, artwork, shine. */
  function medalSvg(art, tier, unlocked, options = {}) {
    const fill = unlocked ? `url(#tier-${tier})` : 'url(#tier-locked)';
    const isOwl = Boolean(OWL_ART[art]);
    const transform = isOwl
      ? 'translate(50 51) scale(.39) translate(-60 -50)'
      : 'translate(50 51) scale(.46) translate(-60 -60)';
    const lock = unlocked ? '' : `<g class="medal-lock"><circle cx="76" cy="78" r="12" fill="#0b1126" stroke="#4b5575" stroke-width="2"/><rect x="70" y="77" width="12" height="9" rx="2" fill="#94a3b8"/><path d="M72.5 77 v-3 a3.5 3.5 0 0 1 7 0 v3" stroke="#94a3b8" stroke-width="2.2" fill="none"/></g>`;
    return `<svg class="medal medal--${tier}${unlocked ? ' is-unlocked' : ' is-locked'} ${options.className || ''}" viewBox="0 0 100 100" aria-hidden="true">
      <path d="${medalEdge()}" fill="${fill}"/>
      <circle cx="50" cy="50" r="40" fill="url(#medal-inner)" stroke="rgba(0,0,0,.45)" stroke-width="1.5"/>
      <circle cx="50" cy="50" r="36.5" fill="none" stroke="${unlocked ? `url(#tier-${tier})` : '#3a4360'}" stroke-width="1.2" stroke-dasharray="2 2.6" opacity=".9"/>
      <clipPath id="medal-clip-${art}-${unlocked ? 1 : 0}"><circle cx="50" cy="50" r="39"/></clipPath>
      <g clip-path="url(#medal-clip-${art}-${unlocked ? 1 : 0})"><g class="medal-art" transform="${transform}">${artMarkup(art)}</g></g>
      <path d="M18 38 A34 34 0 0 1 62 14" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" opacity=".22"/>
      ${lock}
    </svg>`;
  }

  /* ---------- Avatars (photo, owl or emoji) ---------- */

  function renderAvatar(node, who) {
    if (!node) return;
    node.replaceChildren();
    node.classList.remove('is-photo', 'is-owl', 'is-emoji');
    const avatar = who && who.avatar ? who.avatar : '';
    if (who && who.avatarUrl) {
      const img = document.createElement('img');
      img.src = who.avatarUrl;
      img.alt = '';
      img.decoding = 'async';
      img.loading = 'lazy';
      node.append(img);
      node.classList.add('is-photo');
    } else if (avatar.startsWith('owl:')) {
      node.innerHTML = variantSvg(avatar.slice(4));
      node.classList.add('is-owl');
    } else {
      node.textContent = avatar || '👤';
      node.classList.add('is-emoji');
    }
  }

  /* ---------- Live owls: eyes follow the pointer, random blinks ---------- */

  let pointer = null;
  let lookFrame = 0;

  function lookAt() {
    lookFrame = 0;
    document.querySelectorAll('.owl-live').forEach(svg => {
      const pupils = svg.querySelectorAll('.owl-pupils');
      if (!pupils.length) return;
      const box = svg.getBoundingClientRect();
      if (!box.width || box.bottom < 0 || box.top > window.innerHeight) return;
      let dx = 0;
      let dy = 0;
      if (pointer) {
        const cx = box.left + box.width / 2;
        const cy = box.top + box.height * 0.42;
        const angle = Math.atan2(pointer.y - cy, pointer.x - cx);
        const distance = Math.min(1, Math.hypot(pointer.x - cx, pointer.y - cy) / 240);
        dx = Math.cos(angle) * 4.5 * distance;
        dy = Math.sin(angle) * 4 * distance;
      }
      pupils.forEach(group => group.setAttribute('transform', `translate(${dx.toFixed(2)} ${dy.toFixed(2)})`));
    });
  }

  if (!reducedMotion) {
    window.addEventListener('pointermove', event => {
      if (event.pointerType !== 'mouse') return;
      pointer = { x: event.clientX, y: event.clientY };
      if (!lookFrame) lookFrame = requestAnimationFrame(lookAt);
    }, { passive: true });
    document.addEventListener('mouseleave', () => {
      pointer = null;
      if (!lookFrame) lookFrame = requestAnimationFrame(lookAt);
    });
  }

  function blinkSoon() {
    if (reducedMotion) return;
    window.setTimeout(() => {
      document.querySelectorAll('.owl-live').forEach(svg => {
        if (Math.random() < 0.75) {
          svg.classList.add('is-blinking');
          window.setTimeout(() => svg.classList.remove('is-blinking'), 170);
        }
      });
      blinkSoon();
    }, 2200 + Math.random() * 3500);
  }

  /* ---------- Static owls placed around the page ---------- */

  function placeOwls() {
    const spots = [
      ['#hero-owl', { mood: 'happy', wave: true, live: true }],
      ['#owl-loading-art', { mood: 'normal', acc: ['nerd', 'book'], live: true }],
      ['#ach-owl', { mood: 'happy', acc: ['trophy'], live: true }],
      ['#footer-owl', { mood: 'sleep' }],
      ['#cookie-owl', { mood: 'wink' }]
    ];
    spots.forEach(([selector, options]) => {
      const node = document.querySelector(selector);
      if (node && !node.dataset.drawn) {
        node.innerHTML = owlSvg(options);
        node.dataset.drawn = 'yes';
      }
    });
  }

  function scoreOwl(percent) {
    const node = document.querySelector('#score-owl');
    if (!node) return;
    const options = percent === 100
      ? { mood: 'happy', acc: ['crown', 'sparkle'] }
      : percent >= 75
        ? { mood: 'happy', acc: ['party'] }
        : percent >= 50
          ? { mood: 'wink' }
          : { mood: 'sad' };
    node.innerHTML = owlSvg(Object.assign({ live: options.mood !== 'happy' }, options));
    node.classList.remove('is-pop');
    void node.offsetWidth;
    node.classList.add('is-pop');
  }

  /* ---------- Ace the companion ---------- */

  const HIDE_STORE = 'aceminder.owlHidden';
  const buddy = { root: null, figure: null, bubble: null, text: null, mood: 'normal', acc: [], timer: 0, lastAuto: 0, seen: new Set() };
  let idleTimer = 0;
  let sleeping = false;
  let tipOrder = [];
  let clicks = [];
  let petTimer = 0;
  let lastPet = 0;

  function readHidden() {
    try { return window.localStorage.getItem(HIDE_STORE) === 'yes'; } catch { return false; }
  }

  function writeHidden(value) {
    try {
      if (value) window.localStorage.setItem(HIDE_STORE, 'yes');
      else window.localStorage.removeItem(HIDE_STORE);
    } catch { /* storage blocked */ }
  }

  function buildBuddy() {
    const root = document.createElement('div');
    root.className = 'owl-buddy';
    root.id = 'owl-buddy';
    root.innerHTML = `
      <div class="owl-bubble" id="owl-bubble" hidden><p id="owl-bubble-text"></p></div>
      <button class="owl-buddy-figure" id="owl-buddy-figure" type="button"></button>
      <button class="owl-buddy-hide" id="owl-buddy-hide" type="button">×</button>
      <span class="owl-zzz" aria-hidden="true"><i>z</i><i>z</i><i>Z</i></span>
      <span class="owl-hearts" aria-hidden="true"></span>`;
    const show = document.createElement('button');
    show.className = 'owl-buddy-show';
    show.id = 'owl-buddy-show';
    show.type = 'button';
    show.innerHTML = owlSvg({ mood: 'wink' });
    document.body.append(root, show);
    buddy.root = root;
    buddy.figure = root.querySelector('#owl-buddy-figure');
    buddy.bubble = root.querySelector('#owl-bubble');
    buddy.text = root.querySelector('#owl-bubble-text');
    setMood('normal');
    labelBuddy();

    buddy.figure.addEventListener('click', onBuddyClick);
    buddy.figure.addEventListener('pointerenter', event => {
      if (event.pointerType !== 'mouse') return;
      window.clearTimeout(petTimer);
      petTimer = window.setTimeout(pet, 1400);
    });
    buddy.figure.addEventListener('pointerleave', () => window.clearTimeout(petTimer));
    root.querySelector('#owl-buddy-hide').addEventListener('click', () => setHidden(true));
    show.addEventListener('click', () => {
      setHidden(false);
      say(tr('owl.hello'), { mood: 'happy', hoot: true });
    });
    buddy.bubble.addEventListener('click', () => hideBubble());
    setHidden(readHidden(), true);
  }

  function labelBuddy() {
    if (!buddy.root) return;
    buddy.figure.setAttribute('aria-label', tr('owl.label'));
    buddy.root.querySelector('#owl-buddy-hide').setAttribute('aria-label', tr('owl.hide'));
    buddy.root.querySelector('#owl-buddy-hide').title = tr('owl.hide');
    const show = document.querySelector('#owl-buddy-show');
    show.setAttribute('aria-label', tr('owl.show'));
    show.title = tr('owl.show');
  }

  function setHidden(hidden, quiet) {
    buddy.root.classList.toggle('is-hidden', hidden);
    document.querySelector('#owl-buddy-show').classList.toggle('is-visible', hidden);
    if (!quiet) writeHidden(hidden);
  }

  function setMood(mood, acc = []) {
    if (!buddy.figure) return;
    const key = `${mood}|${acc.join(',')}`;
    if (buddy.figure.dataset.key === key) return;
    buddy.figure.dataset.key = key;
    buddy.figure.innerHTML = owlSvg({ mood, acc, live: true });
    buddy.mood = mood;
    buddy.acc = acc;
    lookAt();
  }

  function play(className, duration = 900) {
    if (!buddy.root || reducedMotion) return;
    buddy.root.classList.remove(className);
    void buddy.root.offsetWidth;
    buddy.root.classList.add(className);
    window.setTimeout(() => buddy.root.classList.remove(className), duration);
  }

  /* options: mood, acc, hoot, dance, persist (ms or true), auto */
  function say(text, options = {}) {
    if (!buddy.root || buddy.root.classList.contains('is-hidden') || !text) return;
    wake(true);
    window.clearTimeout(buddy.timer);
    buddy.text.textContent = text;
    buddy.bubble.hidden = false;
    buddy.bubble.classList.remove('is-in');
    void buddy.bubble.offsetWidth;
    buddy.bubble.classList.add('is-in');
    if (options.mood) setMood(options.mood, options.acc || []);
    if (options.hoot) play('is-hoot', 700);
    if (options.dance) play('is-dance', 1800);
    if (options.persist !== true) {
      const ms = typeof options.persist === 'number' ? options.persist : Math.min(9000, 3500 + text.length * 45);
      buddy.timer = window.setTimeout(() => {
        hideBubble();
        if (!sleeping) setMood('normal');
      }, ms);
    }
  }

  function hideBubble() {
    if (!buddy.bubble) return;
    buddy.bubble.hidden = true;
  }

  function autoSay(text, options) {
    const now = Date.now();
    if (now - buddy.lastAuto < 9000 || !buddy.bubble || !buddy.bubble.hidden) return false;
    buddy.lastAuto = now;
    say(text, options);
    return true;
  }

  function nextTip() {
    if (!tipOrder.length) {
      tipOrder = Array.from({ length: 10 }, (_, i) => i + 1).sort(() => Math.random() - 0.5);
    }
    return tr(`owl.tip${tipOrder.pop()}`);
  }

  function onBuddyClick() {
    if (sleeping) {
      wake();
      say(tr('owl.wake'), { mood: 'wow', hoot: true });
      return;
    }
    const now = Date.now();
    clicks = clicks.filter(time => now - time < 2200);
    clicks.push(now);
    window.AceDevice?.vibrate(10);
    if (clicks.length >= 5) {
      clicks = [];
      play('is-spin', 1000);
      say(tr('owl.spin'), { mood: 'happy', acc: ['party'] });
      return;
    }
    say(nextTip(), { mood: Math.random() < 0.5 ? 'happy' : 'wink', hoot: true });
  }

  function pet() {
    const now = Date.now();
    if (sleeping || now - lastPet < 20000) return;
    lastPet = now;
    const hearts = buddy.root.querySelector('.owl-hearts');
    hearts.innerHTML = '<i>💛</i><i>💛</i><i>💛</i>';
    play('is-petting', 1600);
    say(tr('owl.pet'), { mood: 'happy', acc: ['heart'] });
  }

  /* Falls asleep after 45 seconds without activity; wakes on any interaction. */
  function resetIdle() {
    window.clearTimeout(idleTimer);
    idleTimer = window.setTimeout(fallAsleep, 45000);
  }

  function fallAsleep() {
    if (!buddy.root || buddy.bubble && !buddy.bubble.hidden) {
      resetIdle();
      return;
    }
    sleeping = true;
    buddy.root.classList.add('is-sleeping');
    setMood('sleep');
  }

  function wake(quiet) {
    resetIdle();
    if (!sleeping) return;
    sleeping = false;
    buddy.root.classList.remove('is-sleeping');
    if (!quiet) setMood('normal');
  }

  ['pointerdown', 'keydown', 'touchstart', 'wheel'].forEach(name => {
    window.addEventListener(name, () => {
      if (sleeping) wake();
      else resetIdle();
    }, { passive: true });
  });

  /* Follows the scroll: lags behind like a bird catching up, flaps, tilts. */
  let lastScroll = window.scrollY;
  let target = 0;
  let offset = 0;
  let follow = 0;

  function step() {
    target *= 0.86;
    offset += (target - offset) * 0.16;
    if (buddy.root) {
      buddy.root.style.setProperty('--owl-y', `${offset.toFixed(2)}px`);
      buddy.root.style.setProperty('--owl-tilt', `${(offset * -0.35).toFixed(2)}deg`);
      buddy.root.classList.toggle('is-flapping', Math.abs(target) > 3);
    }
    if (Math.abs(offset) > 0.2 || Math.abs(target) > 0.2) {
      follow = requestAnimationFrame(step);
    } else {
      follow = 0;
      if (buddy.root) buddy.root.classList.remove('is-flapping');
    }
  }

  window.addEventListener('scroll', () => {
    const delta = window.scrollY - lastScroll;
    lastScroll = window.scrollY;
    if (reducedMotion || !buddy.root) return;
    if (sleeping && Math.abs(delta) > 40) wake();
    target = Math.max(-46, Math.min(46, target - delta * 0.9));
    if (!follow) follow = requestAnimationFrame(step);
  }, { passive: true });

  /* Section tips: Ace comments once per section per visit. */
  function watchSections() {
    if (!('IntersectionObserver' in window)) return;
    const lines = {
      top: 'owl.hero',
      generator: 'owl.builder',
      'how-it-works': 'owl.how',
      'level-up': 'owl.level',
      achievements: 'owl.achievements',
      leaderboard: 'owl.board',
      'your-way': 'owl.way'
    };
    /* Only comment on a section the reader actually stays on (not one flown past). */
    const pending = new Map();
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        const id = entry.target.id;
        window.clearTimeout(pending.get(id));
        if (!entry.isIntersecting || buddy.seen.has(id)) return;
        pending.set(id, window.setTimeout(() => {
          if (autoSay(tr(lines[id]), { mood: id === 'achievements' ? 'wow' : 'happy' })) buddy.seen.add(id);
        }, 1200));
      });
    }, { rootMargin: '-42% 0px -42% 0px', threshold: 0 });
    Object.keys(lines).forEach(id => {
      const node = document.getElementById(id);
      if (node) observer.observe(node);
    });
  }

  /* ---------- Reactions to the rest of the site ---------- */

  window.addEventListener('aceminder:generating', event => {
    const active = event.detail && event.detail.active;
    const card = document.querySelector('#owl-loading');
    if (card) card.hidden = !active;
    if (active) {
      say(tr('owl.generating'), { mood: 'normal', acc: ['nerd', 'book'], persist: true });
      buddy.root?.classList.add('is-thinking');
      rotateLoadingLines(true);
    } else {
      buddy.root?.classList.remove('is-thinking');
      rotateLoadingLines(false);
      hideBubble();
      setMood('normal');
    }
  });

  let loadingTimer = 0;
  function rotateLoadingLines(on) {
    window.clearInterval(loadingTimer);
    const line = document.querySelector('#owl-loading-line');
    if (!line || !on) return;
    let index = 1;
    line.textContent = tr('owl.load1');
    loadingTimer = window.setInterval(() => {
      index = index % 5 + 1;
      line.classList.remove('is-in');
      void line.offsetWidth;
      line.textContent = tr(`owl.load${index}`);
      line.classList.add('is-in');
    }, 3200);
  }

  window.addEventListener('aceminder:generated', () => {
    say(tr('owl.ready'), { mood: 'happy', hoot: true });
  });

  window.addEventListener('aceminder:graded', event => {
    const percent = Number(event.detail && event.detail.percent) || 0;
    scoreOwl(percent);
    window.setTimeout(() => {
      if (percent === 100) say(tr('owl.perfect'), { mood: 'happy', acc: ['crown'], dance: true });
      else if (percent >= 75) say(tr('owl.great', { p: percent }), { mood: 'happy', acc: ['party'], dance: true });
      else if (percent >= 50) say(tr('owl.good', { p: percent }), { mood: 'wink', hoot: true });
      else say(tr('owl.low'), { mood: 'sad' });
    }, 400);
  });

  window.addEventListener('aceminder:levelup', event => {
    window.setTimeout(() => say(tr('owl.levelUp', { n: event.detail.level }), { mood: 'happy', acc: ['crown'], dance: true }), 2600);
  });

  window.addEventListener('aceminder:achievement', event => {
    const names = (event.detail && event.detail.names) || [];
    if (names.length) {
      window.setTimeout(() => say(tr('owl.achievement', { name: names[0] }), { mood: 'wow', acc: ['sparkle'], dance: true }), 4200);
    }
  });

  let greeted = false;
  window.addEventListener('aceminder:account', event => {
    const user = event.detail && event.detail.user;
    if (user && user.username && !greeted) {
      greeted = true;
      window.setTimeout(() => autoSay(tr('owl.helloUser', { name: user.username }), { mood: 'happy', hoot: true }), 1500);
    }
  });

  window.addEventListener('aceminder:language', () => {
    labelBuddy();
  });

  function localDay() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  function streakReminder() {
    const snapshot = window.AceGame && window.AceGame.snapshot();
    if (snapshot && snapshot.streak > 0 && snapshot.lastDay && snapshot.lastDay !== localDay()) {
      say(tr('owl.streakRisk', { n: snapshot.streak }), { mood: 'wow', acc: ['flame'], hoot: true, persist: 9000 });
      buddy.lastAuto = Date.now();
      return true;
    }
    return false;
  }

  /* ---------- Start ---------- */

  window.AceOwl = {
    svg: owlSvg,
    variant: variantSvg,
    variants: Object.keys(VARIANTS),
    medal: medalSvg,
    avatar: renderAvatar,
    say: (text, options) => say(text, options),
    scoreOwl
  };

  document.addEventListener('DOMContentLoaded', () => {
    ensureDefs();
    placeOwls();
    buildBuddy();
    watchSections();
    resetIdle();
    blinkSoon();
    window.setTimeout(() => {
      if (!streakReminder() && !sessionStorageHas('aceminder.owlHello')) {
        autoSay(tr('owl.hello'), { mood: 'happy', hoot: true });
      }
    }, 2600);
  });

  function sessionStorageHas(key) {
    try {
      if (window.sessionStorage.getItem(key)) return true;
      window.sessionStorage.setItem(key, '1');
    } catch { /* ignore */ }
    return false;
  }
})();
