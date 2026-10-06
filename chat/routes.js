const express = require('express');
const bcrypt = require('bcryptjs');
const { createLimiter } = require('./limits');
const images = require('./images');
const { REPORT_REASONS, isAdminName } = require('./shared');

const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 72;
// Compared against when the user does not exist, so login timing doesn't reveal valid usernames.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

function createChatRouter(getStore) {
  const router = express.Router();
  const loginLimiter = createLimiter({ max: 10, windowMs: 10 * 60 * 1000 });
  const registerLimiter = createLimiter({ max: 5, windowMs: 60 * 60 * 1000 });

  const uploadLimiter = createLimiter({ max: 1, windowMs: 6 * 1000 });
  const uploadHourLimiter = createLimiter({ max: 20, windowMs: 60 * 60 * 1000 });
  const reportLimiter = createLimiter({ max: 10, windowMs: 60 * 60 * 1000 });

  router.use(express.json({ limit: '10kb' }));

  function requireStore(req, res, next) {
    if (!getStore()) return res.status(503).json({ error: 'El chat todavía no está disponible.' });
    next();
  }

  function startSession(req, user) {
    return new Promise((resolve, reject) => {
      req.session.regenerate(err => {
        if (err) return reject(err);
        req.session.user = { id: user.id, username: user.username };
        req.session.save(saveErr => (saveErr ? reject(saveErr) : resolve()));
      });
    });
  }

  const sessionUser = req => (req.session && req.session.user) || null;

  function requireUser(req, res, next) {
    if (!sessionUser(req)) return res.status(401).json({ error: 'Inicia sesión para continuar.' });
    next();
  }

  function requireAdmin(req, res, next) {
    const user = sessionUser(req);
    if (!user) return res.status(401).json({ error: 'Inicia sesión para continuar.' });
    if (!isAdminName(user.username)) return res.status(403).json({ error: 'Solo los moderadores pueden hacer esto.' });
    next();
  }

  router.get('/chat/status', async (req, res, next) => {
    try {
      const user = sessionUser(req);
      const mutedUntil = user && getStore() ? await getStore().getMute(user.id) : 0;
      res.json({
        enabled: Boolean(getStore()),
        photos: images.enabled(),
        user: user ? { username: user.username } : null,
        admin: Boolean(user && isAdminName(user.username)),
        mutedUntil,
      });
    } catch (err) {
      next(err);
    }
  });

  router.get('/chat/history', requireStore, async (req, res, next) => {
    try {
      const user = sessionUser(req);
      const before = Math.max(0, Number(req.query.before) || 0);
      const limit = Math.min(60, Math.max(1, Number(req.query.limit) || 40));
      res.json(await getStore().listMessages({ before, limit, viewerId: user ? user.id : null }).then(r => ({
        messages: r.messages.map(({ userId, ...m }) => m),
        hasMore: r.hasMore,
      })));
    } catch (err) {
      next(err);
    }
  });

  // Photos arrive as the raw request body (Content-Type: image/*).
  router.post('/chat/upload', requireStore, requireUser,
    express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: images.MAX_BYTES }),
    async (req, res, next) => {
      try {
        const user = sessionUser(req);
        if (!images.enabled()) return res.status(503).json({ error: 'Las fotos no están disponibles en este momento.' });
        if (!Buffer.isBuffer(req.body) || !req.body.length) {
          return res.status(415).json({ error: 'Sube una foto JPG, PNG o WebP de hasta 6 MB.' });
        }
        if (await getStore().getMute(user.id)) return res.status(403).json({ error: 'Estás silenciado y no puedes enviar fotos.' });
        if (!uploadLimiter(user.id) || !uploadHourLimiter(user.id)) {
          return res.status(429).json({ error: 'Has enviado muchas fotos. Espera un momento.' });
        }
        const image = await images.processImage(req.body);
        images.registerUpload(user.id, image);
        res.status(201).json({ image });
      } catch (err) {
        if (err instanceof images.ImageError) return res.status(400).json({ error: err.message });
        next(err);
      }
    });

  router.delete('/chat/upload/:name', requireUser, (req, res) => {
    images.discardUpload(sessionUser(req).id, req.params.name);
    res.json({ ok: true });
  });

  // ---- Moderation
  router.post('/chat/report', requireStore, requireUser, async (req, res, next) => {
    try {
      const user = sessionUser(req);
      const messageId = Number(req.body.messageId);
      const reason = REPORT_REASONS.includes(req.body.reason) ? req.body.reason : 'otro';
      if (!Number.isInteger(messageId) || messageId < 1) return res.status(400).json({ error: 'Mensaje no válido.' });
      if (!reportLimiter(user.id)) return res.status(429).json({ error: 'Has enviado muchos reportes. Inténtalo más tarde.' });
      const result = await getStore().createReport({ messageId, reporterId: user.id, reason });
      if (result === null) return res.status(404).json({ error: 'El mensaje ya no existe.' });
      res.status(201).json({ ok: true, duplicate: result === false });
    } catch (err) {
      next(err);
    }
  });

  router.get('/chat/reports', requireStore, requireAdmin, async (req, res, next) => {
    try {
      const reports = await getStore().listReports();
      res.json({ reports: reports.map(r => ({ ...r, message: (({ userId, ...m }) => m)(r.message) })) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/chat/reports/:id/dismiss', requireStore, requireAdmin, async (req, res, next) => {
    try {
      await getStore().dismissReports(Number(req.params.id));
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // minutes = 0 lifts the mute. Moderators cannot be muted.
  router.post('/chat/mute', requireStore, requireAdmin, async (req, res, next) => {
    try {
      const target = await getStore().findUserByName(String(req.body.username || '').slice(0, 20));
      if (!target) return res.status(404).json({ error: 'Usuario no encontrado.' });
      if (isAdminName(target.username)) return res.status(400).json({ error: 'No puedes silenciar a otro moderador.' });
      const minutes = Math.max(0, Math.min(60 * 24 * 365, Math.floor(Number(req.body.minutes) || 0)));
      const until = minutes ? Date.now() + minutes * 60 * 1000 : 0;
      await getStore().setMute(target.id, until);
      res.json({ ok: true, username: target.username, until });
    } catch (err) {
      next(err);
    }
  });

  router.post('/auth/register', requireStore, async (req, res, next) => {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');

    if (!USERNAME_RE.test(username)) {
      return res.status(400).json({ error: 'El usuario debe tener de 3 a 20 caracteres: letras, números o guion bajo.' });
    }
    if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
      return res.status(400).json({ error: `La contraseña debe tener entre ${PASSWORD_MIN} y ${PASSWORD_MAX} caracteres.` });
    }
    if (!registerLimiter(req.ip)) {
      return res.status(429).json({ error: 'Demasiadas cuentas creadas desde tu conexión. Inténtalo más tarde.' });
    }

    try {
      const hash = await bcrypt.hash(password, 10);
      const user = await getStore().createUser(username, hash);
      await startSession(req, user);
      res.status(201).json({ user: { username: user.username } });
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ese nombre de usuario ya está en uso.' });
      next(err);
    }
  });

  router.post('/auth/login', requireStore, async (req, res, next) => {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');

    if (!loginLimiter(req.ip)) {
      return res.status(429).json({ error: 'Demasiados intentos. Espera unos minutos y vuelve a intentarlo.' });
    }

    try {
      const user = USERNAME_RE.test(username) ? await getStore().findUserByName(username) : null;
      const ok = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
      if (!user || !ok) return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
      await startSession(req, user);
      res.json({ user: { username: user.username } });
    } catch (err) {
      next(err);
    }
  });

  router.post('/auth/logout', (req, res, next) => {
    req.session.destroy(err => {
      if (err) return next(err);
      res.clearCookie('gtavi.sid');
      res.json({ ok: true });
    });
  });

  router.use((err, req, res, next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'La foto es demasiado grande (máximo 6 MB).' });
    console.error('[chat] API error:', err);
    res.status(500).json({ error: 'Error del servidor. Inténtalo de nuevo.' });
  });

  return router;
}

module.exports = { createChatRouter };
