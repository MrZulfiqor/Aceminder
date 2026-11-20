'use strict';

/* Achievements: the trophy room, progress towards each one, the detail view and the
   big unlock celebration. Definitions come from the server (/api/auth/config) so guests
   and signed-in players play by exactly the same rules. */

(function () {
  const tr = (key, vars) => window.AceI18n.t(key, vars);
  const $ = selector => document.querySelector(selector);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const TIER_ORDER = { bronze: 0, silver: 1, gold: 2, diamond: 3 };

  const state = { defs: [], stats: {}, owned: [], filter: 'all', signedIn: false };

  /* ---------- Stats for guests (same rules as accounts.py stats_for) ---------- */

  function guestStats(game) {
    const history = Array.isArray(game.history) ? game.history : [];
    const topics = new Set();
    const languages = new Set();
    const perDay = {};
    let night = 0, early = 0, weekend = 0, big = 0, files = 0, mixed = 0, tooHard = 0, comebacks = 0;
    let previous = null;
    history.forEach(item => {
      topics.add(String(item.topic || '').trim().toLowerCase());
      perDay[item.day] = (perDay[item.day] || 0) + 1;
      if (Number.isInteger(item.hour)) {
        if (item.hour >= 22 || item.hour < 5) night += 1;
        if (item.hour >= 5 && item.hour < 8) early += 1;
      }
      const parts = String(item.day || '').split('-').map(Number);
      if (parts.length === 3) {
        const weekday = new Date(parts[0], parts[1] - 1, parts[2]).getDay();
        if (weekday === 0 || weekday === 6) weekend += 1;
      }
      if (item.language) languages.add(item.language);
      if (item.total >= 20) big += 1;
      if (item.files > 0) files += 1;
      if ((item.formats || 1) >= 3) mixed += 1;
      if (item.difficulty === 'Too Hard' && item.percent === 100) tooHard += 1;
      if (previous !== null && previous < 50 && item.percent >= 90) comebacks += 1;
      previous = item.percent;
    });
    return {
      tests: game.tests || 0,
      correct: game.correct || 0,
      perfects: game.perfects || 0,
      hardWins: game.hardWins || 0,
      tooHardPerfects: tooHard,
      bestStreak: game.bestStreak || 0,
      level: game.level || 1,
      topics: topics.size,
      dayTests: Math.max(0, ...Object.values(perDay)),
      nightTests: night,
      earlyTests: early,
      weekendTests: weekend,
      languages: languages.size,
      bigTests: big,
      fileTests: files,
      mixTests: mixed,
      comebacks
    };
  }

  function evaluate(stats) {
    return state.defs.filter(def => (stats[def.stat] || 0) >= def.target).map(def => def.id);
  }

  /* ---------- Text helpers ---------- */

  const name = def => tr(`ach.${def.id}`);
  const desc = def => tr(`ach.stat.${def.stat}`, { n: def.target });
  const tierLabel = tier => tr(`ach.tier.${tier}`);
  const fmt = value => Number(value).toLocaleString(window.AceI18n.lang);

  /* ---------- Rendering ---------- */

  function progressOf(def) {
    const current = Math.min(def.target, state.stats[def.stat] || 0);
    return { current, percent: Math.round((current / def.target) * 100) };
  }

  function card(def) {
    const owned = state.owned.includes(def.id);
    const progress = progressOf(def);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `ach-card ach-card--${def.tier}${owned ? ' is-unlocked' : ' is-locked'}`;
    button.dataset.id = def.id;
    button.innerHTML = window.AceOwl.medal(def.art, def.tier, owned);
    const copy = document.createElement('span');
    copy.className = 'ach-copy';
    const title = document.createElement('strong');
    title.textContent = name(def);
    const detail = document.createElement('small');
    detail.textContent = desc(def);
    copy.append(title, detail);
    const foot = document.createElement('span');
    foot.className = 'ach-foot';
    if (owned) {
      foot.innerHTML = `<span class="ach-tier ach-tier--${def.tier}"></span>`;
      foot.firstChild.textContent = tierLabel(def.tier);
    } else {
      foot.innerHTML = '<span class="ach-bar"><i></i></span><span class="ach-count"></span>';
      foot.querySelector('i').style.width = `${progress.percent}%`;
      foot.querySelector('.ach-count').textContent = tr('ach.progress', { cur: fmt(progress.current), target: fmt(def.target) });
    }
    button.append(copy, foot);
    button.setAttribute('aria-label', `${name(def)} · ${owned ? tr('ach.done') : desc(def)}`);
    button.addEventListener('click', () => openDetail(def));
    return button;
  }

  function render() {
    const grid = $('#ach-grid');
    if (!grid || !state.defs.length || !window.AceOwl) return;
    const owned = state.defs.filter(def => state.owned.includes(def.id));
    $('#ach-count').textContent = tr('ach.count', { n: owned.length, total: state.defs.length });
    $('#ach-meter').style.width = `${Math.round((owned.length / state.defs.length) * 100)}%`;
    ['bronze', 'silver', 'gold', 'diamond'].forEach(tier => {
      const node = $(`#ach-tier-${tier}`);
      if (!node) return;
      const all = state.defs.filter(def => def.tier === tier);
      node.textContent = `${all.filter(def => state.owned.includes(def.id)).length}/${all.length}`;
    });
    $('#ach-guest').hidden = state.signedIn;

    document.querySelectorAll('[data-ach-filter]').forEach(button => {
      const active = button.dataset.achFilter === state.filter;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });

    const list = state.defs
      .filter(def => state.filter === 'all'
        || (state.filter === 'unlocked' ? state.owned.includes(def.id) : !state.owned.includes(def.id)))
      .sort((a, b) => {
        const ownA = state.owned.includes(a.id) ? 0 : 1;
        const ownB = state.owned.includes(b.id) ? 0 : 1;
        if (ownA !== ownB) return ownA - ownB;
        if (ownA === 1) return progressOf(b).percent - progressOf(a).percent;
        return TIER_ORDER[b.tier] - TIER_ORDER[a.tier];
      });
    grid.replaceChildren(...list.map(card));
    if (!list.length) {
      const empty = document.createElement('p');
      empty.className = 'ach-empty';
      empty.textContent = tr('ach.none');
      grid.append(empty);
    }
    renderMini();
  }

  /* The player card shows the newest unlocks, then the closest locked ones. */
  function renderMini() {
    const list = $('#badges');
    if (!list) return;
    const owned = state.owned.map(id => state.defs.find(def => def.id === id)).filter(Boolean).reverse();
    const next = state.defs
      .filter(def => !state.owned.includes(def.id))
      .sort((a, b) => progressOf(b).percent - progressOf(a).percent);
    const picks = [...owned.slice(0, 4), ...next].slice(0, 6);
    list.replaceChildren(...picks.map(def => {
      const unlocked = state.owned.includes(def.id);
      const item = document.createElement('li');
      item.className = `badge${unlocked ? ' is-owned' : ''}`;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'badge-button';
      button.innerHTML = window.AceOwl.medal(def.art, def.tier, unlocked);
      const label = document.createElement('span');
      label.className = 'badge-name';
      label.textContent = name(def);
      button.append(label);
      button.title = `${name(def)} · ${desc(def)}`;
      button.addEventListener('click', () => openDetail(def));
      item.append(button);
      return item;
    }));
    const count = $('#badge-count');
    if (count) count.textContent = `${state.owned.length} / ${state.defs.length}`;
  }

  /* ---------- Detail dialog ---------- */

  function openDetail(def) {
    const dialog = $('#ach-dialog');
    if (!dialog) return;
    const owned = state.owned.includes(def.id);
    const progress = progressOf(def);
    $('#ach-detail-art').innerHTML = window.AceOwl.medal(def.art, def.tier, owned, { className: 'medal--big' });
    const tier = $('#ach-detail-tier');
    tier.textContent = tierLabel(def.tier);
    tier.className = `ach-tier ach-tier--${def.tier}`;
    $('#ach-detail-name').textContent = name(def);
    $('#ach-detail-desc').textContent = desc(def);
    $('#ach-detail-status').textContent = owned
      ? tr('ach.done')
      : tr('ach.progress', { cur: fmt(progress.current), target: fmt(def.target) });
    $('#ach-detail-status').classList.toggle('is-done', owned);
    $('#ach-detail-bar').style.width = `${owned ? 100 : progress.percent}%`;
    dialog.classList.toggle('is-locked', !owned);
    if (!dialog.open) dialog.showModal();
    window.AceDevice?.vibrate(10);
  }

  $('#ach-detail-close')?.addEventListener('click', () => $('#ach-dialog').close());
  $('#ach-dialog')?.addEventListener('click', event => {
    if (event.target === event.currentTarget) event.currentTarget.close();
  });
  document.querySelectorAll('[data-ach-filter]').forEach(button => {
    button.addEventListener('click', () => {
      state.filter = button.dataset.achFilter;
      render();
    });
  });

  /* ---------- Unlock celebration ---------- */

  const queue = [];
  let showing = false;

  function celebrate(ids) {
    const defs = ids.map(id => state.defs.find(def => def.id === id)).filter(Boolean);
    if (!defs.length) return;
    queue.push(...defs);
    window.dispatchEvent(new CustomEvent('aceminder:achievement', { detail: { ids, names: defs.map(name) } }));
    if (!showing) window.setTimeout(showNext, 1400);
  }

  function showNext() {
    const pop = $('#ach-pop');
    const def = queue.shift();
    if (!pop || !def) {
      showing = false;
      return;
    }
    showing = true;
    $('#ach-pop-art').innerHTML = window.AceOwl.medal(def.art, def.tier, true, { className: 'medal--big' });
    const tier = $('#ach-pop-tier');
    tier.textContent = tierLabel(def.tier);
    tier.className = `ach-tier ach-tier--${def.tier}`;
    $('#ach-pop-name').textContent = name(def);
    $('#ach-pop-desc').textContent = desc(def);
    pop.className = `ach-pop ach-pop--${def.tier}`;
    pop.hidden = false;
    void pop.offsetWidth;
    pop.classList.add('is-in');
    window.AceDevice?.vibrate([30, 40, 30, 40, 80]);
    if (window.AceConfetti && !reducedMotion) window.AceConfetti(def.tier === 'diamond' ? 240 : 120);
    window.clearTimeout(pop._timer);
    pop._timer = window.setTimeout(closePop, 4200);
  }

  function closePop() {
    const pop = $('#ach-pop');
    if (!pop || pop.hidden) return;
    window.clearTimeout(pop._timer);
    pop.classList.remove('is-in');
    pop.classList.add('is-out');
    window.setTimeout(() => {
      pop.hidden = true;
      pop.classList.remove('is-out');
      showNext();
    }, 380);
  }

  $('#ach-pop')?.addEventListener('click', closePop);

  /* ---------- Data sources ---------- */

  function update(stats, owned, signedIn) {
    state.stats = stats || {};
    state.owned = Array.isArray(owned) ? owned.filter(id => state.defs.some(def => def.id === id)) : [];
    state.signedIn = Boolean(signedIn);
    render();
  }

  window.AceAchievements = {
    get defs() { return state.defs; },
    guestStats,
    evaluate,
    celebrate,
    update,
    render
  };

  window.addEventListener('aceminder:config', event => {
    const defs = event.detail && event.detail.achievements;
    if (Array.isArray(defs)) {
      state.defs = defs;
      window.dispatchEvent(new CustomEvent('aceminder:achievements-ready'));
      render();
    }
  });

  window.addEventListener('aceminder:language', render);
})();
