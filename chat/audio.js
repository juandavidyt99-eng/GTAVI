// Chat voice notes: short recordings from the browser (WebM/Opus, Ogg or MP4/AAC), checked by their
// file signature and stored as they arrive next to the chat photos.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { uploadsDir } = require('./images');

const MAX_BYTES = 3 * 1024 * 1024;
const MAX_MS = 2 * 60 * 1000;
const PENDING_TTL_MS = 60 * 60 * 1000;
const NAME_RE = /^[a-f0-9]{24}\.(webm|ogg|m4a)$/;
const CONTENT_TYPES = { webm: 'audio/webm', ogg: 'audio/ogg', m4a: 'audio/mp4' };

class AudioError extends Error {}

// Recorders in Chrome/Firefox/Android produce WebM or Ogg; Safari on iPhone and Mac produces MP4.
function detectFormat(buffer) {
  if (buffer.length < 12) return null;
  if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) return 'webm';
  if (buffer.toString('latin1', 0, 4) === 'OggS') return 'ogg';
  if (buffer.toString('latin1', 4, 8) === 'ftyp') return 'm4a';
  return null;
}

async function saveAudio(buffer, ms) {
  const ext = detectFormat(buffer);
  if (!ext) throw new AudioError('La nota de voz no tiene un formato válido.');
  const duration = Math.round(Number(ms));
  if (!Number.isFinite(duration) || duration < 300) throw new AudioError('La nota de voz es demasiado corta.');
  const name = `${crypto.randomBytes(12).toString('hex')}.${ext}`;
  await fs.promises.writeFile(path.join(uploadsDir(), name), buffer);
  return { name, ms: Math.min(duration, MAX_MS) };
}

function removeAudio(name) {
  if (!name || !NAME_RE.test(name)) return;
  fs.promises.unlink(path.join(uploadsDir(), name)).catch(() => {});
}

// Recordings uploaded but not yet sent. Unused ones are deleted after an hour.
const pending = new Map();

function registerAudio(userId, audio) {
  pending.set(audio.name, { userId, audio, at: Date.now() });
}

function claimAudio(userId, name) {
  const entry = pending.get(String(name));
  if (!entry || entry.userId !== userId) return null;
  pending.delete(entry.audio.name);
  return entry.audio;
}

function discardAudio(userId, name) {
  const entry = pending.get(String(name));
  if (!entry || entry.userId !== userId) return false;
  pending.delete(entry.audio.name);
  removeAudio(entry.audio.name);
  return true;
}

setInterval(() => {
  const limit = Date.now() - PENDING_TTL_MS;
  for (const [name, entry] of pending) {
    if (entry.at < limit) {
      pending.delete(name);
      removeAudio(name);
    }
  }
}, 10 * 60 * 1000).unref();

module.exports = {
  MAX_BYTES, MAX_MS, NAME_RE, CONTENT_TYPES, AudioError,
  detectFormat, saveAudio, removeAudio, registerAudio, claimAudio, discardAudio,
};
