(() => {
  const $ = id => document.getElementById(id);
  const els = {
    disabled: $('chat-disabled'),
    app: $('chat-app'),
    online: $('online-pill'),
    onlineCount: $('online-count'),
    status: $('chat-status'),
    list: $('chat-messages'),
    empty: $('chat-empty'),
    composer: $('chat-composer'),
    input: $('chat-input'),
    spoiler: $('chat-spoiler'),
    send: $('chat-send'),
    chatError: $('chat-error'),
    guest: $('chat-guest'),
    accountGuest: $('account-guest'),
    accountUser: $('account-user'),
    accountName: $('account-name'),
    accountAvatar: $('account-avatar'),
    logout: $('logout-btn'),
    dialog: $('auth-dialog'),
    authTitle: $('auth-title'),
    authForm: $('auth-form'),
    authHint: $('auth-hint'),
    authError: $('auth-error'),
    authSubmit: $('auth-submit'),
  };

  const MAX_RENDERED = 200;
  const timeFmt = new Intl.DateTimeFormat('es', { hour: '2-digit', minute: '2-digit' });
  const dayFmt = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' });

  let socket = null;
  let me = null;
  let authMode = 'login';

  async function api(path, body) {
    const res = await fetch(path, body === undefined
      ? { credentials: 'same-origin' }
      : { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Error de conexión. Inténtalo de nuevo.');
    return data;
  }

  function avatarColor(name) {
    let hash = 0;
    for (const ch of name) hash = (hash * 31 + ch.codePointAt(0)) % 360;
    return `hsl(${hash} 70% 45%)`;
  }

  function fillAvatar(el, name) {
    el.textContent = name.charAt(0).toUpperCase();
    el.style.background = avatarColor(name);
  }

  function formatTime(value) {
    const date = new Date(value);
    const today = new Date().toDateString() === date.toDateString();
    return today ? timeFmt.format(date) : `${dayFmt.format(date)} · ${timeFmt.format(date)}`;
  }

  function isNearBottom() {
    const l = els.list;
    return l.scrollHeight - l.scrollTop - l.clientHeight < 80;
  }

  function renderMessage(m, { scroll = true } = {}) {
    const stick = isNearBottom();
    const own = me && m.username.toLowerCase() === me.username.toLowerCase();

    const li = document.createElement('li');
    li.className = own ? 'msg msg-own' : 'msg';

    const avatar = document.createElement('span');
    avatar.className = 'avatar';
    fillAvatar(avatar, m.username);

    const body = document.createElement('div');
    body.className = 'msg-body';

    const head = document.createElement('div');
    head.className = 'msg-head';
    const name = document.createElement('strong');
    name.textContent = m.username;
    const time = document.createElement('time');
    time.dateTime = new Date(m.createdAt).toISOString();
    time.textContent = formatTime(m.createdAt);
    head.append(name, time);

    const text = document.createElement('p');
    text.className = 'msg-text';
    text.textContent = m.content;

    if (m.spoiler) {
      const tag = document.createElement('span');
      tag.className = 'msg-spoiler-tag';
      tag.textContent = 'Spoiler';
      head.append(tag);
      text.classList.add('spoiler');
      text.tabIndex = 0;
      text.setAttribute('role', 'button');
      text.setAttribute('aria-label', 'Mensaje con spoiler. Pulsa para mostrarlo.');
      const reveal = () => {
        text.classList.add('revealed');
        text.removeAttribute('role');
        text.removeAttribute('aria-label');
        text.removeAttribute('tabindex');
      };
      text.addEventListener('click', reveal, { once: true });
      text.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); reveal(); } });
    }

    body.append(head, text);
    li.append(avatar, body);
    els.list.append(li);
    els.empty.hidden = true;

    while (els.list.children.length > MAX_RENDERED) els.list.firstElementChild.remove();
    if (scroll && (stick || own)) els.list.scrollTop = els.list.scrollHeight;
  }

  async function loadHistory() {
    try {
      const messages = await api('/api/chat/history');
      els.list.replaceChildren();
      messages.forEach(m => renderMessage(m, { scroll: false }));
      els.empty.hidden = messages.length > 0;
      els.list.scrollTop = els.list.scrollHeight;
    } catch {
      setStatus('offline', 'No se pudo cargar el historial');
    }
  }

  function setStatus(state, label) {
    els.status.dataset.state = state;
    els.status.textContent = label;
  }

  function showDisabled() {
    if (socket) socket.disconnect();
    els.app.hidden = true;
    els.online.hidden = true;
    els.disabled.hidden = false;
  }

  function connect() {
    if (socket) socket.disconnect();
    setStatus('connecting', 'Conectando…');
    socket = io();
    socket.on('connect', () => {
      setStatus('live', 'En vivo');
      loadHistory();
    });
    socket.on('disconnect', () => setStatus('connecting', 'Reconectando…'));
    socket.on('connect_error', err => {
      if (err.message === 'disabled') showDisabled();
      else setStatus('offline', 'Sin conexión');
    });
    socket.on('chat:message', m => renderMessage(m));
    socket.on('chat:online', count => {
      els.onlineCount.textContent = count;
      els.online.hidden = false;
    });
  }

  function updateAccountUI() {
    const logged = Boolean(me);
    els.composer.hidden = !logged;
    els.guest.hidden = logged;
    els.accountGuest.hidden = logged;
    els.accountUser.hidden = !logged;
    if (logged) {
      els.accountName.textContent = me.username;
      fillAvatar(els.accountAvatar, me.username);
    }
  }

  function setAuthMode(mode) {
    authMode = mode;
    const register = mode === 'register';
    els.dialog.querySelectorAll('.auth-tab').forEach(tab => {
      const active = tab.dataset.tab === mode;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    els.authTitle.textContent = register ? 'Crear cuenta' : 'Entrar';
    els.authSubmit.textContent = register ? 'Crear cuenta' : 'Entrar';
    els.authHint.hidden = !register;
    els.authForm.password.autocomplete = register ? 'new-password' : 'current-password';
    els.authError.textContent = '';
  }

  function openAuth(mode) {
    setAuthMode(mode);
    els.authForm.reset();
    els.dialog.showModal();
    els.authForm.username.focus();
  }

  document.querySelectorAll('[data-open-auth]').forEach(btn => {
    btn.addEventListener('click', () => openAuth(btn.dataset.openAuth));
  });
  els.dialog.querySelectorAll('.auth-tab').forEach(tab => {
    tab.addEventListener('click', () => setAuthMode(tab.dataset.tab));
  });
  els.dialog.addEventListener('click', e => {
    if (e.target === els.dialog) els.dialog.close();
  });

  els.authForm.addEventListener('submit', async e => {
    e.preventDefault();
    els.authError.textContent = '';
    els.authSubmit.disabled = true;
    try {
      const { user } = await api(`/api/auth/${authMode}`, {
        username: els.authForm.username.value.trim(),
        password: els.authForm.password.value,
      });
      me = user;
      els.dialog.close();
      updateAccountUI();
      connect();
      els.input.focus();
    } catch (err) {
      els.authError.textContent = err.message;
    } finally {
      els.authSubmit.disabled = false;
    }
  });

  els.logout.addEventListener('click', async () => {
    try {
      await api('/api/auth/logout', {});
    } finally {
      me = null;
      updateAccountUI();
      connect();
    }
  });

  els.composer.addEventListener('submit', e => {
    e.preventDefault();
    const text = els.input.value.trim();
    if (!text || !socket) return;
    els.send.disabled = true;
    els.chatError.textContent = '';
    socket.timeout(8000).emit('chat:send', { text, spoiler: els.spoiler.checked }, (err, res) => {
      els.send.disabled = false;
      if (err) {
        els.chatError.textContent = 'No se pudo enviar. Revisa tu conexión.';
      } else if (res && res.error) {
        els.chatError.textContent = res.error;
      } else {
        els.input.value = '';
        els.spoiler.checked = false;
      }
      els.input.focus();
    });
  });

  async function init() {
    let status = { enabled: false };
    try {
      status = await api('/api/chat/status');
    } catch {
      // Treated as disabled below.
    }
    if (!status.enabled || typeof io === 'undefined') return showDisabled();

    me = status.user;
    els.app.hidden = false;
    updateAccountUI();
    connect();
  }

  init();
})();
