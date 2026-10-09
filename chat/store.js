const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { createJsonStore } = require('./jsonstore');
const { dataDir } = require('./shared');

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

  // The messages table predates photos, replies and edits: add the new columns when missing.
  const [existing] = await pool.query(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'messages'"
  );
  const have = new Set(existing.map(c => c.COLUMN_NAME));
  const wanted = [
    ['image', 'VARCHAR(40) NULL'],
    ['image_w', 'SMALLINT UNSIGNED NOT NULL DEFAULT 0'],
    ['image_h', 'SMALLINT UNSIGNED NOT NULL DEFAULT 0'],
    ['reply_to', 'INT NULL'],
    ['edited_at', 'TIMESTAMP NULL DEFAULT NULL'],
    ['deleted', 'TINYINT(1) NOT NULL DEFAULT 0'],
    ['audio', 'VARCHAR(40) NULL'],
    ['audio_ms', 'INT UNSIGNED NOT NULL DEFAULT 0'],
  ];
  for (const [name, def] of wanted) {
    if (!have.has(name)) await pool.query(`ALTER TABLE messages ADD COLUMN ${name} ${def}`);
  }

  // Accounts created before "Entrar con Google" need the column that links them to Google.
  const [userCols] = await pool.query(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'"
  );
  if (!userCols.some(c => c.COLUMN_NAME === 'google_id')) {
    await pool.query('ALTER TABLE users ADD COLUMN google_id VARCHAR(64) NULL, ADD UNIQUE KEY uq_users_google (google_id)');
  }

  // Profile photo and cover picture.
  const [profileCols] = await pool.query(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'profiles'"
  );
  const haveProfile = new Set(profileCols.map(c => c.COLUMN_NAME));
  if (!haveProfile.has('avatar')) await pool.query('ALTER TABLE profiles ADD COLUMN avatar VARCHAR(40) NULL');
  if (!haveProfile.has('cover')) await pool.query('ALTER TABLE profiles ADD COLUMN cover VARCHAR(16) NULL');

  const toPost = r => ({
    id: r.id,
    userId: r.user_id,
    author: { username: r.username, team: r.team || null, avatar: r.avatar || null },
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
    author: { username: r.username, team: r.team || null, avatar: r.avatar || null },
    content: r.content,
    createdAt: r.created_at,
  });

  // Viewer id (when present) is always the first placeholder.
  function postSelect(viewerId) {
    const liked = viewerId
      ? 'EXISTS(SELECT 1 FROM post_likes l WHERE l.post_id = p.id AND l.user_id = ?) AS liked'
      : '0 AS liked';
    return `SELECT p.id, p.user_id, p.category, p.body, p.spoiler, p.video_id, p.like_count, p.comment_count,
                   p.created_at, u.username, pr.team, pr.avatar, ${liked}
            FROM posts p
            JOIN users u ON u.id = p.user_id
            LEFT JOIN profiles pr ON pr.user_id = p.user_id`;
  }

  const COMMENT_SELECT = `SELECT c.id, c.post_id, c.user_id, c.content, c.created_at, u.username, pr.team, pr.avatar
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

  const MESSAGE_SELECT = `SELECT m.id, m.user_id, m.content, m.spoiler, m.image, m.image_w, m.image_h, m.audio, m.audio_ms, m.reply_to,
           m.edited_at, m.deleted, m.created_at, u.username, pr.team, pr.avatar,
           r.content AS r_content, r.image AS r_image, r.audio AS r_audio, r.deleted AS r_deleted, ru.username AS r_username
    FROM messages m
    JOIN users u ON u.id = m.user_id
    LEFT JOIN profiles pr ON pr.user_id = m.user_id
    LEFT JOIN messages r ON r.id = m.reply_to
    LEFT JOIN users ru ON ru.id = r.user_id`;

  async function attachReactions(rows, viewerId) {
    const byMessage = new Map();
    if (rows.length) {
      const [rx] = await pool.query(
        `SELECT message_id, emoji, COUNT(*) AS c, SUM(user_id = ?) AS mine
         FROM message_reactions WHERE message_id IN (?) GROUP BY message_id, emoji ORDER BY MIN(created_at)`,
        [viewerId || 0, rows.map(r => r.id)]
      );
      for (const x of rx) {
        if (!byMessage.has(x.message_id)) byMessage.set(x.message_id, []);
        byMessage.get(x.message_id).push({ emoji: x.emoji, count: Number(x.c), mine: Number(x.mine) > 0 });
      }
    }
    return rows.map(r => {
      const deleted = Boolean(r.deleted);
      let replyTo = null;
      if (r.reply_to) {
        const gone = r.r_content === null || Boolean(r.r_deleted);
        replyTo = {
          id: r.reply_to, username: r.r_username || '', excerpt: gone ? '' : String(r.r_content).slice(0, 120),
          hasImage: !gone && Boolean(r.r_image), hasAudio: !gone && Boolean(r.r_audio), deleted: gone,
        };
      }
      return {
        id: r.id,
        userId: r.user_id,
        username: r.username,
        team: r.team || null,
        avatar: r.avatar || null,
        content: deleted ? '' : r.content,
        spoiler: Boolean(r.spoiler),
        image: r.image && !deleted ? { name: r.image, w: r.image_w, h: r.image_h } : null,
        audio: r.audio && !deleted ? { name: r.audio, ms: r.audio_ms } : null,
        replyTo,
        createdAt: r.created_at,
        editedAt: r.edited_at,
        reactions: byMessage.get(r.id) || [],
      };
    });
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
    async findUserByGoogleId(googleId) {
      const [rows] = await pool.query('SELECT id, username FROM users WHERE google_id = ?', [googleId]);
      return rows[0] || null;
    },
    async createGoogleUser(username, googleId, passwordHash) {
      const [result] = await pool.query(
        'INSERT INTO users (username, password_hash, google_id) VALUES (?, ?, ?)', [username, passwordHash, googleId]);
      return { id: result.insertId, username };
    },
    async getProfile(username) {
      const [rows] = await pool.query(
        `SELECT u.id, u.username, u.created_at, pr.bio, pr.team, pr.avatar, pr.cover,
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
        avatar: r.avatar || null, cover: r.cover || null,
        stats: { posts: Number(r.posts), comments: Number(r.comments), likesReceived: Number(r.likes_received) },
      };
    },
    async updateProfile(userId, { bio, team, cover }) {
      await pool.query(
        `INSERT INTO profiles (user_id, bio, team, cover) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE bio = VALUES(bio), team = VALUES(team), cover = VALUES(cover)`,
        [userId, bio, team, cover || null]
      );
    },
    // Returns the previous photo so the caller can delete its file.
    async setAvatar(userId, avatar) {
      const [rows] = await pool.query('SELECT avatar FROM profiles WHERE user_id = ?', [userId]);
      await pool.query(
        `INSERT INTO profiles (user_id, avatar) VALUES (?, ?) ON DUPLICATE KEY UPDATE avatar = VALUES(avatar)`,
        [userId, avatar]
      );
      return rows[0] ? rows[0].avatar : null;
    },

    // Chat
    async addMessage(userId, { content, spoiler, image, audio, replyTo }) {
      const [result] = await pool.query(
        `INSERT INTO messages (user_id, content, spoiler, image, image_w, image_h, audio, audio_ms, reply_to)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, content, spoiler ? 1 : 0, image ? image.name : null, image ? image.w : 0, image ? image.h : 0,
          audio ? audio.name : null, audio ? audio.ms : 0, replyTo || null]
      );
      return this.getMessage(result.insertId, userId);
    },
    async getMessage(id, viewerId) {
      const [rows] = await pool.query(`${MESSAGE_SELECT} WHERE m.id = ?`, [id]);
      if (!rows.length) return null;
      return (await attachReactions(rows, viewerId))[0];
    },
    async listMessages({ before, limit, viewerId }) {
      const params = [];
      let where = 'WHERE m.deleted = 0';
      if (before) { where += ' AND m.id < ?'; params.push(before); }
      params.push(limit + 1);
      const [rows] = await pool.query(`${MESSAGE_SELECT} ${where} ORDER BY m.id DESC LIMIT ?`, params);
      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit).reverse();
      return { messages: await attachReactions(page, viewerId), hasMore };
    },
    async editMessage(id, content) {
      const [res] = await pool.query('UPDATE messages SET content = ?, edited_at = NOW() WHERE id = ? AND deleted = 0', [content, id]);
      if (!res.affectedRows) return null;
      return this.getMessage(id, null);
    },
    async deleteMessage(id) {
      return inTransaction(async conn => {
        const [rows] = await conn.query('SELECT image, audio FROM messages WHERE id = ? AND deleted = 0 FOR UPDATE', [id]);
        if (!rows.length) return null;
        await conn.query("UPDATE messages SET deleted = 1, content = '', image = NULL, audio = NULL WHERE id = ?", [id]);
        await conn.query('DELETE FROM message_reactions WHERE message_id = ?', [id]);
        await conn.query('DELETE FROM chat_reports WHERE message_id = ?', [id]);
        return { image: rows[0].image, audio: rows[0].audio };
      });
    },
    async toggleReaction(id, userId, emoji) {
      const [found] = await pool.query('SELECT id FROM messages WHERE id = ? AND deleted = 0', [id]);
      if (!found.length) return null;
      const [ins] = await pool.query('INSERT IGNORE INTO message_reactions (message_id, user_id, emoji) VALUES (?, ?, ?)', [id, userId, emoji]);
      const on = ins.affectedRows === 1;
      if (!on) await pool.query('DELETE FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?', [id, userId, emoji]);
      const [[row]] = await pool.query('SELECT COUNT(*) AS c FROM message_reactions WHERE message_id = ? AND emoji = ?', [id, emoji]);
      return { on, count: Number(row.c) };
    },
    async getMute(userId) {
      const [rows] = await pool.query('SELECT until_ms FROM chat_mutes WHERE user_id = ?', [userId]);
      const until = rows[0] ? Number(rows[0].until_ms) : 0;
      return until > Date.now() ? until : 0;
    },
    async setMute(userId, untilMs) {
      if (!untilMs) return void await pool.query('DELETE FROM chat_mutes WHERE user_id = ?', [userId]);
      await pool.query(
        'INSERT INTO chat_mutes (user_id, until_ms) VALUES (?, ?) ON DUPLICATE KEY UPDATE until_ms = VALUES(until_ms)',
        [userId, untilMs]
      );
    },
    async createReport({ messageId, reporterId, reason }) {
      const [found] = await pool.query('SELECT id FROM messages WHERE id = ? AND deleted = 0', [messageId]);
      if (!found.length) return null;
      const [res] = await pool.query(
        'INSERT IGNORE INTO chat_reports (message_id, reporter_id, reason) VALUES (?, ?, ?)',
        [messageId, reporterId, reason]
      );
      return res.affectedRows === 1;
    },
    async listReports() {
      const [rows] = await pool.query(
        `SELECT rp.message_id, COUNT(*) AS c, MAX(rp.created_at) AS last_at,
                GROUP_CONCAT(DISTINCT rp.reason) AS reasons, GROUP_CONCAT(DISTINCT u.username) AS reporters
         FROM chat_reports rp JOIN users u ON u.id = rp.reporter_id
         GROUP BY rp.message_id ORDER BY last_at DESC LIMIT 50`
      );
      const out = [];
      for (const r of rows) {
        const message = await this.getMessage(r.message_id, null);
        if (!message) continue;
        out.push({
          messageId: r.message_id, count: Number(r.c), reasons: String(r.reasons).split(','),
          reporters: String(r.reporters).split(','), lastAt: r.last_at, message,
        });
      }
      return out;
    },
    async dismissReports(messageId) {
      await pool.query('DELETE FROM chat_reports WHERE message_id = ?', [messageId]);
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
  return path.join(dataDir(), 'community.json');
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
