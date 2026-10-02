// Single-file store used when no MySQL database is configured.
// Everything lives in memory and is written to disk (atomically, debounced),
// so the community keeps working across restarts. Assumes one server process.
const fs = require('fs');
const path = require('path');
const { hotScore, HISTORY_LIMIT } = require('./shared');

const SAVE_DELAY_MS = 400;

function createJsonStore(filePath) {
  const state = {
    seq: { user: 0, message: 0, post: 0, comment: 0 },
    users: new Map(),          // id -> user
    usersByName: new Map(),    // lowercase username -> user
    messages: [],
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
    }
    state.messages = raw.messages || [];
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

  let timer = null;
  function serialize() {
    const now = Date.now();
    for (const [sid, s] of state.sessions) if (s.expires && s.expires < now) state.sessions.delete(sid);
    return JSON.stringify({
      version: 1,
      seq: state.seq,
      users: [...state.users.values()],
      messages: state.messages,
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
    async addMessage(userId, content, spoiler) {
      const message = { id: ++state.seq.message, username: state.users.get(userId).username, content, spoiler, createdAt: now() };
      state.messages.push(message);
      if (state.messages.length > HISTORY_LIMIT) state.messages.splice(0, state.messages.length - HISTORY_LIMIT);
      save();
      return { id: message.id, createdAt: message.createdAt };
    },
    async recentMessages() {
      return state.messages.map(m => ({ ...m }));
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
