// Trailers page: playlist swaps the video shown on the main stage
(() => {
  const dataEl = document.getElementById('trailer-data');
  const playlist = document.getElementById('playlist');
  const stage = document.getElementById('theater-stage');
  if (!dataEl || !playlist || !stage) return;

  const trailers = JSON.parse(dataEl.textContent);
  const $ = id => document.getElementById(id);
  const embed = id => `https://www.youtube.com/embed/${id}?autoplay=1&rel=0&playsinline=1`;

  function select(index) {
    const t = trailers[index];
    if (!t) return;

    playlist.querySelectorAll('.pl-item').forEach(btn => {
      btn.setAttribute('aria-current', String(Number(btn.dataset.index) === index));
    });

    $('theater-num').textContent = t.num;
    $('theater-title').textContent = t.title;
    $('theater-desc').textContent = t.desc;
    const date = $('theater-date');
    date.dateTime = t.date;
    date.textContent = t.date_h;
    $('theater-yt').href = `https://www.youtube.com/watch?v=${t.id}`;

    const iframe = stage.querySelector('iframe');
    if (iframe) {
      // Already playing: switch straight to the new video.
      iframe.src = embed(t.id);
      iframe.title = `Reproductor: ${t.title}`;
      return;
    }

    const card = $('theater-card');
    const thumb = $('theater-thumb');
    card.dataset.videoId = t.id;
    card.setAttribute('aria-label', `Reproducir ${t.title}`);
    thumb.alt = `Portada de ${t.title}`;
    thumb.dataset.ytThumb = t.id;
    thumb.src = `https://i.ytimg.com/vi/${t.id}/maxresdefault.jpg`;
    $('theater-badge').textContent = [t.kind, t.length].filter(Boolean).join(' · ');
  }

  playlist.addEventListener('click', e => {
    const btn = e.target.closest('.pl-item');
    if (!btn) return;
    select(Number(btn.dataset.index));
    if (window.matchMedia('(max-width: 900px)').matches) {
      stage.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  });
})();
