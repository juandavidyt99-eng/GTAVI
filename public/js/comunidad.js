// Community page: composer, live feed with sorting/filters, and the "me" sidebar card.
(() => {
  const G = window.GTA;
  const list = document.getElementById('feed');
  if (!G || !list) return;

  const feed = G.createFeed({
    list,
    more: document.getElementById('feed-more'),
    empty: document.getElementById('feed-empty'),
    filter: (post, q) => !q.category || post.category === q.category,
  });

  G.createComposer(document.getElementById('composer'), {
    onPosted: post => {
      const q = feed.query;
      if (q.sort === 'recent' && (!q.category || q.category === post.category)) feed.prepend(post);
      else feed.set({ sort: 'recent', category: '' }).then(syncControls);
    },
  });

  const tabs = document.querySelectorAll('.social-toolbar .tab');
  const chips = document.querySelectorAll('#feed-chips .chip');
  function syncControls() {
    tabs.forEach(t => t.setAttribute('aria-pressed', String(t.dataset.sort === feed.query.sort)));
    chips.forEach(c => c.setAttribute('aria-pressed', String(c.dataset.cat === (feed.query.category || ''))));
  }
  tabs.forEach(t => t.addEventListener('click', () => { feed.set({ sort: t.dataset.sort }); syncControls(); }));
  chips.forEach(c => c.addEventListener('click', () => { feed.set({ category: c.dataset.cat }); syncControls(); }));

  // Sidebar: who am I
  const card = document.getElementById('me-card');
  function renderMe(user) {
    card.replaceChildren();
    if (!user) {
      card.append(
        G.el('h2', null, 'Únete a la comunidad'),
        G.el('p', 'side-text', 'Crea tu cuenta gratis para publicar, comentar, dar me gusta y entrar al chat.'),
      );
      const actions = G.el('div', 'side-actions');
      const reg = G.el('button', 'btn btn-primary btn-sm', 'Crear cuenta');
      reg.type = 'button';
      reg.dataset.openAuth = 'register';
      const log = G.el('button', 'btn-link', 'Ya tengo cuenta');
      log.type = 'button';
      log.dataset.openAuth = 'login';
      actions.append(reg, log);
      card.append(actions);
      return;
    }
    const row = G.el('a', 'me-row');
    row.href = '/perfil';
    const info = G.el('div');
    info.append(G.el('strong', null, user.username), G.el('span', 'me-team', user.team ? G.TEAM[user.team] : 'Sin equipo'));
    row.append(G.avatar(user.username, user.team, 'avatar-lg', user.avatar), info);
    const stats = G.el('dl', 'me-stats');
    [['Posts', user.stats.posts], ['Coment.', user.stats.comments], ['Me gusta', user.stats.likesReceived]].forEach(([k, v]) => {
      const d = G.el('div');
      d.append(G.el('dd', null, G.formatCount(v)), G.el('dt', null, k));
      stats.append(d);
    });
    const link = G.el('a', 'btn btn-outline btn-sm', 'Ver mi perfil');
    link.href = '/perfil';
    card.append(row, stats, link);
  }
  G.onAuth(user => {
    renderMe(user);
    feed.reload();
  });
  G.loadMe().then(user => {
    renderMe(user);
    feed.reload();
  });

  // Online counter in the sidebar
  const socket = G.getSocket();
  const online = document.getElementById('side-online');
  if (socket && online) socket.on('chat:online', n => { online.textContent = n; });
})();
