const { Server } = require('socket.io');
const { createLimiter } = require('./limits');

const MAX_LENGTH = 500;
const MIN_INTERVAL_MS = 1000;

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function cleanText(value) {
  return String(value || '')
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function attachChatSocket(httpServer, sessionMiddleware, getStore) {
  const io = new Server(httpServer, {
    allowRequest: (req, callback) => callback(null, sameOrigin(req)),
  });
  io.engine.use(sessionMiddleware);

  const burstLimiter = createLimiter({ max: 6, windowMs: 10 * 1000 });
  const lastSent = new Map();

  const broadcastOnline = () => io.emit('chat:online', io.of('/').sockets.size);

  io.use((socket, next) => {
    if (!getStore()) return next(new Error('disabled'));
    next();
  });

  io.on('connection', socket => {
    const user = socket.request.session && socket.request.session.user;
    broadcastOnline();

    socket.on('chat:send', async (payload, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      if (!user) return reply({ error: 'Inicia sesión para escribir.' });

      const content = cleanText(payload && payload.text);
      if (!content) return reply({ error: 'El mensaje está vacío.' });
      if (content.length > MAX_LENGTH) return reply({ error: `Máximo ${MAX_LENGTH} caracteres.` });

      const now = Date.now();
      if (now - (lastSent.get(user.id) || 0) < MIN_INTERVAL_MS || !burstLimiter(user.id)) {
        return reply({ error: 'Vas muy rápido. Espera un momento.' });
      }
      lastSent.set(user.id, now);

      try {
        const spoiler = Boolean(payload && payload.spoiler);
        const saved = await getStore().addMessage(user.id, content, spoiler);
        io.emit('chat:message', {
          id: saved.id,
          username: user.username,
          content,
          spoiler,
          createdAt: saved.createdAt,
        });
        reply({ ok: true });
      } catch (err) {
        console.error('[chat] Could not save message:', err);
        reply({ error: 'No se pudo enviar el mensaje. Inténtalo de nuevo.' });
      }
    });

    socket.on('disconnect', broadcastOnline);
  });

  return io;
}

module.exports = { attachChatSocket };
