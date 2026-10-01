// Community page: debates feed (sorting, topic filter, likes, replies)
(() => {
  const store = window.CommunityStore;
  const list = document.getElementById('post-list');
  if (!store || !list) return;

  const CATEGORY = {
    debate: { label: 'Debate', cls: 'tag-noticia' },
    teoria: { label: 'Teoría', cls: 'tag-teoria' },
    leonida: { label: 'Leonida', cls: 'tag-oficial' },
    noticias: { label: 'Noticias', cls: 'tag-rumor' },
  };
  const ICON = {
    reply: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z"/>',
    heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z"/>',
  };
  const state = { sort: 'recent', category: 'all' };
  const rtf = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });

  function svg(name) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    el.setAttribute('viewBox', '0 0 24 24');
    el.setAttribute('aria-hidden', 'true');
    el.setAttribute('class', 'icon');
    el.innerHTML = ICON[name];
    return el;
  }

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function avatar(name) {
    const a = el('span', 'avatar', name.charAt(0).toUpperCase());
    let hash = 0;
    for (const ch of name) hash = (hash * 31 + ch.codePointAt(0)) % 360;
    a.style.background = `hsl(${hash} 70% 45%)`;
    a.setAttribute('aria-hidden', 'true');
    return a;
  }

  function ago(iso) {
    const diff = (new Date(iso) - Date.now()) / 1000;
    const steps = [['day', 86400], ['hour', 3600], ['minute', 60]];
    for (const [unit, secs] of steps) {
      if (Math.abs(diff) >= secs) return rtf.format(Math.round(diff / secs), unit);
    }
    return 'ahora';
  }

  function renderPost(post) {
    const li = el('li', 'post');
    li.dataset.id = post.id;

    const main = el('div', 'post-main');
    const head = el('div', 'post-head');
    const name = el('strong', 'post-author', post.author.name);
    const time = el('time', 'post-time', ago(post.createdAt));
    time.dateTime = post.createdAt;
    const cat = CATEGORY[post.category];
    const tag = el('span', `tag ${cat.cls}`, cat.label);
    head.append(name, time, tag);
    if (post.preview) head.append(el('span', 'preview-badge', 'Vista previa'));

    const title = el('h3', 'post-title', post.title);
    const excerpt = el('p', 'post-excerpt', post.excerpt);

    const actions = el('div', 'post-actions');
    const like = el('button', 'post-action like-btn');
    like.type = 'button';
    like.setAttribute('aria-pressed', String(post.liked));
    like.setAttribute('aria-label', `Me gusta: ${post.title}`);
    const likeCount = el('span', 'count', String(post.likes));
    like.append(svg('heart'), likeCount);
    like.addEventListener('click', async () => {
      like.disabled = true;
      try {
        const res = await store.toggleLike(post.id);
        like.setAttribute('aria-pressed', String(res.liked));
        likeCount.textContent = String(res.likes);
        like.classList.remove('pop');
        void like.offsetWidth;
        like.classList.add('pop');
      } finally {
        like.disabled = false;
      }
    });

    const repliesId = `replies-${post.id}`;
    const toggle = el('button', 'post-action replies-btn');
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', repliesId);
    toggle.append(svg('reply'), el('span', 'count', `${post.replyCount} respuestas`));

    const replies = el('ol', 'post-replies');
    replies.id = repliesId;
    replies.hidden = true;
    post.replies.forEach(r => {
      const item = el('li', 'reply');
      const body = el('div', 'reply-body');
      const rh = el('div', 'post-head');
      const rt = el('time', 'post-time', ago(r.createdAt));
      rt.dateTime = r.createdAt;
      rh.append(el('strong', 'post-author', r.author.name), rt);
      body.append(rh, el('p', 'reply-text', r.text));
      item.append(avatar(r.author.name), body);
      replies.append(item);
    });
    const more = el('li', 'reply-more', 'Responder y ver el hilo completo llegará con los comentarios. Próximamente.');
    replies.append(more);

    toggle.addEventListener('click', () => {
      const open = replies.hidden;
      replies.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
    });

    actions.append(like, toggle);
    main.append(head, title, excerpt, actions, replies);
    li.append(avatar(post.author.name), main);
    return li;
  }

  async function render() {
    list.setAttribute('aria-busy', 'true');
    const posts = await store.listPosts(state);
    list.replaceChildren(...posts.map(renderPost));
    if (!posts.length) list.append(el('li', 'post-empty', 'Todavía no hay debates en este tema.'));
    list.removeAttribute('aria-busy');
  }

  function bindGroup(selector, attr, key) {
    const buttons = document.querySelectorAll(selector);
    buttons.forEach(btn => btn.addEventListener('click', () => {
      state[key] = btn.dataset[attr];
      buttons.forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
      render();
    }));
  }

  bindGroup('.forum-toolbar .tab', 'sort', 'sort');
  bindGroup('#forum-chips .chip', 'cat', 'category');

  // "Teorías" feature card jumps to the feed already filtered.
  document.querySelectorAll('[data-goto-filter]').forEach(link => {
    link.addEventListener('click', () => {
      document.querySelector(`#forum-chips .chip[data-cat="${link.dataset.gotoFilter}"]`)?.click();
    });
  });

  render();
})();
