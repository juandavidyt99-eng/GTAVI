// Countdown to release date
const countdownEl = document.getElementById('countdown');
if (countdownEl) {
  const target = new Date(countdownEl.dataset.target).getTime();
  const daysEl = document.getElementById('cd-days');
  const hoursEl = document.getElementById('cd-hours');
  const minutesEl = document.getElementById('cd-minutes');

  function pad(n) { return String(n).padStart(2, '0'); }

  function updateCountdown() {
    const diff = target - Date.now();
    if (diff <= 0) {
      daysEl.textContent = '00';
      hoursEl.textContent = '00';
      minutesEl.textContent = '00';
      clearInterval(countdownTimer);
      return;
    }
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
    const minutes = Math.floor((diff / (1000 * 60)) % 60);
    daysEl.textContent = pad(days);
    hoursEl.textContent = pad(hours);
    minutesEl.textContent = pad(minutes);
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

// Hero image slider
const slider = document.getElementById('hero-slider');
if (slider) {
  const slides = Array.from(slider.querySelectorAll('.slide'));
  const dotsWrap = document.getElementById('slider-dots');
  const prevBtn = document.querySelector('.slider-arrow.prev');
  const nextBtn = document.querySelector('.slider-arrow.next');
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

// Play button placeholder interaction
document.querySelector('.play-btn')?.addEventListener('click', () => {
  alert('Aquí se reproduciría el tráiler oficial de GTA VI.');
});

// Fade-in on scroll
const revealEls = document.querySelectorAll('.section, .hero-content');
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.style.opacity = '1';
      entry.target.style.transform = 'translateY(0)';
    }
  });
}, { threshold: 0.15 });

revealEls.forEach(el => {
  el.style.opacity = '0';
  el.style.transform = 'translateY(30px)';
  el.style.transition = 'opacity 0.8s ease, transform 0.8s ease';
  observer.observe(el);
});
