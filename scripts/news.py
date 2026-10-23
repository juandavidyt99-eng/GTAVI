#!/usr/bin/env python3
"""Editorial tool for the static site: adds our own articles and keeps every list that links to them in sync.

    python3 scripts/news.py add scripts/articles/<slug>.json   # creates public/noticias/<slug>.html
    python3 scripts/news.py relist [YYYY-MM-DD]                 # side/related lists, /noticias, home, RSS, sitemaps

New pages are made from the newest existing article, so they share its exact markup and styles.
The order of articles (newest first) lives in scripts/news-order.json; `add` puts the new slug first.
Article JSON fields: slug, published (ISO with offset), date_h, section, short, title, card_title, seo_title,
seo_desc, dek, img (name in /images/news/redaccion/, without size), alt, credit, keys[], body (HTML), sources[[name, url]].
"""
import html
import json
import re
import sys
from datetime import date, datetime, timedelta
from email.utils import format_datetime
from pathlib import Path
from urllib.parse import quote
from xml.sax.saxutils import escape as xml_escape

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / 'public'
NEWS_DIR = PUBLIC / 'noticias'
ORDER_FILE = ROOT / 'scripts' / 'news-order.json'
SITE = 'https://gtavivicecity.com'
AR_DIR = '/images/news/redaccion/'
AUTHOR = 'Redacción GTA VI Vice City'


def read(path):
    return path.read_text(encoding='utf-8')


def write(path, text):
    path.write_text(text, encoding='utf-8')
    print('wrote', path.relative_to(ROOT))


def sub_once(pattern, repl, text, flags=re.S):
    new, n = re.subn(pattern, lambda m: repl(m) if callable(repl) else repl, text, count=1, flags=flags)
    if n != 1:
        raise SystemExit(f'pattern not found: {pattern[:80]}')
    return new


def strip_tags(text):
    return html.unescape(re.sub(r'<[^>]+>', ' ', text))


# ------------------------------------------------------------------ reading articles back from their pages
def article_data(slug):
    page = read(NEWS_DIR / f'{slug}.html')
    get = lambda pat: re.search(pat, page, re.S).group(1)
    return {
        'slug': slug,
        'title': get(r'<h1 class="ar-title">(.*?)</h1>'),
        'card_title': html.unescape(get(r'<div class="ar-share" data-share data-title="([^"]*)"')),
        'section': get(r'<p class="ar-kicker"><span class="tag tag-redaccion">[^<]*</span><span>(.*?)</span></p>'),
        'img': get(r'<div class="ar-hero-media">\s*<img src="' + re.escape(AR_DIR) + r'([a-z0-9-]+)-1600\.webp"'),
        'dek': get(r'<p class="ar-dek">(.*?)</p>'),
        'published': get(r'<div class="ar-byline">.*?<time datetime="([^"]+)">'),
        'date_h': get(r'<div class="ar-byline">.*?<time datetime="[^"]+">(.*?)</time>'),
        'minutes': int(get(r'(\d+) min de lectura')),
    }


def load_order():
    return json.loads(read(ORDER_FILE))


# ------------------------------------------------------------------ markup shared by every list
def ar_card(a, cls='ar-card', size='800'):
    return f'''<article class="{cls}">
  <a class="ar-card-media" href="/noticias/{a["slug"]}" tabindex="-1" aria-hidden="true"><img src="{AR_DIR}{a["img"]}-{size}.webp" alt="" width="800" height="450" loading="lazy" decoding="async"></a>
  <div class="ar-card-body">
    <p class="ar-card-meta"><span class="tag tag-redaccion">{a["section"]}</span><time datetime="{a["published"]}">{a["date_h"]}</time><span>{a["minutes"]} min de lectura</span></p>
    <h3 class="ar-card-title"><a href="/noticias/{a["slug"]}">{a["card_title"]}</a></h3>
    <p class="ar-card-dek">{a["dek"]}</p>
  </div>
</article>'''


def side_item(a):
    return (f'<li><a href="/noticias/{a["slug"]}"><img src="{AR_DIR}{a["img"]}-800.webp" alt="" width="800" height="450" loading="lazy" decoding="async">'
            f'<span><span class="ar-side-kicker">{a["section"]}</span>{a["card_title"]}</span></a></li>')


def hm_card(a, cls, size):
    return f'''      <article class="hm-card {cls}">
        <img src="{AR_DIR}{a["img"]}-{size}.webp" alt="" width="{size}" height="{int(size) * 9 // 16}" loading="lazy" decoding="async">
        <div class="hm-card-body">
          <p class="hm-card-meta"><span class="tag tag-redaccion">{a["section"]}</span><span>{a["minutes"]} min</span></p>
          <h3 class="hm-card-title"><a href="/noticias/{a["slug"]}">{a["card_title"]}</a></h3>
          <p class="hm-card-dek">{a["dek"]}</p>
        </div>
      </article>'''


# ------------------------------------------------------------------ add
def add(spec_path):
    art = json.loads(read(Path(spec_path)))
    slug, url = art['slug'], f'/noticias/{art["slug"]}'
    order = load_order()
    template = read(NEWS_DIR / f'{order[0]}.html')
    ext = re.search(r'(<svg class="icon-ext".*?</svg>)', template, re.S).group(1)
    words = len(strip_tags(art['dek'] + ' ' + art['body']).split())
    minutes = max(2, round(words / 200))
    og = f'{SITE}/images/og/{slug}.jpg'
    esc = lambda s: s.replace('"', '&quot;')
    page = template

    # head
    page = sub_once(r'<title>.*?</title>', f'<title>{art["seo_title"]}</title>', page)
    page = sub_once(r'<meta name="description" content="[^"]*">', f'<meta name="description" content="{esc(art["seo_desc"])}">', page)
    for attr in ('rel="canonical"', 'rel="alternate" hreflang="es"', 'rel="alternate" hreflang="x-default"'):
        page = sub_once(r'<link ' + re.escape(attr) + r' href="[^"]*">', f'<link {attr} href="{SITE}{url}">', page)
    for prop in ('article:published_time', 'article:modified_time'):
        page = sub_once(rf'<meta property="{prop}" content="[^"]*">', f'<meta property="{prop}" content="{art["published"]}">', page)
    page = sub_once(r'<meta property="article:section" content="[^"]*">', f'<meta property="article:section" content="{esc(art["section"])}">', page)
    meta = {
        ('property', 'og:title'): art['title'], ('property', 'og:description'): art['seo_desc'], ('property', 'og:url'): SITE + url,
        ('property', 'og:image'): og, ('property', 'og:image:alt'): art['title'], ('name', 'twitter:title'): art['title'],
        ('name', 'twitter:description'): art['seo_desc'], ('name', 'twitter:image'): og,
    }
    for (kind, key), value in meta.items():
        page = sub_once(rf'<meta {kind}="{re.escape(key)}" content="[^"]*">', f'<meta {kind}="{key}" content="{esc(value)}">', page)

    # structured data
    def fix_ld(m):
        data = json.loads(m.group(1))
        if data.get('@type') == 'BreadcrumbList':
            data['itemListElement'][2].update(name=art['short'], item=SITE + url)
        elif data.get('@type') == 'NewsArticle':
            data.update({
                'headline': art['title'] if len(art['title']) <= 110 else art['card_title'], 'description': art['seo_desc'],
                'image': [f'{SITE}{AR_DIR}{art["img"]}-1600.webp', og],
                'datePublished': art['published'], 'dateModified': art.get('modified', art['published']),
                'mainEntityOfPage': {'@type': 'WebPage', '@id': SITE + url}, 'articleSection': art['section'],
                'wordCount': words, 'citation': [u for _, u in art['sources']],
            })
        return '<script type="application/ld+json">\n' + json.dumps(data, ensure_ascii=False, indent=2) + '\n</script>'
    page = re.sub(r'<script type="application/ld\+json">\s*(.*?)\s*</script>', fix_ld, page, flags=re.S)

    # hero
    img = art['img']
    page = sub_once(r'(<div class="ar-hero-media">\s*)<img [^>]*>',
                    lambda m: m.group(1) + f'<img src="{AR_DIR}{img}-1600.webp" srcset="{AR_DIR}{img}-800.webp 800w, {AR_DIR}{img}-1600.webp 1600w" sizes="100vw" alt="{esc(art["alt"])}" width="1600" height="900" fetchpriority="high" decoding="async">', page)
    page = sub_once(r'(<nav class="breadcrumb"[^>]*><ol><li><a href="/">Inicio</a></li><li><a href="/noticias">Noticias</a></li><li aria-current="page">).*?(</li>)',
                    lambda m: m.group(1) + art['short'] + m.group(2), page)
    page = sub_once(r'(<p class="ar-kicker"><span class="tag tag-redaccion">[^<]*</span><span>).*?(</span></p>)', lambda m: m.group(1) + art['section'] + m.group(2), page)
    page = sub_once(r'<h1 class="ar-title">.*?</h1>', f'<h1 class="ar-title">{art["title"]}</h1>', page)
    page = sub_once(r'<p class="ar-dek">.*?</p>', f'<p class="ar-dek">{art["dek"]}</p>', page)
    page = sub_once(r'(<div class="ar-byline">.*?)<time datetime="[^"]+">.*?</time> · \d+ min de lectura',
                    lambda m: m.group(1) + f'<time datetime="{art["published"]}">{art["date_h"]}</time> · {minutes} min de lectura', page)

    # body
    page = sub_once(r'<p class="ar-credit">.*?</p>', f'<p class="ar-credit">{art["credit"]} · <span>Imagen: Rockstar Games</span></p>', page)
    page = sub_once(r'(<aside class="ar-keys".*?<ul>).*?(</ul>)', lambda m: m.group(1) + ''.join(f'<li>{k}</li>' for k in art['keys']) + m.group(2), page)
    page = sub_once(r'(<div class="ar-content">\n).*?(\n    </div>\n    <section class="ar-sources")', lambda m: m.group(1) + art['body'].strip('\n') + m.group(2), page)
    sources = ''.join(f'<li><a href="{u}" target="_blank" rel="noopener">{n} {ext}</a></li>' for n, u in art['sources'])
    page = sub_once(r'(<section class="ar-sources".*?<ul>).*?(</ul>)', lambda m: m.group(1) + sources + m.group(2), page)
    share = f'''<div class="ar-share" data-share data-title="{esc(art["card_title"])}">
      <span class="ar-share-label">Compartir</span>
      <a class="ar-share-btn" data-share-net="whatsapp" href="https://wa.me/?text={quote(art["card_title"] + " " + SITE + url)}" target="_blank" rel="noopener">WhatsApp</a>
      <a class="ar-share-btn" data-share-net="x" href="https://twitter.com/intent/tweet?text={quote(art["card_title"])}&amp;url={quote(SITE + url, safe="")}" target="_blank" rel="noopener">X</a>
      <a class="ar-share-btn" data-share-net="facebook" href="https://www.facebook.com/sharer/sharer.php?u={quote(SITE + url, safe="")}" target="_blank" rel="noopener">Facebook</a>
      <button type="button" class="ar-share-btn" data-share-copy="{SITE}{url}">Copiar enlace</button>
    </div>'''
    page = sub_once(r'<div class="ar-share" data-share.*?</div>', share, page)

    write(NEWS_DIR / f'{slug}.html', page)
    if slug not in order:
        order.insert(0, slug)
        write(ORDER_FILE, json.dumps(order, indent=2) + '\n')
    add_to_sitemap(slug, img, art['published'][:10])


def add_to_sitemap(slug, img, day):
    path = PUBLIC / 'sitemap.xml'
    text = read(path)
    if f'/noticias/{slug}</loc>' in text:
        return
    entry = f'''  <url>
    <loc>{SITE}/noticias/{slug}</loc>
    <lastmod>{day}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
    <image:image><image:loc>{SITE}{AR_DIR}{img}-1600.webp</image:loc></image:image>
  </url>
'''
    first_article = re.search(r'  <url>\n    <loc>' + re.escape(SITE) + r'/noticias/[a-z0-9-]+</loc>', text)
    text = text[:first_article.start()] + entry + text[first_article.start():]
    write(path, text)


# ------------------------------------------------------------------ relist
def relist(today_iso=None):
    order = load_order()
    arts = [article_data(s) for s in order]
    by_slug = {a['slug']: a for a in arts}

    # every article: "Más de la redacción" (4) and "Sigue leyendo" (3)
    for a in arts:
        others = [o for o in arts if o['slug'] != a['slug']]
        path = NEWS_DIR / f'{a["slug"]}.html'
        page = read(path)
        page = sub_once(r'<ul class="ar-side-list">.*?</ul>', '<ul class="ar-side-list">' + ''.join(side_item(o) for o in others[:4]) + '</ul>', page)
        page = sub_once(r'(<section class="block block-alt ar-related".*?<div class="ar-grid">\n).*?(\n    </div>\n  </div>\n</section>)',
                        lambda m: m.group(1) + '\n'.join(ar_card(o) for o in others[:3]) + m.group(2), page)
        write(path, page)

    # /noticias: lead + grid
    path = PUBLIC / 'noticias.html'
    page = read(path)
    lead, rest = arts[0], arts[1:]
    page = sub_once(r'(<div class="ar-lead">\n).*?(\n    </div>\n    <div class="ar-grid ar-grid-5">\n).*?(\n    </div>\n  </div>\n</section>)',
                    lambda m: m.group(1) + ar_card(lead, 'ar-card ar-card-lead', '1600') + m.group(2) + '\n'.join(ar_card(o) for o in rest) + m.group(3), page)
    write(path, page)

    # home: 1 large, 2 medium, 3 small cards, then a text list with the rest
    path = PUBLIC / 'index.html'
    page = read(path)
    sizes = [('hm-card-xl', 1600), ('hm-card-md', 800), ('hm-card-md', 800), ('hm-card-sm', 800), ('hm-card-sm', 800), ('hm-card-sm', 800)]
    bento = '\n'.join(hm_card(a, cls, size) for a, (cls, size) in zip(arts, sizes))
    more = '\n'.join(f'        <li><a href="/noticias/{a["slug"]}"><span class="tag tag-redaccion">{a["section"]}</span><strong>{a["card_title"]}</strong></a></li>' for a in arts[len(sizes):])
    page = sub_once(r'(<div class="hm-bento">\n).*?(\n    </div>\n    <ul class="hm-more" aria-label="Más artículos de nuestra redacción">\n).*?(\n    </ul>)',
                    lambda m: m.group(1) + bento + m.group(2) + more + m.group(3), page)
    write(path, page)

    build_feeds(arts, today_iso or date.today().isoformat())


def build_feeds(arts, today_iso):
    newest = sorted(arts, key=lambda a: a['published'], reverse=True)
    items = []
    for a in newest:
        link = f'{SITE}/noticias/{a["slug"]}'
        items.append(f'''    <item>
      <title>{xml_escape(html.unescape(a["title"]))}</title>
      <link>{link}</link>
      <guid isPermaLink="true">{link}</guid>
      <pubDate>{format_datetime(datetime.fromisoformat(a["published"]))}</pubDate>
      <category>{xml_escape(html.unescape(a["section"]))}</category>
      <dc:creator>{AUTHOR}</dc:creator>
      <description>{xml_escape(html.unescape(strip_tags(a["dek"]).strip()))}</description>
      <media:content url="{SITE}{AR_DIR}{a["img"]}-1600.webp" medium="image" type="image/webp" width="1600" height="900"/>
    </item>''')
    path = PUBLIC / 'feed.xml'
    feed = read(path)
    feed = sub_once(r'<lastBuildDate>.*?</lastBuildDate>', f'<lastBuildDate>{format_datetime(datetime.fromisoformat(newest[0]["published"]))}</lastBuildDate>', feed)
    start = feed.index('    <item>')
    end = feed.rindex('</item>') + len('</item>')
    feed = feed[:start] + '\n'.join(items) + feed[end:]
    write(path, feed)

    cutoff = date.fromisoformat(today_iso) - timedelta(days=2)
    fresh = [a for a in newest if date.fromisoformat(a['published'][:10]) >= cutoff]
    urls = ''.join(f'''  <url>
    <loc>{SITE}/noticias/{a["slug"]}</loc>
    <news:news>
      <news:publication><news:name>GTA VI Vice City</news:name><news:language>es</news:language></news:publication>
      <news:publication_date>{a["published"]}</news:publication_date>
      <news:title>{xml_escape(html.unescape(a["title"]))}</news:title>
    </news:news>
  </url>
''' for a in fresh)
    write(PUBLIC / 'sitemap-news.xml', '<?xml version="1.0" encoding="UTF-8"?>\n'
          '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">\n'
          + urls + '</urlset>\n')
    print(f'news sitemap: {len(fresh)} articles since {cutoff}')


if __name__ == '__main__':
    if len(sys.argv) >= 3 and sys.argv[1] == 'add':
        add(sys.argv[2])
    elif len(sys.argv) >= 2 and sys.argv[1] == 'relist':
        relist(sys.argv[2] if len(sys.argv) > 2 else None)
    else:
        print(__doc__)
        sys.exit(1)
