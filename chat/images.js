// Chat photos: validated, stripped of metadata (EXIF/GPS), resized and stored as WebP.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { dataDir } = require('./shared');

let sharp = null;
try {
  sharp = require('sharp');
} catch (err) {
  console.warn('[chat] "sharp" is not available: photo uploads are disabled.', err.message);
}

const MAX_BYTES = 6 * 1024 * 1024;
const ALLOWED_INPUT = new Set(['jpeg', 'png', 'webp']);
const PENDING_TTL_MS = 60 * 60 * 1000;
const NAME_RE = /^[a-f0-9]{24}(_t)?\.webp$/;

const uploadsDir = () => {
  const dir = path.join(dataDir(), 'uploads', 'chat');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

class ImageError extends Error {}

const enabled = () => Boolean(sharp);

async function processImage(buffer) {
  if (!sharp) throw new ImageError('Las fotos no están disponibles en este momento.');
  let meta;
  try {
    meta = await sharp(buffer, { limitInputPixels: 50e6 }).metadata();
  } catch {
    throw new ImageError('El archivo no es una imagen válida.');
  }
  if (!ALLOWED_INPUT.has(meta.format)) throw new ImageError('Solo se admiten fotos JPG, PNG o WebP.');

  // rotate() applies the EXIF orientation; sharp drops all other metadata by default.
  const full = await sharp(buffer, { limitInputPixels: 50e6 })
    .rotate()
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer({ resolveWithObject: true });
  const thumb = await sharp(full.data).resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true }).webp({ quality: 72 }).toBuffer();

  const name = crypto.randomBytes(12).toString('hex');
  const dir = uploadsDir();
  await fs.promises.writeFile(path.join(dir, `${name}.webp`), full.data);
  await fs.promises.writeFile(path.join(dir, `${name}_t.webp`), thumb);
  return { name, w: full.info.width, h: full.info.height };
}

function removeImage(name) {
  if (!name || !/^[a-f0-9]{24}$/.test(name)) return;
  const dir = uploadsDir();
  for (const file of [`${name}.webp`, `${name}_t.webp`]) fs.promises.unlink(path.join(dir, file)).catch(() => {});
}

// Photos uploaded but not yet attached to a message. Unused ones are deleted after an hour.
const pending = new Map();

function registerUpload(userId, image) {
  pending.set(image.name, { userId, image, at: Date.now() });
}

function claimUpload(userId, name) {
  const entry = pending.get(String(name));
  if (!entry || entry.userId !== userId) return null;
  pending.delete(entry.image.name);
  return entry.image;
}

function discardUpload(userId, name) {
  const entry = pending.get(String(name));
  if (!entry || entry.userId !== userId) return false;
  pending.delete(entry.image.name);
  removeImage(entry.image.name);
  return true;
}

setInterval(() => {
  const limit = Date.now() - PENDING_TTL_MS;
  for (const [name, entry] of pending) {
    if (entry.at < limit) {
      pending.delete(name);
      removeImage(name);
    }
  }
}, 10 * 60 * 1000).unref();

module.exports = {
  MAX_BYTES, NAME_RE, ImageError, enabled, uploadsDir, processImage, removeImage,
  registerUpload, claimUpload, discardUpload,
};
