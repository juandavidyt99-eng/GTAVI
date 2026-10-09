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
        G.el('p', 'side-text', 'Entra gratis para publicar, comentar, dar me gusta y hablar en el chat.'),
      );
      const actions = G.el('div', 'side-actions');
      if (G.google) {
        const google = G.el('a', 'auth-google auth-google-sm');
        google.href = `/api/auth/google?next=${encodeURIComponent(location.pathname)}`;
        google.innerHTML = '<svg class="auth-google-g" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg><span>Continuar con Google</span>';
        actions.append(google);
      } else {
        const reg = G.el('button', 'btn btn-primary btn-sm', 'Crear cuenta');
        reg.type = 'button';
        reg.dataset.openAuth = 'register';
        const log = G.el('button', 'btn-link', 'Ya tengo cuenta');
        log.type = 'button';
        log.dataset.openAuth = 'login';
        actions.append(reg, log);
      }
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
  if (socket) {
    socket.on('chat:online', n => {
      if (online) online.textContent = n;
      document.querySelectorAll('[data-online-count]').forEach(b => { b.textContent = n; });
      document.querySelectorAll('[data-online-pill]').forEach(p => { p.hidden = !(n > 0); });
    });
  }
})();
