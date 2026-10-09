// Profile page: /perfil (your own, or sign-in form) and /u/<username> (public profile).
(() => {
  const G = window.GTA;
  if (!G) return;
  const $ = id => document.getElementById(id);
  const match = location.pathname.match(/^\/u\/([A-Za-z0-9_]{3,20})$/);
  const viewing = match ? match[1] : null;
  const dateFmt = new Intl.DateTimeFormat('es', { month: 'long', year: 'numeric' });
  const COVERS = JSON.parse($('profile-covers').textContent);
  const DEFAULT_COVER = 'vice-city';
  const MAX_PHOTO_BYTES = 6 * 1024 * 1024;

  // The edit form is left alone here, so refreshing the card (e.g. after a new photo) keeps it open.
  const sections = ['profile-loading', 'profile-card', 'profile-auth', 'profile-missing', 'profile-posts'];
  function show(...ids) {
    sections.forEach(id => { $(id).hidden = !ids.includes(id); });
    if (!ids.includes('profile-card')) $('profile-edit').hidden = true;
  }

  let feed = null;
  let profile = null;

  function renderCard(p, isMe) {
    profile = p;
    document.title = `${p.username} | Comunidad GTA VI`;
    $('page-title').textContent = `Perfil de ${p.username} en la comunidad GTA VI`;
    $('pc-avatar').replaceChildren(G.avatar(p.username, p.team, 'avatar-xl', p.avatar));
    $('pc-name').textContent = p.username;
    $('pc-handle').textContent = `@${p.username}`;
    $('pc-mod').hidden = !p.moderator;
    $('pc-quick').hidden = !isMe;
    const cover = COVERS[p.cover] || COVERS[DEFAULT_COVER];
    $('profile-cover').style.setProperty('--cover', `url('${cover}')`);
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

  function paintEditAvatar() {
    $('pe-avatar').replaceChildren(G.avatar(profile.username, profile.team, 'avatar-xl', profile.avatar));
    $('pe-remove').hidden = !profile.avatar;
  }

  function openEdit() {
    form.bio.value = profile.bio || '';
    form.querySelectorAll('[name=team]').forEach(r => { r.checked = r.value === (profile.team || ''); });
    form.querySelectorAll('[name=cover]').forEach(r => { r.checked = r.value === (profile.cover || DEFAULT_COVER); });
    paintEditAvatar();
    $('pe-photo-state').textContent = 'JPG, PNG o WebP. Se recorta en cuadrado.';
    form.querySelector('[data-error]').textContent = '';
    updateCounter();
    form.hidden = false;
    form.bio.focus();
  }
  form.querySelectorAll('[name=cover]').forEach(r => r.addEventListener('change', () => {
    $('profile-cover').style.setProperty('--cover', `url('${COVERS[r.value] || COVERS[DEFAULT_COVER]}')`);
  }));
  form.querySelector('[data-cancel]').addEventListener('click', () => {
    form.hidden = true;
    $('profile-cover').style.setProperty('--cover', `url('${COVERS[profile.cover] || COVERS[DEFAULT_COVER]}')`);
  });

  // ---- Profile photo
  async function shrink(file) {
    if (file.size <= 1.5 * 1024 * 1024) return file;
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return await new Promise(resolve => canvas.toBlob(b => resolve(b || file), 'image/jpeg', 0.88));
    } catch {
      return file;
    }
  }
  const photoState = $('pe-photo-state');
  $('pe-upload').addEventListener('click', () => $('pe-file').click());
  $('pe-file').addEventListener('change', async () => {
    const file = $('pe-file').files[0];
    $('pe-file').value = '';
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { photoState.textContent = 'Solo se admiten fotos JPG, PNG o WebP.'; return; }
    photoState.textContent = 'Subiendo foto…';
    $('pe-upload').disabled = true;
    try {
      const prepared = await shrink(file);
      if (prepared.size > MAX_PHOTO_BYTES) throw new Error('La foto es demasiado grande (máximo 6 MB).');
      const res = await fetch('/api/me/avatar', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': prepared.type || 'image/jpeg' }, body: prepared,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'No se pudo subir la foto.');
      profile = { ...profile, avatar: data.user.avatar };
      G.setMe({ ...G.me, ...data.user });
      paintEditAvatar();
      photoState.textContent = '¡Foto actualizada!';
    } catch (err) {
      photoState.textContent = err.message;
    } finally {
      $('pe-upload').disabled = false;
    }
  });
  $('pe-remove').addEventListener('click', async () => {
    try {
      const { user } = await G.api('/api/me/avatar', { method: 'DELETE' });
      profile = { ...profile, avatar: null };
      G.setMe({ ...G.me, ...user });
      paintEditAvatar();
      photoState.textContent = 'Foto quitada.';
    } catch (err) {
      photoState.textContent = err.message;
    }
  });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const submit = form.querySelector('[type=submit]');
    submit.disabled = true;
    try {
      const team = (form.querySelector('[name=team]:checked') || {}).value || null;
      const cover = (form.querySelector('[name=cover]:checked') || {}).value || null;
      const { user } = await G.api('/api/me', { method: 'PATCH', body: { bio: form.bio.value, team, cover } });
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
        $('profile-cover').style.setProperty('--cover', `url('${COVERS[DEFAULT_COVER]}')`);
        $('pa-google').hidden = !G.google;
        $('pa-or').hidden = !G.google;
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
