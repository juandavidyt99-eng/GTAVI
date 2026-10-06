// Community API: posts, likes, comments and profiles.
const express = require('express');
const { createLimiter } = require('./limits');
const { cleanLine, cleanMultiline, youtubeId, isAdminName, googleConfig } = require('./shared');

const CATEGORIES = ['debate', 'teoria', 'leonida', 'noticias', 'clip'];
const TEAMS = ['jason', 'lucia'];
const PAGE_SIZE = 15;
const POST_MAX = 1000;
const CAPTION_MAX = 300;
const COMMENT_MAX = 500;
const BIO_MAX = 160;

function createSocialRouter(getStore, bus) {
  const router = express.Router();
  router.use(express.json({ limit: '16kb' }));

  const limit = {
    postBurst: createLimiter({ max: 1, windowMs: 20 * 1000 }),
    postHour: createLimiter({ max: 10, windowMs: 60 * 60 * 1000 }),
    commentBurst: createLimiter({ max: 1, windowMs: 4 * 1000 }),
    commentWindow: createLimiter({ max: 30, windowMs: 10 * 60 * 1000 }),
    like: createLimiter({ max: 60, windowMs: 60 * 1000 }),
    profile: createLimiter({ max: 10, windowMs: 10 * 60 * 1000 }),
  };

  const currentUser = req => (req.session && req.session.user) || null;
  const isAdmin = user => Boolean(user && isAdminName(user.username));
  const canModify = (user, ownerId) => Boolean(user && (user.id === ownerId || isAdmin(user)));

  function present(item, user) {
    const { userId, ...rest } = item;
    return { ...rest, canDelete: canModify(user, userId) };
  }

  // Broadcast copy: never personalised.
  function broadcastable(item) {
    const { userId, ...rest } = item;
    return { ...rest, liked: false, canDelete: false };
  }

  function requireUser(req, res, next) {
    if (!currentUser(req)) return res.status(401).json({ error: 'Inicia sesión para continuar.' });
    next();
  }

  function idParam(value) {
    const id = Number(value);
    return Number.isInteger(id) && id > 0 ? id : null;
  }

  const wrap = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

  // ---- Profiles
  router.get('/me', wrap(async (req, res) => {
    const user = currentUser(req);
    const profile = user ? await getStore().getProfile(user.username) : null;
    if (profile) delete profile.id;
    res.json({ enabled: true, user: profile, admin: isAdmin(user), google: Boolean(googleConfig()) });
  }));

  router.patch('/me', requireUser, wrap(async (req, res) => {
    const user = currentUser(req);
    if (!limit.profile(user.id)) return res.status(429).json({ error: 'Has cambiado tu perfil muchas veces. Espera unos minutos.' });
    const bio = cleanLine(req.body.bio);
    const team = req.body.team || null;
    if (bio.length > BIO_MAX) return res.status(400).json({ error: `La bio admite como máximo ${BIO_MAX} caracteres.` });
    if (team !== null && !TEAMS.includes(team)) return res.status(400).json({ error: 'Equipo no válido.' });
    await getStore().updateProfile(user.id, { bio, team });
    const profile = await getStore().getProfile(user.username);
    delete profile.id;
    res.json({ user: profile });
  }));

  router.get('/users/:username', wrap(async (req, res) => {
    const profile = await getStore().getProfile(String(req.params.username).slice(0, 20));
    if (!profile) return res.status(404).json({ error: 'Usuario no encontrado.' });
    delete profile.id;
    res.json({ user: profile });
  }));

  // ---- Posts
  router.get('/posts', wrap(async (req, res) => {
    const user = currentUser(req);
    const sort = req.query.sort === 'popular' ? 'popular' : 'recent';
    const category = CATEGORIES.includes(req.query.category) ? req.query.category : null;
    let authorId = null;
    if (req.query.user) {
      const author = await getStore().findUserByName(String(req.query.user).slice(0, 20));
      if (!author) return res.json({ posts: [], next: null });
      authorId = author.id;
    }
    const cursor = Math.max(0, Number(req.query.cursor) || 0);
    const posts = await getStore().listPosts({
      sort, category, authorId,
      before: sort === 'recent' ? cursor : 0,
      offset: sort === 'popular' ? cursor : 0,
      limit: PAGE_SIZE,
      viewerId: user ? user.id : null,
    });
    let next = null;
    if (posts.length === PAGE_SIZE) next = sort === 'popular' ? cursor + PAGE_SIZE : posts[posts.length - 1].id;
    res.json({ posts: posts.map(p => present(p, user)), next });
  }));

  router.get('/posts/:id', wrap(async (req, res) => {
    const id = idParam(req.params.id);
    const user = currentUser(req);
    const post = id && await getStore().getPost(id, user ? user.id : null);
    if (!post) return res.status(404).json({ error: 'Publicación no encontrada.' });
    res.json({ post: present(post, user) });
  }));

  router.post('/posts', requireUser, wrap(async (req, res) => {
    const user = currentUser(req);
    const category = CATEGORIES.includes(req.body.category) ? req.body.category : 'debate';
    const body = cleanMultiline(req.body.body);
    const videoInput = cleanLine(req.body.videoUrl);
    const videoId = videoInput ? youtubeId(videoInput) : null;

    if (videoInput && !videoId) return res.status(400).json({ error: 'Pega un enlace válido de YouTube (vídeo o Short).' });
    if (category === 'clip' && !videoId) return res.status(400).json({ error: 'Los clips necesitan un enlace de YouTube.' });
    if (category !== 'clip' && !body) return res.status(400).json({ error: 'Escribe algo antes de publicar.' });
    const max = category === 'clip' ? CAPTION_MAX : POST_MAX;
    if (body.length > max) return res.status(400).json({ error: `Máximo ${max} caracteres.` });
    if (!limit.postBurst(user.id)) return res.status(429).json({ error: 'Espera unos segundos antes de volver a publicar.' });
    if (!limit.postHour(user.id)) return res.status(429).json({ error: 'Has publicado mucho en la última hora. Vuelve más tarde.' });

    const post = await getStore().createPost(user.id, { category, body, spoiler: Boolean(req.body.spoiler), videoId });
    bus.emit('post:new', broadcastable(post));
    res.status(201).json({ post: present(post, user) });
  }));

  router.delete('/posts/:id', requireUser, wrap(async (req, res) => {
    const user = currentUser(req);
    const id = idParam(req.params.id);
    const post = id && await getStore().getPost(id, null);
    if (!post) return res.status(404).json({ error: 'Publicación no encontrada.' });
    if (!canModify(user, post.userId)) return res.status(403).json({ error: 'Solo puedes borrar tus publicaciones.' });
    await getStore().deletePost(id);
    bus.emit('post:delete', { id });
    res.json({ ok: true });
  }));

  router.post('/posts/:id/like', requireUser, wrap(async (req, res) => {
    const user = currentUser(req);
    const id = idParam(req.params.id);
    if (!limit.like(user.id)) return res.status(429).json({ error: 'Vas muy rápido. Espera un momento.' });
    const result = id && await getStore().toggleLike(id, user.id);
    if (!result) return res.status(404).json({ error: 'Publicación no encontrada.' });
    bus.emit('post:likes', { id, likes: result.likes });
    res.json(result);
  }));

  // ---- Comments
  router.get('/posts/:id/comments', wrap(async (req, res) => {
    const id = idParam(req.params.id);
    if (!id) return res.status(404).json({ error: 'Publicación no encontrada.' });
    const user = currentUser(req);
    const comments = await getStore().listComments(id);
    res.json({ comments: comments.map(c => present(c, user)) });
  }));

  router.post('/posts/:id/comments', requireUser, wrap(async (req, res) => {
    const user = currentUser(req);
    const id = idParam(req.params.id);
    const content = cleanMultiline(req.body.content);
    if (!content) return res.status(400).json({ error: 'El comentario está vacío.' });
    if (content.length > COMMENT_MAX) return res.status(400).json({ error: `Máximo ${COMMENT_MAX} caracteres.` });
    if (!limit.commentBurst(user.id) || !limit.commentWindow(user.id)) {
      return res.status(429).json({ error: 'Vas muy rápido. Espera un momento.' });
    }
    const result = id && await getStore().addComment(id, user.id, content);
    if (!result) return res.status(404).json({ error: 'Publicación no encontrada.' });
    bus.emit('comment:new', { postId: id, comment: broadcastable(result.comment), comments: result.comments });
    res.status(201).json({ comment: present(result.comment, user), comments: result.comments });
  }));

  router.delete('/comments/:id', requireUser, wrap(async (req, res) => {
    const user = currentUser(req);
    const id = idParam(req.params.id);
    const comment = id && await getStore().getComment(id);
    if (!comment) return res.status(404).json({ error: 'Comentario no encontrado.' });
    if (!canModify(user, comment.userId)) return res.status(403).json({ error: 'Solo puedes borrar tus comentarios.' });
    const result = await getStore().deleteComment(id);
    bus.emit('comment:delete', { postId: result.postId, id, comments: result.comments });
    res.json({ ok: true, comments: result.comments });
  }));

  router.use((err, req, res, next) => {
    console.error('[community] API error:', err);
    res.status(500).json({ error: 'Error del servidor. Inténtalo de nuevo.' });
  });

  return router;
}

module.exports = { createSocialRouter };
