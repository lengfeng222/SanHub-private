/* eslint-disable no-console */
import fs from 'fs';
import { promises as fsp } from 'fs';
import path from 'path';
import {
  resolveDefaultImageBucket,
  uploadBufferToImageBucket,
  uploadToPicUI,
} from './picui';
import { fetchWithRetry } from './http-retry';
import { inferMediaKindFromMimeType, inferMediaKindFromUrl, type MediaKind } from './media-kind';

// ========================================
// 媒体文件存储
// 支持将 base64 图片保存为文件，减少数据库体积
// ========================================

const DATA_DIR = process.env.DATA_DIR || './data';
const MEDIA_DIR = path.join(DATA_DIR, 'media');
const PUBLIC_RUNTIME_MEDIA_DIR = path.join(process.cwd(), 'public', 'runtime-media');
const INTERNAL_RUNTIME_MEDIA_PATH_PATTERN = /\/api\/runtime-media\/([^/?#]+)/i;
const MAX_REMOTE_MEDIA_BYTES = Math.max(
  1,
  Number(process.env.MEDIA_REMOTE_CACHE_MAX_BYTES) || 512 * 1024 * 1024
);
export const RUNTIME_MEDIA_RETENTION_MS = Math.max(
  60 * 60 * 1000,
  (Number(process.env.RUNTIME_MEDIA_RETENTION_HOURS) || 24) * 60 * 60 * 1000
);
const RUNTIME_MEDIA_CLEANUP_INTERVAL_MS = Math.max(
  5 * 60 * 1000,
  Number(process.env.RUNTIME_MEDIA_CLEANUP_INTERVAL_MS) || 15 * 60 * 1000
);

let lastRuntimeMediaCleanupAt = 0;
let runtimeMediaCleanupPromise: Promise<void> | null = null;
let runtimeMediaCleanupTimer: NodeJS.Timeout | null = null;

type SaveMediaOptions = {
  publicBaseUrl?: string;
  filename?: string;
  storageMode?: 'auto' | 'runtime';
};

export type SavedMediaAsset = {
  url: string;
  mimeType?: string;
  kind: MediaKind;
};

// 确保目录存在
async function ensureMediaDir(): Promise<void> {
  await fsp.mkdir(MEDIA_DIR, { recursive: true });
}

function resolvePublicRuntimeMediaDirs(): string[] {
  const dirs = new Set<string>();
  dirs.add(path.resolve(process.cwd(), 'public', 'runtime-media'));

  const cwd = path.resolve(process.cwd());
  if (cwd.endsWith(path.join('.next', 'standalone'))) {
    dirs.add(path.resolve(cwd, '..', '..', 'public', 'runtime-media'));
  } else {
    dirs.add(path.resolve(cwd, '.next', 'standalone', 'public', 'runtime-media'));
  }

  return Array.from(dirs);
}

async function ensurePublicRuntimeMediaDir(): Promise<void> {
  await Promise.all(
    resolvePublicRuntimeMediaDirs().map((dir) => fsp.mkdir(dir, { recursive: true }))
  );
}

function isExpiredTimestamp(timestampMs: number, now = Date.now()): boolean {
  return Number.isFinite(timestampMs) && timestampMs > 0 && now - timestampMs >= RUNTIME_MEDIA_RETENTION_MS;
}

function inferTimestampFromRuntimeMediaFilename(filename: string): number | null {
  const safeFilename = sanitizeFilename(filename);
  if (!safeFilename) return null;

  const epochMatch = safeFilename.match(/(?:^|[^0-9])(1\d{12})(?:[^0-9]|$)/);
  if (epochMatch) {
    const timestamp = Number(epochMatch[1]);
    if (Number.isFinite(timestamp) && timestamp > 946684800000 && timestamp < 4102444800000) {
      return timestamp;
    }
  }

  const compactDateMatch = safeFilename.match(/(?:^|[^0-9])((?:20\d{2})(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])(?:[01]\d|2[0-3])(?:[0-5]\d){2})(?:[^0-9]|$)/);
  if (compactDateMatch) {
    const raw = compactDateMatch[1];
    const parsed = Date.UTC(
      Number(raw.slice(0, 4)),
      Number(raw.slice(4, 6)) - 1,
      Number(raw.slice(6, 8)),
      Number(raw.slice(8, 10)),
      Number(raw.slice(10, 12)),
      Number(raw.slice(12, 14)),
    );
    if (Number.isFinite(parsed) && parsed > 946684800000 && parsed < 4102444800000) {
      return parsed;
    }
  }

  return null;
}

function resolveRuntimeMediaTimestamp(filename: string, statMtimeMs: number): number {
  return inferTimestampFromRuntimeMediaFilename(filename) ?? statMtimeMs;
}

async function deleteRuntimeMediaFilename(filename: string): Promise<void> {
  const safeFilename = sanitizeFilename(filename);
  if (!safeFilename) return;

  await Promise.allSettled(
    resolvePublicRuntimeMediaDirs().map(async (dir) => {
      const filepath = path.join(dir, safeFilename);
      try {
        await fsp.unlink(filepath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error;
        }
      }
    })
  );
}

export function extractRuntimeMediaFilenameFromUrl(
  input: string,
  origin?: string
): string | null {
  const value = String(input || '').trim();
  if (!value) return null;

  const relativeMatch = value.match(INTERNAL_RUNTIME_MEDIA_PATH_PATTERN);
  if (relativeMatch?.[1]) {
    return sanitizeRuntimeMediaFilename(decodeURIComponent(relativeMatch[1]));
  }

  try {
    const parsed = origin ? new URL(value, origin) : new URL(value);
    const absoluteMatch = parsed.pathname.match(INTERNAL_RUNTIME_MEDIA_PATH_PATTERN);
    if (!absoluteMatch?.[1]) return null;
    return sanitizeRuntimeMediaFilename(decodeURIComponent(absoluteMatch[1]));
  } catch {
    return null;
  }
}

export async function deletePublicRuntimeMediaByUrl(
  input: string,
  origin?: string
): Promise<boolean> {
  const filename = extractRuntimeMediaFilenameFromUrl(input, origin);
  if (!filename) return false;
  await deleteRuntimeMediaFilename(filename);
  return true;
}

async function cleanupExpiredRuntimeMediaFiles(force = false): Promise<void> {
  const now = Date.now();
  if (!force && now - lastRuntimeMediaCleanupAt < RUNTIME_MEDIA_CLEANUP_INTERVAL_MS) {
    return runtimeMediaCleanupPromise || Promise.resolve();
  }

  if (runtimeMediaCleanupPromise) {
    return runtimeMediaCleanupPromise;
  }

  runtimeMediaCleanupPromise = (async () => {
    lastRuntimeMediaCleanupAt = now;
    const seen = new Set<string>();
    for (const dir of resolvePublicRuntimeMediaDirs()) {
      let entries: fs.Dirent[];
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }

      for (const entry of entries) {
        if (!entry.isFile()) continue;
        if (seen.has(entry.name)) continue;
        seen.add(entry.name);

        const filepath = path.join(dir, entry.name);
        try {
          const stat = await fsp.stat(filepath);
          if (isExpiredTimestamp(resolveRuntimeMediaTimestamp(entry.name, stat.mtimeMs), now)) {
            await deleteRuntimeMediaFilename(entry.name);
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            console.warn('[MediaStorage] Runtime media cleanup failed:', error);
          }
        }
      }
    }
  })().finally(() => {
    runtimeMediaCleanupPromise = null;
  });

  return runtimeMediaCleanupPromise;
}

function ensureRuntimeMediaCleanupScheduler(): void {
  if (runtimeMediaCleanupTimer) return;

  runtimeMediaCleanupTimer = setInterval(() => {
    void cleanupExpiredRuntimeMediaFiles(true).catch((error) => {
      console.warn('[MediaStorage] Scheduled runtime media cleanup failed:', error);
    });
  }, RUNTIME_MEDIA_CLEANUP_INTERVAL_MS);

  runtimeMediaCleanupTimer.unref?.();

  void cleanupExpiredRuntimeMediaFiles().catch((error) => {
    console.warn('[MediaStorage] Initial runtime media cleanup failed:', error);
  });
}

export async function triggerRuntimeMediaCleanup(force = false): Promise<void> {
  ensureRuntimeMediaCleanupScheduler();
  await cleanupExpiredRuntimeMediaFiles(force);
}

export function getPublicRuntimeMediaDir(): string {
  return PUBLIC_RUNTIME_MEDIA_DIR;
}

// 从 data URL 中提取 mime 类型和数据
function parseDataUrl(dataUrl: string): { mimeType: string; data: string } | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return {
    mimeType: match[1],
    data: match[2],
  };
}

// 根据 mime 类型获取文件扩展名
function getExtension(mimeType: string): string {
  const map: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'video/webm': 'webm',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/ogg': 'ogg',
    'audio/webm': 'webm',
  };
  return map[mimeType] || 'bin';
}

function isRemoteUrl(value: string): boolean {
  return value.startsWith('http://') || value.startsWith('https://');
}

function sanitizeFilename(filename: string): string {
  const base = path.basename(filename || '');
  return base.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export function sanitizeRuntimeMediaFilename(filename: string): string {
  return sanitizeFilename(filename);
}

function normalizePublicBaseUrl(raw?: string): string | null {
  const value = String(raw || '').trim().replace(/\/+$/, '');
  if (!value || !/^https?:\/\//i.test(value)) return null;

  try {
    const parsed = new URL(value);
    const hostname = parsed.hostname.toLowerCase();
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname === '0.0.0.0'
    ) {
      return null;
    }
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

function filenameFromUrl(id: string, mediaUrl: string, mimeType: string): string {
  try {
    const parsed = new URL(mediaUrl);
    const basename = path.basename(parsed.pathname);
    if (basename && basename !== '/' && /\.[a-z0-9]{2,5}$/i.test(basename)) {
      return `${id}-${basename}`;
    }
  } catch {
    // ignore
  }
  return `${id}.${getExtension(mimeType)}`;
}

async function downloadRemoteMedia(mediaUrl: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const response = await fetchWithRetry(fetch, mediaUrl, () => ({
    method: 'GET',
    headers: {
      Accept: 'image/*,video/*,audio/*,*/*',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
  }), {
    attempts: 4,
    baseDelayMs: 500,
    maxDelayMs: 6000,
  });

  if (!response.ok) {
    const details = await response.text().catch(() => '');
    throw new Error(`remote media download failed (${response.status})${details ? `: ${details.slice(0, 200)}` : ''}`);
  }

  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > MAX_REMOTE_MEDIA_BYTES) {
    throw new Error(`remote media exceeds cache limit: ${contentLength} bytes`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  if (buffer.length > MAX_REMOTE_MEDIA_BYTES) {
    throw new Error(`remote media exceeds cache limit: ${buffer.length} bytes`);
  }

  const mimeType = response.headers.get('content-type')?.split(';')[0]?.trim() || 'application/octet-stream';
  return { buffer, mimeType };
}

/**
 * 保存 base64 数据为文件（async version，不支持 PicUI）
 * @param id 唯一标识符（通常是 generation ID）
 * @param dataUrl base64 data URL
 * @returns 文件的相对路径（用于存储到数据库）或原始 data URL（如果禁用文件存储）
 */
export async function saveMediaToFile(id: string, dataUrl: string): Promise<string> {
  // 如果不是 data URL，直接返回（可能是外部 URL）
  if (!dataUrl.startsWith('data:')) {
    return dataUrl;
  }

  // 检查是否启用文件存储（默认启用）
  const useFileStorage = process.env.MEDIA_FILE_STORAGE !== 'false';
  if (!useFileStorage) {
    return dataUrl;
  }

  const parsed = parseDataUrl(dataUrl);
  if (!parsed) {
    console.warn('[MediaStorage] Invalid data URL format, keeping as-is');
    return dataUrl;
  }

  try {
    await ensureMediaDir();

    const ext = getExtension(parsed.mimeType);
    const filename = `${id}.${ext}`;
    const filepath = path.join(MEDIA_DIR, filename);

    // 将 base64 转换为 Buffer 并写入文件
    const buffer = Buffer.from(parsed.data, 'base64');
    await fsp.writeFile(filepath, buffer);

    console.log(`[MediaStorage] Saved: ${filename} (${(buffer.length / 1024).toFixed(1)} KB)`);

    // 返回文件标识符（前缀 file: 表示本地文件）
    return `file:${filename}`;
  } catch (error) {
    console.error('[MediaStorage] Failed to save file:', error);
    // 失败时返回原始 data URL
    return dataUrl;
  }
}

/**
 * 保存媒体文件（异步版本，优先上传到默认图片桶）
 * @param id 唯一标识符（通常是 generation ID）
 * @param dataUrl base64 data URL
 * @returns 图床 URL、本地文件路径或原始 data URL
 */
export async function saveMediaAsync(
  id: string,
  dataUrl: string,
  options: SaveMediaOptions = {}
): Promise<string> {
  return (await saveMediaAsset(id, dataUrl, options)).url;
}

export async function saveMediaAsset(
  id: string,
  dataUrl: string,
  options: SaveMediaOptions = {}
): Promise<SavedMediaAsset> {
  const storageMode = options.storageMode || 'auto';
  const runtimeOnly = storageMode === 'runtime';
  const configuredBucket = await resolveDefaultImageBucket();

  if (isRemoteUrl(dataUrl)) {
    try {
      const remote = await downloadRemoteMedia(dataUrl);
      const filename = options.filename || filenameFromUrl(id, dataUrl, remote.mimeType);
      const kind = inferMediaKindFromMimeType(remote.mimeType);

      if (!runtimeOnly && configuredBucket) {
        try {
          const uploadedUrl = await uploadBufferToImageBucket(
            remote.buffer,
            remote.mimeType,
            filename,
            { publicBaseUrl: options.publicBaseUrl }
          );
          if (uploadedUrl) {
            console.log(`[MediaStorage] Cached remote media to bucket: ${uploadedUrl}`);
            return {
              url: uploadedUrl,
              mimeType: remote.mimeType,
              kind,
            };
          }
        } catch (bucketError) {
          console.warn('[MediaStorage] Remote bucket cache failed, falling back to local runtime media:', bucketError);
        }
      }

      const runtimeUrl = await saveBufferToPublicFile(id, remote.buffer, remote.mimeType, {
        ...options,
        filename,
      });
      if (runtimeUrl) {
        console.log(`[MediaStorage] Cached remote media to runtime media: ${runtimeUrl}`);
        return {
          url: runtimeUrl,
          mimeType: remote.mimeType,
          kind,
        };
      }
    } catch (error) {
      console.warn('[MediaStorage] Remote media cache failed, keeping original URL:', error);
    }

    return {
      url: dataUrl,
      kind: inferMediaKindFromUrl(dataUrl),
    };
  }

  // 如果不是 data URL，直接返回（可能是其他外部标识）
  if (!dataUrl.startsWith('data:')) {
    return {
      url: dataUrl,
      kind: inferMediaKindFromUrl(dataUrl),
    };
  }

  const parsed = parseDataUrl(dataUrl);
  const mimeType = parsed?.mimeType || 'application/octet-stream';
  const kind = inferMediaKindFromMimeType(mimeType);

  // 优先尝试上传到默认图片桶
  if (!runtimeOnly && configuredBucket) {
    try {
      const filename = options.filename || `${id}.${getExtension(mimeType)}`;
      const picuiUrl = await uploadToPicUI(dataUrl, filename, { publicBaseUrl: options.publicBaseUrl });
      if (picuiUrl) {
        console.log(`[MediaStorage] Uploaded to remote bucket: ${picuiUrl}`);
        return {
          url: picuiUrl,
          mimeType,
          kind,
        };
      }
    } catch (error) {
      console.warn('[MediaStorage] Remote upload failed, falling back to local runtime media:', error);
    }

    const runtimeUrl = await saveMediaToPublicFile(id, dataUrl, options);
    if (runtimeUrl) {
      console.log(`[MediaStorage] Saved media to runtime media: ${runtimeUrl}`);
      return {
        url: runtimeUrl,
        mimeType,
        kind,
      };
    }

    return {
      url: dataUrl,
      mimeType,
      kind,
    };
  }

  const runtimeUrl = await saveMediaToPublicFile(id, dataUrl, options);
  if (runtimeUrl) {
    console.log(`[MediaStorage] Saved media to runtime media: ${runtimeUrl}`);
    return {
      url: runtimeUrl,
      mimeType,
      kind,
    };
  }

  // 回退到本地文件存储
  return {
    url: await saveMediaToFile(id, dataUrl),
    mimeType,
    kind,
  };
}

export async function saveBufferToPublicFile(
  id: string,
  buffer: Buffer,
  mimeType: string,
  options: SaveMediaOptions = {}
): Promise<string | null> {
  ensureRuntimeMediaCleanupScheduler();
  const publicBaseUrl =
    normalizePublicBaseUrl(options.publicBaseUrl)
    || normalizePublicBaseUrl(
      process.env.SANHUB_PUBLIC_BASE_URL || process.env.NEXTAUTH_URL || process.env.APP_URL || process.env.PUBLIC_BASE_URL
    );
  if (!publicBaseUrl) {
    return null;
  }

  await ensurePublicRuntimeMediaDir();
  await cleanupExpiredRuntimeMediaFiles();

  const normalizedMimeType = mimeType.split(';')[0]?.trim().toLowerCase() || 'application/octet-stream';
  const fallbackFilename = `${id}.${getExtension(normalizedMimeType)}`;
  const filename = sanitizeFilename(options.filename || fallbackFilename);
  const filenameWithExtension = /\.[a-z0-9]{2,5}$/i.test(filename)
    ? filename
    : `${filename}.${getExtension(normalizedMimeType)}`;
  const runtimeDirs = resolvePublicRuntimeMediaDirs();
  await Promise.all(
    runtimeDirs.map((dir) => fsp.writeFile(path.join(dir, filenameWithExtension), buffer))
  );

  return `${publicBaseUrl}/api/runtime-media/${encodeURIComponent(filenameWithExtension)}`;
}

export async function saveMediaToPublicFile(
  id: string,
  input: string,
  options: SaveMediaOptions = {}
): Promise<string | null> {
  let buffer: Buffer;
  let mimeType: string;

  if (isRemoteUrl(input)) {
    const remote = await downloadRemoteMedia(input);
    buffer = remote.buffer;
    mimeType = remote.mimeType;
  } else {
    const parsed = parseDataUrl(input);
    if (!parsed) {
      return null;
    }
    buffer = Buffer.from(parsed.data, 'base64');
    mimeType = parsed.mimeType;
  }

  return saveBufferToPublicFile(id, buffer, mimeType, options);
}

export async function readPublicRuntimeMediaFile(
  filename: string
): Promise<{ buffer: Buffer; mimeType: string; filename: string } | null> {
  ensureRuntimeMediaCleanupScheduler();
  try {
    const safeFilename = sanitizeFilename(filename);
    if (!safeFilename) {
      return null;
    }

    let buffer: Buffer | null = null;
    for (const dir of resolvePublicRuntimeMediaDirs()) {
        const filepath = path.join(dir, safeFilename);
        try {
          const stat = await fsp.stat(filepath);
          if (isExpiredTimestamp(resolveRuntimeMediaTimestamp(safeFilename, stat.mtimeMs))) {
            await deleteRuntimeMediaFilename(safeFilename);
            return null;
          }
        buffer = await fsp.readFile(filepath);
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error;
        }
      }
    }

    if (!buffer) {
      return null;
    }

    const ext = path.extname(safeFilename).slice(1).toLowerCase();

    const mimeTypes: Record<string, string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      mp4: 'video/mp4',
      webm: 'video/webm',
      mov: 'video/quicktime',
      mp3: 'audio/mpeg',
      wav: 'audio/wav',
      ogg: 'audio/ogg',
      txt: 'text/plain; charset=utf-8',
    };

    return {
      buffer,
      mimeType: mimeTypes[ext] || 'application/octet-stream',
      filename: safeFilename,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    console.error('[MediaStorage] Failed to read runtime media file:', error);
    return null;
  }
}

/**
 * 读取媒体文件
 * @param identifier 文件标识符（file:xxx.png 格式）或完整路径
 * @returns { buffer, mimeType } 或 null
 */
export async function readMediaFile(
  identifier: string
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  try {
    let filename: string;

    if (identifier.startsWith('file:')) {
      filename = identifier.slice(5);
    } else {
      // 可能是完整路径或其他格式
      filename = path.basename(identifier);
    }

    const filepath = path.join(MEDIA_DIR, filename);

    const buffer = await fsp.readFile(filepath);
    const ext = path.extname(filename).slice(1).toLowerCase();

    const mimeTypes: Record<string, string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      mp4: 'video/mp4',
      webm: 'video/webm',
      mp3: 'audio/mpeg',
      wav: 'audio/wav',
      ogg: 'audio/ogg',
    };

    const mimeType = mimeTypes[ext] || 'application/octet-stream';

    return { buffer, mimeType };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    console.error('[MediaStorage] Failed to read file:', error);
    return null;
  }
}

/**
 * 删除媒体文件
 * @param identifier 文件标识符
 */
export function deleteMediaFile(identifier: string): boolean {
  try {
    if (!identifier.startsWith('file:')) {
      return false;
    }

    const filename = identifier.slice(5);
    const filepath = path.join(MEDIA_DIR, filename);

    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath);
      console.log(`[MediaStorage] Deleted: ${filename}`);
      return true;
    }

    return false;
  } catch (error) {
    console.error('[MediaStorage] Failed to delete file:', error);
    return false;
  }
}

/**
 * 检查标识符是否为本地文件
 */
export function isLocalFile(identifier: string): boolean {
  return identifier.startsWith('file:');
}
