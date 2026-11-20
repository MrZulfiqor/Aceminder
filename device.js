'use strict';

/* Detects phone or desktop and sets <html data-device="phone|desktop">.
   Loaded without defer in <head> so the right mode is applied before the first paint,
   then kept up to date when the window is resized or the device is rotated. */

(function () {
  const root = document.documentElement;
  const PHONE_UA = /Android.+Mobile|iPhone|iPod|Windows Phone|BlackBerry|Opera Mini|IEMobile|Mobile Safari/i;

  function detect() {
    const width = window.innerWidth || root.clientWidth;
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    const noHover = window.matchMedia('(hover: none)').matches;
    const shortSide = Math.min(window.screen.width || width, window.screen.height || width);
    const hinted = navigator.userAgentData && typeof navigator.userAgentData.mobile === 'boolean'
      ? navigator.userAgentData.mobile
      : PHONE_UA.test(navigator.userAgent);

    if (hinted) return 'phone';
    /* Touch-only screens with a small short side are phones; tablets stay on desktop mode. */
    if (coarse && noHover && shortSide < 600) return 'phone';
    /* A desktop window squeezed to phone width gets the phone layout too. */
    if (width <= 680) return 'phone';
    return 'desktop';
  }

  function apply() {
    const mode = detect();
    root.dataset.touch = window.matchMedia('(pointer: coarse)').matches ? 'yes' : 'no';
    if (root.dataset.device === mode) return;
    const previous = root.dataset.device;
    root.dataset.device = mode;
    window.AceDevice.mode = mode;
    if (previous) {
      window.dispatchEvent(new CustomEvent('aceminder:device', { detail: { mode, previous } }));
    }
  }

  window.AceDevice = {
    mode: 'desktop',
    isPhone: () => root.dataset.device === 'phone',
    vibrate(pattern) {
      /* Browsers refuse (and log an error) before the person has tapped the page. */
      const activated = !navigator.userActivation || navigator.userActivation.hasBeenActive;
      if (root.dataset.device === 'phone' && activated && typeof navigator.vibrate === 'function') {
        try { navigator.vibrate(pattern); } catch { /* not allowed here */ }
      }
    }
  };

  apply();

  let timer = 0;
  const later = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(apply, 120);
  };
  window.addEventListener('resize', later, { passive: true });
  window.addEventListener('orientationchange', later);
  ['(pointer: coarse)', '(hover: none)'].forEach(query => {
    const list = window.matchMedia(query);
    if (typeof list.addEventListener === 'function') list.addEventListener('change', apply);
  });

  /* ---------- Phone bottom tab bar ---------- */

  function setupTabbar() {
    const bar = document.querySelector('#tabbar');
    if (!bar) return;
    const tabs = Array.from(bar.querySelectorAll('[data-tab-target]'));

    const keyTab = bar.querySelector('#tab-key');
    const keyPill = document.querySelector('#open-key-dialog');
    if (keyTab && keyPill) {
      keyTab.addEventListener('click', () => keyPill.click());
      const syncKey = () => keyTab.classList.toggle('is-ready', keyPill.classList.contains('is-ready'));
      new MutationObserver(syncKey).observe(keyPill, { attributes: true, attributeFilter: ['class'] });
      syncKey();
    }

    tabs.forEach(tab => tab.addEventListener('click', () => window.AceDevice.vibrate(8)));

    if (!('IntersectionObserver' in window)) return;
    const sections = tabs
      .map(tab => document.querySelector(tab.dataset.tabTarget))
      .filter(Boolean);
    /* The active tab is whichever section crosses the middle of the screen. */
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        tabs.forEach(tab => {
          const active = tab.dataset.tabTarget === `#${entry.target.id}`;
          tab.classList.toggle('is-active', active);
          if (active) tab.setAttribute('aria-current', 'location');
          else tab.removeAttribute('aria-current');
        });
      });
    }, { rootMargin: '-48% 0px -48% 0px', threshold: 0 });
    sections.forEach(section => observer.observe(section));
  }

  document.addEventListener('DOMContentLoaded', setupTabbar);
})();
