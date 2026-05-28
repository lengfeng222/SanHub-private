/* eslint-disable no-console */
import { randomUUID } from 'crypto';
import { fetch as undiciFetch } from 'undici';
import { getSystemConfig, getVideoModelWithChannel } from './db';
import type { SoraGenerateRequest, GenerateResult, VideoChannel, VideoModel } from '@/types';
import { generateVideo, type VideoGenerationRequest } from './sora-api';
import { fetchWithRetry } from './http-retry';
import { resolveFlowVeoModel } from './video-model-normalizer';
import { saveMediaToPublicFile } from './media-storage';

type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';
type GenerationProgressMeta = Record<string, unknown>;
type GenerationProgressCallback = (progress: number, meta?: GenerationProgressMeta) => void | Promise<void>;

export type LingkeMediaVideoTaskSnapshot = {
  taskId: string;
  code: number;
  status: string;
  state: 'pending' | 'processing' | 'completed' | 'failed' | '';
  statusGroup: 'pending' | 'processing' | 'completed' | 'failed' | 'timeout';
  progress: number;
  message?: string;
  resultUrl?: string;
  final: boolean;
  raw: unknown;
};

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 50,
};

const SORA_LOG_LEVEL: LogLevel = (() => {
  const raw = (process.env.SORA_LOG_LEVEL || '').toLowerCase();
  if (raw in LOG_LEVELS) return raw as LogLevel;
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug';
})();

const shouldLog = (level: LogLevel) => LOG_LEVELS[level] >= LOG_LEVELS[SORA_LOG_LEVEL];

const logDebug = (...args: unknown[]) => {
  if (shouldLog('debug')) console.log(...args);
};
const logInfo = (...args: unknown[]) => {
  if (shouldLog('info')) console.log(...args);
};
const logWarn = (...args: unknown[]) => {
  if (shouldLog('warn')) console.warn(...args);
};
const logError = (...args: unknown[]) => {
  if (shouldLog('error')) console.error(...args);
};

type ExternalVideoPayload = {
  prompt: string;
  model: string;
  files: { mimeType: string; data: string }[];
};

type ExternalChatChoice = {
  message?: {
    content?: unknown;
  };
  delta?: {
    content?: unknown;
    reasoning_content?: unknown;
  };
};

type ExternalChatResponse = {
  choices?: ExternalChatChoice[];
  error?: {
    message?: string;
    detail?: string;
  } | string;
  detail?: string;
};

const VIDEO_URL_PATTERN = /\.(mp4|mov|webm|mkv|m3u8)(\?|#|$)/i;
const IMAGE_URL_PATTERN = /\.(jpg|jpeg|png|webp|gif|bmp|svg)(\?|#|$)/i;
const GROK_MAX_VIDEO_LENGTH_SECONDS = 30;
const LINGKE_MEDIA_POLL_INTERVAL_MS = 3000;
const LINGKE_MEDIA_MAX_POLLS = 600;

function stripDataUrlPrefix(input: string): string {
  return String(input || '').replace(/^data:[^;]+;base64,/, '');
}

function normalizeExtractedUrl(raw: string, baseUrl?: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const cleaned = trimmed.replace(/^['"(<\[]+|[>'")\],.]+$/g, '');
  if (!cleaned) return null;
  if (/^https?:\/\//i.test(cleaned)) return cleaned;

  if (baseUrl) {
    const canResolveRelative =
      cleaned.startsWith('/') ||
      cleaned.startsWith('./') ||
      cleaned.startsWith('../') ||
      cleaned.startsWith('cache/') ||
      cleaned.startsWith('tmp/');
    if (canResolveRelative) {
      try {
        return new URL(cleaned, baseUrl).toString();
      } catch {
        return null;
      }
    }
  }

  return null;
}

function collectCapturedUrls(input: string, pattern: RegExp, baseUrl?: string): string[] {
  const results: string[] = [];
  pattern.lastIndex = 0;

  let matched: RegExpExecArray | null;
  while ((matched = pattern.exec(input)) !== null) {
    const captured = typeof matched[1] === 'string' ? matched[1] : matched[0];
    const normalized = normalizeExtractedUrl(captured, baseUrl);
    if (normalized) {
      results.push(normalized);
    }
  }

  return results;
}

function scoreVideoCandidate(url: string, baseScore: number): number {
  const lower = url.toLowerCase();
  let score = baseScore;

  if (VIDEO_URL_PATTERN.test(lower)) score += 90;
  if (lower.includes('/v1/files/video/')) score += 80;
  if (lower.includes('/videos/')) score += 70;
  if (lower.includes('/video/')) score += 60;
  if (lower.includes('generated_video')) score += 70;
  if (lower.includes('video')) score += 20;

  if (IMAGE_URL_PATTERN.test(lower)) score -= 120;
  if (lower.includes('preview_image')) score -= 80;
  if (lower.includes('/preview/')) score -= 40;
  if (lower.includes('poster')) score -= 40;

  return score;
}

function selectBestVideoCandidate(candidates: Array<{ url: string; score: number }>): string | null {
  if (candidates.length === 0) return null;

  const deduped = new Map<string, number>();
  for (const candidate of candidates) {
    const previousScore = deduped.get(candidate.url);
    if (previousScore === undefined || candidate.score > previousScore) {
      deduped.set(candidate.url, candidate.score);
    }
  }

  const ranked = Array.from(deduped.entries())
    .map(([url, score]) => ({ url, score }))
    .sort((a, b) => b.score - a.score);

  if (ranked.length === 0) return null;
  if (ranked[0]!.score > 0) return ranked[0]!.url;

  return null;
}

function buildMediaJson(type: 'video' | 'image', url: string): string {
  return JSON.stringify({ type, url });
}

function parseMediaJsonFromContent(content: string): { type: 'video' | 'image'; url: string } | null {
  try {
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== 'object') return null;
    if ((parsed.type === 'video' || parsed.type === 'image') && typeof parsed.url === 'string' && parsed.url.trim()) {
      return { type: parsed.type, url: parsed.url.trim() };
    }
    return null;
  } catch {
    return null;
  }
}

function extractVideoUrlFromText(content: string, baseUrl?: string): string | null {
  const trimmed = content.trim();
  if (!trimmed) return null;

  const mediaJson = parseMediaJsonFromContent(trimmed);
  if (mediaJson?.type === 'video' && mediaJson.url) {
    const normalized = normalizeExtractedUrl(mediaJson.url, baseUrl);
    if (normalized) return normalized;
  }

  const candidates: Array<{ url: string; score: number }> = [];

  const videoTagSrcMatches = collectCapturedUrls(
    trimmed,
    /<video\b[^>]*\bsrc=['"]([^'"]+)['"]/gi,
    baseUrl,
  );
  for (const url of videoTagSrcMatches) {
    candidates.push({ url, score: scoreVideoCandidate(url, 140) });
  }

  const sourceTagMatches = collectCapturedUrls(
    trimmed,
    /<source\b[^>]*\bsrc=['"]([^'"]+)['"]/gi,
    baseUrl,
  );
  for (const url of sourceTagMatches) {
    candidates.push({ url, score: scoreVideoCandidate(url, 120) });
  }

  const markdownLinkMatches = collectCapturedUrls(
    trimmed,
    /!?\[[^\]]*]\(([^)]+)\)/gi,
    baseUrl,
  );
  for (const url of markdownLinkMatches) {
    candidates.push({ url, score: scoreVideoCandidate(url, 70) });
  }

  const rawUrlMatches = collectCapturedUrls(
    trimmed,
    /(https?:\/\/[^\s"'<>`]+)/gi,
    baseUrl,
  );
  for (const url of rawUrlMatches) {
    candidates.push({ url, score: scoreVideoCandidate(url, 50) });
  }

  const best = selectBestVideoCandidate(candidates);
  if (best) return best;

  const fallback = rawUrlMatches.find((url) => !IMAGE_URL_PATTERN.test(url.toLowerCase())) || null;
  return fallback;
}

function normalizeContentToText(content: unknown, depth = 0): string {
  if (depth > 6 || content === null || content === undefined) return '';
  if (typeof content === 'string') return content;

  if (Array.isArray(content)) {
    return content
      .map((item) => normalizeContentToText(item, depth + 1))
      .filter(Boolean)
      .join('\n')
      .trim();
  }

  if (typeof content === 'object') {
    const record = content as Record<string, unknown>;
    if (typeof record.text === 'string') return record.text;
    if (typeof record.content === 'string') return record.content;
    if (typeof record.url === 'string') return record.url;

    return Object.values(record)
      .map((item) => normalizeContentToText(item, depth + 1))
      .filter(Boolean)
      .join('\n')
      .trim();
  }

  return '';
}

function compactSnippet(content: string, max = 200): string {
  return content.replace(/\s+/g, ' ').trim().slice(0, max);
}

function extractUpstreamErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;

  const detail = typeof record.detail === 'string' ? record.detail.trim() : '';
  if (detail) return detail;

  const error = record.error;
  if (typeof error === 'string' && error.trim()) {
    return error.trim();
  }
  if (error && typeof error === 'object') {
    const errorRecord = error as Record<string, unknown>;
    if (typeof errorRecord.message === 'string' && errorRecord.message.trim()) {
      return errorRecord.message.trim();
    }
    if (typeof errorRecord.detail === 'string' && errorRecord.detail.trim()) {
      return errorRecord.detail.trim();
    }
  }

  return null;
}

function extractContentFromExternalChatPayload(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const record = payload as Record<string, unknown>;
  const choices = Array.isArray(record.choices) ? record.choices : [];
  const segments: string[] = [];

  for (const choice of choices) {
    if (!choice || typeof choice !== 'object') continue;
    const item = choice as Record<string, unknown>;
    const message = item.message as Record<string, unknown> | undefined;
    const delta = item.delta as Record<string, unknown> | undefined;

    const candidates = [
      message?.content,
      delta?.content,
      delta?.reasoning_content,
    ];

    for (const candidate of candidates) {
      const text = normalizeContentToText(candidate);
      if (text) segments.push(text);
    }
  }

  return segments.join('\n').trim();
}

function extractVideoUrlFromUnknownPayload(payload: unknown, baseUrl?: string): string | null {
  const queue: unknown[] = [payload];
  const visited = new Set<unknown>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === null || current === undefined) continue;

    if (typeof current === 'string') {
      const fromText = extractVideoUrlFromText(current, baseUrl);
      if (fromText) return fromText;

      const normalized = normalizeExtractedUrl(current, baseUrl);
      if (normalized && scoreVideoCandidate(normalized, 0) > 0) {
        return normalized;
      }
      continue;
    }

    if (typeof current !== 'object') continue;
    if (visited.has(current)) continue;
    visited.add(current);

    if (Array.isArray(current)) {
      for (const item of current) queue.push(item);
      continue;
    }

    for (const value of Object.values(current as Record<string, unknown>)) {
      queue.push(value);
    }
  }

  return null;
}

function clampLingkeProgress(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function resolveLingkeStatusGroup(status: string, hasResult: boolean): string {
  if (hasResult) return 'completed';

  const normalized = normalizeLingkeStatus(status);
  if (!normalized) return 'processing';
  if (normalized === 'pending') return 'pending';
  if (normalized === 'failed') return 'failed';
  if (normalized === 'completed') return 'completed';
  return 'processing';
}

function normalizeLingkeStatus(status: string): 'pending' | 'processing' | 'completed' | 'failed' | '' {
  const normalized = String(status || '').trim().toLowerCase();
  if (!normalized) return '';

  if (
    normalized.includes('queue') ||
    normalized.includes('wait') ||
    normalized.includes('pending') ||
    normalized.includes('submit') ||
    normalized.includes('created') ||
    normalized.includes('等待') ||
    normalized.includes('排队') ||
    normalized.includes('创建')
  ) {
    return 'pending';
  }

  if (
    normalized.includes('fail') ||
    normalized.includes('error') ||
    normalized.includes('cancel') ||
    normalized.includes('失败') ||
    normalized.includes('错误') ||
    normalized.includes('取消') ||
    normalized.includes('异常')
  ) {
    return 'failed';
  }

  if (
    normalized.includes('success') ||
    normalized.includes('done') ||
    normalized.includes('finish') ||
    normalized.includes('completed') ||
    normalized.includes('succeeded') ||
    normalized.includes('成功') ||
    normalized.includes('完成') ||
    normalized.includes('已完成')
  ) {
    return 'completed';
  }

  if (
    normalized.includes('process') ||
    normalized.includes('running') ||
    normalized.includes('render') ||
    normalized.includes('处理中') ||
    normalized.includes('生成中') ||
    normalized.includes('执行中') ||
    normalized.includes('渲染中')
  ) {
    return 'processing';
  }

  return 'processing';
}

function buildLingkeVideoTaskSnapshot(
  taskId: string,
  data: any,
  baseUrl?: string
): LingkeMediaVideoTaskSnapshot {
  const directUrl = extractVideoUrlFromUnknownPayload(data, baseUrl)
    || (typeof data?.data?.result_url === 'string' ? data.data.result_url : null)
    || (typeof data?.result_url === 'string' ? data.result_url : null);
  const statusLabel = String(data?.data?.status || data?.status || '').trim();
  const message = extractLingkeTaskMessage(data);
  const state = normalizeLingkeStatus(
    String(data?.data?.state || data?.state || '').trim() || statusLabel || message || ''
  );
  const numericProgress = Number(
    data?.data?.progress
      ?? data?.progress
      ?? data?.data?.percentage
      ?? data?.percentage
      ?? NaN
  );

  let progress = Number.isFinite(numericProgress)
    ? clampLingkeProgress(numericProgress)
    : 0;

  if (!progress) {
    if (directUrl) progress = 100;
    else if (state === 'pending') progress = 10;
    else if (state === 'processing') progress = 60;
    else if (state === 'failed') progress = 0;
  }

  return {
    taskId,
    code: Number(data?.code ?? 0),
    status: statusLabel || message || '',
    state,
    statusGroup: resolveLingkeStatusGroup(statusLabel || message || '', Boolean(directUrl)) as LingkeMediaVideoTaskSnapshot['statusGroup'],
    progress,
    message,
    resultUrl: directUrl || undefined,
    final: Boolean(directUrl) || Boolean(data?.is_final || data?.data?.is_final),
    raw: data,
  };
}

export async function fetchLingkeMediaVideoTaskSnapshot(
  baseUrl: string,
  apiKey: string,
  taskId: string
): Promise<LingkeMediaVideoTaskSnapshot> {
  const statusUrl = `${baseUrl.replace(/\/$/, '')}/v1/media/status?task_id=${encodeURIComponent(taskId)}`;
  const statusResponse = await fetchWithRetry(undiciFetch, statusUrl, () => ({
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  }));

  const statusData: any = await statusResponse.json().catch(() => ({}));
  if (!statusResponse.ok) {
    throw new Error(`灵刻媒体查询失败 (${statusResponse.status})`);
  }

  return buildLingkeVideoTaskSnapshot(taskId, statusData, baseUrl);
}

function parseSseDataEvents(rawText: string): string[] {
  const events: string[] = [];
  const normalized = rawText.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  let dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
      continue;
    }

    if (line.trim() === '') {
      if (dataLines.length > 0) {
        events.push(dataLines.join('\n'));
        dataLines = [];
      }
      continue;
    }
  }

  if (dataLines.length > 0) {
    events.push(dataLines.join('\n'));
  }

  return events;
}

function extractVideoUrlFromSseResponseText(
  rawText: string,
  baseUrl?: string
): { url: string | null; errorMessage: string | null; text: string } {
  const events = parseSseDataEvents(rawText);
  const textSegments: string[] = [];
  let errorMessage: string | null = null;

  for (const eventData of events) {
    const data = eventData.trim();
    if (!data || data === '[DONE]') continue;

    let payload: unknown = null;
    try {
      payload = JSON.parse(data);
    } catch {
      const directUrl = extractVideoUrlFromText(data, baseUrl);
      if (directUrl) {
        return { url: directUrl, errorMessage, text: textSegments.join('\n').trim() };
      }
      textSegments.push(data);
      continue;
    }

    const upstreamError = extractUpstreamErrorMessage(payload);
    if (upstreamError && !errorMessage) {
      errorMessage = upstreamError;
    }

    const urlFromPayload = extractVideoUrlFromUnknownPayload(payload, baseUrl);
    if (urlFromPayload) {
      return { url: urlFromPayload, errorMessage, text: textSegments.join('\n').trim() };
    }

    const contentText = extractContentFromExternalChatPayload(payload);
    if (contentText) {
      textSegments.push(contentText);
      const urlFromContent = extractVideoUrlFromText(contentText, baseUrl);
      if (urlFromContent) {
        return { url: urlFromContent, errorMessage, text: textSegments.join('\n').trim() };
      }
    }
  }

  const mergedText = textSegments.join('\n').trim();
  const fallbackUrl = mergedText ? extractVideoUrlFromText(mergedText, baseUrl) : null;
  return { url: fallbackUrl, errorMessage, text: mergedText };
}

function parseSseEventBlock(block: string): string | null {
  const dataLines = block
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart());

  if (dataLines.length === 0) return null;
  return dataLines.join('\n').trim();
}

function progressFromExternalMessage(message: string, currentProgress: number): number {
  const text = message.trim();
  if (!text) return currentProgress;

  if (text.includes('上传参考图片')) return Math.max(currentProgress, 30);
  if (text.includes('参考图已就绪')) return Math.max(currentProgress, 42);
  if (text.includes('开始提交视频任务')) return Math.max(currentProgress, 56);
  if (text.includes('视频任务状态:')) return Math.max(currentProgress, 72);
  if (text.includes('4K') && text.includes('放大')) return Math.max(currentProgress, 86);
  if (text.toUpperCase().includes('1080') && text.includes('放大')) return Math.max(currentProgress, 86);
  if (text.includes('缓存')) return Math.max(currentProgress, 94);
  return Math.max(currentProgress, 18);
}

async function readStreamingExternalChatResponse(
  response: Response,
  baseUrl: string | undefined,
  onProgress?: GenerationProgressCallback
): Promise<{ url: string | null; errorMessage: string | null; text: string; rawBody: string }> {
  if (!response.body?.getReader) {
    const rawBody = await response.text();
    const parsed = extractVideoUrlFromSseResponseText(rawBody, baseUrl);
    return { ...parsed, rawBody };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const textSegments: string[] = [];
  const rawSegments: string[] = [];
  let buffer = '';
  let rawUrl: string | null = null;
  let errorMessage: string | null = null;
  let progress = 5;

  const processEventData = (eventData: string) => {
    const data = eventData.trim();
    if (!data || data === '[DONE]') return;

    let payload: unknown = null;
    try {
      payload = JSON.parse(data);
    } catch {
      const directUrl = extractVideoUrlFromText(data, baseUrl);
      if (directUrl && !rawUrl) {
        rawUrl = directUrl;
      }
      textSegments.push(data);
      return;
    }

    const upstreamError = extractUpstreamErrorMessage(payload);
    if (upstreamError && !errorMessage) {
      errorMessage = upstreamError;
    }

    const urlFromPayload = extractVideoUrlFromUnknownPayload(payload, baseUrl);
    if (urlFromPayload && !rawUrl) {
      rawUrl = urlFromPayload;
    }

    const contentText = extractContentFromExternalChatPayload(payload);
    if (contentText) {
      textSegments.push(contentText);
      const nextProgress = progressFromExternalMessage(contentText, progress);
      if (nextProgress > progress) {
        progress = nextProgress;
        onProgress?.(progress);
      }

      const urlFromContent = extractVideoUrlFromText(contentText, baseUrl);
      if (urlFromContent && !rawUrl) {
        rawUrl = urlFromContent;
      }
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    rawSegments.push(chunk);
    buffer = (buffer + chunk).replace(/\r\n/g, '\n');

    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);

      const eventData = parseSseEventBlock(block);
      if (eventData) {
        processEventData(eventData);
      }

      boundary = buffer.indexOf('\n\n');
    }
  }

  const tail = decoder.decode();
  if (tail) {
    rawSegments.push(tail);
    buffer += tail;
  }

  const tailData = parseSseEventBlock(buffer.replace(/\r\n/g, '\n'));
  if (tailData) {
    processEventData(tailData);
  }

  const text = textSegments.join('\n').trim();
  if (!rawUrl && text) {
    rawUrl = extractVideoUrlFromText(text, baseUrl);
  }

  return {
    url: rawUrl,
    errorMessage,
    text,
    rawBody: rawSegments.join(''),
  };
}

function normalizeAspectRatioLabel(aspectRatio: string): string {
  switch ((aspectRatio || '').toLowerCase()) {
    case 'landscape':
      return '16:9';
    case 'portrait':
      return '9:16';
    case 'square':
      return '1:1';
    default:
      return aspectRatio || '16:9';
  }
}

function normalizeDurationSeconds(duration?: string): number {
  if (!duration) return 10;
  const matched = duration.match(/(\d+)/);
  if (!matched) return 10;
  const parsed = Number.parseInt(matched[1], 10);
  if (Number.isNaN(parsed) || parsed <= 0) return 10;
  return parsed;
}

function normalizeGrokVideoLengthSeconds(duration?: string, fallback = 10): number {
  const parsed = normalizeDurationSeconds(duration);
  const base = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(1, Math.min(GROK_MAX_VIDEO_LENGTH_SECONDS, Math.floor(base)));
}

function mapFlowModel(modelName: string, aspectRatio: string, duration: string, imageCount: number): string {
  const normalizedModel = (modelName || '').trim();
  const lowerModel = normalizedModel.toLowerCase();

  if (lowerModel.startsWith('veo_')) {
    return resolveFlowVeoModel(normalizedModel, aspectRatio, imageCount) || normalizedModel;
  }

  const ratio = (aspectRatio || '').toLowerCase();
  const seconds = normalizeDurationSeconds(duration);

  const isI2V = imageCount > 0 || lowerModel.includes('i2v') || lowerModel.includes('image');
  const isR2V = imageCount >= 3 || lowerModel.includes('r2v') || lowerModel.includes('reference');

  if (isR2V) {
    return ratio === 'portrait' ? 'veo_3_0_r2v_fast_portrait' : 'veo_3_0_r2v_fast_landscape';
  }

  if (isI2V) {
    if (seconds >= 15) {
      return ratio === 'portrait'
        ? 'veo_2_1_fast_d_15_i2v_portrait'
        : 'veo_2_1_fast_d_15_i2v_landscape';
    }
    return ratio === 'portrait'
      ? 'veo_3_1_i2v_s_fast_portrait_fl'
      : 'veo_3_1_i2v_s_fast_fl';
  }

  if (seconds >= 15) {
    return ratio === 'portrait'
      ? 'veo_2_1_fast_d_15_t2v_portrait'
      : 'veo_2_1_fast_d_15_t2v_landscape';
  }

  return ratio === 'portrait' ? 'veo_3_1_t2v_fast_portrait' : 'veo_3_1_t2v_fast_landscape';
}

function mapGrokModel(modelName: string): string {
  return modelName?.trim() || 'grok-imagine-1.0-video';
}

function mapChannelModel(channelType: VideoChannel['type'], model: VideoModel, request: SoraGenerateRequest): string {
  const ratio = request.aspectRatio || model.defaultAspectRatio || 'landscape';
  const duration = request.duration || model.defaultDuration || '8s';
  const imageCount = (request.files || []).filter((file) => file.mimeType.startsWith('image/')).length;

  if (channelType === 'flow2api') {
    return mapFlowModel(model.apiModel, ratio, duration, imageCount);
  }
  if (channelType === 'lingke-media') {
    return model.apiModel || request.model || 'veo3.1-lite';
  }
  if (channelType === 'grok2api') {
    return mapGrokModel(model.apiModel);
  }
  return model.apiModel || request.model;
}

function resolveVideoConfigObject(
  request: SoraGenerateRequest,
  model: VideoModel
): {
  aspect_ratio: string;
  video_length: number;
  resolution: string;
  preset: 'fun' | 'normal' | 'spicy';
  generation_mode?: string;
  off_peak?: boolean;
  quality_version?: string;
  model_version?: string;
  version?: string;
  extra_params?: Record<string, unknown>;
} {
  const requestConfig = request.videoConfigObject || request.video_config;
  const modelConfig = model.videoConfigObject;
  const hasRequestAspectRatio = typeof request.aspectRatio === 'string' && request.aspectRatio.trim().length > 0;
  const hasRequestDuration = typeof request.duration === 'string' && request.duration.trim().length > 0;

  const aspectRatioRaw =
    requestConfig?.aspect_ratio ||
    (hasRequestAspectRatio
      ? request.aspectRatio
      : modelConfig?.aspect_ratio || model.defaultAspectRatio || 'landscape');

  const videoLengthRaw =
    typeof requestConfig?.video_length === 'number'
      ? requestConfig.video_length
      : hasRequestDuration
        ? normalizeGrokVideoLengthSeconds(request.duration || '8s')
        : typeof modelConfig?.video_length === 'number'
          ? modelConfig.video_length
          : normalizeGrokVideoLengthSeconds(model.defaultDuration || '8s');

  const resolutionRaw = (requestConfig?.resolution || modelConfig?.resolution || '720P').toString().toUpperCase();
  const presetRaw = (requestConfig?.preset || modelConfig?.preset || 'normal').toString().toLowerCase();
  const generationModeRaw = requestConfig?.generation_mode || modelConfig?.generation_mode;
  const qualityVersionRaw = requestConfig?.quality_version || modelConfig?.quality_version;
  const modelVersionRaw = requestConfig?.model_version || modelConfig?.model_version;
  const versionRaw = requestConfig?.version || modelConfig?.version;
  const offPeakRaw =
    typeof requestConfig?.off_peak === 'boolean'
      ? requestConfig.off_peak
      : typeof modelConfig?.off_peak === 'boolean'
        ? modelConfig.off_peak
        : undefined;
  const extraParamsRaw = {
    ...(modelConfig?.extra_params && typeof modelConfig.extra_params === 'object' ? modelConfig.extra_params : {}),
    ...(requestConfig?.extra_params && typeof requestConfig.extra_params === 'object' ? requestConfig.extra_params : {}),
  };

  const resolved: {
    aspect_ratio: string;
    video_length: number;
    resolution: string;
    preset: 'fun' | 'normal' | 'spicy';
    generation_mode?: string;
    off_peak?: boolean;
    quality_version?: string;
    model_version?: string;
    version?: string;
    extra_params?: Record<string, unknown>;
  } = {
    aspect_ratio: normalizeAspectRatioLabel(aspectRatioRaw || '16:9'),
    video_length: Math.max(1, Math.min(GROK_MAX_VIDEO_LENGTH_SECONDS, Math.floor(videoLengthRaw))),
    resolution: resolutionRaw || '720P',
    preset: presetRaw === 'fun' || presetRaw === 'spicy' ? (presetRaw as 'fun' | 'spicy') : 'normal',
  };

  if (typeof generationModeRaw === 'string' && generationModeRaw.trim()) {
    resolved.generation_mode = generationModeRaw.trim();
  }
  if (typeof qualityVersionRaw === 'string' && qualityVersionRaw.trim()) {
    resolved.quality_version = qualityVersionRaw.trim();
  }
  if (typeof modelVersionRaw === 'string' && modelVersionRaw.trim()) {
    resolved.model_version = modelVersionRaw.trim();
  }
  if (typeof versionRaw === 'string' && versionRaw.trim()) {
    resolved.version = versionRaw.trim();
  }
  if (typeof offPeakRaw === 'boolean') {
    resolved.off_peak = offPeakRaw;
  }
  if (Object.keys(extraParamsRaw).length > 0) {
    resolved.extra_params = extraParamsRaw;
  }

  return resolved;
}

function normalizeLingkeResolution(value?: string): string {
  const normalized = String(value || '').trim().toUpperCase();
  if (!normalized || normalized === 'SD') return '720P';
  if (normalized === 'HD') return '1080P';
  return normalized;
}

function normalizeLingkeResolutionForFamily(family: LingkeModelFamily, value?: string): string {
  const normalized = normalizeLingkeResolution(value);
  if (family === 'vidu' || family === 'sd20') {
    if (normalized === '720P') return '720p';
    if (normalized === '1080P') return '1080p';
  }
  if (family === 'kling' && normalized === 'HD') return '1080P';
  return normalized;
}

type LingkeModelFamily = 'wanxiang' | 'vidu' | 'sd20' | 'veo' | 'happyhorse' | 'pix' | 'kling' | 'generic';
type LingkeInputMode =
  | 'text'
  | 'reference'
  | 'first_frame'
  | 'first_last_frame'
  | 'video_reference'
  | 'video_continue'
  | 'video_edit'
  | 'motion_control';

function classifyLingkeModel(modelName: string): LingkeModelFamily {
  const raw = (modelName || '').toLowerCase();
  if (raw.includes('万相')) return 'wanxiang';
  if (raw.includes('vidu')) return 'vidu';
  if (raw.includes('sd 2.0') || raw.includes('sd2.0') || raw.includes('sd 2')) return 'sd20';
  if (raw.includes('veo')) return 'veo';
  if (raw.includes('快乐马') || raw.includes('happyhorse')) return 'happyhorse';
  if (raw.includes('pix ')) return 'pix';
  if (raw.includes('可灵') || raw.includes('kling')) return 'kling';
  return 'generic';
}

function classifyLingkeInputMode(modelName: string): LingkeInputMode {
  const raw = (modelName || '').toLowerCase();
  if (raw.includes('动作控制')) return 'motion_control';
  if (raw.includes('视频续写') || raw.includes('续写')) return 'video_continue';
  if (raw.includes('视频编辑') || raw.includes('编辑')) return 'video_edit';
  if (raw.includes('视频参考')) return 'video_reference';
  if (raw.includes('首尾帧')) return 'first_last_frame';
  if (raw.includes('首帧')) return 'first_frame';
  if (raw.includes('参考生') || raw.includes('参考')) return 'reference';
  return 'text';
}

function resolveLingkeKlingDuration(modelName: string, requestedLength: number): number {
  const raw = (modelName || '').toLowerCase();
  if (raw.includes('v3-omni')) return 5;
  if (raw.includes('v3-video')) return 5;
  if (raw.includes('omni 首尾帧') || raw.includes('omni 参考生')) return 5;
  return requestedLength <= 5 ? 5 : requestedLength;
}

function resolveLingkeKlingResolution(modelName: string, currentResolution: string): string {
  const raw = (modelName || '').toLowerCase();
  if (raw.includes('v3-omni')) return '1k';
  return currentResolution;
}

function toLingkeDataUrl(file: { mimeType: string; data: string }): string {
  return file.data.startsWith('data:')
    ? file.data
    : `data:${file.mimeType};base64,${file.data.replace(/^data:[^;]+;base64,/, '')}`;
}

function isRemoteHttpUrl(value?: string): boolean {
  return /^https?:\/\//i.test(String(value || '').trim());
}

function toLingkeReferenceValue(file: { mimeType: string; data: string }): string {
  return isRemoteHttpUrl(file.data) ? file.data : toLingkeDataUrl(file);
}

const LINGKE_METADATA_EXTRA_PARAM_KEYS = new Set([
  'upstream_params',
  'dynamic_param_options',
  'default_dynamic_param_values',
  'upload_mode',
  'requires_upload',
  'upload_param_names',
  'image_upload_param_names',
  'video_upload_param_names',
  'audio_upload_param_names',
  'required_upload_param_names',
  'required_image_upload_param_names',
  'required_video_upload_param_names',
  'required_audio_upload_param_names',
  'min_reference_image_count',
  'max_reference_image_count',
  'reference_image_count_options',
  'default_reference_image_count',
  'image_resolution_options',
  'aspect_ratio_param_name',
  'generation_mode_param_name',
  'upstream_param_names',
  'submit_only_upstream_params',
]);

type LingkeRuntimeConfig = {
  inputMode: LingkeInputMode;
  uploadParamNames: string[];
  imageUploadParamNames: string[];
  videoUploadParamNames: string[];
  upstreamParamNames: string[];
  submitOnlyUpstreamParams: boolean;
  defaultDynamicParamValues: Record<string, unknown>;
  aspectRatioParamName?: string;
  generationModeParamName?: string;
  durationParamName?: string;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
}

function normalizeLingkeInputModeValue(value: unknown): LingkeInputMode | null {
  const normalized = String(value || '').trim().toLowerCase();
  switch (normalized) {
    case 'text':
    case 'reference':
    case 'reference_images':
    case 'first_frame':
    case 'first_last_frame':
    case 'video_reference':
    case 'video_continue':
    case 'video_edit':
    case 'motion_control':
      if (normalized === 'reference_images') return 'reference';
      return normalized;
    default:
      return null;
  }
}

function sanitizeLingkeDynamicDefaults(value: unknown): Record<string, unknown> {
  if (!isPlainObject(value)) return {};

  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined)
  );
}

function getLingkeModelRuntimeConfig(model: VideoModel, modelName: string): LingkeRuntimeConfig {
  const extraParams = isPlainObject(model.videoConfigObject?.extra_params)
    ? model.videoConfigObject.extra_params
    : {};
  const inputMode =
    normalizeLingkeInputModeValue(extraParams.upload_mode)
    || normalizeLingkeInputModeValue(extraParams.input_mode)
    || classifyLingkeInputMode(modelName);

  return {
    inputMode,
    uploadParamNames: toStringArray(extraParams.upload_param_names),
    imageUploadParamNames: toStringArray(extraParams.image_upload_param_names),
    videoUploadParamNames: toStringArray(extraParams.video_upload_param_names),
    upstreamParamNames: toStringArray(extraParams.upstream_param_names),
    submitOnlyUpstreamParams:
      extraParams.submit_only_upstream_params === true
      || toStringArray(extraParams.upstream_param_names).length > 0,
    defaultDynamicParamValues: sanitizeLingkeDynamicDefaults(extraParams.default_dynamic_param_values),
    aspectRatioParamName:
      typeof extraParams.aspect_ratio_param_name === 'string' && extraParams.aspect_ratio_param_name.trim()
        ? extraParams.aspect_ratio_param_name.trim()
        : undefined,
    generationModeParamName:
      typeof extraParams.generation_mode_param_name === 'string' && extraParams.generation_mode_param_name.trim()
        ? extraParams.generation_mode_param_name.trim()
        : undefined,
    durationParamName:
      typeof extraParams.duration_param_name === 'string' && extraParams.duration_param_name.trim()
        ? extraParams.duration_param_name.trim()
        : undefined,
  };
}

function isMeaningfulLingkeParamValue(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function buildLingkeAllowedParamNames(runtimeConfig: LingkeRuntimeConfig): Set<string> {
  const allowed = new Set<string>(runtimeConfig.upstreamParamNames);
  if (runtimeConfig.aspectRatioParamName) {
    allowed.add(runtimeConfig.aspectRatioParamName);
  }
  if (runtimeConfig.generationModeParamName) {
    allowed.add(runtimeConfig.generationModeParamName);
  }
  if (runtimeConfig.durationParamName) {
    allowed.add(runtimeConfig.durationParamName);
  }
  return allowed;
}

function applyLingkeRuntimeDefaults(
  params: Record<string, unknown>,
  runtimeConfig: LingkeRuntimeConfig
): Record<string, unknown> {
  if (!isPlainObject(params)) return params;
  if (!isPlainObject(runtimeConfig.defaultDynamicParamValues) || Object.keys(runtimeConfig.defaultDynamicParamValues).length === 0) {
    return params;
  }

  const merged = { ...params };
  for (const [key, value] of Object.entries(runtimeConfig.defaultDynamicParamValues)) {
    if (!isMeaningfulLingkeParamValue(merged[key])) {
      merged[key] = value;
    }
  }
  return merged;
}

function filterLingkeUpstreamParams(
  params: Record<string, unknown>,
  runtimeConfig: LingkeRuntimeConfig
): Record<string, unknown> {
  if (!runtimeConfig.submitOnlyUpstreamParams || runtimeConfig.upstreamParamNames.length === 0) {
    return params;
  }

  const allowed = buildLingkeAllowedParamNames(runtimeConfig);
  return Object.fromEntries(
    Object.entries(params).filter(([key, value]) => allowed.has(key) && isMeaningfulLingkeParamValue(value))
  );
}

function resolveNearestAllowedDuration(
  requestedLength: number,
  allowedDurations: number[],
  fallbackLength: number
): number {
  const normalizedAllowed = Array.from(
    new Set(
      allowedDurations
        .map((value) => Math.floor(Number(value)))
        .filter((value) => Number.isFinite(value) && value > 0)
    )
  ).sort((a, b) => a - b);

  if (normalizedAllowed.length === 0) {
    return fallbackLength;
  }

  if (normalizedAllowed.includes(requestedLength)) {
    return requestedLength;
  }

  const greaterOrEqual = normalizedAllowed.find((value) => value >= requestedLength);
  if (greaterOrEqual) return greaterOrEqual;
  return normalizedAllowed[normalizedAllowed.length - 1] || fallbackLength;
}

function resolveLingkeRequestedDuration(
  requestedLength: number,
  model: VideoModel,
  runtimeConfig: LingkeRuntimeConfig
): number {
  const durationCandidates = Array.isArray(model.durations)
    ? model.durations.map((duration) => normalizeDurationSeconds(duration.value))
    : [];
  const fallbackDuration =
    normalizeDurationSeconds(String(runtimeConfig.defaultDynamicParamValues.duration || ''))
    || normalizeDurationSeconds(model.defaultDuration)
    || Math.max(1, requestedLength);

  return resolveNearestAllowedDuration(
    Math.max(1, requestedLength),
    durationCandidates,
    fallbackDuration
  );
}

function extractLingkeTaskMessage(data: any): string | undefined {
  const directCandidates = [
    data?.data?.error,
    data?.data?.msg,
    data?.data?.message,
    data?.error,
    data?.msg,
    data?.message,
  ];

  for (const candidate of directCandidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }

  const extracted =
    extractUpstreamErrorMessage(data?.data)
    || extractUpstreamErrorMessage(data);
  if (extracted) return extracted;

  try {
    const rawError = data?.data?.error ?? data?.error;
    if (rawError !== undefined) {
      return compactSnippet(JSON.stringify(rawError), 320);
    }
  } catch {
    // ignore stringify failure
  }

  return undefined;
}

function extractLingkeRuntimeExtraParams(extraParams?: Record<string, unknown>): Record<string, unknown> {
  if (!isPlainObject(extraParams)) return {};

  return Object.fromEntries(
    Object.entries(extraParams).filter(([key, value]) => {
      if (LINGKE_METADATA_EXTRA_PARAM_KEYS.has(key)) return false;
      return value !== undefined;
    })
  );
}

function inferLingkeUploadKind(
  paramName: string,
  runtimeConfig?: LingkeRuntimeConfig
): 'image' | 'video' | null {
  const trimmed = String(paramName || '').trim();
  if (!trimmed) return null;
  if (runtimeConfig?.imageUploadParamNames.includes(trimmed)) return 'image';
  if (runtimeConfig?.videoUploadParamNames.includes(trimmed)) return 'video';

  const lower = trimmed.toLowerCase();
  if (
    lower === 'first_frame'
    || lower === 'last_frame'
    || lower.includes('image')
    || lower === 'images'
    || lower === 'reference'
  ) {
    return 'image';
  }
  if (lower.includes('video') || lower === 'videos') {
    return 'video';
  }
  return null;
}

function assignLingkeUploadParam(
  params: Record<string, unknown>,
  paramName: string,
  kind: 'image' | 'video',
  imageValues: string[],
  videoValues: string[]
) {
  if (!paramName) return;
  const lower = paramName.toLowerCase();

  if (kind === 'image') {
    if (imageValues.length === 0) return;
    if (lower === 'last_frame') {
      params[paramName] = imageValues[1] || imageValues[0];
      return;
    }
    if (
      lower === 'images'
      || lower.endsWith('_images')
      || lower === 'reference_frames'
      || lower === 'frames'
    ) {
      params[paramName] = imageValues;
      return;
    }
    params[paramName] = imageValues[0];
    return;
  }

  if (videoValues.length === 0) return;
  if (lower === 'videos' || lower.endsWith('_videos')) {
    params[paramName] = videoValues;
    return;
  }
  params[paramName] = videoValues[0];
}

function sanitizeLingkeUploadParams(
  params: Record<string, unknown>,
  runtimeConfig: LingkeRuntimeConfig,
  files: Array<{ mimeType: string; data: string }>
): Record<string, unknown> {
  if (!isPlainObject(params)) return params;

  const imageValues = files
    .filter((file) => file.mimeType.startsWith('image/'))
    .map(toLingkeReferenceValue)
    .filter(isRemoteHttpUrl);
  const videoValues = files
    .filter((file) => file.mimeType.startsWith('video/'))
    .map(toLingkeReferenceValue)
    .filter(isRemoteHttpUrl);

  const normalizedParams = { ...params };
  const candidates = new Set<string>([
    'images',
    'videos',
    'image',
    'video',
    'reference_image',
    'reference_images',
    'reference_video',
    'first_frame',
    'last_frame',
    ...runtimeConfig.uploadParamNames,
    ...runtimeConfig.imageUploadParamNames,
    ...runtimeConfig.videoUploadParamNames,
    ...Object.keys(normalizedParams),
  ]);

  for (const key of Array.from(candidates)) {
    const kind = inferLingkeUploadKind(key, runtimeConfig);
    if (!kind) continue;

    const currentValue = normalizedParams[key];
    const looksLikeInlineUpload =
      typeof currentValue === 'string'
        ? currentValue.trim().startsWith('data:')
        : Array.isArray(currentValue)
          ? currentValue.some(
              (item) => typeof item === 'string' && item.trim().startsWith('data:')
            )
          : false;

    if (
      looksLikeInlineUpload
      || currentValue === undefined
      || currentValue === null
      || (Array.isArray(currentValue) && currentValue.length === 0)
      || (typeof currentValue === 'string' && !currentValue.trim())
    ) {
      assignLingkeUploadParam(normalizedParams, key, kind, imageValues, videoValues);
    }
  }

  if (runtimeConfig.aspectRatioParamName && runtimeConfig.aspectRatioParamName !== 'aspect_ratio') {
    const aspectRatioValue = normalizedParams.aspect_ratio;
    if (typeof aspectRatioValue === 'string' && aspectRatioValue.trim()) {
      normalizedParams[runtimeConfig.aspectRatioParamName] = aspectRatioValue;
    }
  }
  if (runtimeConfig.generationModeParamName && runtimeConfig.generationModeParamName !== 'generation_mode') {
    const generationModeValue = normalizedParams.generation_mode;
    if (typeof generationModeValue === 'string' && generationModeValue.trim()) {
      normalizedParams[runtimeConfig.generationModeParamName] = generationModeValue;
    }
  }

  const withDefaults = applyLingkeRuntimeDefaults(normalizedParams, runtimeConfig);
  return filterLingkeUpstreamParams(withDefaults, runtimeConfig);
}

function summarizeLingkeParams(params: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(params).map(([key, value]) => {
      if (typeof value === 'string') {
        if (value.startsWith('data:')) return [key, 'data:...'];
        if (isRemoteHttpUrl(value)) return [key, value.slice(0, 160)];
        return [key, value];
      }
      if (Array.isArray(value)) {
        return [key, value.map((item) => {
          if (typeof item === 'string') {
            if (item.startsWith('data:')) return 'data:...';
            if (isRemoteHttpUrl(item)) return item.slice(0, 160);
          }
          return item;
        })];
      }
      return [key, value];
    })
  );
}

function findLingkeInlineUploadFields(params: Record<string, unknown>): string[] {
  const fields: string[] = [];

  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string') {
      if (value.trim().startsWith('data:')) {
        fields.push(key);
      }
      continue;
    }

    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        if (typeof item === 'string' && item.trim().startsWith('data:')) {
          fields.push(`${key}[${index}]`);
        }
      });
    }
  }

  return fields;
}

async function prepareLingkeReferenceFiles(
  files: Array<{ mimeType: string; data: string }>,
  publicBaseUrl?: string
): Promise<Array<{ mimeType: string; data: string }>> {
  if (!Array.isArray(files) || files.length === 0) return [];

  return Promise.all(
    files.map(async (file, index) => {
      if (isRemoteHttpUrl(file.data)) {
        return file;
      }

      const dataUrl = toLingkeDataUrl(file);
      const filename = `lingke-input-${Date.now()}-${index}-${randomUUID()}`;
      const publicUrl = await saveMediaToPublicFile(filename, dataUrl, {
        publicBaseUrl,
      });

      if (!publicUrl) {
        throw new Error(
          '当前灵刻模型上传参考图/参考视频时，需要站点具备公网可访问地址；请在服务器公网域名下重试。'
        );
      }

      return {
        ...file,
        data: publicUrl,
      };
    })
  );
}

function buildLingkeReferenceParams(
  model: VideoModel,
  modelName: string,
  files: Array<{ mimeType: string; data: string }>
): Record<string, unknown> {
  if (!Array.isArray(files) || files.length === 0) return {};

  const runtimeConfig = getLingkeModelRuntimeConfig(model, modelName);
  const mode = runtimeConfig.inputMode;
  const imageFiles = files.filter((file) => file.mimeType.startsWith('image/'));
  const videoFiles = files.filter((file) => file.mimeType.startsWith('video/'));

  const imageDataUrls = imageFiles.map(toLingkeReferenceValue);
  const videoDataUrls = videoFiles.map(toLingkeReferenceValue);

  const firstImage = imageDataUrls[0];
  const secondImage = imageDataUrls[1] || imageDataUrls[0];
  const firstVideo = videoDataUrls[0];

  const referenceParams: Record<string, unknown> = {};

  if (imageDataUrls.length > 0) {
    referenceParams.images = imageDataUrls;
  }
  if (videoDataUrls.length > 0) {
    referenceParams.videos = videoDataUrls;
  }

  switch (mode) {
    case 'first_frame':
      if (firstImage) {
        referenceParams.first_frame = firstImage;
        referenceParams.image = firstImage;
        referenceParams.reference_image = firstImage;
      }
      break;
    case 'first_last_frame':
      if (firstImage) {
        referenceParams.first_frame = firstImage;
        referenceParams.image = firstImage;
      }
      if (secondImage) {
        referenceParams.last_frame = secondImage;
      }
      if (imageDataUrls.length > 0) {
        referenceParams.reference_image = firstImage;
        referenceParams.reference_images = imageDataUrls;
      }
      break;
    case 'reference':
      if (firstImage) {
        referenceParams.image = firstImage;
        referenceParams.reference_image = firstImage;
      }
      if (imageDataUrls.length > 0) {
        referenceParams.reference_images = imageDataUrls;
      }
      break;
    case 'video_reference':
      if (firstVideo) {
        referenceParams.video = firstVideo;
        referenceParams.reference_video = firstVideo;
      }
      if (firstImage) {
        referenceParams.reference_image = firstImage;
      }
      if (imageDataUrls.length > 0) {
        referenceParams.reference_images = imageDataUrls;
      }
      break;
    case 'video_continue':
      if (firstVideo) {
        referenceParams.video = firstVideo;
        referenceParams.reference_video = firstVideo;
      }
      if (firstImage) {
        referenceParams.reference_image = firstImage;
      }
      break;
    case 'video_edit':
      if (firstVideo) {
        referenceParams.video = firstVideo;
      }
      if (firstImage) {
        referenceParams.image = firstImage;
        referenceParams.reference_image = firstImage;
      }
      if (imageDataUrls.length > 0) {
        referenceParams.reference_images = imageDataUrls;
      }
      break;
    case 'motion_control':
      if (firstImage) {
        referenceParams.image = firstImage;
        referenceParams.reference_image = firstImage;
      }
      if (firstVideo) {
        referenceParams.video = firstVideo;
        referenceParams.reference_video = firstVideo;
      }
      break;
    case 'text':
    default:
      if (firstImage) {
        referenceParams.reference_image = firstImage;
      }
      break;
  }

  for (const paramName of runtimeConfig.uploadParamNames) {
    const kind = inferLingkeUploadKind(paramName, runtimeConfig);
    if (!kind) continue;
    assignLingkeUploadParam(referenceParams, paramName, kind, imageDataUrls, videoDataUrls);
  }
  for (const paramName of runtimeConfig.imageUploadParamNames) {
    assignLingkeUploadParam(referenceParams, paramName, 'image', imageDataUrls, videoDataUrls);
  }
  for (const paramName of runtimeConfig.videoUploadParamNames) {
    assignLingkeUploadParam(referenceParams, paramName, 'video', imageDataUrls, videoDataUrls);
  }

  return sanitizeLingkeUploadParams(referenceParams, runtimeConfig, files);
}

function buildLingkeVideoParams(
  model: VideoModel,
  modelName: string,
  videoConfig: {
    aspect_ratio: string;
    video_length: number;
    resolution: string;
    preset: 'fun' | 'normal' | 'spicy';
    generation_mode?: string;
    off_peak?: boolean;
    quality_version?: string;
    model_version?: string;
    version?: string;
    extra_params?: Record<string, unknown>;
  },
  generationMode?: string
): Record<string, unknown> {
  const runtimeConfig = getLingkeModelRuntimeConfig(model, modelName);
  const family = classifyLingkeModel(modelName);
  const mode = runtimeConfig.inputMode;
  const resolution = normalizeLingkeResolutionForFamily(family, videoConfig.resolution);
  const requestedLength = resolveLingkeRequestedDuration(
    Math.max(1, Math.floor(videoConfig.video_length || 8)),
    model,
    runtimeConfig
  );
  const params: Record<string, unknown> = {
    aspect_ratio: videoConfig.aspect_ratio || '16:9',
    resolution,
    preset: videoConfig.preset || 'normal',
  };

  if (family === 'wanxiang') {
    params.quality = 'sd';
    params.duration = 15;
  } else if (family === 'vidu') {
    params.duration = requestedLength;
    params.off_peak = false;
    if (!videoConfig.model_version || videoConfig.model_version.trim().toLowerCase() === 'standard') {
      params.model_version = 'viduq3';
    }
    if (typeof videoConfig.quality_version === 'string' && videoConfig.quality_version.trim()) {
      params.quality_version = videoConfig.quality_version.trim();
    } else {
      params.quality_version = 'standard';
    }
  } else if (family === 'sd20') {
    params.duration = requestedLength;
    if (typeof videoConfig.version === 'string' && videoConfig.version.trim()) {
      const candidateVersion = videoConfig.version.trim();
      if (candidateVersion.toLowerCase() !== 'standard') {
        params.version = candidateVersion;
      }
    }
    if (!('version' in params) || !String(params.version || '').trim()) {
      params.version = '标准';
    }
  } else if (family === 'pix') {
    params.duration = 15;
  } else if (family === 'kling') {
    params.duration = resolveLingkeKlingDuration(modelName, requestedLength);
    params.mode = 'std';
    params.resolution = resolveLingkeKlingResolution(modelName, resolution);
  } else {
    params.video_length = requestedLength;
    if (family === 'veo') {
      params.quality = 'sd';
    }
  }

  if (mode === 'video_continue') {
    delete params.video_length;
    params.duration = family === 'wanxiang' ? 15 : requestedLength;
  }

  if (mode === 'motion_control') {
    params.generation_mode = generationMode || 'normal';
  }

  if (generationMode) {
    params.generation_mode = generationMode;
  }

  if (typeof videoConfig.generation_mode === 'string' && videoConfig.generation_mode.trim()) {
    params.generation_mode = videoConfig.generation_mode.trim();
  }
  if (typeof videoConfig.off_peak === 'boolean') {
    params.off_peak = videoConfig.off_peak;
  }
  if (typeof videoConfig.quality_version === 'string' && videoConfig.quality_version.trim()) {
    params.quality_version = videoConfig.quality_version.trim();
  }
  if (typeof videoConfig.model_version === 'string' && videoConfig.model_version.trim()) {
    if (!(family === 'vidu' && videoConfig.model_version.trim().toLowerCase() === 'standard')) {
      params.model_version = videoConfig.model_version.trim();
    }
  }
  if (typeof videoConfig.version === 'string' && videoConfig.version.trim()) {
    if (!(family === 'sd20' && videoConfig.version.trim().toLowerCase() === 'standard')) {
      params.version = videoConfig.version.trim();
    }
  }
  if (videoConfig.extra_params && typeof videoConfig.extra_params === 'object') {
    Object.assign(params, extractLingkeRuntimeExtraParams(videoConfig.extra_params));
  }

  if (family === 'kling') {
    params.duration = resolveLingkeKlingDuration(modelName, Number(params.duration) || requestedLength);
    params.resolution = resolveLingkeKlingResolution(modelName, String(params.resolution || resolution));
    if (!('mode' in params) || typeof params.mode !== 'string' || !String(params.mode).trim()) {
      params.mode = 'std';
    }
  }

  const mergedWithDefaults = applyLingkeRuntimeDefaults(params, runtimeConfig);
  const allowedParams = filterLingkeUpstreamParams(mergedWithDefaults, runtimeConfig);

  if (runtimeConfig.submitOnlyUpstreamParams && runtimeConfig.upstreamParamNames.length > 0) {
    const durationKey = runtimeConfig.durationParamName || (runtimeConfig.upstreamParamNames.includes('duration') ? 'duration' : '');
    if (durationKey && !isMeaningfulLingkeParamValue(allowedParams[durationKey])) {
      allowedParams[durationKey] = requestedLength;
    }
    const aspectRatioKey = runtimeConfig.aspectRatioParamName || (runtimeConfig.upstreamParamNames.includes('aspect_ratio') ? 'aspect_ratio' : '');
    if (aspectRatioKey && !isMeaningfulLingkeParamValue(allowedParams[aspectRatioKey]) && videoConfig.aspect_ratio) {
      allowedParams[aspectRatioKey] = videoConfig.aspect_ratio;
    }
    return allowedParams;
  }

  return mergedWithDefaults;
}

function resolveRequestedVideoLengthSeconds(request: SoraGenerateRequest, model?: VideoModel): number {
  const requestConfig = request.videoConfigObject || request.video_config;
  if (typeof requestConfig?.video_length === 'number' && Number.isFinite(requestConfig.video_length)) {
    return Math.max(1, Math.min(GROK_MAX_VIDEO_LENGTH_SECONDS, Math.floor(requestConfig.video_length)));
  }

  if (request.duration && request.duration.trim()) {
    return normalizeGrokVideoLengthSeconds(request.duration);
  }

  if (typeof model?.videoConfigObject?.video_length === 'number' && Number.isFinite(model.videoConfigObject.video_length)) {
    return Math.max(1, Math.min(GROK_MAX_VIDEO_LENGTH_SECONDS, Math.floor(model.videoConfigObject.video_length)));
  }

  return normalizeGrokVideoLengthSeconds(model?.defaultDuration || request.model || '8s');
}

function resolveModelDurationCost(model: VideoModel, request: SoraGenerateRequest): number | null {
  if (!Array.isArray(model.durations) || model.durations.length === 0) return null;

  const requestedDurationValue = (request.duration || '').trim().toLowerCase();
  if (requestedDurationValue) {
    const exactValueMatch = model.durations.find(
      (duration) => duration.value.trim().toLowerCase() === requestedDurationValue
    );
    if (exactValueMatch && Number.isFinite(exactValueMatch.cost)) {
      return Math.max(0, exactValueMatch.cost);
    }
  }

  const requestedSeconds = resolveRequestedVideoLengthSeconds(request, model);
  const exactSecondsMatch = model.durations.find(
    (duration) => normalizeDurationSeconds(duration.value) === requestedSeconds
  );
  if (exactSecondsMatch && Number.isFinite(exactSecondsMatch.cost)) {
    return Math.max(0, exactSecondsMatch.cost);
  }

  const defaultMatch = model.durations.find(
    (duration) => duration.value === model.defaultDuration
  ) || model.durations[0];
  if (defaultMatch && Number.isFinite(defaultMatch.cost)) {
    return Math.max(0, defaultMatch.cost);
  }

  return null;
}

export function resolveVideoGenerationCost(
  pricing: { soraVideo10s: number; soraVideo15s: number; soraVideo25s: number },
  request: SoraGenerateRequest,
  model?: VideoModel
): number {
  const modelCost = model ? resolveModelDurationCost(model, request) : null;
  if (modelCost !== null) return modelCost;

  const durationHint = `${request.duration || ''} ${request.model || ''}`.toLowerCase();
  const requestedSeconds = resolveRequestedVideoLengthSeconds(request, model);

  if (durationHint.includes('25') || requestedSeconds >= 25) {
    return pricing.soraVideo25s;
  }
  if (durationHint.includes('15') || requestedSeconds >= 15) {
    return pricing.soraVideo15s;
  }
  return pricing.soraVideo10s;
}
function getTypeAndCost(
  model: string,
  pricing: { soraVideo10s: number; soraVideo15s: number; soraVideo25s: number }
): { type: 'sora-video'; cost: number } {
  if (model.includes('25s') || model.includes('25')) {
    return { type: 'sora-video', cost: pricing.soraVideo25s };
  }
  if (model.includes('15s') || model.includes('15')) {
    return { type: 'sora-video', cost: pricing.soraVideo15s };
  }
  return { type: 'sora-video', cost: pricing.soraVideo10s };
}

function parseLegacySoraModel(model: string): {
  apiModel: 'sora-2';
  orientation: 'landscape' | 'portrait';
  seconds: string;
  size?: string;
} {
  const normalizedModel = String(model || '').toLowerCase();
  const apiModel: 'sora-2' = 'sora-2';
  let orientation: 'landscape' | 'portrait' = 'landscape';
  let seconds = '8';

  if (normalizedModel.includes('portrait')) {
    orientation = 'portrait';
  }

  if (normalizedModel.includes('25s') || normalizedModel.includes('25')) {
    seconds = '20';
  } else if (normalizedModel.includes('15s') || normalizedModel.includes('15')) {
    seconds = '15';
  } else if (normalizedModel.includes('12s') || normalizedModel.includes('12')) {
    seconds = '12';
  } else if (normalizedModel.includes('10s') || normalizedModel.includes('10')) {
    seconds = '10';
  } else if (normalizedModel.includes('4s')) {
    seconds = '4';
  }

  const size = orientation === 'portrait' ? '720x1280' : '1280x720';
  return { apiModel, orientation, seconds, size };
}

function buildVideoMessages(request: ExternalVideoPayload): Array<{
  role: 'user';
  content: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>;
}> {
  const content: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> = [
    {
      type: 'text',
      text: request.prompt || 'Generate a video',
    },
  ];

  for (const file of request.files) {
    if (!file.mimeType.startsWith('image/')) continue;
    content.push({
      type: 'image_url',
      image_url: {
        url: `data:${file.mimeType};base64,${stripDataUrlPrefix(file.data)}`,
      },
    });
  }

  return [{ role: 'user', content }];
}

async function generateViaExternalChat(
  channel: VideoChannel,
  model: VideoModel,
  request: SoraGenerateRequest,
  onProgress?: GenerationProgressCallback
): Promise<GenerateResult> {
  const effectiveBaseUrl = model.baseUrl || channel.baseUrl;
  const effectiveApiKey = model.apiKey || channel.apiKey;

  if (!effectiveBaseUrl || !effectiveApiKey) {
    throw new Error('视频渠道未配置 Base URL 或 API Key');
  }

  const resolvedModel = mapChannelModel(channel.type, model, request);
  const files = request.files || [];
  const prompt = request.prompt || '';
  const useStreamingResponse = channel.type === 'flow2api';

  const payload: Record<string, unknown> = {
    model: resolvedModel,
    messages: buildVideoMessages({ prompt, model: resolvedModel, files }),
    stream: useStreamingResponse,
  };

  if (channel.type === 'grok2api') {
    payload.video_config = resolveVideoConfigObject(request, model);
  }

  const apiUrl = `${effectiveBaseUrl.replace(/\/$/, '')}/v1/chat/completions`;
  onProgress?.(5);

  logInfo('[Video Adapter] External chat request:', {
    channelType: channel.type,
    channelName: channel.name,
    apiUrl,
    model: resolvedModel,
    stream: useStreamingResponse,
    hasImages: files.some((file) => file.mimeType.startsWith('image/')),
  });

  const response = await fetchWithRetry(undiciFetch, apiUrl, () => ({
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${effectiveApiKey}`,
    },
    body: JSON.stringify(payload),
  }));

  if (!response.ok) {
    const rawBody = await response.text();
    let parsedBody: unknown = null;
    if (rawBody.trim()) {
      try {
        parsedBody = JSON.parse(rawBody) as ExternalChatResponse;
      } catch {
        parsedBody = null;
      }
    }
    const upstreamError = extractUpstreamErrorMessage(parsedBody);
    const detail = upstreamError || compactSnippet(rawBody, 400);
    throw new Error(`上游返回错误 (${response.status})${detail ? `: ${detail}` : ''}`);
  }

  let rawUrl: string | null = null;
  let upstreamMessage = '';
  let rawBody = '';

  if (useStreamingResponse) {
    const parsedStream = await readStreamingExternalChatResponse(
      response as unknown as Response,
      effectiveBaseUrl,
      onProgress
    );
    rawBody = parsedStream.rawBody;
    rawUrl = parsedStream.url;
    upstreamMessage = parsedStream.errorMessage || parsedStream.text;
  } else {
    rawBody = await response.text();
    let parsedBody: unknown = null;
    if (rawBody.trim()) {
      try {
        parsedBody = JSON.parse(rawBody) as ExternalChatResponse;
      } catch {
        parsedBody = null;
      }
    }
    rawUrl = extractVideoUrlFromUnknownPayload(parsedBody, effectiveBaseUrl);
    upstreamMessage = extractContentFromExternalChatPayload(parsedBody);
  }

  if (!rawUrl) {
    const message = compactSnippet(upstreamMessage, 220);
    if (message) {
      logWarn('[Video Adapter] Upstream response without video URL:', message);
      throw new Error(`上游未返回视频链接: ${message}`);
    }
    logWarn('[Video Adapter] Unrecognized upstream payload:', compactSnippet(rawBody, 300));
    throw new Error('无法从上游响应中解析视频链接');
  }

  onProgress?.(100);

  const cost = resolveVideoGenerationCost((await getSystemConfig()).pricing, request, model);
  return {
    type: 'sora-video',
    url: rawUrl,
    cost,
    videoChannelId: channel.id,
  };
}

async function generateViaSoraApi(
  request: SoraGenerateRequest,
  onProgress?: GenerationProgressCallback,
  channelId?: string
): Promise<GenerateResult> {
  const config = await getSystemConfig();
  const { apiModel, orientation, seconds, size } = parseLegacySoraModel(request.model);

  const videoRequest: VideoGenerationRequest = {
    prompt: request.prompt,
    model: apiModel,
    orientation,
    seconds,
    size,
  };

  if (request.files && request.files.length > 0) {
    const imageFile = request.files.find((file) => file.mimeType.startsWith('image/'));
    if (imageFile) {
      videoRequest.input_image = stripDataUrlPrefix(imageFile.data);
    }
  }

  if (request.style_id) {
    videoRequest.style_id = request.style_id;
  }
  if (request.remix_target_id) {
    videoRequest.remix_target_id = request.remix_target_id;
  }

  const result = await generateVideo(
    videoRequest,
    onProgress ? (progress) => onProgress(progress) : undefined,
    channelId ? { channelId } : undefined
  );

  if (!result.data || result.data.length === 0 || !result.data[0].url) {
    throw new Error('视频生成失败：未返回有效的视频 URL');
  }

  const first = result.data[0];
  const { type, cost } = getTypeAndCost(request.model, config.pricing);

  return {
    type,
    url: first.url,
    cost,
    videoId: result.id,
    videoChannelId: result.channelId,
    permalink: typeof first.permalink === 'string' ? first.permalink : undefined,
    revised_prompt: typeof first.revised_prompt === 'string' ? first.revised_prompt : undefined,
  };
}

async function generateViaLingkeMedia(
  channel: VideoChannel,
  model: VideoModel,
  request: SoraGenerateRequest,
  onProgress?: GenerationProgressCallback
): Promise<GenerateResult> {
  const effectiveBaseUrl = model.baseUrl || channel.baseUrl;
  const effectiveApiKey = model.apiKey || channel.apiKey;

  if (!effectiveBaseUrl || !effectiveApiKey) {
    throw new Error('灵刻媒体渠道未配置 Base URL 或 API Key');
  }

  const resolvedModel = mapChannelModel(channel.type, model, request);
  const videoConfig = resolveVideoConfigObject(request, model);
  const runtimeConfig = getLingkeModelRuntimeConfig(model, resolvedModel);
  const generationMode = request.videoConfigObject?.generation_mode
    || request.video_config?.generation_mode
    || model.videoConfigObject?.generation_mode;

  const params = buildLingkeVideoParams(model, resolvedModel, videoConfig, generationMode);
  const preparedFiles = await prepareLingkeReferenceFiles(
    request.files || [],
    request.publicBaseUrl
  );
  const referenceParams = buildLingkeReferenceParams(model, resolvedModel, preparedFiles);
  const inputMode = runtimeConfig.inputMode;
  const requiresReferenceImage = inputMode === 'reference' || inputMode === 'first_frame' || inputMode === 'first_last_frame' || inputMode === 'motion_control';
  const hasImageReference = preparedFiles.some((file) => file.mimeType.startsWith('image/'));
  if (requiresReferenceImage && !hasImageReference) {
    throw new Error(`模型 ${resolvedModel} 需要至少上传 1 张参考图片后再生成`);
  }
  Object.assign(params, referenceParams);
  const finalParams = sanitizeLingkeUploadParams(params, runtimeConfig, preparedFiles);
  const inlineUploadFields = findLingkeInlineUploadFields(finalParams);
  if (inlineUploadFields.length > 0) {
    throw new Error(
      `灵刻模型参考素材未成功转换为公网 URL，请检查站点公网访问或图床配置（字段: ${inlineUploadFields.join(', ')}）`
    );
  }

  logInfo('[LingkeMedia] Prepared request params:', {
    model: resolvedModel,
    inputMode,
    imageFiles: preparedFiles.filter((file) => file.mimeType.startsWith('image/')).length,
    videoFiles: preparedFiles.filter((file) => file.mimeType.startsWith('video/')).length,
    uploadParamNames: runtimeConfig.uploadParamNames,
    imageUploadParamNames: runtimeConfig.imageUploadParamNames,
    videoUploadParamNames: runtimeConfig.videoUploadParamNames,
    submitOnlyUpstreamParams: runtimeConfig.submitOnlyUpstreamParams,
    params: summarizeLingkeParams(finalParams),
  });

  const apiUrl = `${effectiveBaseUrl.replace(/\/$/, '')}/v1/media/generate`;
  onProgress?.(5);

  const createResponse = await fetchWithRetry(undiciFetch, apiUrl, () => ({
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${effectiveApiKey}`,
    },
    body: JSON.stringify({
      model: resolvedModel,
      prompt: request.prompt || 'Generate video',
      params: finalParams,
    }),
  }));

  const created: any = await createResponse.json().catch(() => ({}));
  logInfo('[LingkeMedia] Create task response:', {
    model: resolvedModel,
    status: createResponse.status,
    code: created?.code,
    msg: created?.msg,
    taskId: created?.data?.task_id || created?.data?.taskId || null,
    dataKeys: created?.data && typeof created.data === 'object' ? Object.keys(created.data) : [],
  });
  if (!createResponse.ok || Number(created?.code ?? 0) !== 200) {
    const detail = String(created?.data?.详情 || created?.data?.msg || created?.msg || '创建任务失败');
    const upstreamBalance = created?.data?.['当前余额'];
    const requiredAmount = created?.data?.['需要金额'];
    const balanceGap = created?.data?.['差额'];
    if (Number(created?.code ?? 0) === 402 || detail.includes('余额不足')) {
      const extras = [
        upstreamBalance !== undefined ? `当前余额 ${upstreamBalance}` : '',
        requiredAmount !== undefined ? `需要 ${requiredAmount}` : '',
        balanceGap !== undefined ? `差额 ${balanceGap}` : '',
      ].filter(Boolean).join('，');
      throw new Error(`灵刻媒体视频生成失败: 上游渠道余额不足${extras ? `（${extras}）` : ''}`);
    }
    throw new Error(`灵刻媒体视频生成失败${createResponse.ok ? '' : ` (${createResponse.status})`}: ${detail}`);
  }

  const taskId = created?.data?.task_id || created?.data?.taskId;
  if (!taskId) {
    throw new Error('灵刻媒体未返回任务 ID');
  }

  await onProgress?.(10, {
    upstreamTaskId: String(taskId),
    upstreamStatus: String(created?.msg || '任务创建成功'),
    upstreamState: 'created',
    upstreamStatusGroup: 'pending',
    upstreamProgress: 10,
  });

  let lastStatusSnapshot = '';
  for (let attempt = 0; attempt < LINGKE_MEDIA_MAX_POLLS; attempt += 1) {
    const snapshot = await fetchLingkeMediaVideoTaskSnapshot(
      effectiveBaseUrl,
      effectiveApiKey,
      String(taskId)
    );

    const statusSnapshot = JSON.stringify({
      attempt,
      code: snapshot.code,
      state: snapshot.state,
      status: snapshot.status,
      message: snapshot.message || null,
      hasDirectUrl: Boolean(snapshot.resultUrl),
    });
    if (statusSnapshot !== lastStatusSnapshot || attempt === 0 || attempt % 10 === 0 || snapshot.resultUrl) {
      logInfo('[LingkeMedia] Poll status:', statusSnapshot);
      lastStatusSnapshot = statusSnapshot;
    }

    if (snapshot.final && snapshot.resultUrl) {
      await onProgress?.(100, {
        upstreamTaskId: String(taskId),
        upstreamStatus: snapshot.status || '已完成',
        upstreamState: snapshot.state || 'completed',
        upstreamStatusGroup: 'completed',
        upstreamProgress: 100,
        upstreamResultUrl: snapshot.resultUrl,
        upstreamFinal: true,
      });
      return {
        type: 'sora-video',
        url: snapshot.resultUrl,
        cost: resolveVideoGenerationCost((await getSystemConfig()).pricing, request, model),
        videoChannelId: channel.id,
      };
    }

    if (snapshot.state === 'failed') {
      const upstreamDetails = snapshot.raw && typeof snapshot.raw === 'object'
        ? compactSnippet(JSON.stringify(snapshot.raw), 600)
        : '';
      throw new Error(
        snapshot.message
        || snapshot.status
        || (upstreamDetails ? `灵刻媒体视频任务失败：${upstreamDetails}` : '灵刻媒体视频任务失败')
      );
    }

    await onProgress?.(Math.max(snapshot.progress, Math.min(95, 10 + Math.floor(attempt / 2))), {
      upstreamTaskId: String(taskId),
      upstreamStatus: snapshot.status || undefined,
      upstreamState: snapshot.state || undefined,
      upstreamStatusGroup: snapshot.statusGroup,
      upstreamProgress: Math.max(snapshot.progress, Math.min(95, 10 + Math.floor(attempt / 2))),
    });
    await new Promise((resolve) => setTimeout(resolve, LINGKE_MEDIA_POLL_INTERVAL_MS));
  }

  throw new Error('灵刻媒体视频任务超时');
}

async function generateByVideoModel(
  request: SoraGenerateRequest,
  onProgress?: GenerationProgressCallback
): Promise<GenerateResult | null> {
  if (!request.modelId) return null;

  const modelConfig = await getVideoModelWithChannel(request.modelId);
  if (!modelConfig) {
    throw new Error('视频模型不存在或未配置');
  }

  const { model, channel } = modelConfig;

  if (!model.enabled) {
    throw new Error('视频模型已禁用');
  }
  if (!channel.enabled) {
    throw new Error('视频渠道已禁用');
  }

  const channelType = channel.type;
  if (channelType === 'flow2api' || channelType === 'grok2api' || channelType === 'openai-compatible') {
    return generateViaExternalChat(channel, model, request, onProgress);
  }

  if (channelType === 'lingke-media') {
    return generateViaLingkeMedia(channel, model, request, onProgress);
  }

  if (channelType === 'sora' || channelType === 'apexerapi') {
    const ratio = request.aspectRatio || model.defaultAspectRatio || 'landscape';
    const duration = request.duration || model.defaultDuration || '8s';

    const fallbackRequest: SoraGenerateRequest = {
      ...request,
      model: `sora2-${ratio}-${duration}`,
    };
    return generateViaSoraApi(fallbackRequest, onProgress, channel.id);
  }

  throw new Error(`不支持的视频渠道类型: ${channelType}`);
}

export async function generateWithSora(
  request: SoraGenerateRequest,
  onProgress?: GenerationProgressCallback
): Promise<GenerateResult> {
  logDebug('[Sora] Request config:', {
    model: request.model,
    modelId: request.modelId,
    prompt: request.prompt?.substring(0, 50),
    hasFiles: request.files && request.files.length > 0,
    filesCount: request.files?.length || 0,
  });

  try {
    const routed = await generateByVideoModel(request, onProgress);
    if (routed) {
      logInfo('[Sora] Generation completed by dynamic channel:', {
        modelId: request.modelId,
        url: routed.url,
      });
      return routed;
    }

    const legacy = await generateViaSoraApi(request, onProgress);
    logInfo('[Sora] Generation completed by legacy sora route:', {
      url: legacy.url,
    });
    return legacy;
  } catch (error) {
    logError('[Sora] Generation failed:', error);
    throw error;
  }
}
