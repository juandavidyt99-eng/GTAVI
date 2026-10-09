const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const { createLimiter } = require('./limits');
const images = require('./images');
const voice = require('./audio');
const { REPORT_REASONS, isAdminName, googleConfig } = require('./shared');

const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 72;
// Compared against when the user does not exist, so login timing doesn't reveal valid usernames.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);
const OAUTH_MAX_AGE_MS = 10 * 60 * 1000;

// Only same-site paths are accepted as the page to return to after signing in.
function safeNext(value) {
  const next = String(value || '');
  return /^\/(?![/\\])[^\s]*$/.test(next) && next.length <= 300 ? next : '/';
}

// "Juan David López" -> "JuanDavidLopez": a starting point the user can change.
function usernameFromName(name) {
  const base = String(name || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .split(/[^A-Za-z0-9]+/).filter(Boolean)
    .map(w => w[0].toUpperCase() + w.slice(1))
    .join('')
    .slice(0, 16);
  return base.length >= 3 ? base : `Fan${base}`;
}

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
        audio: true,
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

  // Voice notes arrive as the raw recording (Content-Type: audio/*), with their length in ?ms=.
  const audioLimiter = createLimiter({ max: 1, windowMs: 4 * 1000 });
  const audioHourLimiter = createLimiter({ max: 40, windowMs: 60 * 60 * 1000 });
  router.post('/chat/audio', requireStore, requireUser,
    express.raw({ type: req => /^audio\//.test(req.headers['content-type'] || ''), limit: voice.MAX_BYTES }),
    async (req, res, next) => {
      try {
        const user = sessionUser(req);
        if (!Buffer.isBuffer(req.body) || !req.body.length) {
          return res.status(415).json({ error: 'La nota de voz no tiene un formato válido.' });
        }
        if (await getStore().getMute(user.id)) return res.status(403).json({ error: 'Estás silenciado y no puedes enviar notas de voz.' });
        if (!audioLimiter(user.id) || !audioHourLimiter(user.id)) {
          return res.status(429).json({ error: 'Has enviado muchas notas de voz. Espera un momento.' });
        }
        const audio = await voice.saveAudio(req.body, req.query.ms);
        voice.registerAudio(user.id, audio);
        res.status(201).json({ audio });
      } catch (err) {
        if (err instanceof voice.AudioError) return res.status(400).json({ error: err.message });
        next(err);
      }
    });

  router.delete('/chat/audio/:name', requireUser, (req, res) => {
    voice.discardAudio(sessionUser(req).id, req.params.name);
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
    // With Google sign-in on, new members join only through Google.
    if (googleConfig()) return res.status(403).json({ error: 'Las cuentas nuevas se crean con Google.' });
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

  // ---- Entrar con Google (OAuth 2.0 authorization code flow)
  const googleLimiter = createLimiter({ max: 20, windowMs: 10 * 60 * 1000 });

  function saveSession(req) {
    return new Promise((resolve, reject) => req.session.save(err => (err ? reject(err) : resolve())));
  }

  router.get('/auth/google', async (req, res, next) => {
    const google = googleConfig();
    const nextPath = safeNext(req.query.next);
    if (!google || !getStore()) return res.redirect('/perfil?google=error');
    try {
      const state = crypto.randomBytes(16).toString('hex');
      req.session.oauth = { state, next: nextPath, at: Date.now() };
      await saveSession(req);
      const params = new URLSearchParams({
        client_id: google.id,
        redirect_uri: google.redirectUri,
        response_type: 'code',
        scope: 'openid profile',
        state,
        prompt: 'select_account',
      });
      res.redirect(`${GOOGLE_AUTH_URL}?${params}`);
    } catch (err) {
      next(err);
    }
  });

  router.get('/auth/google/callback', async (req, res) => {
    const google = googleConfig();
    const oauth = req.session && req.session.oauth;
    const fail = () => res.redirect('/perfil?google=error');
    if (req.session) delete req.session.oauth;
    if (!google || !getStore() || !oauth || !googleLimiter(req.ip)) return fail();
    if (Date.now() - oauth.at > OAUTH_MAX_AGE_MS || typeof req.query.state !== 'string'
        || req.query.state.length !== oauth.state.length
        || !crypto.timingSafeEqual(Buffer.from(req.query.state), Buffer.from(oauth.state))
        || typeof req.query.code !== 'string') {
      return fail();
    }

    try {
      const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: req.query.code,
          client_id: google.id,
          client_secret: google.secret,
          redirect_uri: google.redirectUri,
          grant_type: 'authorization_code',
        }),
        signal: AbortSignal.timeout(10000),
      });
      const tokens = await tokenRes.json().catch(() => ({}));
      if (!tokenRes.ok || typeof tokens.id_token !== 'string') throw new Error(`token exchange failed (${tokenRes.status})`);

      // The ID token comes straight from Google's token endpoint over TLS, so its claims can be trusted
      // once audience, issuer and expiry match (OpenID Connect Core, section 3.1.3.7).
      const claims = JSON.parse(Buffer.from(tokens.id_token.split('.')[1] || '', 'base64url').toString('utf8'));
      if (claims.aud !== google.id || !GOOGLE_ISSUERS.has(claims.iss) || !claims.sub
          || Number(claims.exp) * 1000 < Date.now()) {
        throw new Error('invalid id token');
      }

      const googleId = String(claims.sub);
      const existing = await getStore().findUserByGoogleId(googleId);
      if (existing) {
        await startSession(req, existing);
        return res.redirect(oauth.next);
      }

      // New here: let them pick their community name before the account is created.
      req.session.googlePending = { googleId, name: usernameFromName(claims.given_name || claims.name), next: oauth.next, at: Date.now() };
      await saveSession(req);
      res.redirect('/perfil?google=nuevo');
    } catch (err) {
      console.error('[auth] Google sign-in failed:', err.message);
      fail();
    }
  });

  router.get('/auth/google/pending', requireStore, async (req, res, next) => {
    const pending = req.session && req.session.googlePending;
    if (!pending || Date.now() - pending.at > OAUTH_MAX_AGE_MS) return res.json({ pending: false });
    try {
      // Suggest a free variant of their name.
      let suggestion = pending.name;
      for (let i = 0; i < 5 && await getStore().findUserByName(suggestion); i++) {
        suggestion = `${pending.name.slice(0, 15)}${crypto.randomInt(10, 10000)}`;
      }
      res.json({ pending: true, suggestion });
    } catch (err) {
      next(err);
    }
  });

  router.post('/auth/google/complete', requireStore, async (req, res, next) => {
    const pending = req.session && req.session.googlePending;
    if (!pending || Date.now() - pending.at > OAUTH_MAX_AGE_MS) {
      return res.status(400).json({ error: 'La sesión con Google caducó. Vuelve a intentarlo.' });
    }
    const username = String(req.body.username || '').trim();
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    if (!USERNAME_RE.test(username)) {
      return res.status(400).json({ error: 'El usuario debe tener de 3 a 20 caracteres: letras, números o guion bajo.' });
    }

    // Members who joined with a username and password keep their account: proving the old
    // password once links it to this Google account.
    if (password) {
      if (!loginLimiter(req.ip)) {
        return res.status(429).json({ error: 'Demasiados intentos. Espera unos minutos y vuelve a intentarlo.' });
      }
      try {
        const owner = await getStore().findUserByName(username);
        const linkable = owner && !owner.google_id;
        const ok = await bcrypt.compare(password, linkable ? owner.password_hash : DUMMY_HASH);
        if (!linkable || !ok) return res.status(401).json({ error: 'La contraseña no coincide con esa cuenta.', link: true });
        if (!await getStore().linkGoogle(owner.id, pending.googleId)) {
          return res.status(409).json({ error: 'Esta cuenta de Google ya está vinculada a otro usuario.' });
        }
        const nextPath = pending.next;
        await startSession(req, owner);
        return res.json({ user: { username: owner.username }, linked: true, next: nextPath });
      } catch (err) {
        return next(err);
      }
    }

    if (!registerLimiter(req.ip)) {
      return res.status(429).json({ error: 'Demasiadas cuentas creadas desde tu conexión. Inténtalo más tarde.' });
    }

    try {
      // Google accounts sign in only through Google: the password is random and never shown.
      const hash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
      let user;
      try {
        user = await getStore().createGoogleUser(username, pending.googleId, hash);
      } catch (err) {
        if (err.code !== 'ER_DUP_ENTRY') throw err;
        user = await getStore().findUserByGoogleId(pending.googleId);
        if (!user) {
          const owner = await getStore().findUserByName(username);
          if (owner && !owner.google_id) {
            return res.status(409).json({
              error: 'Ese nombre ya tiene una cuenta. Si es tuya, escribe su contraseña para vincularla con Google.',
              link: true,
            });
          }
          return res.status(409).json({ error: 'Ese nombre de usuario ya está en uso.' });
        }
      }
      await startSession(req, user);
      res.status(201).json({ user: { username: user.username }, next: pending.next });
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
    if (err.type === 'entity.too.large') {
      const isAudio = req.path.startsWith('/chat/audio');
      return res.status(413).json({ error: isAudio ? 'La nota de voz es demasiado larga (máximo 2 minutos).' : 'La foto es demasiado grande (máximo 6 MB).' });
    }
    console.error('[chat] API error:', err);
    res.status(500).json({ error: 'Error del servidor. Inténtalo de nuevo.' });
  });

  return router;
}

module.exports = { createChatRouter };
