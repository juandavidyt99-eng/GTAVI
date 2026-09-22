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

menuToggle?.addEventListener('click', () => {
  navLinks.classList.toggle('open');
  menuToggle.classList.toggle('open');
});

// Close mobile menu after clicking a link
document.querySelectorAll('.nav-links a').forEach(link => {
  link.addEventListener('click', () => {
    navLinks.classList.remove('open');
    menuToggle.classList.remove('open');
  });
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

// Trailers: load the YouTube player only when clicked
document.querySelectorAll('.video-card[data-video-id]').forEach(card => {
  card.addEventListener('click', () => {
    const live = document.createElement('div');
    live.className = 'video-live';
    const iframe = document.createElement('iframe');
    iframe.src = `https://www.youtube.com/embed/${card.dataset.videoId}?autoplay=1&rel=0`;
    iframe.title = card.getAttribute('aria-label');
    iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
    iframe.allowFullscreen = true;
    live.appendChild(iframe);
    card.replaceWith(live);
  });
});

// Fade-in on scroll
const revealEls = document.querySelectorAll('.block-head, .news-top, .feed-head, .story-card, .video-item, .leonida-grid, .duo-img, .duo-bio, .spec');
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
