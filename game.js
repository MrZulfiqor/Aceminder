'use strict';

/* Aceminder progression: XP, levels, daily streaks, badges, toasts and confetti.
   Everything is kept in this browser's localStorage; nothing is sent to the server. */

(function () {
  const tr = (key, vars) => window.AceI18n.t(key, vars);
  const STORE = 'aceminder.progress';
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const MULTIPLIERS = {
    'Too easy': 0.5,
    'Easy': 0.75,
    'Easy-Medium': 0.9,
    'Medium': 1,
    'Medium-Hard': 1.25,
    'Hard': 1.5,
    'Too Hard': 2
  };
  const fresh = () => ({
    xp: 0, tests: 0, correct: 0, best: null, streak: 0, bestStreak: 0,
    lastDay: '', perfects: 0, hardWins: 0, badges: [], awarded: [], history: []
  });
  let serverStats = null;

  function load() {
    try {
      const raw = JSON.parse(window.localStorage.getItem(STORE) || 'null');
      return raw && typeof raw === 'object' ? Object.assign(fresh(), raw) : fresh();
    } catch {
      return fresh();
    }
  }

  /* When signed in, progress comes from the server account instead of this browser. */
  let accountUser = null;

  function fromServer(progress) {
    if (progress.stats) serverStats = progress.stats;
    return Object.assign(fresh(), {
      xp: progress.xp,
      tests: progress.tests,
      correct: progress.correct,
      best: progress.best,
      streak: progress.streak,
      bestStreak: progress.bestStreak,
      lastDay: progress.lastDay || '',
      perfects: progress.perfects,
      hardWins: progress.hardWins,
      badges: Array.isArray(progress.badges) ? progress.badges : []
    });
  }

  function save() {
    if (accountUser) return;
    try {
      window.localStorage.setItem(STORE, JSON.stringify(state));
    } catch {
      /* storage blocked: progress lasts for this visit only */
    }
  }

  let state = load();

  function dayKey(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function daysBetween(a, b) {
    if (!a || !b) return Infinity;
    const [ay, am, ad] = a.split('-').map(Number);
    const [by, bm, bd] = b.split('-').map(Number);
    return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
  }

  /* A streak only counts while the last marked test was today or yesterday. */
  function liveStreak() {
    return daysBetween(state.lastDay, dayKey()) <= 1 ? state.streak : 0;
  }

  /* Level n -> n+1 costs 100 + 50(n-1) XP. */
  function levelInfo(xp) {
    let level = 1;
    let floor = 0;
    let cost = 100;
    while (xp >= floor + cost) {
      floor += cost;
      level += 1;
      cost = 100 + 50 * (level - 1);
    }
    return { level, into: xp - floor, cost };
  }

  function rankFor(level) {
    const steps = [2, 4, 7, 10, 14];
    const index = steps.findIndex(limit => level <= limit);
    return tr(`game.rank${index === -1 ? 6 : index + 1}`);
  }

  /* ---------- Rendering ---------- */

  const $ = selector => document.querySelector(selector);

  function render() {
    const info = levelInfo(state.xp);
    const percent = Math.min(100, Math.round((info.into / info.cost) * 100));
    const streak = liveStreak();

    const hudStreak = $('#hud-streak');
    if (hudStreak) {
      $('#hud-streak-count').textContent = String(streak);
      hudStreak.classList.toggle('is-lit', streak > 0);
      hudStreak.title = `${tr('hud.streak')}: ${streak}`;
    }
    const hudLevel = $('#hud-level');
    if (hudLevel) {
      $('#hud-level-num').textContent = String(info.level);
      $('#hud-xp-fill').style.width = `${percent}%`;
      hudLevel.title = `${tr('hud.level')}: ${info.level} · ${rankFor(info.level)}`;
    }

    const tabStreak = $('#tab-streak');
    if (tabStreak) {
      tabStreak.textContent = `🔥${streak}`;
      tabStreak.hidden = streak < 1;
    }

    pushAchievements();
    if (!$('#player-card')) return;
    const nameNode = $('#player-name');
    nameNode.replaceChildren();
    if (accountUser) {
      const face = document.createElement('span');
      face.className = 'player-face';
      window.AceOwl?.avatar(face, accountUser);
      nameNode.append(face, document.createTextNode(accountUser.username || ''));
    } else {
      nameNode.textContent = tr('acct.guestNote');
    }
    $('#player-level').textContent = String(info.level);
    $('#player-rank').textContent = rankFor(info.level);
    $('#player-xp-text').textContent = tr('game.xpToNext', { xp: info.into, next: info.cost, level: info.level + 1 });
    $('#player-xp-fill').style.width = `${percent}%`;
    $('#stat-streak').textContent = String(streak);
    $('#stat-tests').textContent = String(state.tests);
    $('#stat-best').textContent = state.best === null ? '–' : `${state.best}%`;
    $('#stat-correct').textContent = String(state.correct);
  }

  function currentStats() {
    if (accountUser && serverStats) return serverStats;
    const A = window.AceAchievements;
    return A ? A.guestStats(Object.assign({}, state, { level: levelInfo(state.xp).level })) : {};
  }

  function pushAchievements() {
    window.AceAchievements?.update(currentStats(), state.badges, Boolean(accountUser));
  }

  /* ---------- Toasts ---------- */

  function toast(text, icon = '✨', tone = '') {
    const holder = $('#toasts');
    if (!holder) return;
    const item = document.createElement('div');
    item.className = `toast${tone ? ` toast--${tone}` : ''}`;
    const glyph = document.createElement('span');
    glyph.className = 'toast-icon';
    glyph.setAttribute('aria-hidden', 'true');
    glyph.textContent = icon;
    const copy = document.createElement('span');
    copy.textContent = text;
    item.append(glyph, copy);
    holder.append(item);
    window.setTimeout(() => item.classList.add('is-leaving'), 4200);
    window.setTimeout(() => item.remove(), 4700);
  }

  function toastSequence(items) {
    items.forEach((args, index) => window.setTimeout(() => toast(...args), index * 650));
  }

  /* ---------- Confetti ---------- */

  const canvas = $('#confetti');
  const ctx = canvas ? canvas.getContext('2d') : null;
  let pieces = [];
  let frame = 0;

  function sizeCanvas() {
    if (!canvas) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = window.innerWidth * ratio;
    canvas.height = window.innerHeight * ratio;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function confetti(amount = 140) {
    if (!ctx || reducedMotion) return;
    sizeCanvas();
    const colors = ['#ffd166', '#f59e0b', '#f472b6', '#a78bfa', '#22d3ee', '#34d399', '#ffffff'];
    const w = window.innerWidth;
    for (let i = 0; i < amount; i += 1) {
      const fromLeft = i % 2 === 0;
      pieces.push({
        x: fromLeft ? -10 : w + 10,
        y: window.innerHeight * (0.45 + Math.random() * 0.3),
        vx: (fromLeft ? 1 : -1) * (6 + Math.random() * 9),
        vy: -(9 + Math.random() * 11),
        size: 5 + Math.random() * 7,
        spin: Math.random() * Math.PI,
        vspin: (Math.random() - 0.5) * 0.35,
        color: colors[i % colors.length],
        life: 0
      });
    }
    if (!frame) frame = requestAnimationFrame(tick);
  }

  function tick() {
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    pieces = pieces.filter(p => p.y < window.innerHeight + 40 && p.life < 420);
    pieces.forEach(p => {
      p.life += 1;
      p.vy += 0.32;
      p.vx *= 0.985;
      p.x += p.vx;
      p.y += p.vy;
      p.spin += p.vspin;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.spin);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      ctx.restore();
    });
    if (pieces.length) {
      frame = requestAnimationFrame(tick);
    } else {
      frame = 0;
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    }
  }

  /* ---------- Score animation ---------- */

  function animateScore(percent) {
    const panel = $('#score-panel');
    const label = $('#score-percent');
    if (!panel || !label) return;
    if (reducedMotion) return;
    const start = performance.now();
    const duration = 1100;
    const step = now => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      const value = Math.round(percent * eased);
      label.textContent = `${value}%`;
      panel.style.setProperty('--score', String(value));
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function bump(selector) {
    const node = $(selector);
    if (!node || reducedMotion) return;
    node.classList.remove('is-bumped');
    void node.offsetWidth;
    node.classList.add('is-bumped');
  }

  /* ---------- Events from the question builder ---------- */

  function celebrate(xp, before, after, streak, firstToday, newBadges, percent) {
    const scoreXp = $('#score-xp');
    if (scoreXp) {
      scoreXp.textContent = tr('score.xp', { n: xp });
      scoreXp.hidden = false;
    }
    bump('#hud-level');
    if (firstToday) bump('#hud-streak');
    const queue = [[tr('toast.xp', { n: xp }), '⚡', 'xp']];
    if (firstToday && streak > 1) queue.push([tr('toast.streak', { n: streak }), '🔥', 'streak']);
    if (after > before) queue.push([tr('toast.levelUp', { n: after }), '🏆', 'level']);
    toastSequence(queue);
    haptic(after > before || percent === 100 ? [40, 60, 40, 60, 90] : percent >= 70 ? [35, 50, 35] : [25]);
    if (percent >= 70 || after > before) confetti(percent === 100 ? 220 : 140);
    if (after > before) window.dispatchEvent(new CustomEvent('aceminder:levelup', { detail: { level: after } }));
    if (newBadges.length) window.AceAchievements?.celebrate(newBadges);
  }

  window.addEventListener('aceminder:graded', event => {
    const run = event.detail || {};
    const total = Number(run.total) || 0;
    const correct = Number(run.correct) || 0;
    const percent = Number(run.percent) || 0;
    animateScore(percent);
    const scoreXp = $('#score-xp');

    /* Signed in: the server already calculated and saved the XP. */
    if (run.signedIn) {
      const award = run.award;
      if (run.progress) {
        state = fromServer(run.progress);
        render();
      }
      if (award && !award.repeat) {
        celebrate(award.xp, award.levelBefore, award.levelAfter, award.streak, award.firstToday, award.newBadges || [], percent);
      } else {
        if (scoreXp) scoreXp.hidden = true;
        toast(award && award.repeat ? tr('toast.repeat') : tr('toast.noAward'), 'ℹ️');
      }
      return;
    }

    if (!run.testId || state.awarded.includes(run.testId)) {
      if (scoreXp) scoreXp.hidden = true;
      toast(tr('toast.repeat'), 'ℹ️');
      return;
    }

    const before = levelInfo(state.xp).level;
    const multiplier = MULTIPLIERS[run.difficulty] || 1;
    const today = dayKey();
    const gap = daysBetween(state.lastDay, today);
    const firstToday = gap !== 0;

    let xp = Math.round(correct * 10 * multiplier);
    if (total && correct === total) xp += 50;
    if (firstToday) xp += 20;
    xp = Math.max(5, xp);

    if (gap === 1) state.streak += 1;
    else if (gap !== 0) state.streak = 1;
    state.lastDay = today;
    state.bestStreak = Math.max(state.bestStreak, state.streak);
    state.xp += xp;
    state.tests += 1;
    state.correct += correct;
    state.best = state.best === null ? percent : Math.max(state.best, percent);
    if (percent === 100) state.perfects += 1;
    if (percent >= 75 && (run.difficulty === 'Hard' || run.difficulty === 'Too Hard')) state.hardWins += 1;
    state.awarded = [...state.awarded, run.testId].slice(-60);
    state.history = [...(state.history || []), {
      percent,
      difficulty: run.difficulty,
      total,
      topic: String(run.topic || '').slice(0, 120),
      day: today,
      hour: new Date().getHours(),
      language: run.language || '',
      files: Number(run.files) || 0,
      formats: Number(run.formats) || 1
    }].slice(-400);

    const after = levelInfo(state.xp).level;
    const A = window.AceAchievements;
    const unlocked = A
      ? A.evaluate(A.guestStats(Object.assign({}, state, { level: after }))).filter(id => !state.badges.includes(id))
      : [];
    state.badges.push(...unlocked);
    save();
    render();
    celebrate(xp, before, after, state.streak, firstToday, unlocked, percent);
  });

  window.addEventListener('aceminder:account', event => {
    const user = event.detail && event.detail.user;
    accountUser = user || null;
    if (!user) serverStats = null;
    state = user && user.progress ? fromServer(user.progress) : load();
    render();
  });

  window.addEventListener('aceminder:achievements-ready', pushAchievements);

  window.AceToast = (text, icon) => toast(text, icon || '✨');
  window.AceConfetti = amount => confetti(amount);
  window.AceGame = {
    snapshot: () => ({
      streak: liveStreak(),
      lastDay: state.lastDay,
      level: levelInfo(state.xp).level,
      signedIn: Boolean(accountUser)
    })
  };

  /* Phones get a small buzz when an answer is picked and when results land. */
  function haptic(pattern) {
    if (window.AceDevice) window.AceDevice.vibrate(pattern);
  }

  document.addEventListener('change', event => {
    if (event.target instanceof HTMLInputElement && event.target.closest('.answer-option')) haptic(12);
  });

  window.addEventListener('aceminder:language', () => {
    render();
    startRotator();
  });

  /* ---------- Hero subject rotator ---------- */

  let rotatorTimer = 0;
  function startRotator() {
    const node = $('#hero-rotator');
    if (!node) return;
    window.clearInterval(rotatorTimer);
    const words = tr('hero.subjects').split('|').map(word => word.trim()).filter(Boolean);
    if (!words.length) return;
    let index = 0;
    node.textContent = words[0];
    if (reducedMotion || words.length < 2) return;
    rotatorTimer = window.setInterval(() => {
      index = (index + 1) % words.length;
      node.classList.add('is-out');
      window.setTimeout(() => {
        node.textContent = words[index];
        node.classList.remove('is-out');
      }, 260);
    }, 2400);
  }

  /* ---------- Header and hero polish ---------- */

  const header = $('#site-header');
  const onScroll = () => header && header.classList.toggle('is-scrolled', window.scrollY > 8);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  const art = $('#hero-art');
  if (art && !reducedMotion) {
    art.addEventListener('pointermove', event => {
      if (event.pointerType !== 'mouse' || document.documentElement.dataset.device === 'phone') return;
      const box = art.getBoundingClientRect();
      const x = (event.clientX - box.left) / box.width - 0.5;
      const y = (event.clientY - box.top) / box.height - 0.5;
      art.style.setProperty('--tilt-x', `${(-y * 7).toFixed(2)}deg`);
      art.style.setProperty('--tilt-y', `${(x * 9).toFixed(2)}deg`);
    });
    art.addEventListener('pointerleave', () => {
      art.style.setProperty('--tilt-x', '0deg');
      art.style.setProperty('--tilt-y', '0deg');
    });
  }

  window.addEventListener('resize', () => {
    if (pieces.length) sizeCanvas();
  });

  document.addEventListener('DOMContentLoaded', () => {
    render();
    startRotator();
  });
})();
