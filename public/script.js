// Countdown to release date
const countdownEl = document.getElementById('countdown');
if (countdownEl) {
  const target = new Date(countdownEl.dataset.target).getTime();
  const daysEl = document.getElementById('cd-days');
  const hoursEl = document.getElementById('cd-hours');
  const minutesEl = document.getElementById('cd-minutes');
  const secondsEl = document.getElementById('cd-seconds');

  function pad(n) { return String(n).padStart(2, '0'); }

  function updateCountdown() {
    const diff = target - Date.now();
    if (diff <= 0) {
      daysEl.textContent = '00';
      hoursEl.textContent = '00';
      minutesEl.textContent = '00';
      secondsEl.textContent = '00';
      clearInterval(countdownTimer);
      return;
    }
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
    const minutes = Math.floor((diff / (1000 * 60)) % 60);
    const seconds = Math.floor((diff / 1000) % 60);
    daysEl.textContent = pad(days);
    hoursEl.textContent = pad(hours);
    minutesEl.textContent = pad(minutes);
    secondsEl.textContent = pad(seconds);
  }

  updateCountdown();
  const countdownTimer = setInterval(updateCountdown, 1000);
}

// Transparent navbar that solidifies on scroll
const navbar = document.getElementById('navbar');
const updateNavbar = () => {
  navbar?.classList.toggle('scrolled', window.scrollY > 40);
};
window.addEventListener('scroll', updateNavbar, { passive: true });
updateNavbar();

// Hero image sliders (desktop + mobile tracks, each independent)
function initSlider(track) {
  const slides = Array.from(track.querySelectorAll('.slide'));
  const dotsWrap = track.querySelector('.slider-dots');
  const prevBtn = track.querySelector('.slider-arrow.prev');
  const nextBtn = track.querySelector('.slider-arrow.next');
  let current = 0;
  let timer;

  slides.forEach((_, i) => {
    const dot = document.createElement('button');
    dot.className = 'dot' + (i === 0 ? ' active' : '');
    dot.setAttribute('aria-label', `Ir a la imagen ${i + 1}`);
    dot.addEventListener('click', () => goTo(i));
    dotsWrap.appendChild(dot);
  });
  const dots = Array.from(dotsWrap.querySelectorAll('.dot'));

  function goTo(index) {
    slides[current].classList.remove('active');
    dots[current].classList.remove('active');
    current = (index + slides.length) % slides.length;
    slides[current].classList.add('active');
    dots[current].classList.add('active');
    resetTimer();
  }

  function next() { goTo(current + 1); }
  function prev() { goTo(current - 1); }

  function resetTimer() {
    clearInterval(timer);
    timer = setInterval(next, 5500);
  }

  nextBtn?.addEventListener('click', next);
  prevBtn?.addEventListener('click', prev);
  resetTimer();
}

document.querySelectorAll('.hero-track').forEach(initSlider);

// Navbar mobile toggle
const menuToggle = document.querySelector('.menu-toggle');
const navLinks = document.querySelector('.nav-links');

function setMenu(open) {
  navLinks.classList.toggle('open', open);
  menuToggle.classList.toggle('open', open);
  menuToggle.setAttribute('aria-expanded', String(open));
  menuToggle.setAttribute('aria-label', open ? 'Cerrar menú' : 'Abrir menú');
}

menuToggle?.addEventListener('click', () => setMenu(!navLinks.classList.contains('open')));

// Close mobile menu after clicking a link or pressing Escape
document.querySelectorAll('.nav-links a').forEach(link => {
  link.addEventListener('click', () => setMenu(false));
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && navLinks?.classList.contains('open')) {
    setMenu(false);
    menuToggle.focus();
  }
});

// News feed category filter
const newsFilters = document.getElementById('news-filters');
const newsFeed = document.getElementById('news-feed');
if (newsFilters && newsFeed) {
  const items = newsFeed.querySelectorAll('[data-category]');
  newsFilters.addEventListener('click', (e) => {
    const btn = e.target.closest('.feed-filter');
    if (!btn) return;
    newsFilters.querySelectorAll('.feed-filter').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const filter = btn.dataset.filter;
    items.forEach(item => {
      const show = filter === 'all' || item.dataset.category === filter;
      item.classList.toggle('news-hidden', !show);
    });
  });
}

// Trailers: the YouTube player only loads when someone presses play.
// Posters are hosted on this site, so the cards look right even if YouTube's image servers are slow.
window.GTAPlayer = {
  frame(id, title) {
    const iframe = document.createElement('iframe');
    iframe.src = `https://www.youtube.com/embed/${id}?autoplay=1&rel=0&playsinline=1`;
    iframe.title = title || 'Reproductor de YouTube';
    iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen';
    // YouTube rejects embeds that arrive without a referrer (player error 153).
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    iframe.allowFullscreen = true;
    return iframe;
  },
  play(stage, id, title) {
    const live = document.createElement('div');
    live.className = 'video-live';
    live.appendChild(this.frame(id, title));
    stage.replaceChildren(live);
    stage.dataset.playing = id;
  },
};

document.addEventListener('click', e => {
  const card = e.target.closest('.video-card[data-video-id]');
  if (!card) return;
  const title = card.dataset.title || card.getAttribute('aria-label') || '';
  const stage = card.closest('[data-player-stage]');
  if (stage) {
    window.GTAPlayer.play(stage, card.dataset.videoId, title);
  } else {
    const holder = document.createElement('div');
    card.replaceWith(holder);
    window.GTAPlayer.play(holder, card.dataset.videoId, title);
    holder.replaceWith(holder.firstChild);
  }
});

// Home video player: the list on the side swaps and plays the video on the big screen
document.querySelectorAll('[data-tv]').forEach(tv => {
  const stage = tv.querySelector('[data-player-stage]');
  const items = tv.querySelectorAll('[data-tv-item]');
  const set = (sel, fn) => { const el = tv.querySelector(sel); if (el) fn(el); };
  items.forEach(btn => btn.addEventListener('click', () => {
    items.forEach(b => b.setAttribute('aria-current', String(b === btn)));
    set('[data-tv-num]', el => { el.textContent = btn.dataset.num; });
    set('[data-tv-title]', el => { el.textContent = btn.dataset.title; });
    set('[data-tv-desc]', el => { el.textContent = btn.dataset.desc; });
    set('[data-tv-meta]', el => { el.textContent = btn.dataset.meta; });
    set('[data-tv-yt]', el => { el.href = `https://www.youtube.com/watch?v=${btn.dataset.videoId}`; });
    window.GTAPlayer.play(stage, btn.dataset.videoId, `Grand Theft Auto VI: ${btn.dataset.title}`);
    if (window.matchMedia('(max-width: 900px)').matches) stage.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }));
});

// "Faltan X días" badges
document.querySelectorAll('[data-days-left]').forEach(el => {
  const target = new Date(el.dataset.daysLeft).getTime();
  const days = Math.ceil((target - Date.now()) / 86400000);
  const out = el.querySelector('strong') || el;
  if (days > 1) out.textContent = String(days);
  else el.textContent = days === 1 ? '¡GTA VI sale mañana!' : '¡GTA VI ya está disponible!';
});

// Fade-in on scroll
const revealEls = document.querySelectorAll([
  '.block-head, .news-top, .feed-head, .story-card, .video-item, .region-card, .duo-card-bio, .spec',
  '.news-featured, .news-card, .trailer-note, .region-detail, .profile, .duo-fact, .cast-card',
  '.feature-card, .soon-card, .cta-card, .hub-card',
  '.hm-card, .tv, .ed-card, .hm-tile, .hm-join, .hm-guide, .ar-card',
].join(', '));
if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.05, rootMargin: '0px 0px -40px 0px' });

  revealEls.forEach(el => {
    el.classList.add('reveal');
    observer.observe(el);
  });
}

// Account state for the menus: the bottom bar shows your initial when you're logged in.
if (document.querySelector('[data-nav-avatar]')) {
  window.GTA_ME = window.GTA_ME || fetch('/api/me', { credentials: 'same-origin' })
    .then(res => (res.ok ? res.json() : null))
    .catch(() => null);

  window.GTANav = {
    render(user) {
      document.querySelectorAll('[data-nav-avatar]').forEach(slot => {
        if (!slot.dataset.icon) slot.dataset.icon = slot.innerHTML;
        if (user) {
          let hue = 0;
          for (const ch of user.username) hue = (hue * 31 + ch.codePointAt(0)) % 360;
          slot.textContent = user.username.charAt(0).toUpperCase();
          slot.style.background = `linear-gradient(135deg, hsl(${hue} 75% 52%), hsl(${(hue + 50) % 360} 70% 38%))`;
          slot.classList.add('has-user');
          if (user.avatar && /^[a-f0-9]{24}$/.test(user.avatar)) {
            const img = document.createElement('img');
            img.src = `/media/chat/${user.avatar}_a.webp`;
            img.alt = '';
            img.addEventListener('error', () => img.remove());
            slot.append(img);
          }
        } else {
          slot.innerHTML = slot.dataset.icon;
          slot.style.background = '';
          slot.classList.remove('has-user');
        }
      });
    },
  };
  window.GTA_ME.then(data => window.GTANav.render(data && data.user));
}
