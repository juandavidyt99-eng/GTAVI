// Live chat (/chat): messages, replies, reactions, photos, voice notes, mentions, typing and moderation.
(() => {
  const G = window.GTA;
  const $ = id => document.getElementById(id);
  const app = $('cx-app');
  if (!G || !app) return;

  const el = G.el;
  const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥', '👏', '💀'];
  const EMOJIS = ['😀', '😂', '🤣', '😊', '😍', '😎', '🤩', '🥳', '😅', '😉', '🤔', '😮', '😢', '😭', '😡', '🙄',
    '👍', '👎', '👏', '🙌', '🙏', '💪', '🔥', '💯', '❤️', '💜', '💙', '🖤', '💀', '👀', '🎮', '🏝️',
    '🌴', '🌅', '🚤', '🚁', '🚗', '🏎️', '🔫', '💸', '🕶️', '🍹', '🎶', '🎧', '⭐', '✨', '🚀', '🏆'];
  const EDIT_WINDOW_MS = 15 * 60 * 1000;
  const MAX_PHOTO_BYTES = 6 * 1024 * 1024;
  const NAME_RE = /^[a-f0-9]{24}$/;
  const AUDIO_RE = /^[a-f0-9]{24}\.(webm|ogg|m4a)$/;
  const MAX_VOICE_MS = 2 * 60 * 1000;
  const PLAY_SVG = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5L8 5.5Z"/></svg>';
  const PAUSE_SVG = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>';

  const els = {
    scroll: $('cx-scroll'), list: $('cx-list'), empty: $('cx-empty'), older: $('cx-older'),
    jump: $('cx-jump'), jumpText: $('cx-jump-text'), typing: $('cx-typing'),
    status: $('cx-status'), online: $('cx-online'), onlineBtn: $('cx-online-btn'), side: $('cx-side'),
    users: $('cx-users'), usersCount: $('cx-users-count'),
    modBtn: $('cx-mod-btn'), modCount: $('cx-mod-count'),
    composer: $('cx-composer'), input: $('cx-input'), send: $('cx-send'), error: $('cx-error'), count: $('cx-count'),
    reply: $('cx-reply'), replyName: $('cx-reply-name'), replyText: $('cx-reply-text'),
    attach: $('cx-attach'), attachImg: $('cx-attach-img'), attachState: $('cx-attach-state'), spoiler: $('cx-spoiler'),
    file: $('cx-file'), attachBtn: $('cx-attach-btn'), emojiBtn: $('cx-emoji-btn'),
    guest: $('cx-guest'), muted: $('cx-muted'), mutedText: $('cx-muted-text'),
    row: $('cx-row'), mic: $('cx-mic'), rec: $('cx-rec'), recCancel: $('cx-rec-cancel'), recSend: $('cx-rec-send'),
    recTime: $('cx-rec-time'), recBars: $('cx-rec-bars'), recLabel: $('cx-rec-label'),
  };

  const state = {
    messages: new Map(),   // id -> { data, el }
    hasMore: false,
    loadingOlder: false,
    unread: 0,
    replyTo: null,
    image: null,           // { name, w, h } once uploaded
    uploading: false,
    admin: false,
    photos: true,
    audio: false,          // voice notes allowed by the server and supported by this browser
    mutedUntil: 0,
    typing: new Map(),
    tabUnread: 0,
  };
  const baseTitle = document.title;
  const timeFmt = new Intl.DateTimeFormat('es', { hour: '2-digit', minute: '2-digit' });
  const dayFmt = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'long' });
  const socket = G.getSocket();

  const me = () => G.me;
  const isOwn = m => Boolean(me() && me().username.toLowerCase() === m.username.toLowerCase());
  const mentionRe = () => (me() ? new RegExp(`(^|\\W)@${me().username}\\b`, 'i') : null);

  function emit(event, payload) {
    return new Promise(resolve => {
      if (!socket || !socket.connected) return resolve({ error: 'Sin conexión. Reintentando…' });
      socket.timeout(8000).emit(event, payload, (err, res) => resolve(err ? { error: 'No se pudo completar. Revisa tu conexión.' } : res || {}));
    });
  }

  // ------------------------------------------------------------ rich text
  function appendRich(parent, text) {
    const re = /(https?:\/\/[^\s<>"']+)|@([A-Za-z0-9_]{3,20})\b/g;
    let last = 0;
    let m;
    while ((m = re.exec(text))) {
      if (m[2] && m.index > 0 && /\w/.test(text[m.index - 1])) continue;
      parent.append(text.slice(last, m.index));
      if (m[1]) {
        const url = m[1].replace(/[.,!?;:)\]]+$/, '');
        let valid = null;
        try { valid = new URL(url); } catch { /* not a URL */ }
        if (valid && /^https?:$/.test(valid.protocol)) {
          const a = el('a', 'cx-link', url);
          a.href = valid.href;
          a.target = '_blank';
          a.rel = 'noopener nofollow ugc';
          parent.append(a);
        } else {
          parent.append(url);
        }
        last = m.index + url.length;
        re.lastIndex = last;
      } else {
        const a = el('a', 'cx-mention', `@${m[2]}`);
        a.href = `/u/${encodeURIComponent(m[2])}`;
        if (me() && m[2].toLowerCase() === me().username.toLowerCase()) a.classList.add('is-me');
        parent.append(a);
        last = m.index + m[0].length;
      }
    }
    parent.append(text.slice(last));
  }

  // ------------------------------------------------------------ message DOM
  function photoNode(m) {
    const { name, w, h } = m.image;
    if (!NAME_RE.test(name)) return null;
    const fig = el('figure', 'cx-photo');
    const btn = el('button', 'cx-photo-btn');
    btn.type = 'button';
    btn.setAttribute('aria-label', `Ver foto de ${m.username} en grande`);
    btn.style.aspectRatio = `${w} / ${h}`;
    const img = el('img');
    img.src = `/media/chat/${name}_t.webp`;
    img.alt = `Foto enviada por ${m.username}`;
    img.width = w;
    img.height = h;
    img.loading = 'lazy';
    img.decoding = 'async';
    btn.append(img);
    if (m.spoiler) {
      fig.classList.add('is-spoiler');
      btn.append(el('span', 'cx-photo-veil', 'Spoiler · toca para ver'));
    }
    btn.addEventListener('click', () => {
      if (fig.classList.contains('is-spoiler')) fig.classList.remove('is-spoiler');
      else openLightbox(`/media/chat/${name}.webp`, img.alt);
    });
    fig.append(btn);
    return { fig, img };
  }

  // Voice note player: one plays at a time; the bars fill up as it plays.
  let playing = null;
  const fmtDur = ms => {
    const total = Math.max(0, Math.round(ms / 1000));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  };

  function voiceNode(m) {
    const { name, ms } = m.audio;
    if (!AUDIO_RE.test(name)) return null;
    const wrap = el('div', 'cx-voice');
    const btn = el('button', 'cx-voice-btn');
    btn.type = 'button';
    btn.setAttribute('aria-label', `Reproducir nota de voz de ${m.username}`);
    btn.innerHTML = PLAY_SVG;
    const wave = el('div', 'cx-voice-wave');
    wave.setAttribute('aria-hidden', 'true');
    let seed = parseInt(name.slice(0, 8), 16) || 7;
    const bars = [];
    for (let i = 0; i < 30; i++) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      const b = el('i');
      b.style.setProperty('--h', (0.22 + ((seed >> 8) % 1000) / 1000 * 0.78).toFixed(2));
      bars.push(b);
    }
    wave.append(...bars);
    const time = el('span', 'cx-voice-time', fmtDur(ms));
    wrap.append(btn, wave, time);

    const total = Math.max(0.5, ms / 1000);
    let audio = null;
    const paint = t => {
      const filled = Math.round(Math.min(1, t / total) * bars.length);
      bars.forEach((b, i) => b.classList.toggle('on', i < filled));
    };
    btn.addEventListener('click', () => {
      if (!audio) {
        audio = new Audio(`/media/chat/${name}`);
        audio.preload = 'auto';
        audio.addEventListener('timeupdate', () => { paint(audio.currentTime); time.textContent = fmtDur(audio.currentTime * 1000); });
        audio.addEventListener('play', () => { wrap.classList.add('is-playing'); btn.innerHTML = PAUSE_SVG; btn.setAttribute('aria-label', 'Pausar nota de voz'); });
        audio.addEventListener('pause', () => { wrap.classList.remove('is-playing'); btn.innerHTML = PLAY_SVG; btn.setAttribute('aria-label', `Reproducir nota de voz de ${m.username}`); });
        audio.addEventListener('ended', () => { paint(0); time.textContent = fmtDur(ms); if (playing === audio) playing = null; });
        audio.addEventListener('error', () => G.toast('Este navegador no puede reproducir la nota de voz.', 'error'));
      }
      if (audio.paused) {
        if (playing && playing !== audio) playing.pause();
        playing = audio;
        audio.play().catch(() => {});
      } else {
        audio.pause();
      }
    });
    wave.addEventListener('click', e => {
      if (!audio || !Number.isFinite(audio.duration)) return;
      const r = wave.getBoundingClientRect();
      audio.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * audio.duration;
    });
    return wrap;
  }

  function quoteNode(m) {
    const q = m.replyTo;
    const btn = el('button', `cx-quote${q.deleted ? ' is-deleted' : ''}`);
    btn.type = 'button';
    btn.dataset.target = q.id;
    btn.append(el('strong', null, q.deleted ? 'Mensaje eliminado' : q.username));
    if (!q.deleted) btn.append(el('span', null, q.excerpt || (q.hasImage ? '📷 Foto' : q.hasAudio ? '🎤 Nota de voz' : '')));
    btn.addEventListener('click', () => {
      const target = state.messages.get(q.id);
      if (!target) return G.toast('Ese mensaje es anterior: carga el historial para verlo.');
      target.el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      target.el.classList.add('is-flash');
      setTimeout(() => target.el.classList.remove('is-flash'), 1600);
    });
    return btn;
  }

  function reactionsNode(entry) {
    const wrap = el('div', 'cx-reactions');
    entry.data.reactions.filter(r => r.count > 0).forEach(r => {
      const b = el('button', 'cx-react');
      b.type = 'button';
      b.setAttribute('aria-pressed', String(Boolean(r.mine)));
      b.setAttribute('aria-label', `${r.emoji} ${r.count}`);
      b.append(el('span', null, r.emoji), el('b', null, String(r.count)));
      b.addEventListener('click', () => react(entry.data.id, r.emoji));
      wrap.append(b);
    });
    return wrap;
  }

  function buildMessage(m) {
    const own = isOwn(m);
    const li = el('li', `cx-msg${own ? ' is-own' : ''}`);
    li.dataset.id = m.id;
    const entry = { data: m, el: li };

    const avatarLink = el('a', 'cx-avatar');
    avatarLink.href = `/u/${encodeURIComponent(m.username)}`;
    avatarLink.setAttribute('aria-label', `Perfil de ${m.username}`);
    avatarLink.append(G.avatar(m.username, m.team, '', m.avatar));

    const body = el('div', 'cx-body');
    const meta = el('div', 'cx-meta');
    const name = el('a', 'cx-name', m.username);
    name.href = `/u/${encodeURIComponent(m.username)}`;
    meta.append(name);
    if (m.team) meta.append(el('span', `team-badge team-${m.team}`, G.TEAM[m.team]));
    const time = el('time', 'cx-time', timeFmt.format(new Date(m.createdAt)));
    time.dateTime = new Date(m.createdAt).toISOString();
    meta.append(time, el('span', 'cx-edited', ''));
    body.append(meta);

    const bubble = el('div', 'cx-bubble');
    bubble.append(el('div', 'cx-slot-quote'), el('div', 'cx-slot-photo'), el('div', 'cx-slot-audio'), el('div', 'cx-slot-text'));
    body.append(bubble, el('div', 'cx-slot-reactions'));

    const more = el('button', 'cx-more');
    more.type = 'button';
    more.setAttribute('aria-label', 'Opciones del mensaje');
    more.setAttribute('aria-haspopup', 'menu');
    more.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h.01M12 12h.01M19 12h.01"/></svg>';
    more.addEventListener('click', e => { e.stopPropagation(); openMenu(entry, more); });
    bubble.addEventListener('contextmenu', e => {
      if (window.matchMedia('(hover: none)').matches) { e.preventDefault(); openMenu(entry, more); }
    });

    li.append(avatarLink, body, more);
    renderEntry(entry);
    return entry;
  }

  // Fills (or refreshes) the parts of a message that can change after it was created.
  function renderEntry(entry) {
    const { data: m, el: li } = entry;
    const slot = cls => li.querySelector(`.${cls}`);

    const quote = slot('cx-slot-quote');
    quote.replaceChildren();
    if (m.replyTo) quote.append(quoteNode(m));

    const text = slot('cx-slot-text');
    text.replaceChildren();
    if (m.content) {
      const p = el('p', 'cx-text');
      appendRich(p, m.content);
      text.append(p);
    }

    const photo = slot('cx-slot-photo');
    if (!photo.firstChild && m.image) {
      const node = photoNode(m);
      if (node) {
        photo.append(node.fig);
        if (entry.pinned) node.img.addEventListener('load', () => { if (isNearBottom(400)) scrollToBottom(); });
      }
    }

    const voice = slot('cx-slot-audio');
    if (!voice.firstChild && m.audio) {
      const node = voiceNode(m);
      if (node) voice.append(node);
    }

    li.querySelector('.cx-edited').textContent = m.editedAt ? '· editado' : '';
    slot('cx-slot-reactions').replaceChildren(...(m.reactions.some(r => r.count > 0) ? [reactionsNode(entry)] : []));

    const re = mentionRe();
    li.classList.toggle('is-mention', Boolean(re && !isOwn(m) && re.test(m.content)));
  }

  // ------------------------------------------------------------ list management
  const dayKey = iso => new Date(iso).toDateString();
  function dayLabel(iso) {
    const d = new Date(iso);
    const today = new Date();
    const yesterday = new Date(Date.now() - 86400000);
    if (d.toDateString() === today.toDateString()) return 'Hoy';
    if (d.toDateString() === yesterday.toDateString()) return 'Ayer';
    return dayFmt.format(d);
  }

  function regroup() {
    els.list.querySelectorAll('.cx-day').forEach(n => n.remove());
    let prev = null;
    for (const li of [...els.list.children]) {
      const entry = state.messages.get(Number(li.dataset.id));
      if (!entry) continue;
      const m = entry.data;
      if (!prev || dayKey(prev.createdAt) !== dayKey(m.createdAt)) {
        const sep = el('li', 'cx-day');
        sep.append(el('span', null, dayLabel(m.createdAt)));
        li.before(sep);
      }
      const grouped = Boolean(prev && prev.username === m.username && dayKey(prev.createdAt) === dayKey(m.createdAt)
        && new Date(m.createdAt) - new Date(prev.createdAt) < 5 * 60 * 1000 && !m.replyTo);
      li.classList.toggle('is-grouped', grouped);
      prev = m;
    }
    els.empty.hidden = state.messages.size > 0;
  }

  const isNearBottom = (px = 120) => els.scroll.scrollHeight - els.scroll.scrollTop - els.scroll.clientHeight < px;
  function scrollToBottom() {
    els.scroll.scrollTop = els.scroll.scrollHeight;
    state.unread = 0;
    els.jump.hidden = true;
  }

  function addMessage(m, { live = false } = {}) {
    if (state.messages.has(m.id)) return;
    const pinned = isNearBottom();
    const entry = buildMessage(m);
    entry.pinned = pinned;
    state.messages.set(m.id, entry);
    els.list.append(entry.el);
    regroup();

    const own = isOwn(m);
    if (own || pinned) scrollToBottom();
    else if (live) {
      state.unread += 1;
      els.jumpText.textContent = state.unread === 1 ? '1 mensaje nuevo' : `${state.unread} mensajes nuevos`;
      els.jump.hidden = false;
    }
    if (live && !own) {
      if (document.hidden) {
        state.tabUnread += 1;
        document.title = `(${state.tabUnread}) ${baseTitle}`;
      }
      if (entry.el.classList.contains('is-mention')) G.toast(`${m.username} te mencionó en el chat`);
    }
  }

  function removeMessage(id) {
    const entry = state.messages.get(id);
    if (entry) {
      entry.el.remove();
      state.messages.delete(id);
    }
    for (const other of state.messages.values()) {
      if (other.data.replyTo && other.data.replyTo.id === id) {
        other.data.replyTo = { ...other.data.replyTo, deleted: true, excerpt: '', hasImage: false, hasAudio: false };
        renderEntry(other);
      }
    }
    if (state.replyTo && state.replyTo.id === id) setReply(null);
    regroup();
  }

  async function loadHistory({ older = false } = {}) {
    if (older) {
      if (state.loadingOlder || !state.hasMore) return;
      state.loadingOlder = true;
      els.older.disabled = true;
    }
    try {
      const oldest = older ? Math.min(...state.messages.keys()) : 0;
      const data = await G.api(`/api/chat/history?limit=40${oldest ? `&before=${oldest}` : ''}`);
      if (!older) {
        els.list.replaceChildren();
        state.messages.clear();
      }
      const before = els.scroll.scrollHeight;
      const fragment = [];
      for (const m of data.messages) {
        if (state.messages.has(m.id)) continue;
        const entry = buildMessage(m);
        state.messages.set(m.id, entry);
        fragment.push(entry.el);
      }
      if (older) els.list.prepend(...fragment); else els.list.append(...fragment);
      state.hasMore = data.hasMore;
      els.older.hidden = !state.hasMore;
      regroup();
      if (older) els.scroll.scrollTop += els.scroll.scrollHeight - before;
      else scrollToBottom();
    } catch (err) {
      setStatus('offline', 'No se pudo cargar el historial');
    } finally {
      state.loadingOlder = false;
      els.older.disabled = false;
    }
  }

  els.older.addEventListener('click', () => loadHistory({ older: true }));
  els.scroll.addEventListener('scroll', () => {
    if (els.scroll.scrollTop < 60 && state.hasMore) loadHistory({ older: true });
    if (isNearBottom()) { state.unread = 0; els.jump.hidden = true; }
  }, { passive: true });
  els.jump.addEventListener('click', () => { scrollToBottom(); });

  // ------------------------------------------------------------ reactions
  async function react(id, emoji) {
    if (!me()) return G.openAuth('register', { reason: 'Crea tu cuenta gratis para reaccionar.' });
    const res = await emit('chat:react', { id, emoji });
    if (res.error) G.toast(res.error, 'error');
  }

  function applyReaction({ id, emoji, count, by, on }) {
    const entry = state.messages.get(id);
    if (!entry) return;
    const list = entry.data.reactions;
    let r = list.find(x => x.emoji === emoji);
    if (!r) {
      r = { emoji, count: 0, mine: false };
      list.push(r);
    }
    r.count = count;
    if (me() && by.toLowerCase() === me().username.toLowerCase()) r.mine = on;
    if (count === 0) entry.data.reactions = list.filter(x => x.emoji !== emoji);
    renderEntry(entry);
  }

  // ------------------------------------------------------------ message menu
  let menu = null;
  function closeMenu() {
    if (!menu) return;
    menu.backdrop.remove();
    menu.node.remove();
    menu = null;
  }

  function openMenu(entry, anchor) {
    closeMenu();
    const m = entry.data;
    const own = isOwn(m);
    const node = el('div', 'cx-menu');
    node.setAttribute('role', 'menu');
    const backdrop = el('div', 'cx-menu-backdrop');
    backdrop.addEventListener('click', closeMenu);

    const row = el('div', 'cx-menu-reactions');
    REACTIONS.forEach(emoji => {
      const b = el('button', null, emoji);
      b.type = 'button';
      b.setAttribute('aria-label', `Reaccionar con ${emoji}`);
      b.addEventListener('click', () => { closeMenu(); react(m.id, emoji); });
      row.append(b);
    });
    node.append(row);

    const item = (label, svgPath, fn, danger = false) => {
      const b = el('button', `cx-menu-item${danger ? ' is-danger' : ''}`);
      b.type = 'button';
      b.setAttribute('role', 'menuitem');
      b.innerHTML = `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${svgPath}</svg>`;
      b.append(el('span', null, label));
      b.addEventListener('click', () => { closeMenu(); fn(); });
      node.append(b);
    };
    const P = {
      reply: '<path d="M10 8 4 13l6 5v-3.2c5 0 8.3 1.4 10 4.2-.6-5.6-3.8-9.4-10-10V8Z"/>',
      copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
      edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z"/>',
      trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
      flag: '<path d="M5 21V4M5 5h12l-2 4 2 4H5"/>',
      mute: '<path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="m16 9 5 6M21 9l-5 6"/>',
    };

    if (me() && !state.mutedUntil) item('Responder', P.reply, () => setReply(m));
    if (m.content) item('Copiar texto', P.copy, () => navigator.clipboard?.writeText(m.content).then(() => G.toast('Texto copiado', 'success')));
    if (own && Date.now() - new Date(m.createdAt) < EDIT_WINDOW_MS && !state.mutedUntil) item('Editar', P.edit, () => startEdit(entry));
    if (own || state.admin) item('Borrar', P.trash, () => removeOwn(m), true);
    if (me() && !own) item('Reportar', P.flag, () => openReport(m));
    if (state.admin && !own) item('Silenciar a ' + m.username, P.mute, () => openMute(m.username), true);

    document.body.append(backdrop, node);
    menu = { node, backdrop };
    if (window.matchMedia('(max-width: 900px)').matches) {
      node.classList.add('is-sheet');
    } else {
      const r = anchor.getBoundingClientRect();
      const w = node.offsetWidth;
      const h = node.offsetHeight;
      node.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w))}px`;
      node.style.top = `${r.bottom + h + 8 > window.innerHeight ? Math.max(8, r.top - h - 4) : r.bottom + 4}px`;
    }
    node.querySelector('button').focus({ preventScroll: true });
  }
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeMenu(); closeEmoji(); } });

  async function removeOwn(m) {
    if (!window.confirm('¿Borrar este mensaje? No se puede deshacer.')) return;
    const res = await emit('chat:delete', { id: m.id });
    if (res.error) G.toast(res.error, 'error');
  }

  // ------------------------------------------------------------ editing
  function startEdit(entry) {
    const slot = entry.el.querySelector('.cx-slot-text');
    const area = el('textarea', 'cx-edit');
    area.value = entry.data.content;
    area.maxLength = 500;
    area.rows = 2;
    area.setAttribute('aria-label', 'Editar mensaje');
    const bar = el('div', 'cx-edit-bar');
    const save = el('button', 'btn btn-primary btn-sm', 'Guardar');
    const cancel = el('button', 'btn btn-outline btn-sm', 'Cancelar');
    save.type = cancel.type = 'button';
    const hint = el('span', 'cx-edit-hint', 'Enter guarda · Esc cancela');
    const err = el('span', 'cx-edit-error');
    bar.append(save, cancel, hint, err);
    slot.replaceChildren(area, bar);
    area.focus();
    area.setSelectionRange(area.value.length, area.value.length);

    const done = () => renderEntry(entry);
    const commit = async () => {
      save.disabled = true;
      const res = await emit('chat:edit', { id: entry.data.id, text: area.value });
      if (res.error) { err.textContent = res.error; save.disabled = false; } else done();
    };
    save.addEventListener('click', commit);
    cancel.addEventListener('click', done);
    area.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(); }
      if (e.key === 'Escape') { e.stopPropagation(); done(); }
    });
  }

  // ------------------------------------------------------------ dialogs
  function makeDialog(title, build) {
    const d = el('dialog', 'auth-dialog cx-dialog');
    d.setAttribute('aria-label', title);
    const close = el('button', 'auth-close');
    close.type = 'button';
    close.setAttribute('aria-label', 'Cerrar');
    close.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
    close.addEventListener('click', () => d.close());
    d.append(close, el('h2', 'auth-title', title));
    build(d);
    d.addEventListener('close', () => d.remove());
    d.addEventListener('click', e => { if (e.target === d) d.close(); });
    document.body.append(d);
    d.showModal();
    return d;
  }

  function openReport(m) {
    const reasons = [['spam', 'Spam o publicidad'], ['acoso', 'Insultos o acoso'], ['spoiler', 'Spoiler sin marcar'],
      ['inapropiado', 'Contenido inapropiado'], ['otro', 'Otro motivo']];
    makeDialog('Reportar mensaje', d => {
      d.append(el('p', 'cx-dialog-lead', `Mensaje de ${m.username}. Un moderador lo revisará.`));
      const form = el('form', 'cx-report');
      reasons.forEach(([value, label], i) => {
        const l = el('label', 'cx-radio');
        const input = el('input');
        input.type = 'radio';
        input.name = 'reason';
        input.value = value;
        input.checked = i === 0;
        l.append(input, el('span', null, label));
        form.append(l);
      });
      const err = el('p', 'auth-error');
      const submit = el('button', 'btn btn-primary auth-submit', 'Enviar reporte');
      submit.type = 'submit';
      form.append(err, submit);
      form.addEventListener('submit', async e => {
        e.preventDefault();
        submit.disabled = true;
        try {
          const res = await G.api('/api/chat/report', { method: 'POST', body: { messageId: m.id, reason: form.reason.value } });
          d.close();
          G.toast(res.duplicate ? 'Ya habías reportado este mensaje' : 'Gracias, lo revisaremos', 'success');
        } catch (error) {
          err.textContent = error.message;
          submit.disabled = false;
        }
      });
      d.append(form);
    });
  }

  function openMute(username) {
    const options = [[10, '10 minutos'], [60, '1 hora'], [1440, '24 horas'], [10080, '7 días'], [525600, 'Expulsar (1 año)'], [0, 'Quitar silencio']];
    makeDialog(`Silenciar a ${username}`, d => {
      d.append(el('p', 'cx-dialog-lead', 'No podrá escribir ni enviar fotos durante ese tiempo.'));
      const list = el('div', 'cx-mute-list');
      options.forEach(([minutes, label]) => {
        const b = el('button', 'btn btn-outline btn-sm', label);
        b.type = 'button';
        b.addEventListener('click', async () => {
          try {
            await G.api('/api/chat/mute', { method: 'POST', body: { username, minutes } });
            d.close();
            G.toast(minutes ? `${username} silenciado` : `${username} ya puede escribir`, 'success');
          } catch (error) {
            G.toast(error.message, 'error');
          }
        });
        list.append(b);
      });
      d.append(list);
    });
  }

  async function refreshReportCount() {
    if (!state.admin) return;
    try {
      const { reports } = await G.api('/api/chat/reports');
      els.modCount.textContent = reports.length;
      els.modCount.hidden = reports.length === 0;
      return reports;
    } catch { return []; }
  }

  function openModPanel() {
    makeDialog('Reportes pendientes', async d => {
      d.classList.add('cx-dialog-wide');
      const box = el('div', 'cx-reports');
      box.append(el('p', 'cx-dialog-lead', 'Cargando…'));
      d.append(box);
      const render = async () => {
        const reports = (await refreshReportCount()) || [];
        box.replaceChildren();
        if (!reports.length) return void box.append(el('p', 'cx-dialog-lead', 'No hay reportes pendientes. ¡Todo en orden!'));
        reports.forEach(r => {
          const card = el('article', 'cx-report-card');
          const head = el('div', 'cx-report-head');
          head.append(el('strong', null, r.message.username), el('span', null, `${r.count} ${r.count === 1 ? 'reporte' : 'reportes'} · ${r.reasons.join(', ')}`));
          card.append(head);
          const content = el('div', 'cx-report-body');
          if (r.message.content) content.append(el('p', null, r.message.content));
          if (r.message.image && NAME_RE.test(r.message.image.name)) {
            const img = el('img');
            img.src = `/media/chat/${r.message.image.name}_t.webp`;
            img.alt = 'Foto reportada';
            content.append(img);
          }
          if (r.message.audio && AUDIO_RE.test(r.message.audio.name)) {
            const a = el('audio');
            a.controls = true;
            a.preload = 'none';
            a.src = `/media/chat/${r.message.audio.name}`;
            content.append(a);
          }
          card.append(content, el('p', 'cx-report-by', `Reportado por: ${r.reporters.join(', ')}`));
          const actions = el('div', 'cx-report-actions');
          const mk = (label, cls, fn) => {
            const b = el('button', `btn ${cls} btn-sm`, label);
            b.type = 'button';
            b.addEventListener('click', async () => { b.disabled = true; await fn(); render(); });
            actions.append(b);
          };
          mk('Borrar mensaje', 'btn-primary', async () => { const res = await emit('chat:delete', { id: r.messageId }); if (res.error) G.toast(res.error, 'error'); });
          mk('Silenciar 1 h', 'btn-outline', async () => {
            try { await G.api('/api/chat/mute', { method: 'POST', body: { username: r.message.username, minutes: 60 } }); G.toast('Usuario silenciado', 'success'); } catch (e) { G.toast(e.message, 'error'); }
          });
          mk('Descartar', 'btn-outline', () => G.api(`/api/chat/reports/${r.messageId}/dismiss`, { method: 'POST', body: {} }));
          card.append(actions);
          box.append(card);
        });
      };
      render();
    });
  }
  els.modBtn.addEventListener('click', openModPanel);

  // ------------------------------------------------------------ lightbox
  function openLightbox(src, alt) {
    const d = el('dialog', 'cx-lightbox');
    d.setAttribute('aria-label', 'Foto ampliada');
    const img = el('img');
    img.src = src;
    img.alt = alt;
    const close = el('button', 'auth-close');
    close.type = 'button';
    close.setAttribute('aria-label', 'Cerrar foto');
    close.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
    close.addEventListener('click', () => d.close());
    d.append(img, close);
    d.addEventListener('click', e => { if (e.target !== img) d.close(); });
    d.addEventListener('close', () => d.remove());
    document.body.append(d);
    d.showModal();
  }

  // ------------------------------------------------------------ composer
  function setReply(m) {
    state.replyTo = m;
    els.reply.hidden = !m;
    if (m) {
      els.replyName.textContent = `Respondiendo a ${m.username}`;
      els.replyText.textContent = m.content || (m.image ? '📷 Foto' : m.audio ? '🎤 Nota de voz' : '');
      els.input.focus();
    }
  }
  $('cx-reply-cancel').addEventListener('click', () => setReply(null));

  function autosize() {
    els.input.style.height = 'auto';
    els.input.style.height = `${Math.min(els.input.scrollHeight, 140)}px`;
    const left = 500 - els.input.value.length;
    els.count.textContent = left < 100 ? String(left) : '';
    els.count.classList.toggle('warn', left < 30);
  }

  // Empty composer shows the microphone; as soon as there is text or a photo it becomes "send".
  function updateComposerMode() {
    const hasContent = Boolean(els.input.value.trim() || state.image || state.uploading);
    els.mic.hidden = !state.audio || hasContent;
    els.send.hidden = state.audio && !hasContent;
  }

  let lastTypingEmit = 0;
  els.input.addEventListener('input', () => {
    autosize();
    updateComposerMode();
    if (els.input.value.trim() && Date.now() - lastTypingEmit > 2500 && socket && socket.connected) {
      lastTypingEmit = Date.now();
      socket.emit('chat:typing');
    }
  });
  els.input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      els.composer.requestSubmit();
    }
  });

  function setError(message) {
    els.error.textContent = message || '';
  }

  els.composer.addEventListener('submit', async e => {
    e.preventDefault();
    if (state.uploading) return setError('Espera a que termine de subirse la foto.');
    const text = els.input.value.trim();
    if (!text && !state.image) return;
    setError('');
    els.send.disabled = true;
    const res = await emit('chat:send', {
      text,
      spoiler: Boolean(state.image && els.spoiler.checked),
      image: state.image ? state.image.name : undefined,
      replyTo: state.replyTo ? state.replyTo.id : undefined,
    });
    els.send.disabled = false;
    if (res.error) {
      setError(res.error);
      if (/silenciado/.test(res.error)) refreshStatus();
    } else {
      els.input.value = '';
      autosize();
      clearAttachment({ keepServerFile: true });
      updateComposerMode();
      setReply(null);
      closeEmoji();
    }
    els.input.focus();
  });

  // ---- photos
  async function prepareImage(file) {
    // Phones produce huge photos: shrink them before uploading (this also drops EXIF data).
    if (file.size <= 1.5 * 1024 * 1024) return file;
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.86));
      return blob || file;
    } catch {
      return file;
    }
  }

  function clearAttachment({ keepServerFile = false } = {}) {
    if (state.image && !keepServerFile) G.api(`/api/chat/upload/${state.image.name}`, { method: 'DELETE' }).catch(() => {});
    state.image = null;
    state.uploading = false;
    els.attach.hidden = true;
    if (els.attachImg.src.startsWith('blob:')) URL.revokeObjectURL(els.attachImg.src);
    els.attachImg.removeAttribute('src');
    els.spoiler.checked = false;
    els.file.value = '';
    updateComposerMode();
  }

  async function attachFile(file) {
    if (!file) return;
    if (!me()) return G.openAuth('register', { reason: 'Crea tu cuenta gratis para enviar fotos.' });
    if (!state.photos) return setError('Las fotos no están disponibles en este momento.');
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return setError('Solo se admiten fotos JPG, PNG o WebP.');
    if (state.mutedUntil) return;
    setError('');
    clearAttachment();
    state.uploading = true;
    updateComposerMode();
    els.attach.hidden = false;
    els.attachState.textContent = 'Subiendo…';
    els.attachImg.src = URL.createObjectURL(file);
    try {
      const prepared = await prepareImage(file);
      if (prepared.size > MAX_PHOTO_BYTES) throw new Error('La foto es demasiado grande (máximo 6 MB).');
      const res = await fetch('/api/chat/upload', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': prepared.type || 'image/jpeg' },
        body: prepared,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'No se pudo subir la foto.');
      state.image = data.image;
      state.uploading = false;
      updateComposerMode();
      els.attachState.textContent = 'Lista para enviar';
      els.input.focus();
    } catch (err) {
      clearAttachment();
      setError(err.message);
    }
  }

  els.attachBtn.addEventListener('click', () => {
    if (!me()) return G.openAuth('register', { reason: 'Crea tu cuenta gratis para enviar fotos.' });
    els.file.click();
  });
  els.file.addEventListener('change', () => attachFile(els.file.files[0]));
  $('cx-attach-remove').addEventListener('click', () => clearAttachment());
  els.input.addEventListener('paste', e => {
    const file = [...(e.clipboardData?.files || [])].find(f => f.type.startsWith('image/'));
    if (file) { e.preventDefault(); attachFile(file); }
  });
  const dropZone = document.querySelector('.cx-main');
  ['dragenter', 'dragover'].forEach(ev => dropZone.addEventListener(ev, e => {
    if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); dropZone.classList.add('is-drop'); }
  }));
  ['dragleave', 'drop'].forEach(ev => dropZone.addEventListener(ev, () => dropZone.classList.remove('is-drop')));
  dropZone.addEventListener('drop', e => {
    const file = [...(e.dataTransfer?.files || [])].find(f => f.type.startsWith('image/'));
    if (file) { e.preventDefault(); attachFile(file); }
  });

  // ---- voice notes (tap the microphone, tap send; up to 2 minutes)
  const canRecord = Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  const rec = { recorder: null, stream: null, chunks: [], start: 0, timer: null, ctx: null, raf: 0, sending: false };

  function pickMime() {
    const options = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm'];
    return options.find(t => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || '';
  }

  function showRecorder(on) {
    els.rec.hidden = !on;
    els.row.hidden = on;
    els.composer.classList.toggle('is-recording', on);
    if (!on) updateComposerMode();
  }

  function releaseMic() {
    if (rec.stream) rec.stream.getTracks().forEach(t => t.stop());
    rec.stream = null;
    clearInterval(rec.timer);
    cancelAnimationFrame(rec.raf);
    if (rec.ctx) rec.ctx.close().catch(() => {});
    rec.ctx = null;
  }

  function startMeter() {
    const bars = Array.from({ length: 26 }, () => el('i'));
    els.recBars.replaceChildren(...bars);
    const levels = bars.map(() => 0.08);
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      rec.ctx = new Ctx();
      const analyser = rec.ctx.createAnalyser();
      analyser.fftSize = 512;
      rec.ctx.createMediaStreamSource(rec.stream).connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      let last = 0;
      const tick = now => {
        rec.raf = requestAnimationFrame(tick);
        if (now - last < 70) return;
        last = now;
        analyser.getByteTimeDomainData(data);
        let peak = 0;
        for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
        levels.shift();
        levels.push(Math.max(0.08, Math.min(1, peak / 60)));
        bars.forEach((b, i) => b.style.setProperty('--h', levels[i].toFixed(2)));
      };
      rec.raf = requestAnimationFrame(tick);
    } catch { /* the meter is decorative */ }
  }

  async function startRecording() {
    if (!me()) return G.openAuth('register', { reason: 'Entra gratis para enviar notas de voz.' });
    if (rec.recorder || rec.sending || state.mutedUntil) return;
    setError('');
    closeEmoji();
    try {
      rec.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (err) {
      return setError(err && err.name === 'NotAllowedError'
        ? 'Permite el acceso al micrófono para enviar notas de voz.'
        : 'No se pudo usar el micrófono de este dispositivo.');
    }
    const mime = pickMime();
    try {
      rec.recorder = new MediaRecorder(rec.stream, mime ? { mimeType: mime, audioBitsPerSecond: 48000 } : undefined);
    } catch {
      rec.recorder = new MediaRecorder(rec.stream);
    }
    rec.chunks = [];
    rec.recorder.addEventListener('dataavailable', e => { if (e.data && e.data.size) rec.chunks.push(e.data); });
    rec.recorder.start(250);
    rec.start = Date.now();
    els.recTime.textContent = '0:00';
    els.recLabel.textContent = 'Grabando…';
    showRecorder(true);
    startMeter();
    rec.timer = setInterval(() => {
      const ms = Date.now() - rec.start;
      els.recTime.textContent = fmtDur(ms);
      if (ms >= MAX_VOICE_MS) sendRecording();
    }, 250);
  }

  function stopRecorder() {
    return new Promise(resolve => {
      const r = rec.recorder;
      if (!r || r.state === 'inactive') return resolve(null);
      r.addEventListener('stop', () => resolve(new Blob(rec.chunks, { type: r.mimeType || 'audio/webm' })), { once: true });
      r.stop();
    });
  }

  function cancelRecording() {
    const r = rec.recorder;
    rec.recorder = null;
    if (r && r.state !== 'inactive') { try { r.stop(); } catch { /* already stopped */ } }
    releaseMic();
    rec.chunks = [];
    showRecorder(false);
  }

  async function sendRecording() {
    if (!rec.recorder || rec.sending) return;
    rec.sending = true;
    const ms = Math.min(Date.now() - rec.start, MAX_VOICE_MS);
    clearInterval(rec.timer);
    els.recLabel.textContent = 'Enviando…';
    els.recSend.disabled = true;
    const blob = await stopRecorder();
    rec.recorder = null;
    releaseMic();
    try {
      if (ms < 700 || !blob || blob.size < 500) throw new Error('La nota de voz es demasiado corta.');
      const type = (blob.type || 'audio/webm').split(';')[0];
      const res = await fetch(`/api/chat/audio?ms=${ms}`, {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': type }, body: blob,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'No se pudo enviar la nota de voz.');
      const sent = await emit('chat:send', { audio: data.audio.name, replyTo: state.replyTo ? state.replyTo.id : undefined });
      if (sent.error) {
        G.api(`/api/chat/audio/${data.audio.name}`, { method: 'DELETE' }).catch(() => {});
        throw new Error(sent.error);
      }
      setReply(null);
    } catch (err) {
      setError(err.message);
      if (/silenciado/.test(err.message)) refreshStatus();
    } finally {
      rec.sending = false;
      els.recSend.disabled = false;
      showRecorder(false);
    }
  }

  els.mic.addEventListener('click', startRecording);
  els.recCancel.addEventListener('click', cancelRecording);
  els.recSend.addEventListener('click', sendRecording);
  window.addEventListener('pagehide', cancelRecording);

  // ---- emoji picker
  let picker = null;
  function closeEmoji() {
    if (!picker) return;
    picker.remove();
    picker = null;
    els.emojiBtn.setAttribute('aria-expanded', 'false');
  }
  els.emojiBtn.addEventListener('click', e => {
    e.stopPropagation();
    if (picker) return closeEmoji();
    picker = el('div', 'cx-emoji');
    picker.setAttribute('role', 'dialog');
    picker.setAttribute('aria-label', 'Elegir emoji');
    EMOJIS.forEach(emoji => {
      const b = el('button', null, emoji);
      b.type = 'button';
      b.addEventListener('click', () => {
        const i = els.input.selectionStart ?? els.input.value.length;
        const j = els.input.selectionEnd ?? i;
        els.input.value = els.input.value.slice(0, i) + emoji + els.input.value.slice(j);
        els.input.setSelectionRange(i + emoji.length, i + emoji.length);
        autosize();
        els.input.focus();
      });
      picker.append(b);
    });
    els.composer.append(picker);
    els.emojiBtn.setAttribute('aria-expanded', 'true');
  });
  document.addEventListener('click', e => {
    if (picker && !picker.contains(e.target) && e.target !== els.emojiBtn) closeEmoji();
  });

  // ------------------------------------------------------------ typing, presence
  function renderTyping() {
    const names = [...state.typing.keys()];
    if (!names.length) els.typing.textContent = '';
    else if (names.length === 1) els.typing.textContent = `${names[0]} está escribiendo…`;
    else if (names.length === 2) els.typing.textContent = `${names[0]} y ${names[1]} están escribiendo…`;
    else els.typing.textContent = 'Varias personas están escribiendo…';
  }

  function renderUsers(names) {
    els.usersCount.textContent = names.length ? `(${names.length})` : '';
    els.users.replaceChildren();
    if (!names.length) return void els.users.append(el('li', 'cx-users-empty', 'Nadie con sesión iniciada por ahora.'));
    names.forEach(name => {
      const li = el('li');
      const a = el('a');
      a.href = `/u/${encodeURIComponent(name)}`;
      a.append(G.avatar(name, null, 'avatar-sm'), el('span', null, name));
      li.append(a);
      els.users.append(li);
    });
  }

  els.onlineBtn.addEventListener('click', () => {
    const open = !els.side.classList.contains('is-open');
    els.side.classList.toggle('is-open', open);
    els.onlineBtn.setAttribute('aria-expanded', String(open));
  });
  $('cx-side-close').addEventListener('click', () => {
    els.side.classList.remove('is-open');
    els.onlineBtn.setAttribute('aria-expanded', 'false');
  });

  // ------------------------------------------------------------ account / status
  function setStatus(s, label) {
    els.status.dataset.state = s;
    els.status.textContent = label;
  }

  function applyAccount() {
    const user = me();
    const muted = state.mutedUntil > Date.now();
    els.composer.hidden = !user || muted;
    els.guest.hidden = Boolean(user);
    els.muted.hidden = !muted;
    if (muted) {
      const until = new Date(state.mutedUntil);
      els.mutedText.textContent = state.mutedUntil - Date.now() > 3 * 365 * 86400000
        ? 'Un moderador te ha expulsado del chat.'
        : `Un moderador te ha silenciado. Podrás escribir de nuevo el ${dayFmt.format(until)} a las ${timeFmt.format(until)}.`;
    }
    els.modBtn.hidden = !state.admin;
    els.attachBtn.hidden = !state.photos;
    if ((!user || muted) && rec.recorder) cancelRecording();
    updateComposerMode();
    document.querySelectorAll('.cx-msg').forEach(li => {
      const entry = state.messages.get(Number(li.dataset.id));
      if (entry) li.classList.toggle('is-own', isOwn(entry.data));
    });
  }

  async function refreshStatus() {
    try {
      const s = await G.api('/api/chat/status');
      state.admin = s.admin;
      state.photos = s.photos;
      state.audio = Boolean(s.audio && canRecord);
      state.mutedUntil = s.mutedUntil || 0;
    } catch { /* keep previous state */ }
    applyAccount();
    refreshReportCount();
  }

  // ------------------------------------------------------------ socket wiring
  if (!socket) {
    setStatus('offline', 'Sin conexión');
    return;
  }
  socket.on('connect', () => {
    setStatus('live', 'En vivo');
    loadHistory();
    refreshStatus();
  });
  socket.on('disconnect', () => setStatus('connecting', 'Reconectando…'));
  socket.on('connect_error', err => setStatus('offline', err.message === 'disabled' ? 'Chat no disponible' : 'Sin conexión'));
  socket.on('chat:message', m => {
    state.typing.delete(m.username);
    renderTyping();
    addMessage(m, { live: true });
  });
  socket.on('chat:edited', ({ id, content, editedAt }) => {
    const entry = state.messages.get(id);
    if (!entry) return;
    entry.data.content = content;
    entry.data.editedAt = editedAt;
    renderEntry(entry);
    for (const other of state.messages.values()) {
      if (other.data.replyTo && other.data.replyTo.id === id) {
        other.data.replyTo = { ...other.data.replyTo, excerpt: content.slice(0, 120) };
        renderEntry(other);
      }
    }
  });
  socket.on('chat:deleted', ({ id }) => removeMessage(id));
  socket.on('chat:reaction', applyReaction);
  socket.on('chat:typing', ({ username }) => {
    if (me() && username.toLowerCase() === me().username.toLowerCase()) return;
    clearTimeout(state.typing.get(username));
    state.typing.set(username, setTimeout(() => { state.typing.delete(username); renderTyping(); }, 4000));
    renderTyping();
  });
  socket.on('chat:online', n => { els.online.textContent = n; });
  socket.on('chat:users', renderUsers);
  if (socket.connected) {
    setStatus('live', 'En vivo');
    loadHistory();
    refreshStatus();
  }

  G.onAuth(() => { clearAttachment(); setReply(null); cancelRecording(); refreshStatus(); });
  G.loadMe().then(refreshStatus);
  setInterval(refreshReportCount, 45000);

  // Tab title + keyboard handling on phones
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { state.tabUnread = 0; document.title = baseTitle; }
  });
  const compact = window.matchMedia('(max-width: 900px)');
  els.input.addEventListener('focus', () => { if (compact.matches) document.body.classList.add('cx-kb'); });
  els.input.addEventListener('blur', () => setTimeout(() => document.body.classList.remove('cx-kb'), 150));
  if (window.visualViewport) {
    const fit = () => document.documentElement.style.setProperty('--cx-h', `${window.visualViewport.height}px`);
    window.visualViewport.addEventListener('resize', fit);
    fit();
  }
  autosize();
  updateComposerMode();
})();
