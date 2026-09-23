const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const HISTORY_LIMIT = 50;

function dbConfigFromEnv() {
  const { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME } = process.env;
  if (!DB_HOST || !DB_USER || !DB_NAME) return null;
  return {
    host: DB_HOST,
    port: Number(DB_PORT) || 3306,
    user: DB_USER,
    password: DB_PASSWORD || '',
    database: DB_NAME,
    charset: 'utf8mb4',
    waitForConnections: true,
    connectionLimit: 10,
  };
}

async function createMysqlStore(config) {
  const pool = mysql.createPool(config);
  const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  for (const statement of schema.split(';').map(s => s.trim()).filter(Boolean)) {
    await pool.query(statement);
  }

  return {
    kind: 'mysql',
    pool,
    async findUserByName(username) {
      const [rows] = await pool.query('SELECT id, username, password_hash FROM users WHERE username = ?', [username]);
      return rows[0] || null;
    },
    async createUser(username, passwordHash) {
      const [result] = await pool.query('INSERT INTO users (username, password_hash) VALUES (?, ?)', [username, passwordHash]);
      return { id: result.insertId, username };
    },
    async addMessage(userId, content, spoiler) {
      const [result] = await pool.query(
        'INSERT INTO messages (user_id, content, spoiler) VALUES (?, ?, ?)',
        [userId, content, spoiler ? 1 : 0]
      );
      const [rows] = await pool.query('SELECT created_at FROM messages WHERE id = ?', [result.insertId]);
      return { id: result.insertId, createdAt: rows[0].created_at };
    },
    async recentMessages() {
      const [rows] = await pool.query(
        `SELECT m.id, m.content, m.spoiler, m.created_at, u.username
         FROM messages m JOIN users u ON u.id = m.user_id
         ORDER BY m.id DESC LIMIT ?`,
        [HISTORY_LIMIT]
      );
      return rows.reverse().map(r => ({
        id: r.id,
        username: r.username,
        content: r.content,
        spoiler: Boolean(r.spoiler),
        createdAt: r.created_at,
      }));
    },
  };
}

// Local development only (CHAT_STORE=memory): data is lost on restart.
function createMemoryStore() {
  const users = new Map();
  const messages = [];
  let nextUserId = 1;
  let nextMessageId = 1;

  return {
    kind: 'memory',
    async findUserByName(username) {
      return users.get(username.toLowerCase()) || null;
    },
    async createUser(username, passwordHash) {
      const key = username.toLowerCase();
      if (users.has(key)) {
        const err = new Error('duplicate');
        err.code = 'ER_DUP_ENTRY';
        throw err;
      }
      const user = { id: nextUserId++, username, password_hash: passwordHash };
      users.set(key, user);
      return { id: user.id, username };
    },
    async addMessage(userId, content, spoiler) {
      const user = [...users.values()].find(u => u.id === userId);
      const message = { id: nextMessageId++, username: user.username, content, spoiler, createdAt: new Date() };
      messages.push(message);
      if (messages.length > HISTORY_LIMIT) messages.shift();
      return { id: message.id, createdAt: message.createdAt };
    },
    async recentMessages() {
      return messages.map(m => ({ ...m }));
    },
  };
}

async function createStore() {
  if (process.env.CHAT_STORE === 'memory') {
    console.warn('[chat] Using in-memory store (development only, data is not persisted).');
    return createMemoryStore();
  }
  const config = dbConfigFromEnv();
  if (!config) {
    console.warn('[chat] DB_HOST, DB_USER and DB_NAME are not set: community chat is disabled.');
    return null;
  }
  try {
    const store = await createMysqlStore(config);
    console.log('[chat] Connected to MySQL.');
    return store;
  } catch (err) {
    console.error('[chat] Could not connect to MySQL, community chat is disabled:', err.message);
    return null;
  }
}

module.exports = { createStore };
