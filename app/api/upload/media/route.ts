/* eslint-disable no-console */
import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getBaseUrlFromRequest } from '@/lib/epay';
import { saveBufferToPublicFile, saveMediaToPublicFile } from '@/lib/media-storage';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DEFAULT_MAX_UPLOAD_BYTES = 80 * 1024 * 1024;
const MAX_UPLOAD_BYTES = Math.max(
  1024 * 1024,
  Number(process.env.PUBLIC_MEDIA_UPLOAD_MAX_BYTES) || DEFAULT_MAX_UPLOAD_BYTES
);

const ALLOWED_MIME_PREFIXES = ['image/', 'video/', 'audio/'];

type UploadResponse = {
  success: boolean;
  data?: {
    url: string;
    name: string;
    mimeType: string;
    size: number;
  };
  error?: string;
};

function json(payload: UploadResponse, status = 200) {
  return NextResponse.json(payload, { status });
}

function normalizeFilename(name: string): string {
  const cleaned = String(name || '')
    .trim()
    .replace(/\\/g, '/')
    .split('/')
    .pop()
    ?.replace(/[^a-zA-Z0-9._-]/g, '_') || '';
  return cleaned || `media-${Date.now()}`;
}

function isAllowedMime(mimeType: string): boolean {
  const normalized = String(mimeType || '').toLowerCase();
  return ALLOWED_MIME_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function buildStoredFilename(userId: string, filename: string): string {
  const safe = normalizeFilename(filename);
  return `upload-${userId.slice(0, 8)}-${Date.now()}-${randomUUID()}-${safe}`;
}

async function handleMultipartUpload(request: NextRequest, userId: string) {
  const form = await request.formData();
  const file = form.get('file');

  if (!file || typeof file !== 'object' || !('arrayBuffer' in file)) {
    return json({ success: false, error: '请选择要上传的媒体文件' }, 400);
  }

  const uploadFile = file as File;
  const mimeType = uploadFile.type || 'application/octet-stream';
  if (!isAllowedMime(mimeType)) {
    return json({ success: false, error: '仅支持图片、视频或音频素材上传' }, 400);
  }

  if (uploadFile.size > MAX_UPLOAD_BYTES) {
    return json({ success: false, error: `文件过大，最大支持 ${(MAX_UPLOAD_BYTES / 1024 / 1024).toFixed(0)}MB` }, 413);
  }

  const buffer = Buffer.from(await uploadFile.arrayBuffer());
  const publicBaseUrl = getBaseUrlFromRequest(request);
  const storedFilename = buildStoredFilename(userId, uploadFile.name || 'media');
  const url = await saveBufferToPublicFile(storedFilename, buffer, mimeType, {
    publicBaseUrl,
    filename: storedFilename,
  });

  if (!url) {
    return json({
      success: false,
      error: '当前访问地址无法生成公网 URL，请使用服务器公网 IP/域名访问站点后再上传素材',
    }, 400);
  }

  return json({
    success: true,
    data: {
      url,
      name: uploadFile.name || storedFilename,
      mimeType,
      size: buffer.length,
    },
  });
}

async function handleJsonUpload(request: NextRequest, userId: string) {
  const body = await request.json().catch(() => ({})) as {
    data?: string;
    mimeType?: string;
    filename?: string;
  };
  const data = String(body.data || '').trim();
  const mimeType = String(body.mimeType || '').trim() || 'application/octet-stream';
  const filename = buildStoredFilename(userId, body.filename || 'media');

  if (!data) {
    return json({ success: false, error: '缺少上传数据' }, 400);
  }
  if (!isAllowedMime(mimeType) && !data.startsWith('data:image/') && !data.startsWith('data:video/') && !data.startsWith('data:audio/')) {
    return json({ success: false, error: '仅支持图片、视频或音频素材上传' }, 400);
  }
  if (data.length > MAX_UPLOAD_BYTES * 1.5) {
    return json({ success: false, error: `文件过大，最大支持 ${(MAX_UPLOAD_BYTES / 1024 / 1024).toFixed(0)}MB` }, 413);
  }

  const publicBaseUrl = getBaseUrlFromRequest(request);
  const url = await saveMediaToPublicFile(filename, data, {
    publicBaseUrl,
    filename,
  });

  if (!url) {
    return json({
      success: false,
      error: '当前访问地址无法生成公网 URL，请使用服务器公网 IP/域名访问站点后再上传素材',
    }, 400);
  }

  return json({
    success: true,
    data: {
      url,
      name: body.filename || filename,
      mimeType,
      size: 0,
    },
  });
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return json({ success: false, error: '请先登录' }, 401);
    }

    const contentType = request.headers.get('content-type') || '';
    if (contentType.includes('multipart/form-data')) {
      return await handleMultipartUpload(request, session.user.id);
    }
    if (contentType.includes('application/json')) {
      return await handleJsonUpload(request, session.user.id);
    }

    return json({ success: false, error: '不支持的上传格式' }, 415);
  } catch (error) {
    console.error('[UploadMedia] failed:', error);
    return json({
      success: false,
      error: error instanceof Error ? error.message : '上传失败',
    }, 500);
  }
}
