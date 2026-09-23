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

  app.use(express.static(path.join(__dirname, 'public')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  const server = http.createServer(app);
  attachChatSocket(server, sessionMiddleware, getStore);

  server.listen(PORT, () => {
    console.log(`GTA VI site running on port ${PORT} (chat: ${store ? store.kind : 'disabled'})`);
  });
}

main();
