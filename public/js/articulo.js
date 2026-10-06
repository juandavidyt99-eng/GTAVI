// Article pages: reading progress bar and share buttons
(() => {
  const bar = document.getElementById('ar-progress-bar');
  const body = document.getElementById('ar-body');
  if (bar && body) {
    let ticking = false;
    const update = () => {
      ticking = false;
      const rect = body.getBoundingClientRect();
      const total = rect.height - window.innerHeight * 0.6;
      const done = Math.min(1, Math.max(0, -rect.top / (total > 0 ? total : 1)));
      bar.style.transform = `scaleX(${done})`;
    };
    window.addEventListener('scroll', () => {
      if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }, { passive: true });
    update();
  }

  document.querySelectorAll('[data-share-copy]').forEach(btn => {
    const label = btn.textContent;
    btn.addEventListener('click', async () => {
      const url = btn.dataset.shareCopy;
      try {
        if (navigator.share && window.matchMedia('(pointer: coarse)').matches) {
          await navigator.share({ title: btn.closest('[data-share]')?.dataset.title || document.title, url });
          return;
        }
        await navigator.clipboard.writeText(url);
        btn.textContent = '¡Enlace copiado!';
      } catch {
        if (!navigator.share) btn.textContent = 'No se pudo copiar';
      }
      setTimeout(() => { btn.textContent = label; }, 2200);
    });
  });
})();
