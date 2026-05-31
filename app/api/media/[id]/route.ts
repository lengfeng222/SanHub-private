/* eslint-disable no-console */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getGeneration, updateGeneration } from '@/lib/db';
import {
  readMediaFile,
  isLocalFile,
  readPublicRuntimeMediaFile,
  saveMediaToPublicFile,
  sanitizeRuntimeMediaFilename,
  RUNTIME_MEDIA_RETENTION_MS,
} from '@/lib/media-storage';
import { getVideoContentUrl } from '@/lib/sora-api';
import { resolveAndValidateUrl } from '@/lib/safe-fetch';
import type { Generation } from '@/types';

const MEDIA_CACHE_CONTROL = 'private, max-age=31536000, immutable';
const RUNTIME_MEDIA_CACHE_CONTROL = 'private, max-age=86400, immutable';
const MEDIA_REDIRECT_CACHE_CONTROL = 'private, max-age=3600';
const INTERNAL_RUNTIME_MEDIA_PATH_PATTERN = /^\/api\/runtime-media\/([^/?#]+)/i;

// 媒体文件服务端点
// 支持多种存储方式：
// 1. 本地文件 (file:xxx.png)
// 2. 外部 URL (http/https)
// 3. Base64 data URL (data:image/png;base64,xxx)
// 4. Sora /content 端点 (需要 API Key 认证)

function extractRuntimeMediaFilename(input: string, origin: string): string | null {
  const relativeMatch = input.match(INTERNAL_RUNTIME_MEDIA_PATH_PATTERN);
  if (relativeMatch?.[1]) {
    return sanitizeRuntimeMediaFilename(decodeURIComponent(relativeMatch[1]));
  }

  try {
    const parsed = new URL(input, origin);
    const absoluteMatch = parsed.pathname.match(INTERNAL_RUNTIME_MEDIA_PATH_PATTERN);
    if (!absoluteMatch?.[1]) return null;
    return sanitizeRuntimeMediaFilename(decodeURIComponent(absoluteMatch[1]));
  } catch {
    return null;
  }
}

function isExternalMediaUrl(value: string): boolean {
  return /^https?:\/\//i.test(String(value || '').trim());
}

function resolveGenerationMediaTimestamp(generation: Generation): number {
  const candidates = [
    Number(generation.params?.runtimeMediaOriginTimestamp ?? 0),
    Number(generation.params?.upstreamUpdatedAt ?? 0),
    Number(generation.updatedAt ?? 0),
    Number(generation.createdAt ?? 0),
  ];

  for (const value of candidates) {
    if (Number.isFinite(value) && value > 0) {
      return value;
    }
  }

  return Date.now();
}

function isGenerationMediaExpired(generation: Generation, now = Date.now()): boolean {
  return now - resolveGenerationMediaTimestamp(generation) >= RUNTIME_MEDIA_RETENTION_MS;
}

function formatCompactUtcTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
  ].join('');
}

function buildRuntimeMediaCacheFilename(generation: Generation, sourceUrl: string): string {
  const compactTimestamp = formatCompactUtcTimestamp(resolveGenerationMediaTimestamp(generation));

  try {
    const parsed = new URL(sourceUrl);
    const basename = parsed.pathname.split('/').pop()?.trim();
    if (basename) {
      const safeBasename = sanitizeRuntimeMediaFilename(decodeURIComponent(basename));
      if (safeBasename) {
        return `${generation.id}-${compactTimestamp}-${safeBasename}`;
      }
    }
  } catch {
    // ignore
  }

  return `${generation.id}-${compactTimestamp}`;
}

async function cacheGenerationResultToRuntimeMedia(
  generation: Generation,
  sourceUrl: string,
  origin: string
): Promise<string | null> {
  if (!isExternalMediaUrl(sourceUrl)) {
    return null;
  }

  if (extractRuntimeMediaFilename(sourceUrl, origin)) {
    return sourceUrl;
  }

  if (isGenerationMediaExpired(generation)) {
    return null;
  }

  let safeUrl: URL;
  try {
    safeUrl = await resolveAndValidateUrl(sourceUrl, { origin });
  } catch (error) {
    console.error('[Media API] Blocked runtime cache source URL:', error);
    return null;
  }

  let cacheSourceUrl = safeUrl.toString();
  if (generation.type.includes('video')) {
    try {
      const { applyVideoProxy } = await import('@/lib/sora-api');
      cacheSourceUrl = await applyVideoProxy(cacheSourceUrl);
    } catch {
      cacheSourceUrl = safeUrl.toString();
    }
  }

  let cachedUrl: string | null = null;
  try {
    cachedUrl = await saveMediaToPublicFile(generation.id, cacheSourceUrl, {
      publicBaseUrl: origin,
      filename: buildRuntimeMediaCacheFilename(generation, sourceUrl),
    });
  } catch (error) {
    console.error('[Media API] Runtime cache write failed:', error);
    return null;
  }

  if (!cachedUrl) {
    return null;
  }

  try {
    const nextParams: Record<string, unknown> = {
      ...(generation.params || {}),
      upstreamResultUrl:
        typeof generation.params?.upstreamResultUrl === 'string' &&
        generation.params.upstreamResultUrl.trim()
          ? generation.params.upstreamResultUrl.trim()
          : sourceUrl,
      runtimeMediaCachedAt: Date.now(),
      runtimeMediaCachedFrom: sourceUrl,
      runtimeMediaOriginTimestamp: resolveGenerationMediaTimestamp(generation),
    };

    await updateGeneration(generation.id, {
      resultUrl: cachedUrl,
      params: nextParams,
    });
  } catch (error) {
    console.error('[Media API] Failed to persist runtime cache URL:', error);
  }

  return cachedUrl;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return new NextResponse('Unauthorized', { status: 401 });
    }

    const { id } = await params;
    
    const generation = await getGeneration(id);
    
    if (!generation) {
      return new NextResponse('Not Found', { status: 404 });
    }

    const isOwner = generation.userId === session.user.id;
    const isAdmin = session.user.role === 'admin' || session.user.role === 'moderator';
    if (!isOwner && !isAdmin) {
      return new NextResponse('Forbidden', { status: 403 });
    }
    
    let resultUrl = generation.resultUrl || '';
    const upstreamResultUrl =
      typeof generation.params?.upstreamResultUrl === 'string'
        ? generation.params.upstreamResultUrl.trim()
        : '';
    const videoId = typeof generation.params?.videoId === 'string' ? generation.params.videoId : undefined;
    const videoChannelId =
      typeof generation.params?.videoChannelId === 'string' ? generation.params.videoChannelId : undefined;

    if (!resultUrl && upstreamResultUrl) {
      resultUrl = upstreamResultUrl;
    }

    if (videoId) {
      try {
        const actualUrl = await getVideoContentUrl(videoId, videoChannelId);
        console.log('[Media API] Sora content URL resolved by videoId:', actualUrl?.substring(0, 80));
        if (actualUrl) {
          resultUrl = actualUrl;
        }
      } catch (error) {
        console.error('[Media API] Failed to resolve videoId content URL:', error);
      }
    }

    if (!resultUrl) {
      return new NextResponse('No Content', { status: 204 });
    }

    const shouldDownload = request.nextUrl.searchParams.get('download') === '1';
    const shouldOpen = request.nextUrl.searchParams.get('open') === '1';
    const origin = new URL(request.url).origin;

    const runtimeMediaFilename = extractRuntimeMediaFilename(resultUrl, origin);
    if (runtimeMediaFilename) {
      const runtimeFile = await readPublicRuntimeMediaFile(runtimeMediaFilename);
      if (runtimeFile) {
        return createMediaResponse(
          request,
          runtimeFile.buffer,
          runtimeFile.mimeType,
          runtimeFile.filename,
          shouldDownload,
          RUNTIME_MEDIA_CACHE_CONTROL
        );
      }

      const storedAgeMs = Date.now() - resolveGenerationMediaTimestamp(generation);
      if (
        upstreamResultUrl &&
        upstreamResultUrl !== resultUrl &&
        Number.isFinite(storedAgeMs) &&
        storedAgeMs >= 0 &&
        storedAgeMs < RUNTIME_MEDIA_RETENTION_MS
      ) {
        resultUrl = upstreamResultUrl;
      } else {
        return new NextResponse('Media expired or missing', { status: 410 });
      }
    }

    // 检查是否是 Sora /content 端点 URL（需要 API Key 认证）
    if (resultUrl.includes('/v1/videos/') && resultUrl.includes('/content')) {
      // 从 URL 中提取 video ID
      const match = resultUrl.match(/\/v1\/videos\/([^/]+)\/content/);
      if (match) {
        const videoId = match[1];
        try {
          // 通过 API Key 获取实际的视频 URL
          const actualUrl = await getVideoContentUrl(videoId, videoChannelId);
          console.log('[Media API] Sora content URL resolved:', actualUrl?.substring(0, 80));
          resultUrl = actualUrl;
        } catch (error) {
          console.error('[Media API] Failed to get Sora content URL:', error);
          return new NextResponse('Failed to get video URL', { status: 502 });
        }
      }
    }

    // 1. 本地文件存储 (file:xxx.png)
    if (isLocalFile(resultUrl)) {
      const file = await readMediaFile(resultUrl);
      if (!file) {
        return new NextResponse('File not found', { status: 404 });
      }
      return createMediaResponse(request, file.buffer, file.mimeType, id, shouldDownload);
    }
    
    // 2. 外部 URL，下载时走服务端代理，预览时重定向
    if (resultUrl.startsWith('http://') || resultUrl.startsWith('https://')) {
      const cachedUrl = await cacheGenerationResultToRuntimeMedia(generation, resultUrl, origin);
      if (cachedUrl) {
        const cachedFilename = extractRuntimeMediaFilename(cachedUrl, origin);
        if (cachedFilename) {
          const cachedFile = await readPublicRuntimeMediaFile(cachedFilename);
          if (cachedFile) {
            return createMediaResponse(
              request,
              cachedFile.buffer,
              cachedFile.mimeType,
              cachedFile.filename,
              shouldDownload,
              RUNTIME_MEDIA_CACHE_CONTROL
            );
          }
        }

        resultUrl = cachedUrl;
      }

      if (isGenerationMediaExpired(generation)) {
        return new NextResponse('Media expired or missing', { status: 410 });
      }

      let safeUrl: URL;
      try {
        safeUrl = await resolveAndValidateUrl(resultUrl, { origin });
      } catch (error) {
        console.error('[Media API] Blocked external URL:', error);
        return new NextResponse('Invalid media URL', { status: 400 });
      }

      let finalUrl = safeUrl.toString();
      if (generation.type.includes('video')) {
        try {
          const { applyVideoProxy } = await import('@/lib/sora-api');
          finalUrl = await applyVideoProxy(safeUrl.toString());
        } catch {
          finalUrl = safeUrl.toString();
        }
      }

      if (shouldDownload) {
        try {
          const upstream = await fetch(finalUrl, {
            redirect: 'follow',
            cache: 'no-store',
          });
          if (!upstream.ok) {
            throw new Error(`Upstream download failed with status ${upstream.status}`);
          }
          const contentType = upstream.headers.get('content-type')?.split(';')[0] || 'application/octet-stream';
          const buffer = Buffer.from(await upstream.arrayBuffer());
          return createMediaResponse(request, buffer, contentType, id, true);
        } catch (error) {
          console.error('[Media API] Proxy download failed:', error);
          return createRedirectResponse(finalUrl, true, shouldOpen);
        }
      }

      return createRedirectResponse(finalUrl, false, shouldOpen);
    }
    
    // 3. Base64 data URL
    const match = resultUrl.match(/^data:([^;]+);base64,(.+)$/);
    
    if (!match) {
      return new NextResponse('Invalid media format', { status: 400 });
    }
    
    const mimeType = match[1];
    const base64Data = match[2];
    const buffer = Buffer.from(base64Data, 'base64');
    
    return createMediaResponse(request, buffer, mimeType, id, shouldDownload);
  } catch (error) {
    console.error('[Media API] Error:', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}

function createRedirectResponse(url: string, download = false, open = false): NextResponse {
  const response = NextResponse.redirect(url, 302);
  response.headers.set('Cache-Control', MEDIA_REDIRECT_CACHE_CONTROL);
  response.headers.set('Vary', 'Cookie');
  if (download && !open) {
    response.headers.set('Content-Disposition', 'attachment');
  }
  return response;
}

function buildMediaETag(cacheKey: string, contentLength: number, contentType: string): string {
  return `"${encodeURIComponent(cacheKey)}-${contentLength}-${encodeURIComponent(contentType)}"`;
}

function requestMatchesETag(request: NextRequest, etag: string): boolean {
  const value = request.headers.get('if-none-match');
  if (!value) return false;

  return value
    .split(',')
    .some((candidate) => candidate.trim() === etag || candidate.trim() === '*');
}

// 创建媒体响应
function createMediaResponse(
  request: NextRequest,
  buffer: Buffer,
  contentType: string,
  cacheKey: string,
  download = false,
  cacheControl = MEDIA_CACHE_CONTROL
): NextResponse {
  const etag = buildMediaETag(cacheKey, buffer.length, contentType);

  const headers: HeadersInit = {
    'Content-Type': contentType,
    'Cache-Control': cacheControl,
    ETag: etag,
    'X-Content-Type-Options': 'nosniff',
    'Vary': 'Cookie',
  };

  if (download) {
    const extension = (() => {
      if (contentType.includes('png')) return 'png';
      if (contentType.includes('jpeg')) return 'jpg';
      if (contentType.includes('webp')) return 'webp';
      if (contentType.includes('mp4')) return 'mp4';
      if (contentType.includes('webm')) return 'webm';
      if (contentType.includes('quicktime')) return 'mov';
      if (contentType.includes('mpeg')) return 'mp3';
      if (contentType.includes('wav')) return 'wav';
      if (contentType.includes('ogg')) return 'ogg';
      return 'bin';
    })();
    headers['Content-Disposition'] = `attachment; filename=\"${cacheKey}.${extension}\"`;
  }

  if (requestMatchesETag(request, etag)) {
    return new NextResponse(null, {
      status: 304,
      headers,
    });
  }
  
  // 转换为 Uint8Array 以兼容 NextResponse
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      ...headers,
      'Content-Length': buffer.length.toString(),
    },
  });
}
