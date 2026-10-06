// Trailers page: picking a video in the playlist starts it right away on the main stage
(() => {
  const dataEl = document.getElementById('trailer-data');
  const playlist = document.getElementById('playlist');
  const stage = document.getElementById('theater-stage');
  if (!dataEl || !playlist || !stage || !window.GTAPlayer) return;

  const trailers = JSON.parse(dataEl.textContent);
  const $ = id => document.getElementById(id);

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

    window.GTAPlayer.play(stage, t.id, `Grand Theft Auto VI: ${t.title}`);
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
