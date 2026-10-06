// Real-time layer: live chat (messages, edits, reactions, typing, presence) and feed updates.
const { Server } = require('socket.io');
const { createLimiter } = require('./limits');
const images = require('./images');
const { CHAT_TEXT_MAX, EDIT_WINDOW_MS, REACTIONS, cleanMultiline, isAdminName } = require('./shared');

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

// Broadcast copy: same for everyone, so reactions carry counts only and no author id.
function publicMessage(message) {
  const { userId, ...rest } = message;
  return { ...rest, reactions: message.reactions.map(({ emoji, count }) => ({ emoji, count })) };
}

function attachChatSocket(httpServer, sessionMiddleware, getStore, bus) {
  const io = new Server(httpServer, {
    allowRequest: (req, callback) => callback(null, sameOrigin(req)),
    maxHttpBufferSize: 1e5,
  });
  io.engine.use(sessionMiddleware);

  const sendLimiter = createLimiter({ max: 6, windowMs: 10 * 1000 });
  const reactLimiter = createLimiter({ max: 20, windowMs: 10 * 1000 });
  const editLimiter = createLimiter({ max: 10, windowMs: 60 * 1000 });
  const lastSent = new Map();
  const lastTyping = new WeakMap();

  // ---- Presence
  let presenceTimer = null;
  function broadcastPresence() {
    if (presenceTimer) return;
    presenceTimer = setTimeout(() => {
      presenceTimer = null;
      const sockets = [...io.of('/').sockets.values()];
      const names = new Set();
      for (const s of sockets) {
        const u = s.request.session && s.request.session.user;
        if (u) names.add(u.username);
      }
      io.emit('chat:online', sockets.length);
      io.emit('chat:users', [...names].sort((a, b) => a.localeCompare(b)).slice(0, 100));
    }, 300);
  }

  io.use((socket, next) => {
    if (!getStore()) return next(new Error('disabled'));
    next();
  });

  // Community feed updates (new posts, likes, comments, deletions) go to everyone.
  if (bus) {
    bus.on('post:new', post => io.emit('feed:new', post));
    bus.on('post:delete', data => io.emit('feed:delete', data));
    bus.on('post:likes', data => io.emit('feed:likes', data));
    bus.on('comment:new', data => io.emit('feed:comment', data));
    bus.on('comment:delete', data => io.emit('feed:comment-delete', data));
  }

  io.on('connection', socket => {
    const user = socket.request.session && socket.request.session.user;
    broadcastPresence();

    // Runs a handler, always answers the ack and never lets an exception escape.
    const handle = (event, fn) => socket.on(event, async (payload, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      try {
        reply(await fn(payload || {}) || { ok: true });
      } catch (err) {
        console.error(`[chat] ${event} failed:`, err);
        reply({ error: 'No se pudo completar la acción. Inténtalo de nuevo.' });
      }
    });

    async function requireActive() {
      if (!user) return { error: 'Inicia sesión para participar.' };
      if (await getStore().getMute(user.id)) return { error: 'Estás silenciado por un moderador y no puedes escribir.' };
      return null;
    }

    handle('chat:send', async payload => {
      const blocked = await requireActive();
      if (blocked) return blocked;

      const content = cleanMultiline(payload.text);
      if (content.length > CHAT_TEXT_MAX) return { error: `Máximo ${CHAT_TEXT_MAX} caracteres.` };

      let image = null;
      if (payload.image) {
        image = images.claimUpload(user.id, payload.image);
        if (!image) return { error: 'La foto caducó. Súbela de nuevo.' };
      }
      if (!content && !image) return { error: 'El mensaje está vacío.' };

      const now = Date.now();
      if (now - (lastSent.get(user.id) || 0) < 800 || !sendLimiter(user.id)) {
        if (image) images.removeImage(image.name);
        return { error: 'Vas muy rápido. Espera un momento.' };
      }
      lastSent.set(user.id, now);

      let replyTo = null;
      if (payload.replyTo) {
        const target = await getStore().getMessage(Number(payload.replyTo), null);
        if (target && !target.replyTo?.deleted) replyTo = target.id;
      }

      const saved = await getStore().addMessage(user.id, { content, spoiler: Boolean(payload.spoiler), image, replyTo });
      io.emit('chat:message', publicMessage(saved));
      return { ok: true, id: saved.id };
    });

    handle('chat:edit', async payload => {
      const blocked = await requireActive();
      if (blocked) return blocked;
      if (!editLimiter(user.id)) return { error: 'Vas muy rápido. Espera un momento.' };

      const id = Number(payload.id);
      const message = await getStore().getMessage(id, null);
      if (!message) return { error: 'El mensaje ya no existe.' };
      if (message.userId !== user.id) return { error: 'Solo puedes editar tus mensajes.' };
      if (Date.now() - new Date(message.createdAt).getTime() > EDIT_WINDOW_MS) {
        return { error: 'Solo puedes editar un mensaje durante 15 minutos.' };
      }
      const content = cleanMultiline(payload.text);
      if (content.length > CHAT_TEXT_MAX) return { error: `Máximo ${CHAT_TEXT_MAX} caracteres.` };
      if (!content && !message.image) return { error: 'El mensaje no puede quedar vacío.' };

      const edited = await getStore().editMessage(id, content);
      if (!edited) return { error: 'El mensaje ya no existe.' };
      io.emit('chat:edited', { id, content: edited.content, editedAt: edited.editedAt });
    });

    handle('chat:delete', async payload => {
      if (!user) return { error: 'Inicia sesión para continuar.' };
      const id = Number(payload.id);
      const message = await getStore().getMessage(id, null);
      if (!message) return { error: 'El mensaje ya no existe.' };
      if (message.userId !== user.id && !isAdminName(user.username)) {
        return { error: 'Solo puedes borrar tus mensajes.' };
      }
      const removed = await getStore().deleteMessage(id);
      if (!removed) return { error: 'El mensaje ya no existe.' };
      images.removeImage(removed.image);
      io.emit('chat:deleted', { id });
    });

    handle('chat:react', async payload => {
      const blocked = await requireActive();
      if (blocked) return blocked;
      if (!reactLimiter(user.id)) return { error: 'Vas muy rápido. Espera un momento.' };
      const emoji = String(payload.emoji || '');
      if (!REACTIONS.includes(emoji)) return { error: 'Reacción no válida.' };
      const result = await getStore().toggleReaction(Number(payload.id), user.id, emoji);
      if (!result) return { error: 'El mensaje ya no existe.' };
      io.emit('chat:reaction', { id: Number(payload.id), emoji, count: result.count, by: user.username, on: result.on });
    });

    socket.on('chat:typing', () => {
      if (!user) return;
      const last = lastTyping.get(socket) || 0;
      if (Date.now() - last < 1500) return;
      lastTyping.set(socket, Date.now());
      socket.broadcast.emit('chat:typing', { username: user.username });
    });

    socket.on('disconnect', broadcastPresence);
  });

  return io;
}

module.exports = { attachChatSocket };
