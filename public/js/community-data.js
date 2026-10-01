// Community data layer.
// Today it serves local preview posts; the public API (listPosts, toggleLike)
// is Promise-based so it can later be backed by our own API, Firebase or Supabase
// without touching the UI code in comunidad.js.
window.CommunityStore = (() => {
  const LIKES_KEY = 'gtavi.community.likes';
  const MIN = 60 * 1000;

  // Preview content: example users and opinion threads (no game facts are invented here).
  const POSTS = [
    {
      id: 'p1', category: 'leonida', author: 'Kalaga_Trails', minutesAgo: 18, likes: 42, replyCount: 23,
      title: '¿Qué región de Leonida vas a explorar primero?',
      excerpt: 'Vice City es lo obvio, pero los Keys y Mount Kalaga me llaman muchísimo. ¿Ustedes por dónde empiezan el 19 de noviembre?',
      replies: [
        { author: 'OceanBeachKid', minutesAgo: 12, text: 'Ocean Beach de noche, sin dudarlo.' },
        { author: 'KeysCaptain', minutesAgo: 9, text: 'Yo directo a los Keys a buscar The Rusty Anchor.' },
      ],
    },
    {
      id: 'p2', category: 'teoria', author: 'NeonDrifter', minutesAgo: 47, likes: 87, replyCount: 41,
      title: 'Teoría: ¿en qué momento sale mal el «golpe fácil» del Tráiler 2?',
      excerpt: 'La descripción oficial dice que un golpe fácil sale mal y los mete en una conspiración. ¿Creen que pasa al principio o a mitad de la historia?',
      replies: [
        { author: 'ViceRider_305', minutesAgo: 30, text: 'Para mí es el arranque de la historia, como el prólogo de GTA V.' },
        { author: 'LuciaMain', minutesAgo: 22, text: 'Apuesto a mitad: primero nos dejarán conocerlos.' },
      ],
    },
    {
      id: 'p3', category: 'noticias', author: 'ViceRider_305', minutesAgo: 95, likes: 64, replyCount: 35,
      title: 'Extended Look: ¿qué detalle te voló la cabeza?',
      excerpt: 'Son 26 minutos de juego y cada vez que lo veo encuentro algo nuevo. Lo de cambiar entre Jason y Lucia en plena persecución me parece brutal.',
      replies: [
        { author: 'Grassrivers_Gator', minutesAgo: 70, text: 'La cantidad de gente en la calle. Se siente vivo.' },
        { author: 'TishaWocka', minutesAgo: 61, text: 'El combate. Tiene muy buena pinta.' },
      ],
    },
    {
      id: 'p4', category: 'debate', author: 'LuciaMain', minutesAgo: 160, likes: 120, replyCount: 58,
      title: '¿Jason o Lucia? ¿Con quién te identificas más?',
      excerpt: 'Ella salió de la Penitenciaría de Leonida y él viene de trabajar para narcos en los Keys. Dos historias muy distintas. ¿De qué equipo eres?',
      replies: [
        { author: 'Kalaga_Trails', minutesAgo: 140, text: 'Equipo Lucia desde el primer tráiler.' },
        { author: 'NeonDrifter', minutesAgo: 120, text: 'Jason. Ese «quiero una vida fácil» me representa.' },
      ],
    },
    {
      id: 'p5', category: 'debate', author: 'OceanBeachKid', minutesAgo: 320, likes: 38, replyCount: 29,
      title: '¿Edición estándar o Ultimate?',
      excerpt: '79,99 USD la estándar y 99,99 USD la Ultimate. ¿Les compensa la diferencia o van a por la básica?',
      replies: [
        { author: 'KeysCaptain', minutesAgo: 300, text: 'Estándar y el resto me lo gasto en el álbum en vinilo.' },
      ],
    },
    {
      id: 'p6', category: 'teoria', author: 'Grassrivers_Gator', minutesAgo: 610, likes: 51, replyCount: 17,
      title: 'Teoría: Cal Hampton sabe más de lo que parece',
      excerpt: 'Un amigo de Jason que desconfía de todo el mundo… En un GTA eso nunca es casualidad. ¿Aliado o problema?',
      replies: [
        { author: 'TishaWocka', minutesAgo: 540, text: 'Huele a personaje con giro final.' },
      ],
    },
    {
      id: 'p7', category: 'noticias', author: 'TishaWocka', minutesAgo: 1440, likes: 73, replyCount: 44,
      title: 'Banda sonora: ¿qué tema quieres escuchar en la radio?',
      excerpt: 'Con Travis Scott, Keith Richards y Rauw Alejandro confirmados en el álbum, la radio de Vice City promete. ¿Qué artista te falta?',
      replies: [
        { author: 'ViceRider_305', minutesAgo: 1300, text: 'Que vuelva una emisora de los 80, por favor.' },
      ],
    },
    {
      id: 'p8', category: 'debate', author: 'KeysCaptain', minutesAgo: 2880, likes: 46, replyCount: 31,
      title: 'GTA Online no llega el día del estreno: ¿bien o mal?',
      excerpt: 'Rockstar ha dicho que el online no estará en el lanzamiento. ¿Prefieren centrarse primero en la historia?',
      replies: [
        { author: 'LuciaMain', minutesAgo: 2700, text: 'Bien. Primero la historia con calma.' },
      ],
    },
  ];

  function readLikes() {
    try {
      return new Set(JSON.parse(localStorage.getItem(LIKES_KEY) || '[]'));
    } catch {
      return new Set();
    }
  }

  function writeLikes(set) {
    try {
      localStorage.setItem(LIKES_KEY, JSON.stringify([...set]));
    } catch {
      // Storage unavailable (private mode): likes just won't persist.
    }
  }

  function hydrate(post, liked) {
    const now = Date.now();
    const isLiked = liked.has(post.id);
    return {
      id: post.id,
      category: post.category,
      title: post.title,
      excerpt: post.excerpt,
      author: { name: post.author },
      createdAt: new Date(now - post.minutesAgo * MIN).toISOString(),
      replyCount: post.replyCount,
      likes: post.likes + (isLiked ? 1 : 0),
      liked: isLiked,
      preview: true,
      replies: post.replies.map(r => ({
        author: { name: r.author },
        createdAt: new Date(now - r.minutesAgo * MIN).toISOString(),
        text: r.text,
      })),
    };
  }

  return {
    source: 'preview',

    async listPosts({ sort = 'recent', category = 'all' } = {}) {
      const liked = readLikes();
      let posts = POSTS.map(p => hydrate(p, liked));
      if (category !== 'all') posts = posts.filter(p => p.category === category);
      posts.sort(sort === 'popular'
        ? (a, b) => (b.likes + b.replyCount) - (a.likes + a.replyCount)
        : (a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      return posts;
    },

    async toggleLike(id) {
      const post = POSTS.find(p => p.id === id);
      if (!post) throw new Error('Debate no encontrado.');
      const liked = readLikes();
      if (liked.has(id)) liked.delete(id);
      else liked.add(id);
      writeLikes(liked);
      return { liked: liked.has(id), likes: post.likes + (liked.has(id) ? 1 : 0) };
    },
  };
})();
