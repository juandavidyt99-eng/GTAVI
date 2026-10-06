// Single-file store used when no MySQL database is configured.
// Everything lives in memory and is written to disk (atomically, debounced),
// so the community keeps working across restarts. Assumes one server process.
const fs = require('fs');
const path = require('path');
const { hotScore } = require('./shared');

const MESSAGE_CAP = 5000;

const SAVE_DELAY_MS = 400;

function createJsonStore(filePath) {
  const state = {
    seq: { user: 0, message: 0, post: 0, comment: 0 },
    users: new Map(),          // id -> user
    usersByName: new Map(),    // lowercase username -> user
    usersByGoogle: new Map(),  // Google account id -> user
    messages: [],
    messageIndex: new Map(),   // id -> message
    reactions: new Map(),      // messageId -> Map(emoji -> Set(userId))
    reports: [],
    mutes: {},                 // userId -> until (ms)
    posts: new Map(),          // id -> post
    likes: new Map(),          // postId -> Set(userId)
    comments: new Map(),       // postId -> [comment]
    commentsById: new Map(),
    sessions: new Map(),       // sid -> { data, expires }
    meta: {},
  };

  if (filePath && fs.existsSync(filePath)) {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    Object.assign(state.seq, raw.seq);
    for (const u of raw.users || []) {
      state.users.set(u.id, u);
      state.usersByName.set(u.username.toLowerCase(), u);
      if (u.google_id) state.usersByGoogle.set(u.google_id, u);
    }
    // Older files stored messages as { username, createdAt }: map them to the current shape.
    state.messages = (raw.messages || []).map(m => ({
      id: m.id,
      user_id: m.user_id ?? (state.usersByName.get(String(m.username).toLowerCase()) || {}).id ?? 0,
      content: m.content || '',
      spoiler: Boolean(m.spoiler),
      image: m.image || null,
      image_w: m.image_w || 0,
      image_h: m.image_h || 0,
      reply_to: m.reply_to || null,
      edited_at: m.edited_at || null,
      deleted: Boolean(m.deleted),
      created_at: m.created_at || m.createdAt || new Date().toISOString(),
    }));
    for (const r of raw.reactions || []) {
      if (!state.reactions.has(r.m)) state.reactions.set(r.m, new Map());
      state.reactions.get(r.m).set(r.e, new Set(r.u));
    }
    state.reports = raw.reports || [];
    state.mutes = raw.mutes || {};
    for (const p of raw.posts || []) {
      const { likers = [], ...post } = p;
      state.posts.set(post.id, post);
      state.likes.set(post.id, new Set(likers));
    }
    for (const c of raw.comments || []) {
      if (!state.comments.has(c.post_id)) state.comments.set(c.post_id, []);
      state.comments.get(c.post_id).push(c);
      state.commentsById.set(c.id, c);
    }
    for (const [sid, s] of Object.entries(raw.sessions || {})) state.sessions.set(sid, s);
    state.meta = raw.meta || {};
  }
  for (const m of state.messages) state.messageIndex.set(m.id, m);

  let timer = null;
  function serialize() {
    const now = Date.now();
    for (const [sid, s] of state.sessions) if (s.expires && s.expires < now) state.sessions.delete(sid);
    return JSON.stringify({
      version: 1,
      seq: state.seq,
      users: [...state.users.values()],
      messages: state.messages,
      reactions: [...state.reactions].flatMap(([m, byEmoji]) =>
        [...byEmoji].filter(([, users]) => users.size).map(([e, users]) => ({ m, e, u: [...users] }))),
      reports: state.reports,
      mutes: state.mutes,
      posts: [...state.posts.values()].map(p => ({ ...p, likers: [...(state.likes.get(p.id) || [])] })),
      comments: [...state.commentsById.values()],
      sessions: Object.fromEntries(state.sessions),
      meta: state.meta,
    });
  }
  function flush() {
    if (!filePath) return;
    clearTimeout(timer);
    timer = null;
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, serialize());
    fs.renameSync(tmp, filePath);
  }
  function save() {
    if (!filePath || timer) return;
    timer = setTimeout(() => {
      try {
        flush();
      } catch (err) {
        console.error('[store] Could not write data file:', err.message);
      }
    }, SAVE_DELAY_MS);
  }
  if (filePath) {
    for (const sig of ['SIGINT', 'SIGTERM']) {
      process.once(sig, () => {
        try { flush(); } catch { /* best effort */ }
        process.exit(0);
      });
    }
  }

  const now = () => new Date().toISOString();
  const authorOf = userId => {
    const u = state.users.get(userId);
    return u ? { username: u.username, team: u.team || null } : { username: 'desconocido', team: null };
  };
  const toPost = (p, viewerId) => ({
    id: p.id,
    userId: p.user_id,
    author: authorOf(p.user_id),
    category: p.category,
    body: p.body,
    spoiler: Boolean(p.spoiler),
    videoId: p.video_id || null,
    createdAt: p.created_at,
    likes: p.like_count,
    comments: p.comment_count,
    liked: Boolean(viewerId && state.likes.get(p.id)?.has(viewerId)),
  });
  const toComment = c => ({ id: c.id, postId: c.post_id, userId: c.user_id, author: authorOf(c.user_id), content: c.content, createdAt: c.created_at });

  function presentMessage(m, viewerId) {
    const author = authorOf(m.user_id);
    let replyTo = null;
    if (m.reply_to) {
      const r = state.messageIndex.get(m.reply_to);
      replyTo = r && !r.deleted
        ? { id: r.id, username: authorOf(r.user_id).username, excerpt: r.content.slice(0, 120), hasImage: Boolean(r.image), deleted: false }
        : { id: m.reply_to, username: r ? authorOf(r.user_id).username : '', excerpt: '', hasImage: false, deleted: true };
    }
    const byEmoji = state.reactions.get(m.id);
    const reactions = byEmoji
      ? [...byEmoji].filter(([, users]) => users.size).map(([emoji, users]) => ({
        emoji, count: users.size, mine: Boolean(viewerId && users.has(viewerId)),
      }))
      : [];
    return {
      id: m.id,
      userId: m.user_id,
      username: author.username,
      team: author.team,
      content: m.deleted ? '' : m.content,
      spoiler: Boolean(m.spoiler),
      image: m.image && !m.deleted ? { name: m.image, w: m.image_w, h: m.image_h } : null,
      replyTo,
      createdAt: m.created_at,
      editedAt: m.edited_at,
      reactions,
    };
  }

  return {
    kind: filePath ? 'file' : 'memory',
    flush,

    // Users
    async findUserByName(username) {
      return state.usersByName.get(String(username).toLowerCase()) || null;
    },
    async createUser(username, passwordHash) {
      const key = username.toLowerCase();
      if (state.usersByName.has(key)) {
        const err = new Error('duplicate');
        err.code = 'ER_DUP_ENTRY';
        throw err;
      }
      const user = { id: ++state.seq.user, username, password_hash: passwordHash, created_at: now(), bio: '', team: null };
      state.users.set(user.id, user);
      state.usersByName.set(key, user);
      save();
      return { id: user.id, username };
    },
    async findUserByGoogleId(googleId) {
      return state.usersByGoogle.get(googleId) || null;
    },
    async createGoogleUser(username, googleId, passwordHash) {
      const key = username.toLowerCase();
      if (state.usersByName.has(key) || state.usersByGoogle.has(googleId)) {
        const err = new Error('duplicate');
        err.code = 'ER_DUP_ENTRY';
        throw err;
      }
      const user = { id: ++state.seq.user, username, password_hash: passwordHash, google_id: googleId, created_at: now(), bio: '', team: null };
      state.users.set(user.id, user);
      state.usersByName.set(key, user);
      state.usersByGoogle.set(googleId, user);
      save();
      return { id: user.id, username };
    },
    async getProfile(username) {
      const u = state.usersByName.get(String(username).toLowerCase());
      if (!u) return null;
      let posts = 0, likesReceived = 0, comments = 0;
      for (const p of state.posts.values()) if (p.user_id === u.id) { posts++; likesReceived += p.like_count; }
      for (const c of state.commentsById.values()) if (c.user_id === u.id) comments++;
      return { id: u.id, username: u.username, bio: u.bio || '', team: u.team || null, createdAt: u.created_at, stats: { posts, comments, likesReceived } };
    },
    async updateProfile(userId, { bio, team }) {
      const u = state.users.get(userId);
      if (!u) return;
      u.bio = bio;
      u.team = team;
      save();
    },

    // Chat
    async addMessage(userId, { content, spoiler, image, replyTo }) {
      const m = {
        id: ++state.seq.message, user_id: userId, content, spoiler: Boolean(spoiler),
        image: image ? image.name : null, image_w: image ? image.w : 0, image_h: image ? image.h : 0,
        reply_to: replyTo || null, edited_at: null, deleted: false, created_at: now(),
      };
      state.messages.push(m);
      state.messageIndex.set(m.id, m);
      while (state.messages.length > MESSAGE_CAP) {
        const old = state.messages.shift();
        state.messageIndex.delete(old.id);
        state.reactions.delete(old.id);
      }
      save();
      return presentMessage(m, userId);
    },
    async getMessage(id, viewerId) {
      const m = state.messageIndex.get(id);
      return m ? presentMessage(m, viewerId) : null;
    },
    async listMessages({ before, limit, viewerId }) {
      const visible = state.messages.filter(m => !m.deleted && (!before || m.id < before));
      const slice = visible.slice(-limit);
      return { messages: slice.map(m => presentMessage(m, viewerId)), hasMore: visible.length > slice.length };
    },
    async editMessage(id, content) {
      const m = state.messageIndex.get(id);
      if (!m || m.deleted) return null;
      m.content = content;
      m.edited_at = now();
      save();
      return presentMessage(m, null);
    },
    async deleteMessage(id) {
      const m = state.messageIndex.get(id);
      if (!m || m.deleted) return null;
      const image = m.image;
      m.deleted = true;
      m.content = '';
      m.image = null;
      state.reactions.delete(id);
      state.reports = state.reports.filter(r => r.message_id !== id);
      save();
      return { image };
    },
    async toggleReaction(id, userId, emoji) {
      const m = state.messageIndex.get(id);
      if (!m || m.deleted) return null;
      if (!state.reactions.has(id)) state.reactions.set(id, new Map());
      const byEmoji = state.reactions.get(id);
      if (!byEmoji.has(emoji)) byEmoji.set(emoji, new Set());
      const users = byEmoji.get(emoji);
      const on = !users.has(userId);
      if (on) users.add(userId); else users.delete(userId);
      save();
      return { on, count: users.size };
    },
    async getMute(userId) {
      const until = state.mutes[userId] || 0;
      return until > Date.now() ? until : 0;
    },
    async setMute(userId, untilMs) {
      if (untilMs) state.mutes[userId] = untilMs; else delete state.mutes[userId];
      save();
    },
    async createReport({ messageId, reporterId, reason }) {
      const m = state.messageIndex.get(messageId);
      if (!m || m.deleted) return null;
      if (state.reports.some(r => r.message_id === messageId && r.reporter_id === reporterId)) return false;
      state.reports.push({ message_id: messageId, reporter_id: reporterId, reason, created_at: now() });
      save();
      return true;
    },
    async listReports() {
      const grouped = new Map();
      for (const r of state.reports) {
        if (!grouped.has(r.message_id)) grouped.set(r.message_id, []);
        grouped.get(r.message_id).push(r);
      }
      return [...grouped].map(([messageId, list]) => ({
        messageId,
        count: list.length,
        reasons: [...new Set(list.map(r => r.reason))],
        reporters: [...new Set(list.map(r => authorOf(r.reporter_id).username))],
        lastAt: list[list.length - 1].created_at,
        message: presentMessage(state.messageIndex.get(messageId), null),
      })).sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1)).slice(0, 50);
    },
    async dismissReports(messageId) {
      state.reports = state.reports.filter(r => r.message_id !== messageId);
      save();
    },

    // Posts
    async createPost(userId, { category, body, spoiler, videoId }) {
      const post = {
        id: ++state.seq.post, user_id: userId, category, body, spoiler: spoiler ? 1 : 0,
        video_id: videoId || null, like_count: 0, comment_count: 0, created_at: now(),
      };
      state.posts.set(post.id, post);
      state.likes.set(post.id, new Set());
      save();
      return toPost(post, userId);
    },
    async getPost(id, viewerId) {
      const p = state.posts.get(id);
      return p ? toPost(p, viewerId) : null;
    },
    async listPosts({ sort, category, authorId, before, offset, limit, viewerId }) {
      let posts = [...state.posts.values()];
      if (category) posts = posts.filter(p => p.category === category);
      if (authorId) posts = posts.filter(p => p.user_id === authorId);
      if (sort === 'popular') {
        const t = Date.now();
        posts.sort((a, b) => hotScore(b, t) - hotScore(a, t) || b.id - a.id);
        posts = posts.slice(offset, offset + limit);
      } else {
        posts.sort((a, b) => b.id - a.id);
        if (before) posts = posts.filter(p => p.id < before);
        posts = posts.slice(0, limit);
      }
      return posts.map(p => toPost(p, viewerId));
    },
    async deletePost(id) {
      state.posts.delete(id);
      state.likes.delete(id);
      for (const c of state.comments.get(id) || []) state.commentsById.delete(c.id);
      state.comments.delete(id);
      save();
    },
    async toggleLike(postId, userId) {
      const p = state.posts.get(postId);
      if (!p) return null;
      const set = state.likes.get(postId);
      const liked = !set.has(userId);
      if (liked) set.add(userId); else set.delete(userId);
      p.like_count = set.size;
      save();
      return { liked, likes: p.like_count };
    },

    // Comments
    async listComments(postId) {
      return (state.comments.get(postId) || []).slice(-200).map(toComment);
    },
    async addComment(postId, userId, content) {
      const p = state.posts.get(postId);
      if (!p) return null;
      const c = { id: ++state.seq.comment, post_id: postId, user_id: userId, content, created_at: now() };
      if (!state.comments.has(postId)) state.comments.set(postId, []);
      state.comments.get(postId).push(c);
      state.commentsById.set(c.id, c);
      p.comment_count += 1;
      save();
      return { comment: toComment(c), comments: p.comment_count };
    },
    async getComment(id) {
      const c = state.commentsById.get(id);
      return c ? toComment(c) : null;
    },
    async deleteComment(id) {
      const c = state.commentsById.get(id);
      if (!c) return null;
      state.commentsById.delete(id);
      const list = state.comments.get(c.post_id) || [];
      const i = list.indexOf(c);
      if (i >= 0) list.splice(i, 1);
      const p = state.posts.get(c.post_id);
      if (p) p.comment_count = Math.max(0, p.comment_count - 1);
      save();
      return { postId: c.post_id, comments: p ? p.comment_count : 0 };
    },

    // Sessions and settings (used by the session store and for the cookie secret)
    sessionGet(sid) {
      const s = state.sessions.get(sid);
      if (!s) return null;
      if (s.expires && s.expires < Date.now()) {
        state.sessions.delete(sid);
        return null;
      }
      return s.data;
    },
    sessionSet(sid, data, expires) {
      state.sessions.set(sid, { data, expires });
      save();
    },
    sessionDestroy(sid) {
      state.sessions.delete(sid);
      save();
    },
    async getMeta(key) {
      return state.meta[key] ?? null;
    },
    async setMeta(key, value) {
      state.meta[key] = value;
      save();
    },
  };
}

module.exports = { createJsonStore };
