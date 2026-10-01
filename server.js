const http = require('http');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const { createStore } = require('./chat/store');
const { createChatRouter } = require('./chat/routes');
const { attachChatSocket } = require('./chat/socket');

const PORT = process.env.PORT || 3000;
const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

async function main() {
  const store = await createStore();
  const getStore = () => store;

  let secret = process.env.SESSION_SECRET;
  if (!secret) {
    secret = crypto.randomBytes(32).toString('hex');
    if (store) console.warn('[chat] SESSION_SECRET is not set: users will be logged out on every restart.');
  }

  const sessionMiddleware = session({
    name: 'gtavi.sid',
    secret,
    store: store && store.kind === 'mysql'
      ? new MySQLStore({ expiration: THIRTY_DAYS, endConnectionOnClose: false }, store.pool)
      : undefined,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', secure: 'auto', maxAge: THIRTY_DAYS },
  });

  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use('/api', sessionMiddleware, createChatRouter(getStore));
  app.use('/api', (req, res) => res.status(404).json({ error: 'No encontrado.' }));

  const publicDir = path.join(__dirname, 'public');

  const notFound = (req, res) => res.status(404).sendFile(path.join(publicDir, '404.html'));
  app.get(['/404', '/404.html'], notFound);

  // Clean URLs: /noticias.html -> /noticias, /index.html -> /
  app.get(/^\/(.+)\.html$/, (req, res) => {
    const name = req.params[0];
    const query = req.originalUrl.slice(req.path.length);
    res.redirect(301, (name === 'index' ? '/' : `/${name}`) + query);
  });

  app.use(express.static(publicDir, { extensions: ['html'] }));
  app.use(notFound);

  const server = http.createServer(app);
  attachChatSocket(server, sessionMiddleware, getStore);

  server.listen(PORT, () => {
    console.log(`GTA VI site running on port ${PORT} (chat: ${store ? store.kind : 'disabled'})`);
  });
}

main();
