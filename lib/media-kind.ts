export type MediaKind = 'image' | 'video' | 'audio' | 'unknown';

const IMAGE_EXTENSION_PATTERN = /\.(jpg|jpeg|png|webp|gif|bmp|svg|avif)(\?|#|$)/i;
const VIDEO_EXTENSION_PATTERN = /\.(mp4|mov|webm|mkv|m4v|avi|m3u8)(\?|#|$)/i;
const AUDIO_EXTENSION_PATTERN = /\.(mp3|wav|ogg|m4a|aac|flac|opus)(\?|#|$)/i;

function normalizeString(value: unknown): string {
  return String(value || '').trim();
}

export function inferMediaKindFromMimeType(value?: string | null): MediaKind {
  const mimeType = normalizeString(value).toLowerCase();
  if (!mimeType) return 'unknown';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'unknown';
}

function inferMediaKindFromPath(value: string): MediaKind {
  const normalized = value.toLowerCase();
  if (VIDEO_EXTENSION_PATTERN.test(normalized)) return 'video';
  if (IMAGE_EXTENSION_PATTERN.test(normalized)) return 'image';
  if (AUDIO_EXTENSION_PATTERN.test(normalized)) return 'audio';
  return 'unknown';
}

export function inferMediaKindFromUrl(value?: string | null): MediaKind {
  const raw = normalizeString(value);
  if (!raw) return 'unknown';

  if (raw.startsWith('data:')) {
    const mimeType = raw.slice(5).split(';', 1)[0];
    return inferMediaKindFromMimeType(mimeType);
  }

  const directPathKind = inferMediaKindFromPath(raw);
  if (directPathKind !== 'unknown') return directPathKind;

  try {
    const parsed = new URL(raw, 'https://placeholder.local');
    const pathnameKind = inferMediaKindFromPath(parsed.pathname);
    if (pathnameKind !== 'unknown') return pathnameKind;
  } catch {
    return 'unknown';
  }

  return 'unknown';
}

export function getMediaKindLabel(kind: MediaKind): string {
  switch (kind) {
    case 'image':
      return '图片';
    case 'video':
      return '视频';
    case 'audio':
      return '音频';
    default:
      return '媒体';
  }
}

type GenerationLike = {
  type?: string | null;
  resultUrl?: string | null;
  params?: unknown;
};

function inferMediaKindFromGenerationType(type?: string | null): MediaKind {
  const normalized = normalizeString(type).toLowerCase();
  if (!normalized) return 'unknown';
  if (normalized.includes('video')) return 'video';
  if (normalized.includes('image')) return 'image';
  if (normalized === 'music' || normalized === 'voice' || normalized.includes('audio')) return 'audio';
  return 'unknown';
}

export function inferDisplayMediaKind(input: GenerationLike): MediaKind {
  const resultKind = inferMediaKindFromUrl(input.resultUrl);
  if (resultKind !== 'unknown') return resultKind;

  const params =
    input.params && typeof input.params === 'object' && !Array.isArray(input.params)
      ? (input.params as Record<string, unknown>)
      : null;
  const upstreamResultUrl =
    params && typeof params.upstreamResultUrl === 'string'
      ? params.upstreamResultUrl
      : '';
  const upstreamKind = inferMediaKindFromUrl(upstreamResultUrl);
  if (upstreamKind !== 'unknown') return upstreamKind;

  return inferMediaKindFromGenerationType(input.type);
}
