// Helpers shared by both stores and the API.
const HISTORY_LIMIT = 50;

// "Hot" ranking: engagement that decays with age (like Hacker News).
function hotScore(post, nowMs) {
  const ageHours = (nowMs - new Date(post.created_at).getTime()) / 3.6e6;
  return (post.like_count * 2 + post.comment_count * 3 + 1) / Math.pow(Math.max(ageHours, 0) + 2, 1.5);
}

function cleanLine(value) {
  return String(value || '')
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Keeps line breaks (at most one empty line in a row) but strips control characters.
function cleanMultiline(value) {
  return String(value || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '')
    .split('\n').map(line => line.replace(/\s+/g, ' ').trimEnd()).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Accepts youtube.com/watch?v=, youtu.be/, /shorts/, /embed/ and /live/ links.
function youtubeId(input) {
  const value = String(input || '').trim();
  if (!value) return null;
  if (/^[A-Za-z0-9_-]{11}$/.test(value)) return value;
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www\.|m\.|music\.)/, '');
  let id = null;
  if (host === 'youtu.be') id = url.pathname.slice(1);
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (url.pathname === '/watch') id = url.searchParams.get('v');
    else {
      const m = url.pathname.match(/^\/(shorts|embed|live|v)\/([^/?#]+)/);
      if (m) id = m[2];
    }
  }
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
}

module.exports = { HISTORY_LIMIT, hotScore, cleanLine, cleanMultiline, youtubeId };
