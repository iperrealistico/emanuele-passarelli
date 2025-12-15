/*
  Site-wide JavaScript
  - Theme switcher (dark/light) with persistence
  - Language switcher (IT/EN) with persistence and accessibility announcements
  - Smart media loader: prevents broken image icons (data-src -> src), shows placeholders, handles errors
  - YouTube "Video Portal": iframe-based player with loading fallback until PLAYING
  - Progressive enhancements only; page stays readable without JS
*/

(() => {
  "use strict";

  const root = document.documentElement;
  const announcer = document.querySelector('[data-announcer]');

  /* -----------------------------
     Helpers
  ------------------------------ */
  const prefersReducedMotion = () =>
    window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const safeLocalStorage = {
    get(key) {
      try { return localStorage.getItem(key); } catch { return null; }
    },
    set(key, value) {
      try { localStorage.setItem(key, value); } catch { /* ignore */ }
    }
  };

  const announce = (msg) => {
    if (!announcer) return;
    announcer.textContent = msg;
  };

  const setHtmlLang = (lang) => {
    // Keep Italian as the default in markup for SEO;
    // switch html lang for accessibility when the user explicitly toggles.
    document.documentElement.setAttribute('lang', lang);
  };

  /* -----------------------------
     Theme switcher
  ------------------------------ */
  const THEME_KEY = 'ep_theme';

  const applyTheme = (theme) => {
    const t = theme === 'light' ? 'light' : 'dark';
    root.setAttribute('data-theme', t);
    safeLocalStorage.set(THEME_KEY, t);

    // Update theme-color for supported browsers
    const metaDark = document.querySelector('meta[name="theme-color"][media*="dark"]');
    const metaLight = document.querySelector('meta[name="theme-color"][media*="light"]');
    if (metaDark && metaLight) {
      // Keep meta tags present; browser will pick by media query.
    }
  };

  const initTheme = () => {
    const saved = safeLocalStorage.get(THEME_KEY);
    if (saved) {
      applyTheme(saved);
      return;
    }

    // Respect user OS preference on first visit
    const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
    applyTheme(prefersLight ? 'light' : 'dark');
  };

  /* -----------------------------
     Language switcher
  ------------------------------ */
  const LANG_KEY = 'ep_lang';

  const applyLanguage = (lang) => {
    const l = lang === 'en' ? 'en' : 'it';
    root.setAttribute('data-language', l);
    safeLocalStorage.set(LANG_KEY, l);
    setHtmlLang(l);

    // Update segmented UI
    document.querySelectorAll('[data-action="set-language"]').forEach((btn) => {
      const isActive = btn.getAttribute('data-language') === l;
      btn.classList.toggle('is-active', isActive);
      btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });

    announce(l === 'it' ? 'Lingua impostata su Italiano' : 'Language set to English');
  };

  const initLanguage = () => {
    const saved = safeLocalStorage.get(LANG_KEY);
    if (saved) {
      applyLanguage(saved);
      return;
    }

    // Default: Italian (per requirements)
    applyLanguage('it');
  };

  /* -----------------------------
     Mobile nav toggle (minimal)
     - CSS can enhance this later; JS only toggles state.
  ------------------------------ */
  const toggleNav = () => {
    const header = document.querySelector('[data-component="header"]');
    if (!header) return;
    header.classList.toggle('is-nav-open');
  };

  /* -----------------------------
     Smart media loader
     - For images we only use data-src to avoid browser broken-image icons.
     - When the file loads: add .is-loaded to the parent figure.
     - On error: add .has-error to keep the placeholder.
  ------------------------------ */
  const initSmartMedia = () => {
    const candidates = Array.from(document.querySelectorAll('img[data-src]'));
    if (!candidates.length) return;

    const loadImg = (img) => {
      const src = img.getAttribute('data-src');
      if (!src) return;

      const holder = img.closest('[data-component="smart-media"]');

      const onLoad = () => {
        holder?.classList.add('is-loaded');
        img.removeEventListener('load', onLoad);
        img.removeEventListener('error', onError);
      };

      const onError = () => {
        holder?.classList.add('has-error');
        img.removeEventListener('load', onLoad);
        img.removeEventListener('error', onError);
      };

      img.addEventListener('load', onLoad, { once: true });
      img.addEventListener('error', onError, { once: true });

      // Start loading
      img.setAttribute('src', src);
    };

    // Use IntersectionObserver when available
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const img = entry.target;
          io.unobserve(img);
          loadImg(img);
        });
      }, { rootMargin: '250px 0px' });

      candidates.forEach((img) => io.observe(img));
    } else {
      // Fallback: load everything
      candidates.forEach(loadImg);
    }
  };

  /* -----------------------------
     Stats counter (subtle)
  ------------------------------ */
  const initStats = () => {
    const stats = Array.from(document.querySelectorAll('[data-count]'));
    if (!stats.length) return;

    if (prefersReducedMotion()) return;

    const animate = (el) => {
      const raw = el.getAttribute('data-count') || '';
      const num = Number(String(raw).replace(/[^0-9.]/g, ''));
      if (!Number.isFinite(num) || num <= 0) return;

      const suffix = raw.includes('+') ? '+' : '';
      const duration = 850;
      const start = performance.now();

      const step = (t) => {
        const p = Math.min(1, (t - start) / duration);
        const eased = 1 - Math.pow(1 - p, 3);
        const value = Math.round(num * eased);
        el.textContent = `${value}${suffix}`;
        if (p < 1) requestAnimationFrame(step);
      };

      requestAnimationFrame(step);
    };

    const seen = new WeakSet();

    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          if (seen.has(entry.target)) return;
          seen.add(entry.target);
          animate(entry.target);
        });
      }, { threshold: 0.35 });

      stats.forEach((el) => io.observe(el));
    } else {
      stats.forEach(animate);
    }
  };

  /* -----------------------------
     YouTube Video Portal
     - We keep iframe-based YouTube, but mount it into the portal.
     - Placeholder stays until player state is PLAYING.
     - A premium overlay button triggers playback if autoplay is blocked.
  ------------------------------ */
  const YT_STATE = {
    UNSTARTED: -1,
    ENDED: 0,
    PLAYING: 1,
    PAUSED: 2,
    BUFFERING: 3,
    CUED: 5
  };

  let ytApiPromise = null;

  const loadYouTubeApi = () => {
    if (ytApiPromise) return ytApiPromise;

    ytApiPromise = new Promise((resolve) => {
      // If already available
      if (window.YT && window.YT.Player) {
        resolve(window.YT);
        return;
      }

      const existing = document.querySelector('script[data-youtube-iframe-api]');
      if (existing) {
        // Wait for global callback
        const prev = window.onYouTubeIframeAPIReady;
        window.onYouTubeIframeAPIReady = () => {
          prev && prev();
          resolve(window.YT);
        };
        return;
      }

      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.async = true;
      s.defer = true;
      s.setAttribute('data-youtube-iframe-api', 'true');
      document.head.appendChild(s);

      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        prev && prev();
        resolve(window.YT);
      };
    });

    return ytApiPromise;
  };

  const initVideoPortals = async () => {
    const portals = Array.from(document.querySelectorAll('.videoPortal[data-video="youtube"]'));
    if (!portals.length) return;

    // Do not force autoplay if user asked for reduced motion.
    // We still mount the player, but keep overlay until user clicks.
    const reduce = prefersReducedMotion();

    const YT = await loadYouTubeApi();

    portals.forEach((portal) => {
      const mount = portal.querySelector('[data-video-mount]');
      const startBtn = portal.querySelector('[data-action="start-video"]');
      const videoId = portal.getAttribute('data-youtube-id');
      const start = Number(portal.getAttribute('data-start') || '0');
      const end = Number(portal.getAttribute('data-end') || '0');

      if (!mount || !videoId) return;

      // Create a stable ID for the mount
      if (!mount.id) {
        mount.id = `yt-${Math.random().toString(16).slice(2)}`;
      }

      // Player vars
      const playerVars = {
        autoplay: reduce ? 0 : 1,
        controls: 0,
        modestbranding: 1,
        rel: 0,
        playsinline: 1,
        iv_load_policy: 3,
        fs: 0,
        disablekb: 1,
        start: start > 0 ? start : undefined,
        end: end > 0 ? end : undefined,
        mute: 1
      };

      // YouTube API expects no undefined properties
      Object.keys(playerVars).forEach((k) => {
        if (playerVars[k] === undefined) delete playerVars[k];
      });

      let loopTimer = null;

      const clearLoop = () => {
        if (loopTimer) {
          window.clearInterval(loopTimer);
          loopTimer = null;
        }
      };

      const ensureLoop = (player) => {
        // Reliable loop between start/end via a light interval check
        if (!(start > 0 && end > 0 && end > start)) return;
        clearLoop();

        loopTimer = window.setInterval(() => {
          try {
            const t = player.getCurrentTime();
            if (t >= end - 0.15) {
              player.seekTo(start, true);
            }
          } catch {
            // ignore
          }
        }, 250);
      };

      // Create the player
      const player = new YT.Player(mount.id, {
        videoId,
        playerVars,
        events: {
          onReady: (ev) => {
            try {
              ev.target.mute();

              if (!reduce) {
                // Try to start automatically
                ev.target.playVideo();
              }
            } catch {
              // ignore
            }
          },
          onStateChange: (ev) => {
            const state = ev.data;

            if (state === YT_STATE.PLAYING) {
              portal.classList.add('is-playing');
              ensureLoop(ev.target);
            }

            if (state === YT_STATE.ENDED) {
              // Loop if needed
              if (start > 0) {
                try { ev.target.seekTo(start, true); ev.target.playVideo(); } catch { /* ignore */ }
              }
            }

            // If buffering/unstarted, keep placeholder visible (no action)
          }
        }
      });

      // Overlay "start" control
      if (startBtn) {
        startBtn.addEventListener('click', () => {
          try {
            player.mute();
            player.playVideo();
          } catch {
            // ignore
          }
        });
      }

      // Safety: if after a while it doesn't play, keep overlay visible (already default)
      window.setTimeout(() => {
        if (!portal.classList.contains('is-playing')) {
          // No intrusive UI; just keep the portal in its placeholder state.
        }
      }, 4500);

      // Pause when the portal leaves viewport (performance-friendly)
      if ('IntersectionObserver' in window) {
        const io = new IntersectionObserver((entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) return;
            try { player.pauseVideo(); } catch { /* ignore */ }
          });
        }, { threshold: 0.05 });

        io.observe(portal);
      }

      // Cleanup loop on pagehide
      window.addEventListener('pagehide', () => {
        clearLoop();
      }, { once: true });
    });
  };

  /* -----------------------------
     Global click handler
  ------------------------------ */
  const initActions = () => {
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;

      const action = btn.getAttribute('data-action');

      if (action === 'toggle-theme') {
        const current = root.getAttribute('data-theme') || 'dark';
        const next = current === 'dark' ? 'light' : 'dark';
        applyTheme(next);
        announce(next === 'dark' ? 'Tema scuro attivo' : 'Tema chiaro attivo');
        return;
      }

      if (action === 'set-language') {
        const lang = btn.getAttribute('data-language') || 'it';
        applyLanguage(lang);
        return;
      }

      if (action === 'toggle-nav') {
        toggleNav();
        return;
      }
    });
  };

  /* -----------------------------
     Year
  ------------------------------ */
  const initYear = () => {
    const el = document.querySelector('[data-year]');
    if (!el) return;
    el.textContent = String(new Date().getFullYear());
  };

  /* -----------------------------
     Init
  ------------------------------ */
  const init = () => {
    initTheme();
    initLanguage();
    initActions();
    initSmartMedia();
    initStats();
    initYear();

    // Video portals depend on the YouTube API
    initVideoPortals();

    // Optional: GSAP enhancements if present
    // Keep it minimal; page must remain smooth without it.
    if (!prefersReducedMotion() && window.gsap && window.ScrollTrigger) {
      try {
        window.gsap.registerPlugin(window.ScrollTrigger);
        window.gsap.utils.toArray('.section').forEach((sec) => {
          window.gsap.fromTo(sec, { opacity: 0, y: 18 }, {
            opacity: 1,
            y: 0,
            duration: 0.9,
            ease: 'power3.out',
            scrollTrigger: { trigger: sec, start: 'top 85%' }
          });
        });
      } catch {
        // ignore
      }
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
