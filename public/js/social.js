// Shared client for the community: API, accounts, realtime socket and the post/feed UI.
window.GTA = (() => {
  const CATEGORY = {
    debate: { label: 'Debate', cls: 'tag-noticia' },
    teoria: { label: 'Teoría', cls: 'tag-teoria' },
    leonida: { label: 'Leonida', cls: 'tag-oficial' },
    noticias: { label: 'Noticias', cls: 'tag-rumor' },
    clip: { label: 'Clip', cls: 'tag-filtracion' },
  };
  const TEAM = { jason: 'Equipo Jason', lucia: 'Equipo Lucia' };
  const SVG = {
    heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z"/>',
    reply: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    send: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
  };
  const GOOGLE_G = '<svg class="auth-google-g" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';

  // ---------------------------------------------------------------- helpers
  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function icon(name) {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('aria-hidden', 'true');
    s.setAttribute('class', 'icon');
    s.innerHTML = SVG[name];
    return s;
  }

  function hue(name) {
    let h = 0;
    for (const ch of name) h = (h * 31 + ch.codePointAt(0)) % 360;
    return h;
  }

  function avatar(name, team, size = '') {
    const a = el('span', `avatar ${size}${team ? ` avatar-${team}` : ''}`, name.charAt(0).toUpperCase());
    a.style.background = `linear-gradient(135deg, hsl(${hue(name)} 75% 52%), hsl(${(hue(name) + 50) % 360} 70% 38%))`;
    a.setAttribute('aria-hidden', 'true');
    return a;
  }

  const rtf = new Intl.RelativeTimeFormat('es', { numeric: 'auto', style: 'short' });
  const dateFmt = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', year: 'numeric' });
  function timeAgo(iso) {
    const diff = (new Date(iso).getTime() - Date.now()) / 1000;
    if (Math.abs(diff) < 45) return 'ahora';
    for (const [unit, secs] of [['day', 86400], ['hour', 3600], ['minute', 60]]) {
      if (Math.abs(diff) >= secs) {
        if (unit === 'day' && Math.abs(diff) > 7 * 86400) return dateFmt.format(new Date(iso));
        return rtf.format(Math.round(diff / secs), unit);
      }
    }
    return 'ahora';
  }
  function timeEl(iso) {
    const t = el('time', 'post-time', timeAgo(iso));
    t.dateTime = new Date(iso).toISOString();
    t.title = new Date(iso).toLocaleString('es');
    t.dataset.live = '';
    return t;
  }
  setInterval(() => {
    document.querySelectorAll('time[data-live]').forEach(t => { t.textContent = timeAgo(t.dateTime); });
  }, 60 * 1000);

  function formatCount(n) {
    return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace('.', ',')} mil` : String(n);
  }

  let toastWrap;
  function toast(message, type = 'info') {
    if (!toastWrap) {
      toastWrap = el('div', 'toast-wrap');
      toastWrap.setAttribute('role', 'status');
      toastWrap.setAttribute('aria-live', 'polite');
      document.body.append(toastWrap);
    }
    const t = el('div', `toast toast-${type}`, message);
    toastWrap.append(t);
    setTimeout(() => t.classList.add('out'), 3200);
    setTimeout(() => t.remove(), 3600);
  }

  async function api(path, { method = 'GET', body } = {}) {
    const res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || 'Error de conexión. Inténtalo de nuevo.');
      err.status = res.status;
      throw err;
    }
    return data;
  }

  // ---------------------------------------------------------------- account
  let me = null;
  let mePromise = null;
  let googleEnabled = false;
  const authListeners = new Set();

  function loadMe(force = false) {
    if (!mePromise || force) {
      const initial = !force && window.GTA_ME ? window.GTA_ME : api('/api/me');
      mePromise = Promise.resolve(initial)
        .then(d => { me = (d && d.user) || null; googleEnabled = Boolean(d && d.google); return me; })
        .catch(() => { me = null; return null; });
    }
    return mePromise;
  }

  function setMe(user) {
    me = user;
    mePromise = Promise.resolve(user);
    window.GTA_ME = Promise.resolve({ enabled: true, user, google: googleEnabled });
    authListeners.forEach(fn => fn(me));
    if (window.GTANav) window.GTANav.render(me);
  }

  function onAuth(fn) {
    authListeners.add(fn);
  }

  async function authenticate(mode, username, password) {
    await api(`/api/auth/${mode}`, { method: 'POST', body: { username, password } });
    const data = await api('/api/me');
    setMe(data.user);
    refreshSocket();
    return data.user;
  }

  async function logout() {
    await api('/api/auth/logout', { method: 'POST', body: {} }).catch(() => {});
    setMe(null);
    refreshSocket();
    toast('Sesión cerrada');
  }

  // ---------------------------------------------------------------- auth dialog
  let dialog;
  let dialogMode = 'login';
  let afterAuth = null;

  function buildDialog() {
    dialog = el('dialog', 'auth-dialog');
    dialog.setAttribute('aria-labelledby', 'gta-auth-title');
    dialog.innerHTML = `
      <form method="dialog" class="auth-close-form"><button class="auth-close" aria-label="Cerrar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">${SVG.close}</svg></button></form>
      <div class="auth-brand">GTA<span>VI</span> <small>Comunidad</small></div>
      <h2 class="auth-title" id="gta-auth-title">Entrar</h2>
      <p class="auth-reason" hidden></p>
      <a class="auth-google" href="/api/auth/google" hidden>${GOOGLE_G}<span>Continuar con Google</span></a>
      <p class="auth-or" hidden><span>o con usuario y contraseña</span></p>
      <div class="auth-tabs" role="tablist">
        <button type="button" role="tab" class="auth-tab" data-tab="login" aria-selected="true">Entrar</button>
        <button type="button" role="tab" class="auth-tab" data-tab="register" aria-selected="false">Crear cuenta</button>
      </div>
      <form class="auth-form" novalidate>
        <label>Usuario<input name="username" type="text" autocomplete="username" maxlength="20" required spellcheck="false" autocapitalize="off"></label>
        <label>Contraseña<input name="password" type="password" autocomplete="current-password" maxlength="72" required></label>
        <p class="auth-hint" hidden>Usuario: 3 a 20 letras, números o guion bajo. Contraseña: mínimo 8 caracteres.</p>
        <p class="auth-error" role="alert"></p>
        <button type="submit" class="btn btn-primary auth-submit">Entrar</button>
      </form>
      <p class="auth-legal">Al unirte aceptas las normas de la comunidad: respeto, sin spam y spoilers marcados.</p>`;
    document.body.append(dialog);

    const form = dialog.querySelector('.auth-form');
    dialog.querySelectorAll('.auth-tab').forEach(tab => tab.addEventListener('click', () => setDialogMode(tab.dataset.tab)));
    dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const error = dialog.querySelector('.auth-error');
      const submit = dialog.querySelector('.auth-submit');
      error.textContent = '';
      submit.disabled = true;
      try {
        const user = await authenticate(dialogMode, form.username.value.trim(), form.password.value);
        dialog.close();
        toast(dialogMode === 'register' ? `¡Bienvenido a la comunidad, ${user.username}!` : `Hola de nuevo, ${user.username}`, 'success');
        if (afterAuth) afterAuth(user);
      } catch (err) {
        error.textContent = err.message;
      } finally {
        submit.disabled = false;
      }
    });
  }

  function setDialogMode(mode) {
    dialogMode = mode;
    const register = mode === 'register';
    dialog.querySelectorAll('.auth-tab').forEach(tab => tab.setAttribute('aria-selected', String(tab.dataset.tab === mode)));
    dialog.querySelector('.auth-title').textContent = register ? 'Crea tu cuenta' : 'Entrar';
    dialog.querySelector('.auth-submit').textContent = register ? 'Crear cuenta' : 'Entrar';
    dialog.querySelector('.auth-hint').hidden = !register;
    dialog.querySelector('.auth-form').password.autocomplete = register ? 'new-password' : 'current-password';
    dialog.querySelector('.auth-error').textContent = '';
  }

  function openAuth(mode = 'login', { reason = '', then = null } = {}) {
    if (!dialog) buildDialog();
    setDialogMode(mode);
    const google = dialog.querySelector('.auth-google');
    google.href = `/api/auth/google?next=${encodeURIComponent(location.pathname + location.search)}`;
    google.hidden = !googleEnabled;
    dialog.querySelector('.auth-or').hidden = !googleEnabled;
    afterAuth = then;
    const r = dialog.querySelector('.auth-reason');
    r.textContent = reason;
    r.hidden = !reason;
    dialog.querySelector('.auth-form').reset();
    dialog.showModal();
    dialog.querySelector('input[name=username]').focus();
  }

  // After "Continuar con Google" a new member picks the name everyone will see.
  function openGoogleChooser(suggestion) {
    const box = el('dialog', 'auth-dialog');
    box.setAttribute('aria-labelledby', 'gta-google-title');
    box.innerHTML = `
      <div class="auth-brand">GTA<span>VI</span> <small>Comunidad</small></div>
      <h2 class="auth-title" id="gta-google-title">Elige tu nombre</h2>
      <p class="auth-reason">Tu cuenta de Google está lista. Así te verán en el chat y la comunidad.</p>
      <form class="auth-form" novalidate>
        <label>Nombre de usuario<input name="username" type="text" autocomplete="username" maxlength="20" required spellcheck="false" autocapitalize="off"></label>
        <p class="auth-hint">De 3 a 20 letras, números o guion bajo. No se puede cambiar después.</p>
        <p class="auth-error" role="alert"></p>
        <button type="submit" class="btn btn-primary auth-submit">Crear cuenta</button>
      </form>
      <p class="auth-legal">Al unirte aceptas las normas de la comunidad: respeto, sin spam y spoilers marcados.</p>`;
    document.body.append(box);
    const form = box.querySelector('form');
    form.username.value = suggestion || '';
    box.addEventListener('close', () => box.remove());
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const error = box.querySelector('.auth-error');
      const submit = box.querySelector('.auth-submit');
      error.textContent = '';
      submit.disabled = true;
      try {
        const res = await api('/api/auth/google/complete', { method: 'POST', body: { username: form.username.value.trim() } });
        const data = await api('/api/me');
        setMe(data.user);
        refreshSocket();
        box.close();
        toast(`¡Bienvenido a la comunidad, ${res.user.username}!`, 'success');
        if (res.next && res.next !== location.pathname + location.search) location.assign(res.next);
      } catch (err) {
        error.textContent = err.message;
      } finally {
        submit.disabled = false;
      }
    });
    box.showModal();
    form.username.select();
  }

  // Back from Google: finish a new account, or explain what went wrong.
  (() => {
    const params = new URLSearchParams(location.search);
    const result = params.get('google');
    if (!result) return;
    params.delete('google');
    const rest = params.toString();
    history.replaceState(null, '', location.pathname + (rest ? `?${rest}` : '') + location.hash);
    if (result === 'error') {
      toast('No se pudo entrar con Google. Inténtalo de nuevo.', 'error');
    } else if (result === 'nuevo') {
      api('/api/auth/google/pending')
        .then(d => (d.pending ? openGoogleChooser(d.suggestion) : toast('La sesión con Google caducó. Vuelve a intentarlo.', 'error')))
        .catch(err => toast(err.message, 'error'));
    }
  })();

  // Runs fn now if logged in, otherwise after signing in.
  function requireAuth(reason, fn) {
    if (me) return fn(me);
    openAuth('register', { reason, then: fn });
  }

  document.addEventListener('click', e => {
    const trigger = e.target.closest('[data-open-auth]');
    if (trigger) {
      e.preventDefault();
      openAuth(trigger.dataset.openAuth || 'login');
    }
    const out = e.target.closest('[data-logout]');
    if (out) {
      e.preventDefault();
      logout();
    }
  });

  // ---------------------------------------------------------------- realtime
  let socket = null;
  function getSocket() {
    if (!socket && typeof window.io === 'function') socket = window.io();
    return socket;
  }
  // The socket reads the session at handshake time, so reconnect after login/logout.
  function refreshSocket() {
    if (!socket) return;
    socket.disconnect();
    socket.connect();
  }

  // ---------------------------------------------------------------- video
  function videoFacade(videoId, title) {
    const btn = el('button', 'video-card post-video');
    btn.type = 'button';
    btn.setAttribute('aria-label', `Reproducir vídeo: ${title}`);
    const img = el('img');
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.src = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
    const play = el('span', 'play-icon');
    play.setAttribute('aria-hidden', 'true');
    play.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
    btn.append(img, play);
    btn.addEventListener('click', () => {
      const live = el('div', 'video-live post-video');
      const iframe = el('iframe');
      iframe.src = `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0&playsinline=1`;
      iframe.title = title;
      iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
      iframe.referrerPolicy = 'strict-origin-when-cross-origin';
      iframe.allowFullscreen = true;
      live.append(iframe);
      btn.replaceWith(live);
    });
    return btn;
  }

  // ---------------------------------------------------------------- post component
  function confirmButton(btn, label, action) {
    let armed = false;
    let timer;
    btn.addEventListener('click', async () => {
      if (!armed) {
        armed = true;
        btn.classList.add('armed');
        btn.querySelector('.label').textContent = label;
        timer = setTimeout(() => {
          armed = false;
          btn.classList.remove('armed');
          btn.querySelector('.label').textContent = '';
        }, 3000);
        return;
      }
      clearTimeout(timer);
      btn.disabled = true;
      try {
        await action();
      } catch (err) {
        toast(err.message, 'error');
        btn.disabled = false;
      }
    });
  }

  function userLink(author, cls = 'post-author') {
    const a = el('a', cls, author.username);
    a.href = `/u/${encodeURIComponent(author.username)}`;
    return a;
  }

  function teamBadge(team) {
    return team ? el('span', `team-badge team-${team}`, TEAM[team]) : null;
  }

  function renderComment(c, onDeleted) {
    const li = el('li', 'comment');
    li.dataset.id = c.id;
    const body = el('div', 'comment-body');
    const head = el('div', 'post-head');
    head.append(userLink(c.author));
    const badge = teamBadge(c.author.team);
    if (badge) head.append(badge);
    head.append(timeEl(c.createdAt));
    if (c.canDelete) {
      const del = el('button', 'icon-btn comment-delete');
      del.type = 'button';
      del.setAttribute('aria-label', 'Borrar comentario');
      del.append(icon('trash'), el('span', 'label'));
      confirmButton(del, '¿Borrar?', async () => {
        const res = await api(`/api/comments/${c.id}`, { method: 'DELETE' });
        li.remove();
        onDeleted(res.comments);
      });
      head.append(del);
    }
    body.append(head, el('p', 'comment-text', c.content));
    const link = el('a', 'comment-avatar');
    link.href = `/u/${encodeURIComponent(c.author.username)}`;
    link.setAttribute('aria-label', `Perfil de ${c.author.username}`);
    link.append(avatar(c.author.username, c.author.team, 'avatar-sm'));
    li.append(link, body);
    return li;
  }

  function renderPost(post, { onDelete } = {}) {
    const li = el('li', `post post-cat-${post.category}`);
    li.dataset.id = post.id;
    li.id = `post-${post.id}`;
    const state = { post, commentsLoaded: false };

    const avatarLink = el('a', 'post-avatar');
    avatarLink.href = `/u/${encodeURIComponent(post.author.username)}`;
    avatarLink.setAttribute('aria-label', `Perfil de ${post.author.username}`);
    avatarLink.append(avatar(post.author.username, post.author.team));

    const main = el('div', 'post-main');
    const head = el('div', 'post-head');
    head.append(userLink(post.author));
    const badge = teamBadge(post.author.team);
    if (badge) head.append(badge);
    head.append(timeEl(post.createdAt));
    const cat = CATEGORY[post.category] || CATEGORY.debate;
    head.append(el('span', `tag ${cat.cls}`, cat.label));
    if (post.canDelete) {
      const del = el('button', 'icon-btn post-delete');
      del.type = 'button';
      del.setAttribute('aria-label', 'Borrar publicación');
      del.append(icon('trash'), el('span', 'label'));
      confirmButton(del, '¿Borrar?', async () => {
        await api(`/api/posts/${post.id}`, { method: 'DELETE' });
        li.classList.add('post-removing');
        setTimeout(() => li.remove(), 250);
        toast('Publicación borrada');
        if (onDelete) onDelete(post.id);
      });
      head.append(del);
    }
    main.append(head);

    const content = el('div', 'post-content');
    if (post.body) content.append(el('p', 'post-body', post.body));
    if (post.videoId) content.append(videoFacade(post.videoId, post.body || `Clip de ${post.author.username}`));
    if (post.spoiler) {
      content.classList.add('is-spoiler');
      const reveal = el('button', 'spoiler-reveal');
      reveal.type = 'button';
      reveal.append(icon('eye'), el('span', null, 'Contiene spoilers · Mostrar'));
      reveal.addEventListener('click', () => {
        content.classList.remove('is-spoiler');
        reveal.remove();
      });
      content.append(reveal);
    }
    main.append(content);

    // Actions
    const actions = el('div', 'post-actions');
    const like = el('button', 'post-action like-btn');
    like.type = 'button';
    like.setAttribute('aria-pressed', String(post.liked));
    like.setAttribute('aria-label', 'Me gusta');
    const likeCount = el('span', 'count', formatCount(post.likes));
    like.append(icon('heart'), likeCount);
    like.addEventListener('click', () => requireAuth('Inicia sesión para dar me gusta.', async () => {
      const wasLiked = like.getAttribute('aria-pressed') === 'true';
      like.setAttribute('aria-pressed', String(!wasLiked));
      state.post.likes += wasLiked ? -1 : 1;
      likeCount.textContent = formatCount(state.post.likes);
      like.classList.remove('pop');
      void like.offsetWidth;
      if (!wasLiked) like.classList.add('pop');
      try {
        const res = await api(`/api/posts/${post.id}/like`, { method: 'POST', body: {} });
        state.post.likes = res.likes;
        like.setAttribute('aria-pressed', String(res.liked));
        likeCount.textContent = formatCount(res.likes);
      } catch (err) {
        like.setAttribute('aria-pressed', String(wasLiked));
        state.post.likes += wasLiked ? 1 : -1;
        likeCount.textContent = formatCount(state.post.likes);
        toast(err.message, 'error');
      }
    }));

    const commentsId = `comments-${post.id}`;
    const toggle = el('button', 'post-action replies-btn');
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', commentsId);
    toggle.setAttribute('aria-label', 'Comentarios');
    const commentCount = el('span', 'count', formatCount(post.comments));
    toggle.append(icon('reply'), commentCount);

    const share = el('button', 'post-action share-btn');
    share.type = 'button';
    share.setAttribute('aria-label', 'Copiar enlace');
    share.append(icon('link'));
    share.addEventListener('click', async () => {
      const url = `${location.origin}${post.category === 'clip' ? '/clips' : '/comunidad'}#post-${post.id}`;
      try {
        if (navigator.share) await navigator.share({ title: 'GTA VI Vice City', text: post.body.slice(0, 100), url });
        else {
          await navigator.clipboard.writeText(url);
          toast('Enlace copiado', 'success');
        }
      } catch { /* cancelled */ }
    });
    actions.append(like, toggle, share);
    main.append(actions);

    // Comments
    const panel = el('div', 'comments');
    panel.id = commentsId;
    panel.hidden = true;
    const list = el('ol', 'comment-list');
    const form = el('form', 'comment-form');
    const input = el('textarea');
    input.rows = 1;
    input.maxLength = 500;
    input.placeholder = 'Escribe un comentario…';
    input.setAttribute('aria-label', 'Comentario');
    const send = el('button', 'comment-send');
    send.type = 'submit';
    send.setAttribute('aria-label', 'Enviar comentario');
    send.append(icon('send'));
    form.append(input, send);
    panel.append(list, form);
    main.append(panel);

    const setCount = n => {
      state.post.comments = n;
      commentCount.textContent = formatCount(n);
    };

    async function loadComments() {
      list.replaceChildren(el('li', 'comment-loading', 'Cargando comentarios…'));
      try {
        const { comments } = await api(`/api/posts/${post.id}/comments`);
        list.replaceChildren(...comments.map(c => renderComment(c, setCount)));
        if (!comments.length) list.append(el('li', 'comment-empty', 'Sé el primero en comentar.'));
        state.commentsLoaded = true;
      } catch (err) {
        list.replaceChildren(el('li', 'comment-empty', err.message));
      }
    }

    toggle.addEventListener('click', () => {
      const open = panel.hidden;
      panel.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
      if (open && !state.commentsLoaded) loadComments();
      if (open) input.focus({ preventScroll: true });
    });

    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        form.requestSubmit();
      }
    });
    input.addEventListener('focus', () => {
      if (!me) requireAuth('Inicia sesión para comentar.', () => input.focus());
    });
    form.addEventListener('submit', e => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      requireAuth('Inicia sesión para comentar.', async () => {
        send.disabled = true;
        try {
          const res = await api(`/api/posts/${post.id}/comments`, { method: 'POST', body: { content: text } });
          list.querySelector('.comment-empty')?.remove();
          if (!list.querySelector(`[data-id="${res.comment.id}"]`)) list.append(renderComment(res.comment, setCount));
          setCount(res.comments);
          input.value = '';
          input.style.height = 'auto';
        } catch (err) {
          toast(err.message, 'error');
        } finally {
          send.disabled = false;
        }
      });
    });

    li.append(avatarLink, main);
    li._gta = {
      setLikes(n) {
        state.post.likes = n;
        likeCount.textContent = formatCount(n);
      },
      setComments: setCount,
      addComment(c) {
        if (!state.commentsLoaded) return;
        if (list.querySelector(`[data-id="${c.id}"]`)) return;
        list.querySelector('.comment-empty')?.remove();
        list.append(renderComment({ ...c, canDelete: Boolean(me && me.username === c.author.username) }, setCount));
      },
      removeComment(id) {
        list.querySelector(`[data-id="${id}"]`)?.remove();
      },
    };
    return li;
  }

  // ---------------------------------------------------------------- feed
  function createFeed({ list, more, empty, params = {}, live = true, filter = () => true }) {
    let query = { sort: 'recent', ...params };
    let next = null;
    let loading = false;
    let token = 0;

    function setEmpty() {
      if (empty) empty.hidden = list.children.length > 0;
    }

    async function load(reset) {
      if (loading && !reset) return;
      loading = true;
      const mine = ++token;
      if (reset) {
        next = null;
        list.replaceChildren(...Array.from({ length: 3 }, () => el('li', 'post post-skeleton')));
        if (empty) empty.hidden = true;
      }
      if (more) more.disabled = true;
      try {
        const qs = new URLSearchParams();
        Object.entries(query).forEach(([k, v]) => { if (v) qs.set(k, v); });
        if (!reset && next) qs.set('cursor', next);
        const data = await api(`/api/posts?${qs}`);
        if (mine !== token) return;
        if (reset) list.replaceChildren();
        data.posts.forEach(p => {
          if (!list.querySelector(`[data-id="${p.id}"]`)) list.append(renderPost(p, { onDelete: setEmpty }));
        });
        next = data.next;
        if (more) more.hidden = !next;
        setEmpty();
        if (reset && location.hash.startsWith('#post-')) {
          document.querySelector(location.hash)?.scrollIntoView({ block: 'center' });
        }
      } catch (err) {
        if (mine !== token) return;
        if (reset) list.replaceChildren();
        toast(err.message, 'error');
      } finally {
        if (mine === token) {
          loading = false;
          if (more) more.disabled = false;
        }
      }
    }

    more?.addEventListener('click', () => load(false));

    if (live) {
      const s = getSocket();
      if (s) {
        s.on('feed:new', post => {
          if (query.sort !== 'recent' || !filter(post, query)) return;
          if (list.querySelector(`[data-id="${post.id}"]`)) return;
          const mine = me && me.username === post.author.username;
          const node = renderPost({ ...post, canDelete: Boolean(mine) }, { onDelete: setEmpty });
          node.classList.add('post-new');
          list.prepend(node);
          setEmpty();
        });
        s.on('feed:delete', ({ id }) => {
          list.querySelector(`[data-id="${id}"]`)?.remove();
          setEmpty();
        });
        s.on('feed:likes', ({ id, likes }) => list.querySelector(`[data-id="${id}"]`)?._gta.setLikes(likes));
        s.on('feed:comment', ({ postId, comment, comments }) => {
          const node = list.querySelector(`[data-id="${postId}"]`);
          if (!node) return;
          node._gta.setComments(comments);
          node._gta.addComment(comment);
        });
        s.on('feed:comment-delete', ({ postId, id, comments }) => {
          const node = list.querySelector(`[data-id="${postId}"]`);
          if (!node) return;
          node._gta.setComments(comments);
          node._gta.removeComment(id);
        });
      }
    }

    return {
      set(params) {
        query = { ...query, ...params };
        return load(true);
      },
      reload: () => load(true),
      prepend(post) {
        if (list.querySelector(`[data-id="${post.id}"]`)) return;
        const node = renderPost(post, { onDelete: setEmpty });
        node.classList.add('post-new');
        list.prepend(node);
        setEmpty();
      },
      get query() { return query; },
    };
  }

  // ---------------------------------------------------------------- composer
  function createComposer(form, { onPosted, fixedCategory = null } = {}) {
    const text = form.querySelector('textarea');
    const counter = form.querySelector('[data-counter]');
    const video = form.querySelector('[name=videoUrl]');
    const videoRow = form.querySelector('[data-video-row]');
    const videoToggle = form.querySelector('[data-video-toggle]');
    const submit = form.querySelector('[type=submit]');
    const error = form.querySelector('[data-error]');
    const avatarSlot = form.querySelector('[data-composer-avatar]');
    const max = Number(text.maxLength) || 1000;

    function paintAvatar(user) {
      if (!avatarSlot) return;
      avatarSlot.replaceChildren(user ? avatar(user.username, user.team) : el('span', 'avatar avatar-guest', '?'));
    }
    onAuth(paintAvatar);
    loadMe().then(paintAvatar);

    function update() {
      const left = max - text.value.length;
      if (counter) {
        counter.textContent = left;
        counter.classList.toggle('warn', left < 60);
      }
      const hasText = text.value.trim().length > 0;
      const hasVideo = video && video.value.trim().length > 0;
      submit.disabled = fixedCategory === 'clip' ? !hasVideo : !hasText;
    }
    text.addEventListener('input', () => {
      text.style.height = 'auto';
      text.style.height = `${Math.min(text.scrollHeight, 320)}px`;
      update();
    });
    video?.addEventListener('input', update);
    videoToggle?.addEventListener('click', () => {
      const open = videoRow.hidden;
      videoRow.hidden = !open;
      videoToggle.setAttribute('aria-expanded', String(open));
      if (open) video.focus();
    });
    form.querySelectorAll('input, textarea').forEach(field => field.addEventListener('focus', () => {
      if (!me) {
        field.blur();
        requireAuth('Crea tu cuenta gratis para publicar en la comunidad.', () => field.focus());
      }
    }));
    update();

    form.addEventListener('submit', e => {
      e.preventDefault();
      requireAuth('Crea tu cuenta gratis para publicar en la comunidad.', async () => {
        if (error) error.textContent = '';
        submit.disabled = true;
        try {
          const category = fixedCategory || (form.querySelector('[name=category]:checked') || {}).value || 'debate';
          const { post } = await api('/api/posts', {
            method: 'POST',
            body: {
              body: text.value,
              category,
              spoiler: Boolean(form.querySelector('[name=spoiler]')?.checked),
              videoUrl: video ? video.value : '',
            },
          });
          form.reset();
          text.style.height = 'auto';
          if (videoRow && !fixedCategory) videoRow.hidden = true;
          toast(category === 'clip' ? '¡Clip publicado!' : '¡Publicado!', 'success');
          if (onPosted) onPosted(post);
        } catch (err) {
          if (error) error.textContent = err.message;
          else toast(err.message, 'error');
        } finally {
          update();
        }
      });
    });
  }

  loadMe();

  return {
    CATEGORY, TEAM, api, el, icon, avatar, timeAgo, timeEl, toast, formatCount,
    loadMe, onAuth, openAuth, requireAuth, authenticate, logout, setMe,
    getSocket, renderPost, createFeed, createComposer,
    get me() { return me; },
  };
})();
