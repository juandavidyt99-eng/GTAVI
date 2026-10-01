// News page: filter cards by category (Oficial / Noticias / Filtraciones / Rumores)
(() => {
  const chips = document.getElementById('news-chips');
  const grid = document.getElementById('news-grid');
  const empty = document.getElementById('news-empty');
  const status = document.getElementById('news-status');
  if (!chips || !grid) return;

  const cards = Array.from(grid.querySelectorAll('.news-card'));
  const buttons = Array.from(chips.querySelectorAll('.chip'));

  function apply(filter) {
    let visible = 0;
    cards.forEach(card => {
      const show = filter === 'all' || card.dataset.category === filter;
      card.hidden = !show;
      if (show) visible++;
    });
    buttons.forEach(btn => btn.setAttribute('aria-pressed', String(btn.dataset.filter === filter)));
    empty.hidden = visible > 0;
    status.textContent = `${visible} ${visible === 1 ? 'noticia' : 'noticias'}`;
  }

  chips.addEventListener('click', e => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    apply(btn.dataset.filter);
    btn.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  });

  empty?.querySelector('[data-filter-reset]')?.addEventListener('click', () => apply('all'));
})();
