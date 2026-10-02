const fs = require('fs');
const os = require('os');
const path = require('path');
const mysql = require('mysql2/promise');
const { createJsonStore } = require('./jsonstore');
const { HISTORY_LIMIT } = require('./shared');

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

  const toPost = r => ({
    id: r.id,
    userId: r.user_id,
    author: { username: r.username, team: r.team || null },
    category: r.category,
    body: r.body,
    spoiler: Boolean(r.spoiler),
    videoId: r.video_id || null,
    createdAt: r.created_at,
    likes: r.like_count,
    comments: r.comment_count,
    liked: Boolean(Number(r.liked)),
  });
  const toComment = r => ({
    id: r.id,
    postId: r.post_id,
    userId: r.user_id,
    author: { username: r.username, team: r.team || null },
    content: r.content,
    createdAt: r.created_at,
  });

  // Viewer id (when present) is always the first placeholder.
  function postSelect(viewerId) {
    const liked = viewerId
      ? 'EXISTS(SELECT 1 FROM post_likes l WHERE l.post_id = p.id AND l.user_id = ?) AS liked'
      : '0 AS liked';
    return `SELECT p.id, p.user_id, p.category, p.body, p.spoiler, p.video_id, p.like_count, p.comment_count,
                   p.created_at, u.username, pr.team, ${liked}
            FROM posts p
            JOIN users u ON u.id = p.user_id
            LEFT JOIN profiles pr ON pr.user_id = p.user_id`;
  }

  const COMMENT_SELECT = `SELECT c.id, c.post_id, c.user_id, c.content, c.created_at, u.username, pr.team
                          FROM comments c
                          JOIN users u ON u.id = c.user_id
                          LEFT JOIN profiles pr ON pr.user_id = c.user_id`;

  async function inTransaction(work) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const result = await work(conn);
      await conn.commit();
      return result;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  return {
    kind: 'mysql',
    pool,

    // Users
    async findUserByName(username) {
      const [rows] = await pool.query('SELECT id, username, password_hash FROM users WHERE username = ?', [username]);
      return rows[0] || null;
    },
    async createUser(username, passwordHash) {
      const [result] = await pool.query('INSERT INTO users (username, password_hash) VALUES (?, ?)', [username, passwordHash]);
      return { id: result.insertId, username };
    },
    async getProfile(username) {
      const [rows] = await pool.query(
        `SELECT u.id, u.username, u.created_at, pr.bio, pr.team,
                (SELECT COUNT(*) FROM posts WHERE user_id = u.id) AS posts,
                (SELECT COALESCE(SUM(like_count), 0) FROM posts WHERE user_id = u.id) AS likes_received,
                (SELECT COUNT(*) FROM comments WHERE user_id = u.id) AS comments
         FROM users u LEFT JOIN profiles pr ON pr.user_id = u.id
         WHERE u.username = ?`,
        [username]
      );
      const r = rows[0];
      if (!r) return null;
      return {
        id: r.id, username: r.username, bio: r.bio || '', team: r.team || null, createdAt: r.created_at,
        stats: { posts: Number(r.posts), comments: Number(r.comments), likesReceived: Number(r.likes_received) },
      };
    },
    async updateProfile(userId, { bio, team }) {
      await pool.query(
        `INSERT INTO profiles (user_id, bio, team) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE bio = VALUES(bio), team = VALUES(team)`,
        [userId, bio, team]
      );
    },

    // Chat
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

    // Posts
    async createPost(userId, { category, body, spoiler, videoId }) {
      const [result] = await pool.query(
        'INSERT INTO posts (user_id, category, body, spoiler, video_id) VALUES (?, ?, ?, ?, ?)',
        [userId, category, body, spoiler ? 1 : 0, videoId || null]
      );
      return this.getPost(result.insertId, userId);
    },
    async getPost(id, viewerId) {
      const params = viewerId ? [viewerId, id] : [id];
      const [rows] = await pool.query(`${postSelect(viewerId)} WHERE p.id = ?`, params);
      return rows[0] ? toPost(rows[0]) : null;
    },
    async listPosts({ sort, category, authorId, before, offset, limit, viewerId }) {
      const where = [];
      const params = viewerId ? [viewerId] : [];
      if (category) { where.push('p.category = ?'); params.push(category); }
      if (authorId) { where.push('p.user_id = ?'); params.push(authorId); }
      if (sort !== 'popular' && before) { where.push('p.id < ?'); params.push(before); }
      let sql = postSelect(viewerId) + (where.length ? ` WHERE ${where.join(' AND ')}` : '');
      if (sort === 'popular') {
        sql += ` ORDER BY (p.like_count * 2 + p.comment_count * 3 + 1)
                 / POW(GREATEST(TIMESTAMPDIFF(MINUTE, p.created_at, NOW()), 0) / 60 + 2, 1.5) DESC, p.id DESC
                 LIMIT ? OFFSET ?`;
        params.push(limit, offset);
      } else {
        sql += ' ORDER BY p.id DESC LIMIT ?';
        params.push(limit);
      }
      const [rows] = await pool.query(sql, params);
      return rows.map(toPost);
    },
    async deletePost(id) {
      await pool.query('DELETE FROM posts WHERE id = ?', [id]);
    },
    async toggleLike(postId, userId) {
      return inTransaction(async conn => {
        const [found] = await conn.query('SELECT id FROM posts WHERE id = ? FOR UPDATE', [postId]);
        if (!found.length) return null;
        const [ins] = await conn.query('INSERT IGNORE INTO post_likes (post_id, user_id) VALUES (?, ?)', [postId, userId]);
        const liked = ins.affectedRows === 1;
        if (!liked) await conn.query('DELETE FROM post_likes WHERE post_id = ? AND user_id = ?', [postId, userId]);
        await conn.query(
          'UPDATE posts SET like_count = (SELECT COUNT(*) FROM post_likes WHERE post_id = ?) WHERE id = ?',
          [postId, postId]
        );
        const [[row]] = await conn.query('SELECT like_count FROM posts WHERE id = ?', [postId]);
        return { liked, likes: row.like_count };
      });
    },

    // Comments
    async listComments(postId) {
      const [rows] = await pool.query(
        `SELECT * FROM (${COMMENT_SELECT} WHERE c.post_id = ? ORDER BY c.id DESC LIMIT 200) recent ORDER BY id ASC`,
        [postId]
      );
      return rows.map(toComment);
    },
    async addComment(postId, userId, content) {
      return inTransaction(async conn => {
        const [found] = await conn.query('SELECT id FROM posts WHERE id = ? FOR UPDATE', [postId]);
        if (!found.length) return null;
        const [result] = await conn.query(
          'INSERT INTO comments (post_id, user_id, content) VALUES (?, ?, ?)',
          [postId, userId, content]
        );
        await conn.query('UPDATE posts SET comment_count = comment_count + 1 WHERE id = ?', [postId]);
        const [[row]] = await conn.query(`${COMMENT_SELECT} WHERE c.id = ?`, [result.insertId]);
        const [[count]] = await conn.query('SELECT comment_count FROM posts WHERE id = ?', [postId]);
        return { comment: toComment(row), comments: count.comment_count };
      });
    },
    async getComment(id) {
      const [rows] = await pool.query(`${COMMENT_SELECT} WHERE c.id = ?`, [id]);
      return rows[0] ? toComment(rows[0]) : null;
    },
    async deleteComment(id) {
      return inTransaction(async conn => {
        const [rows] = await conn.query('SELECT post_id FROM comments WHERE id = ?', [id]);
        if (!rows.length) return null;
        const postId = rows[0].post_id;
        await conn.query('DELETE FROM comments WHERE id = ?', [id]);
        await conn.query('UPDATE posts SET comment_count = GREATEST(comment_count - 1, 0) WHERE id = ?', [postId]);
        const [[count]] = await conn.query('SELECT comment_count FROM posts WHERE id = ?', [postId]);
        return { postId, comments: count ? count.comment_count : 0 };
      });
    },

    async getMeta(key) {
      const [rows] = await pool.query('SELECT v FROM app_meta WHERE k = ?', [key]);
      return rows[0] ? rows[0].v : null;
    },
    async setMeta(key, value) {
      await pool.query('INSERT INTO app_meta (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)', [key, value]);
    },
  };
}

function dataFilePath() {
  const dir = process.env.DATA_DIR || path.join(os.homedir(), '.gtavi-data');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'community.json');
}

async function createStore() {
  if (process.env.CHAT_STORE === 'memory') {
    console.warn('[store] Using in-memory store (development only, data is not persisted).');
    return createJsonStore(null);
  }
  const config = dbConfigFromEnv();
  if (config) {
    try {
      const store = await createMysqlStore(config);
      console.log('[store] Connected to MySQL.');
      return store;
    } catch (err) {
      console.error('[store] Could not connect to MySQL, falling back to the data file:', err.message);
    }
  }
  try {
    const file = dataFilePath();
    const store = createJsonStore(file);
    console.log(`[store] Using data file ${file}. Set DB_HOST, DB_USER, DB_PASSWORD and DB_NAME to use MySQL.`);
    return store;
  } catch (err) {
    console.error('[store] Data file unavailable, using memory (data is lost on restart):', err.message);
    return createJsonStore(null);
  }
}

module.exports = { createStore };
