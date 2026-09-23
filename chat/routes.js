const express = require('express');
const bcrypt = require('bcryptjs');
const { createLimiter } = require('./limits');

const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 72;
// Compared against when the user does not exist, so login timing doesn't reveal valid usernames.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

function createChatRouter(getStore) {
  const router = express.Router();
  const loginLimiter = createLimiter({ max: 10, windowMs: 10 * 60 * 1000 });
  const registerLimiter = createLimiter({ max: 5, windowMs: 60 * 60 * 1000 });

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

  router.get('/chat/status', (req, res) => {
    const user = req.session && req.session.user;
    res.json({ enabled: Boolean(getStore()), user: user ? { username: user.username } : null });
  });

  router.get('/chat/history', requireStore, async (req, res, next) => {
    try {
      res.json(await getStore().recentMessages());
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
    console.error('[chat] API error:', err);
    res.status(500).json({ error: 'Error del servidor. Inténtalo de nuevo.' });
  });

  return router;
}

module.exports = { createChatRouter };
