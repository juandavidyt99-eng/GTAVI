// Clips page: share YouTube clips and browse them in a live grid.
(() => {
  const G = window.GTA;
  const list = document.getElementById('clips');
  if (!G || !list) return;

  const feed = G.createFeed({
    list,
    more: document.getElementById('clips-more'),
    empty: document.getElementById('clips-empty'),
    params: { category: 'clip' },
    filter: post => post.category === 'clip',
  });

  G.createComposer(document.getElementById('subir-clip'), {
    fixedCategory: 'clip',
    onPosted: post => {
      if (feed.query.sort === 'recent') feed.prepend(post);
      else feed.set({ sort: 'recent' }).then(sync);
    },
  });

  const tabs = document.querySelectorAll('.clips-head .tab');
  function sync() {
    tabs.forEach(t => t.setAttribute('aria-pressed', String(t.dataset.sort === feed.query.sort)));
  }
  tabs.forEach(t => t.addEventListener('click', () => { feed.set({ sort: t.dataset.sort }); sync(); }));

  G.onAuth(() => feed.reload());
  G.loadMe().then(() => feed.reload());
})();
