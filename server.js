const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const express = require('express');
const compression = require('compression');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const { createStore } = require('./chat/store');
const { createChatRouter } = require('./chat/routes');
const { createSocialRouter } = require('./chat/social');
const { JsonSessionStore } = require('./chat/session-store');
const { attachChatSocket } = require('./chat/socket');
const images = require('./chat/images');

const PORT = process.env.PORT || 3000;
const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

async function main() {
  const store = await createStore();
  const getStore = () => store;

  // Without SESSION_SECRET, generate one once and keep it, so sessions survive restarts.
  let secret = process.env.SESSION_SECRET;
  if (!secret) {
    secret = await store.getMeta('session_secret');
    if (!secret) {
      secret = crypto.randomBytes(32).toString('hex');
      await store.setMeta('session_secret', secret);
    }
  }

  let sessionStore;
  if (store.kind === 'mysql') sessionStore = new MySQLStore({ expiration: THIRTY_DAYS, endConnectionOnClose: false }, store.pool);
  else if (store.kind === 'file') sessionStore = new JsonSessionStore(store);

  const sessionMiddleware = session({
    name: 'gtavi.sid',
    secret,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', secure: 'auto', maxAge: THIRTY_DAYS },
  });

  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // One canonical URL per page: no "www." and no trailing slash.
  app.use((req, res, next) => {
    const host = req.headers.host || '';
    if (host.startsWith('www.')) {
      return res.redirect(301, `https://${host.slice(4)}${req.originalUrl}`);
    }
    if (req.path.length > 1 && req.path.endsWith('/') && !req.path.startsWith('/api/')) {
      const query = req.originalUrl.slice(req.path.length);
      // Collapse leading slashes too, so "//host/" can't become an off-site redirect.
      return res.redirect(301, '/' + req.path.replace(/^\/+|\/+$/g, '') + query);
    }
    next();
  });

  app.use(compression());
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Frame-Options': 'SAMEORIGIN',
    });
    next();
  });

  // Reject cross-site writes: browsers always send Origin on POST/PATCH/DELETE.
  const sameOriginWrites = (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    const origin = req.headers.origin;
    if (origin) {
      try {
        if (new URL(origin).host === req.headers.host) return next();
      } catch { /* invalid origin */ }
      return res.status(403).json({ error: 'Origen no permitido.' });
    }
    next();
  };

  const bus = new EventEmitter();
  app.use('/api', sessionMiddleware, sameOriginWrites, createChatRouter(getStore), createSocialRouter(getStore, bus));
  app.use('/api', (req, res) => res.status(404).json({ error: 'No encontrado.' }));

  const publicDir = path.join(__dirname, 'public');

  const notFound = (req, res) => res.status(404).sendFile(path.join(publicDir, '404.html'));
  app.get(['/404', '/404.html'], notFound);

  // Chat photos live outside the app folder so they survive deploys.
  app.get('/media/chat/:file', (req, res) => {
    if (!images.NAME_RE.test(req.params.file)) return res.status(404).end();
    res.sendFile(req.params.file, {
      root: images.uploadsDir(),
      maxAge: '365d',
      immutable: true,
      headers: { 'Content-Type': 'image/webp', 'Content-Security-Policy': "default-src 'none'" },
    }, err => {
      if (err && !res.headersSent) res.status(404).end();
    });
  });

  // Public profiles share the profile page; the script reads the username from the URL.
  app.get('/u/:username', (req, res, next) => {
    if (!/^[A-Za-z0-9_]{3,20}$/.test(req.params.username)) return next();
    res.set('Cache-Control', 'no-cache').sendFile(path.join(publicDir, 'perfil.html'));
  });

  // Clean URLs: /noticias.html -> /noticias, /index.html -> /
  app.get(/^\/(.+)\.html$/, (req, res) => {
    const name = req.params[0].replace(/^\/+/, '');
    const query = req.originalUrl.slice(req.path.length);
    res.redirect(301, (name === 'index' ? '/' : `/${name}`) + query);
  });

  // HTML always revalidates; CSS/JS are versioned (?v=) and images rarely change.
  app.use(express.static(publicDir, {
    extensions: ['html'],
    setHeaders(res, filePath) {
      if (/\.html$/.test(filePath)) {
        res.setHeader('Cache-Control', 'no-cache');
      } else if (/\.(css|js)$/.test(filePath)) {
        res.setHeader('Cache-Control', 'public, max-age=2592000');
      } else if (/\.(jpe?g|png|webp|avif|svg|ico)$/.test(filePath)) {
        res.setHeader('Cache-Control', 'public, max-age=604800');
      }
    },
  }));
  app.use(notFound);

  const server = http.createServer(app);
  attachChatSocket(server, sessionMiddleware, getStore, bus);

  server.listen(PORT, () => {
    console.log(`GTA VI site running on port ${PORT} (community store: ${store.kind})`);
  });
}

main();
