// Profile page: /perfil (your own, or sign-in form) and /u/<username> (public profile).
(() => {
  const G = window.GTA;
  if (!G) return;
  const $ = id => document.getElementById(id);
  const match = location.pathname.match(/^\/u\/([A-Za-z0-9_]{3,20})$/);
  const viewing = match ? match[1] : null;
  const dateFmt = new Intl.DateTimeFormat('es', { month: 'long', year: 'numeric' });

  const sections = ['profile-loading', 'profile-card', 'profile-edit', 'profile-auth', 'profile-missing', 'profile-posts'];
  function show(...ids) {
    sections.forEach(id => { $(id).hidden = !ids.includes(id); });
  }

  let feed = null;
  let profile = null;

  function renderCard(p, isMe) {
    profile = p;
    document.title = `${p.username} | Comunidad GTA VI`;
    $('page-title').textContent = `Perfil de ${p.username} en la comunidad GTA VI`;
    $('pc-avatar').replaceChildren(G.avatar(p.username, p.team, 'avatar-xl'));
    $('pc-name').textContent = p.username;
    const team = $('pc-team');
    team.className = p.team ? `team-badge team-${p.team}` : 'team-badge team-none';
    team.textContent = p.team ? G.TEAM[p.team] : 'Sin equipo';
    $('pc-joined').textContent = `Miembro desde ${dateFmt.format(new Date(p.createdAt))}`;
    const bio = $('pc-bio');
    bio.textContent = p.bio || (isMe ? 'Todavía no has escrito tu bio. Pulsa «Editar perfil».' : 'Sin bio por ahora.');
    bio.classList.toggle('muted', !p.bio);
    $('pc-posts').textContent = G.formatCount(p.stats.posts);
    $('pc-comments').textContent = G.formatCount(p.stats.comments);
    $('pc-likes').textContent = G.formatCount(p.stats.likesReceived);

    const actions = $('pc-actions');
    actions.replaceChildren();
    if (isMe) {
      const edit = G.el('button', 'btn btn-primary btn-sm', 'Editar perfil');
      edit.type = 'button';
      edit.addEventListener('click', openEdit);
      actions.append(edit);
    }
    const footer = $('pc-footer');
    footer.replaceChildren();
    if (isMe) {
      const out = G.el('button', 'btn-link', 'Cerrar sesión');
      out.type = 'button';
      out.dataset.logout = '';
      footer.append(out);
    }
    const share = G.el('button', 'icon-btn pc-share');
    share.type = 'button';
    share.setAttribute('aria-label', 'Compartir perfil');
    share.append(G.icon('link'));
    share.addEventListener('click', async () => {
      const url = `${location.origin}/u/${encodeURIComponent(p.username)}`;
      try {
        if (navigator.share) await navigator.share({ title: `${p.username} en GTA VI Vice City`, url });
        else {
          await navigator.clipboard.writeText(url);
          G.toast('Enlace del perfil copiado', 'success');
        }
      } catch { /* cancelled */ }
    });
    actions.append(share);

    $('profile-empty-text').textContent = isMe
      ? 'Publica tu primer debate o clip en la comunidad.'
      : 'Cuando publique algo, aparecerá aquí.';
  }

  function startFeed(username) {
    if (!feed) {
      feed = G.createFeed({
        list: $('profile-feed'),
        more: $('profile-more'),
        empty: $('profile-empty'),
        params: { user: username },
        filter: (post, q) => post.author.username.toLowerCase() === username.toLowerCase()
          && (!q.category || post.category === q.category),
      });
      document.querySelectorAll('.profile-posts .tab').forEach(tab => tab.addEventListener('click', () => {
        document.querySelectorAll('.profile-posts .tab').forEach(t => t.setAttribute('aria-pressed', String(t === tab)));
        feed.set({ category: tab.dataset.cat });
      }));
    }
    feed.set({ user: username });
  }

  // ---- Edit
  const form = $('profile-edit');
  const counter = form.querySelector('[data-bio-counter]');
  const updateCounter = () => { counter.textContent = 160 - form.bio.value.length; };
  form.bio.addEventListener('input', updateCounter);

  function openEdit() {
    form.bio.value = profile.bio || '';
    form.querySelectorAll('[name=team]').forEach(r => { r.checked = r.value === (profile.team || ''); });
    form.querySelector('[data-error]').textContent = '';
    updateCounter();
    form.hidden = false;
    form.bio.focus();
  }
  form.querySelector('[data-cancel]').addEventListener('click', () => { form.hidden = true; });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const submit = form.querySelector('[type=submit]');
    submit.disabled = true;
    try {
      const team = (form.querySelector('[name=team]:checked') || {}).value || null;
      const { user } = await G.api('/api/me', { method: 'PATCH', body: { bio: form.bio.value, team } });
      G.setMe(user);
      form.hidden = true;
      G.toast('Perfil actualizado', 'success');
    } catch (err) {
      form.querySelector('[data-error]').textContent = err.message;
    } finally {
      submit.disabled = false;
    }
  });

  // ---- Inline sign-in / sign-up
  const authForm = $('profile-auth-form');
  let mode = 'register';
  function setMode(next) {
    mode = next;
    authForm.querySelectorAll('.auth-tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.tab === mode)));
    authForm.querySelector('.auth-submit').textContent = mode === 'register' ? 'Crear cuenta' : 'Entrar';
    authForm.querySelector('[data-hint]').hidden = mode !== 'register';
    authForm.password.autocomplete = mode === 'register' ? 'new-password' : 'current-password';
    authForm.querySelector('.auth-error').textContent = '';
  }
  authForm.querySelectorAll('.auth-tab').forEach(t => t.addEventListener('click', () => setMode(t.dataset.tab)));
  authForm.addEventListener('submit', async e => {
    e.preventDefault();
    const submit = authForm.querySelector('.auth-submit');
    const error = authForm.querySelector('.auth-error');
    error.textContent = '';
    submit.disabled = true;
    try {
      const user = await G.authenticate(mode, authForm.username.value.trim(), authForm.password.value);
      G.toast(mode === 'register' ? `¡Bienvenido, ${user.username}!` : `Hola de nuevo, ${user.username}`, 'success');
    } catch (err) {
      error.textContent = err.message;
    } finally {
      submit.disabled = false;
    }
  });

  // ---- Render for the current state
  async function render(me) {
    if (!viewing) {
      if (!me) {
        document.title = 'Únete | Comunidad GTA VI';
        show('profile-auth');
        return;
      }
      renderCard(me, true);
      show('profile-card', 'profile-posts');
      startFeed(me.username);
      return;
    }
    try {
      const { user } = await G.api(`/api/users/${encodeURIComponent(viewing)}`);
      const isMe = Boolean(me && me.username.toLowerCase() === user.username.toLowerCase());
      renderCard(isMe ? me : user, isMe);
      show('profile-card', 'profile-posts');
      startFeed(user.username);
    } catch (err) {
      if (err.status === 404) {
        document.title = 'Usuario no encontrado | Comunidad GTA VI';
        show('profile-missing');
      } else {
        G.toast(err.message, 'error');
      }
    }
  }

  G.onAuth(render);
  G.loadMe().then(render);
})();
