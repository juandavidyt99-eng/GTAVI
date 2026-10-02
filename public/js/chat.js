// Live chat on the community page (shares the account and socket with the feed).
(() => {
  const G = window.GTA;
  const $ = id => document.getElementById(id);
  const section = $('chat');
  if (!G || !section) return;

  const els = {
    online: $('online-pill'),
    onlineCount: $('online-count'),
    status: $('chat-status'),
    list: $('chat-messages'),
    empty: $('chat-empty'),
    composer: $('chat-composer'),
    input: $('chat-input'),
    spoiler: $('chat-spoiler'),
    send: $('chat-send'),
    error: $('chat-error'),
    guest: $('chat-guest'),
  };

  const socket = G.getSocket();
  if (!socket) {
    section.hidden = true;
    return;
  }

  const MAX_RENDERED = 200;
  const timeFmt = new Intl.DateTimeFormat('es', { hour: '2-digit', minute: '2-digit' });
  const dayFmt = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' });

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
    const own = G.me && m.username.toLowerCase() === G.me.username.toLowerCase();

    const li = G.el('li', own ? 'msg msg-own' : 'msg');
    const body = G.el('div', 'msg-body');
    const head = G.el('div', 'msg-head');
    const name = G.el('a', null, m.username);
    name.href = `/u/${encodeURIComponent(m.username)}`;
    const time = G.el('time', null, formatTime(m.createdAt));
    time.dateTime = new Date(m.createdAt).toISOString();
    head.append(name, time);

    const text = G.el('p', 'msg-text', m.content);
    if (m.spoiler) {
      head.append(G.el('span', 'msg-spoiler-tag', 'Spoiler'));
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
    li.append(G.avatar(m.username, null), body);
    els.list.append(li);
    els.empty.hidden = true;

    while (els.list.children.length > MAX_RENDERED) els.list.firstElementChild.remove();
    if (scroll && (stick || own)) els.list.scrollTop = els.list.scrollHeight;
  }

  function setStatus(state, label) {
    els.status.dataset.state = state;
    els.status.textContent = label;
  }

  async function loadHistory() {
    try {
      const messages = await G.api('/api/chat/history');
      els.list.replaceChildren();
      messages.forEach(m => renderMessage(m, { scroll: false }));
      els.empty.hidden = messages.length > 0;
      els.list.scrollTop = els.list.scrollHeight;
    } catch {
      setStatus('offline', 'No se pudo cargar el historial');
    }
  }

  socket.on('connect', () => {
    setStatus('live', 'En vivo');
    loadHistory();
  });
  socket.on('disconnect', () => setStatus('connecting', 'Reconectando…'));
  socket.on('connect_error', err => {
    if (err.message === 'disabled') section.hidden = true;
    else setStatus('offline', 'Sin conexión');
  });
  socket.on('chat:message', m => renderMessage(m));
  socket.on('chat:online', count => {
    els.onlineCount.textContent = count;
    els.online.hidden = false;
  });
  if (socket.connected) {
    setStatus('live', 'En vivo');
    loadHistory();
  }

  function updateAccount(user) {
    els.composer.hidden = !user;
    els.guest.hidden = Boolean(user);
  }
  G.onAuth(updateAccount);
  G.loadMe().then(updateAccount);

  els.composer.addEventListener('submit', e => {
    e.preventDefault();
    const text = els.input.value.trim();
    if (!text) return;
    els.send.disabled = true;
    els.error.textContent = '';
    socket.timeout(8000).emit('chat:send', { text, spoiler: els.spoiler.checked }, (err, res) => {
      els.send.disabled = false;
      if (err) els.error.textContent = 'No se pudo enviar. Revisa tu conexión.';
      else if (res && res.error) els.error.textContent = res.error;
      else {
        els.input.value = '';
        els.spoiler.checked = false;
      }
      els.input.focus();
    });
  });
})();
