const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const sharp = require('sharp');
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const STORAGE_PROVIDER = (process.env.STORAGE_PROVIDER || (process.env.R2_BUCKET_NAME ? 'r2' : 'disabled')).toLowerCase();
const LOCAL_MEDIA_ROOT = path.resolve(process.env.MEDIA_STORAGE_ROOT || path.join(process.cwd(), 'storage'));
const LOCAL_MEDIA_BASE_PATH = process.env.MEDIA_PUBLIC_BASE_PATH || '/media/files';
const R2_READY = Boolean(
  process.env.R2_ACCOUNT_ID &&
    process.env.R2_BUCKET_NAME &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_PUBLIC_BASE_URL,
);

let s3Client = null;

function sanitizeSegment(value, fallback = 'archivo') {
  return String(value || fallback)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 80) || fallback;
}

function ensureAllowedMimeType(mimeType) {
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    const error = new Error('Solo se permiten imagenes JPG, PNG o WebP.');
    error.status = 400;
    throw error;
  }
}

function ensureSize(size) {
  if (size > MAX_UPLOAD_BYTES) {
    const error = new Error('La imagen no puede superar 5 MB.');
    error.status = 400;
    throw error;
  }
}

function buildStorageClient() {
  if (s3Client) return s3Client;

  s3Client = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });

  return s3Client;
}

async function retry(action, attempts = 3) {
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
    }
  }

  throw lastError;
}

async function optimizeImage(buffer) {
  const optimized = await sharp(buffer)
    .rotate()
    .resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82, effort: 4 })
    .toBuffer();

  const metadata = await sharp(optimized).metadata();
  const blurBuffer = await sharp(optimized).resize({ width: 32 }).webp({ quality: 45 }).toBuffer();

  return {
    buffer: optimized,
    size: optimized.length,
    width: metadata.width || null,
    height: metadata.height || null,
    blurDataURL: `data:image/webp;base64,${blurBuffer.toString('base64')}`,
    mimeType: 'image/webp',
  };
}

function buildObjectKey(folder, originalName = 'imagen') {
  const extless = path.parse(originalName).name || 'imagen';
  const safeFolder = sanitizeSegment(folder, 'general');
  const safeName = sanitizeSegment(extless, 'imagen');
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  const random = crypto.randomBytes(4).toString('hex');
  return `${safeFolder}/${stamp}-${random}-${safeName}.webp`;
}

function getStorageHealth() {
  if (STORAGE_PROVIDER === 'r2') {
    return {
      provider: 'r2',
      ready: R2_READY,
      maxUploadBytes: MAX_UPLOAD_BYTES,
      publicBaseUrl: process.env.R2_PUBLIC_BASE_URL || '',
    };
  }

  if (STORAGE_PROVIDER === 'filesystem') {
    return {
      provider: 'filesystem',
      ready: true,
      maxUploadBytes: MAX_UPLOAD_BYTES,
      publicBaseUrl: LOCAL_MEDIA_BASE_PATH,
    };
  }

  return {
    provider: 'disabled',
    ready: false,
    maxUploadBytes: MAX_UPLOAD_BYTES,
    publicBaseUrl: '',
  };
}

function ensureStorageReady() {
  if (STORAGE_PROVIDER === 'filesystem') return;
  if (STORAGE_PROVIDER === 'r2' && R2_READY) return;

  const error = new Error('El almacenamiento de imagenes no esta configurado todavia.');
  error.status = 503;
  throw error;
}

async function uploadToFilesystem(key, buffer) {
  const target = path.join(LOCAL_MEDIA_ROOT, key);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, buffer);
  return {
    url: `${LOCAL_MEDIA_BASE_PATH}/${key}`.replace(/\\/g, '/'),
  };
}

async function uploadToR2(key, buffer) {
  const client = buildStorageClient();
  await retry(() =>
    client.send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: key,
        Body: buffer,
        ContentType: 'image/webp',
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    ),
  );

  return {
    url: `${String(process.env.R2_PUBLIC_BASE_URL).replace(/\/$/, '')}/${key}`,
  };
}

async function uploadImage({ folder, originalName, mimeType, size, buffer }) {
  ensureAllowedMimeType(mimeType);
  ensureSize(size);
  ensureStorageReady();

  const prepared = await optimizeImage(buffer);
  const key = buildObjectKey(folder, originalName);
  const uploaded = STORAGE_PROVIDER === 'filesystem'
    ? await uploadToFilesystem(key, prepared.buffer)
    : await uploadToR2(key, prepared.buffer);

  return {
    provider: STORAGE_PROVIDER,
    key,
    url: uploaded.url,
    blurDataURL: prepared.blurDataURL,
    mimeType: prepared.mimeType,
    size: prepared.size,
    width: prepared.width,
    height: prepared.height,
    originalName: path.basename(originalName || 'imagen'),
    uploadedAt: new Date().toISOString(),
  };
}

async function deleteImage(key) {
  if (!key) return { ok: false };
  ensureStorageReady();

  if (STORAGE_PROVIDER === 'filesystem') {
    const target = path.join(LOCAL_MEDIA_ROOT, key);
    await fs.rm(target, { force: true });
    return { ok: true };
  }

  const client = buildStorageClient();
  await retry(() =>
    client.send(
      new DeleteObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: key,
      }),
    ),
  );

  return { ok: true };
}

module.exports = {
  ALLOWED_MIME_TYPES,
  LOCAL_MEDIA_BASE_PATH,
  LOCAL_MEDIA_ROOT,
  MAX_UPLOAD_BYTES,
  STORAGE_PROVIDER,
  deleteImage,
  getStorageHealth,
  uploadImage,
};
