// Helpers shared by both stores and the API.
const fs = require('fs');
const os = require('os');
const path = require('path');

const HISTORY_LIMIT = 50;
const CHAT_TEXT_MAX = 500;
const EDIT_WINDOW_MS = 15 * 60 * 1000;
// Reactions allowed in the chat (kept in sync with the client).
const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥', '👏', '💀'];
const REPORT_REASONS = ['spam', 'acoso', 'spoiler', 'inapropiado', 'otro'];

// Folder for everything that must survive deploys (data file, uploaded photos).
function dataDir() {
  const dir = process.env.DATA_DIR || path.join(os.homedir(), '.gtavi-data');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const admins = new Set((process.env.ADMIN_USERS || '')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean));
const isAdminName = name => Boolean(name && admins.has(String(name).toLowerCase()));

// "Entrar con Google" is on only when both credentials are set in the environment.
function googleConfig() {
  const id = process.env.GOOGLE_CLIENT_ID;
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!id || !secret) return null;
  return { id, secret, redirectUri: process.env.GOOGLE_REDIRECT_URI || 'https://gtavivicecity.com/api/auth/google/callback' };
}

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

module.exports = {
  HISTORY_LIMIT, CHAT_TEXT_MAX, EDIT_WINDOW_MS, REACTIONS, REPORT_REASONS,
  dataDir, isAdminName, googleConfig, hotScore, cleanLine, cleanMultiline, youtubeId,
};
