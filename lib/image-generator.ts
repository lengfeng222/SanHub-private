/**
 * 统一图像生成器
 * 根据渠道类型动态选择请求方式
 */

import { fetch as undiciFetch, Agent } from 'undici';
import { getImageModelWithChannel } from './db';
import { resolveImageModelWithChannelSelection } from './model-channel-resolver';
import { uploadToPicUI } from './picui';
import { fetchWithRetry } from './http-retry';
import { isTransientError } from './polling-utils';
import { saveMediaToPublicFile } from './media-storage';
import type { GenerateResult } from '@/types';

export interface ImageGenerateRequest {
  modelId: string;
  prompt: string;
  size?: string;
  aspectRatio?: string;
  imageSize?: string;
  quality?: string;
  images?: Array<{ mimeType: string; data: string }>;
  idempotencyKey?: string;
  publicBaseUrl?: string;
}

export type ImageGenerationProgressCallback = (
  progress: number,
  meta?: Record<string, unknown>
) => void | Promise<void>;

export type LingkeMediaImageTaskSnapshot = {
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

// Key 轮询索引
const keyIndexMap = new Map<string, number>();

function getNextApiKey(keys: string, channelId: string): string {
  const keyList = keys.split(',').map(k => k.trim()).filter(k => k);
  if (keyList.length === 0) {
    throw new Error('API Key 未配置');
  }
  const currentIndex = keyIndexMap.get(channelId) || 0;
  const key = keyList[currentIndex % keyList.length];
  keyIndexMap.set(channelId, currentIndex + 1);
  return key;
}

// 下载图片并转换为 base64
async function downloadImageAsBase64(imageUrl: string): Promise<string> {
  const response = await fetchWithRetry(undiciFetch, imageUrl, () => ({ dispatcher: imageAgent }));
  if (!response.ok) {
    throw new Error(`下载图片失败 (${response.status})`);
  }
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const base64 = buffer.toString('base64');
  const contentType = response.headers.get('content-type') || 'image/jpeg';
  return `data:${contentType};base64,${base64}`;
}

// 上传图片到图床获取 URL
async function uploadImageForApi(
  imageData: string,
  index: number
): Promise<string> {
  const filename = `input_${Date.now()}_${index}.jpg`;
  const url = await uploadToPicUI(imageData, filename, { preferDirectS3Url: true });
  if (!url) {
    throw new Error('参考图上传失败，请检查默认图床桶配置');
  }
  return url;
}

export type ResolutionMap = Record<string, string | Record<string, string>>;

export type ResolvedImageTarget = {
  model: string;
  size?: string;
  usedModelFromMapping: boolean;
};

const PIXEL_SIZE_PATTERN = /^\d+[x×]\d+$/i;
const ASPECT_RATIO_PATTERN = /^\d+:\d+$/;
const SYMBOLIC_IMAGE_SIZE_PATTERN = /^(?:\d+K|SD|HD|\d{3,4}P)$/i;

const isSizeValue = (value: string): boolean =>
  PIXEL_SIZE_PATTERN.test(value)
  || ASPECT_RATIO_PATTERN.test(value)
  || SYMBOLIC_IMAGE_SIZE_PATTERN.test(value.trim());

const GENERATION_POST_RETRY_OPTIONS = { attempts: 1 };
const IMAGE_REQUEST_TIMEOUT_MS = 5 * 60 * 1000;
const LINGKE_MEDIA_IMAGE_POLL_INTERVAL_MS = 3000;
const LINGKE_MEDIA_IMAGE_MAX_POLLS = 1200;

const imageAgent = new Agent({
  bodyTimeout: 0,
  headersTimeout: IMAGE_REQUEST_TIMEOUT_MS,
  keepAliveTimeout: IMAGE_REQUEST_TIMEOUT_MS,
  keepAliveMaxTimeout: IMAGE_REQUEST_TIMEOUT_MS,
  pipelining: 0,
  connections: 30,
  connect: {
    timeout: IMAGE_REQUEST_TIMEOUT_MS,
  },
});

const IMAGE_URL_KEYS = [
  'url',
  'preview_url',
  'previewUrl',
  'image_url',
  'imageUrl',
  'output_url',
  'outputUrl',
  'fileUri',
  'file_uri',
];

function isUsableImageUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  return (
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('data:image/')
  );
}

function pickImageUrlFromString(value: string, depth: number): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  if (isUsableImageUrl(trimmed)) {
    return trimmed;
  }

  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      const parsed = JSON.parse(trimmed);
      const nested = pickImageUrl(parsed, depth + 1);
      if (nested) return nested;
    } catch {
      // Continue with pattern extraction below.
    }
  }

  const keyedUrlMatch = trimmed.match(
    /"(?:url|preview_url|previewUrl|image_url|imageUrl|output_url|outputUrl|fileUri|file_uri)"\s*:\s*"([^"]+)"/i
  );
  if (keyedUrlMatch && isUsableImageUrl(keyedUrlMatch[1])) {
    return keyedUrlMatch[1].trim();
  }

  const dataUrlMatch = trimmed.match(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/);
  if (dataUrlMatch) {
    return dataUrlMatch[0];
  }

  const directUrlMatch = trimmed.match(/https?:\/\/[^\s"'<>\])`]+/);
  if (directUrlMatch && isUsableImageUrl(directUrlMatch[0])) {
    return directUrlMatch[0].trim();
  }

  return undefined;
}

function pickImageUrl(value: unknown, depth = 0): string | undefined {
  if (typeof value === 'string') return pickImageUrlFromString(value, depth);
  if (!value || typeof value !== 'object' || depth > 6) return undefined;

  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = pickImageUrl(item, depth + 1);
      if (nested) return nested;
    }
    return undefined;
  }

  const record = value as Record<string, unknown>;
  for (const key of IMAGE_URL_KEYS) {
    const candidate = record[key];
    if (typeof candidate === 'string' && isUsableImageUrl(candidate)) {
      return candidate.trim();
    }
  }

  const priorityNestedKeys = [
    'inlineData',
    'inline_data',
    'fileData',
    'file_data',
    'image',
    'images',
    'output',
    'outputs',
    'result',
    'results',
    'data',
    'parts',
    'content',
  ];

  for (const key of priorityNestedKeys) {
    const nested = pickImageUrl(record[key], depth + 1);
    if (nested) return nested;
  }

  for (const [key, candidate] of Object.entries(record)) {
    if (/url|uri/i.test(key) && typeof candidate === 'string' && isUsableImageUrl(candidate)) {
      return candidate.trim();
    }
  }

  for (const candidate of Object.values(record)) {
    const nested = pickImageUrl(candidate, depth + 1);
    if (nested) return nested;
  }

  return undefined;
}

function buildOpenAIImageInput(
  images: ImageGenerateRequest['images']
): string | string[] | undefined {
  const refs = (images || [])
    .map((image) => image.data)
    .filter((data): data is string => Boolean(data));

  if (refs.length === 0) return undefined;
  return refs.length === 1 ? refs[0] : refs;
}

function clampLingkeProgress(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
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
    normalized.includes('not exist') ||
    normalized.includes('not found') ||
    normalized.includes('does not exist') ||
    normalized.includes('cancel') ||
    normalized.includes('失败') ||
    normalized.includes('错误') ||
    normalized.includes('不存在') ||
    normalized.includes('未找到') ||
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

function resolveLingkeStatusGroup(
  status: string,
  hasResult: boolean
): 'pending' | 'processing' | 'completed' | 'failed' | 'timeout' {
  if (hasResult) return 'completed';

  const normalized = normalizeLingkeStatus(status);
  if (!normalized) return 'processing';
  if (normalized === 'pending') return 'pending';
  if (normalized === 'failed') return 'failed';
  if (normalized === 'completed') return 'completed';
  return 'processing';
}

function buildLingkeImageTaskSnapshot(
  taskId: string,
  data: any
): LingkeMediaImageTaskSnapshot {
  const resultUrl = pickImageUrl(data?.data) || pickImageUrl(data);
  const statusLabel = String(data?.data?.status || data?.status || '').trim();
  const message = String(data?.data?.error || data?.error || data?.data?.msg || data?.msg || '').trim() || undefined;
  const state = normalizeLingkeStatus(String(data?.data?.state || data?.state || '').trim() || statusLabel || message || '');
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
    if (resultUrl) progress = 100;
    else if (state === 'pending') progress = 10;
    else if (state === 'processing') progress = 60;
    else if (state === 'failed') progress = 0;
  }

  return {
    taskId,
    code: Number(data?.code ?? 0),
    status: statusLabel || message || '',
    state,
    statusGroup: resolveLingkeStatusGroup(statusLabel || message || '', Boolean(resultUrl)),
    progress,
    message,
    resultUrl: resultUrl || undefined,
    final: Boolean(resultUrl),
    raw: data,
  };
}

export async function fetchLingkeMediaImageTaskSnapshot(
  baseUrl: string,
  apiKey: string,
  channelId: string,
  taskId: string
): Promise<LingkeMediaImageTaskSnapshot> {
  const statusUrl = `${baseUrl.replace(/\/$/, '')}/v1/media/status?task_id=${encodeURIComponent(taskId)}`;
  const key = getNextApiKey(apiKey, channelId);
  const response = await fetchWithRetry(undiciFetch, statusUrl, () => ({
    method: 'GET',
    headers: {
      Authorization: `Bearer ${key}`,
    },
    dispatcher: imageAgent,
  }));

  const data: any = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`灵刻媒体查询失败 (${response.status})`);
  }

  return buildLingkeImageTaskSnapshot(taskId, data);
}

export function resolveImageTarget(
  apiModel: string,
  resolutions: ResolutionMap | undefined,
  aspectRatio?: string,
  imageSize?: string
): ResolvedImageTarget {
  let resolvedModel = apiModel;
  let resolvedSize: string | undefined;
  let usedModelFromMapping = false;

  const applyValue = (value: string | undefined) => {
    if (!value) return;
    if (isSizeValue(value)) {
      resolvedSize = value;
    } else {
      resolvedModel = value;
      usedModelFromMapping = true;
    }
  };

  if (resolutions && aspectRatio) {
    const ratioConfig = resolutions[aspectRatio];
    if (typeof ratioConfig === 'string') {
      applyValue(ratioConfig);
    } else if (ratioConfig && typeof ratioConfig === 'object' && imageSize) {
      applyValue((ratioConfig as Record<string, string>)[imageSize]);
    }
  }

  if (resolutions && imageSize) {
    const sizeConfig = resolutions[imageSize];
    if (typeof sizeConfig === 'string') {
      applyValue(sizeConfig);
    } else if (sizeConfig && typeof sizeConfig === 'object' && aspectRatio) {
      applyValue((sizeConfig as Record<string, string>)[aspectRatio]);
    }
  }

  return { model: resolvedModel, size: resolvedSize, usedModelFromMapping };
}

// ========================================
// OpenAI Compatible API
// ========================================

async function generateWithOpenAI(
  request: ImageGenerateRequest,
  baseUrl: string,
  apiKey: string,
  target: ResolvedImageTarget,
  channelId: string
): Promise<GenerateResult> {
  const key = getNextApiKey(apiKey, channelId);
  const url = `${baseUrl.replace(/\/$/, '')}/v1/images/generations`;

  const payload: Record<string, unknown> = {
    model: target.model,
    prompt: request.prompt,
    n: 1,
    response_format: 'url',
  };

  // 添加尺寸参数：管理员配置的分辨率映射 > 显式 size > 硬编码兜底
  if (target.size) {
    payload.size = target.size;
  } else if (request.size) {
    payload.size = request.size;
  } else if (request.aspectRatio) {
    const sizeMap: Record<string, string> = {
      '1:1': '1024x1024',
      '16:9': '1792x1024',
      '9:16': '1024x1792',
      '3:2': '1536x1024',
      '2:3': '1024x1536',
    };
    payload.size = sizeMap[request.aspectRatio] || '1024x1024';
  }

  // 统一乘号（管理员可能填了 Unicode ×）
  if (typeof payload.size === 'string') {
    payload.size = payload.size.replace(/×/g, 'x');
  }
  // quality (high / medium / low) — 部分上游代理支持
  if (request.quality) {
    payload.quality = request.quality;
  }

  // Only send Gemini-style image_config when there is no explicit OpenAI size.
  // Some compatible gateways derive low-res sizes from aspect_ratio and let it
  // override the pixel size, e.g. 9:16 -> 720x1280.
  const hasExplicitPixelSize = typeof payload.size === 'string' && isSizeValue(payload.size);
  if (!hasExplicitPixelSize && request.imageSize) {
    const googleConfig: Record<string, string> = {};
    if (request.aspectRatio) googleConfig.aspect_ratio = request.aspectRatio;
    googleConfig.image_size = request.imageSize;
    payload.extra_body = { google: { image_config: googleConfig } };
  }

  const imageInput = buildOpenAIImageInput(request.images);
  if (imageInput) {
    payload.image = imageInput;
  }

  const response = await fetchWithRetry(undiciFetch, url, () => ({
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(request.idempotencyKey
        ? {
            'Idempotency-Key': request.idempotencyKey,
            'X-Idempotency-Key': request.idempotencyKey,
          }
        : {}),
    },
    body: JSON.stringify(payload),
    dispatcher: imageAgent,
  }), GENERATION_POST_RETRY_OPTIONS);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API 错误 (${response.status}): ${errorText}`);
  }

  const data: any = await response.json();
  const imageData = data.data?.[0];

  const remoteImageUrl = pickImageUrl(imageData);

  if (!imageData?.b64_json && !remoteImageUrl) {
    throw new Error('API 返回成功但未包含图片');
  }

  const resultUrl = remoteImageUrl || `data:image/png;base64,${imageData.b64_json}`;

  return {
    type: 'gemini-image', // 统一类型
    url: resultUrl,
    cost: 0, // 由调用方设置
  };
}

// ========================================
// Gemini Native API
// ========================================

async function generateWithGemini(
  request: ImageGenerateRequest,
  baseUrl: string,
  apiKey: string,
  apiModel: string,
  channelId: string
): Promise<GenerateResult> {
  const key = getNextApiKey(apiKey, channelId);
  const url = `${baseUrl.replace(/\/$/, '')}/v1beta/models/${apiModel}:generateContent?key=${key}`;

  const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [];

  // 添加参考图
  if (request.images && request.images.length > 0) {
    for (const img of request.images) {
      parts.push({
        inlineData: {
          mimeType: img.mimeType || 'image/jpeg',
          data: img.data.replace(/^data:[^;]+;base64,/, ''),
        },
      });
    }
  }

  // 添加提示词
  if (request.prompt) {
    parts.push({ text: request.prompt });
  }

  const generationConfig: Record<string, unknown> = {
    imageConfig: {
      aspectRatio: request.aspectRatio || '1:1',
    },
  };

  if (request.imageSize) {
    (generationConfig.imageConfig as Record<string, unknown>).imageSize = request.imageSize;
  }

  const response = await fetchWithRetry(undiciFetch, url, () => ({
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(request.idempotencyKey
        ? {
            'Idempotency-Key': request.idempotencyKey,
            'X-Idempotency-Key': request.idempotencyKey,
          }
        : {}),
    },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig,
    }),
    dispatcher: imageAgent,
  }), GENERATION_POST_RETRY_OPTIONS);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API 错误 (${response.status}): ${errorText}`);
  }

  const data: any = await response.json();
  const generatedImages: string[] = [];
  const responseImageUrl = pickImageUrl(data);

  if (responseImageUrl) {
    generatedImages.push(responseImageUrl);
  }

  const responseParts = data.candidates?.[0]?.content?.parts;
  if (generatedImages.length === 0 && Array.isArray(responseParts)) {
    for (const part of responseParts) {
      const inlineData = part.inlineData || part.inline_data;
      const remoteImageUrl = pickImageUrl(part) || pickImageUrl(inlineData);
      if (remoteImageUrl) {
        generatedImages.push(remoteImageUrl);
        continue;
      }
      if (inlineData?.data) {
        const mime = inlineData.mimeType || inlineData.mime_type || 'image/png';
        generatedImages.push(`data:${mime};base64,${inlineData.data}`);
      }
    }
  }

  if (generatedImages.length === 0) {
    const textPart = data.candidates?.[0]?.content?.parts?.find((p: { text?: string }) => p.text);
    if (textPart?.text) {
      throw new Error(`生成失败: ${textPart.text}`);
    }
    throw new Error('API 返回成功但未包含图片');
  }

  return {
    type: 'gemini-image',
    url: generatedImages[0],
    cost: 0,
  };
}

// ========================================
// ModelScope API
// ========================================

const MODELSCOPE_ASYNC_MODELS = new Set([
  'Qwen/Qwen-Image',
  'Qwen/Qwen-Image-2512',
  'Qwen/Qwen-Image-Edit-2509',
  'Qwen/Qwen-Image-Edit-2511',
  'black-forest-labs/FLUX.2-dev',
]);

async function pollModelScopeTask(baseUrl: string, apiKey: string, taskId: string): Promise<string> {
  const interval = 5000;
  let consecutiveErrors = 0;

  while (true) {
    try {
      const response = await fetchWithRetry(undiciFetch, `${baseUrl}v1/tasks/${taskId}`, () => ({
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'X-ModelScope-Task-Type': 'image_generation',
        },
        dispatcher: imageAgent,
      }));

      if (!response.ok) {
        throw new Error(
          response.status >= 500
            ? `Server Error: ${response.status}`
            : `ModelScope 任务查询失败 (${response.status})`
        );
      }

      const data: any = await response.json();
      consecutiveErrors = 0;

      if (data.task_status === 'SUCCEED') {
        const outputUrl = data.output_images?.[0];
        if (!outputUrl) throw new Error('任务完成但未返回图片');
        return outputUrl;
      }

      if (data.task_status === 'FAILED') {
        throw new Error(data.message || '任务失败');
      }
    } catch (error) {
      if (!isTransientError(error)) {
        throw error;
      }
      consecutiveErrors += 1;
      const retryDelayMs = Math.min(5000 * 2 ** (consecutiveErrors - 1), 60000);
      await new Promise(resolve => setTimeout(resolve, retryDelayMs));
      continue;
    }

    await new Promise(resolve => setTimeout(resolve, interval));
  }
}

async function generateWithModelScope(
  request: ImageGenerateRequest,
  baseUrl: string,
  apiKey: string,
  apiModel: string,
  channelId: string,
  size?: string
): Promise<GenerateResult> {
  const key = getNextApiKey(apiKey, channelId);
  const normalizedBaseUrl = baseUrl.replace(/\/$/, '') + '/';
  const url = `${normalizedBaseUrl}v1/images/generations`;
  const useAsync = MODELSCOPE_ASYNC_MODELS.has(apiModel);

  // 上传参考图获取 URL
  const imageUrls: string[] = [];
  if (request.images && request.images.length > 0) {
    for (let i = 0; i < request.images.length; i++) {
      const img = request.images[i];
      const imgUrl = await uploadImageForApi(img.data, i);
      imageUrls.push(imgUrl);
    }
  }

  const payload: Record<string, unknown> = {
    model: apiModel,
    prompt: request.prompt,
    ...(size && { size }),
    ...(imageUrls.length > 0 && { image_url: imageUrls }),
  };

  const response = await fetchWithRetry(undiciFetch, url, () => ({
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(useAsync ? { 'X-ModelScope-Async-Mode': 'true' } : {}),
      ...(request.idempotencyKey
        ? {
            'Idempotency-Key': request.idempotencyKey,
            'X-Idempotency-Key': request.idempotencyKey,
          }
        : {}),
    },
    body: JSON.stringify(payload),
    dispatcher: imageAgent,
  }), GENERATION_POST_RETRY_OPTIONS);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ModelScope API 错误 (${response.status}): ${errorText}`);
  }

  if (useAsync) {
    const data: any = await response.json();
    if (!data.task_id) throw new Error('未返回任务 ID');
    const imageUrl = await pollModelScopeTask(normalizedBaseUrl, key, data.task_id);
    const base64Image = await downloadImageAsBase64(imageUrl);
    return { type: 'zimage-image', url: base64Image, cost: 0 };
  }

  const data: any = await response.json();
  if (!data.images?.[0]?.url) {
    throw new Error('API 返回成功但未包含图片');
  }

  const base64Image = await downloadImageAsBase64(data.images[0].url);
  return { type: 'zimage-image', url: base64Image, cost: 0 };
}

// ========================================
// Gitee AI API
// ========================================

function parseDataUrl(dataUrl: string): { mimeType: string; data: string } | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return { mimeType: match[1], data: match[2] };
}

async function generateWithGitee(
  request: ImageGenerateRequest,
  baseUrl: string,
  apiKey: string,
  apiModel: string,
  channelId: string,
  size?: string
): Promise<GenerateResult> {
  const key = getNextApiKey(apiKey, channelId);
  const normalizedBaseUrl = baseUrl.replace(/\/$/, '') + '/';

  // 特殊模型处理
  if (apiModel === 'SeedVR2-3B') {
    return generateWithGiteeUpscale(request, normalizedBaseUrl, key, apiModel);
  }
  if (apiModel === 'RMBG-2.0') {
    return generateWithGiteeMatting(request, normalizedBaseUrl, key, apiModel);
  }

  const url = `${normalizedBaseUrl}v1/images/generations`;
  const payload = {
    prompt: request.prompt,
    model: apiModel,
    ...(size && { size }),
  };

  const response = await fetchWithRetry(undiciFetch, url, () => ({
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(request.idempotencyKey
        ? {
            'Idempotency-Key': request.idempotencyKey,
            'X-Idempotency-Key': request.idempotencyKey,
          }
        : {}),
    },
    body: JSON.stringify(payload),
    dispatcher: imageAgent,
  }), GENERATION_POST_RETRY_OPTIONS);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gitee API 错误 (${response.status}): ${errorText}`);
  }

  const data: any = await response.json();
  const imageData = data.data?.[0];
  const remoteImageUrl = pickImageUrl(imageData);
  if (!remoteImageUrl && !imageData?.b64_json) {
    throw new Error('API 返回成功但未包含图片');
  }

  const mimeType = imageData.type || 'image/png';
  return {
    type: 'gitee-image',
    url: remoteImageUrl || `data:${mimeType};base64,${imageData.b64_json}`,
    cost: 0,
  };
}

async function generateWithGiteeUpscale(
  request: ImageGenerateRequest,
  baseUrl: string,
  apiKey: string,
  apiModel: string
): Promise<GenerateResult> {
  const url = `${baseUrl}v1/images/upscaling`;
  const input = request.images?.[0];
  if (!input?.data) throw new Error('缺少参考图');

  const buildFormData = () => {
    const formData = new FormData();
    formData.append('model', apiModel);
    formData.append('outscale', '1');
    formData.append('output_format', 'jpg');

    if (input.data.startsWith('http')) {
      formData.append('image_url', input.data);
    } else {
      const parsed = parseDataUrl(input.data);
      const mimeType = parsed?.mimeType || input.mimeType || 'application/octet-stream';
      const base64Data = parsed?.data || input.data;
      const buffer = Buffer.from(base64Data, 'base64');
      const blob = new Blob([buffer], { type: mimeType });
      formData.append('image', blob, 'input.jpg');
    }

    return formData;
  };

  const response = await fetchWithRetry(undiciFetch, url, () => ({
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      ...(request.idempotencyKey
        ? {
            'Idempotency-Key': request.idempotencyKey,
            'X-Idempotency-Key': request.idempotencyKey,
          }
        : {}),
    },
    body: buildFormData() as any,
    dispatcher: imageAgent,
  }) as any, GENERATION_POST_RETRY_OPTIONS);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gitee API 错误 (${response.status}): ${errorText}`);
  }

  const data: any = await response.json();
  const imageData = data.data?.[0];
  const remoteImageUrl = pickImageUrl(imageData);
  if (!remoteImageUrl && !imageData?.b64_json) {
    throw new Error('API 返回成功但未包含图片');
  }

  const resultUrl = remoteImageUrl || `data:${imageData.type || 'image/jpeg'};base64,${imageData.b64_json}`;
  return { type: 'gitee-image', url: resultUrl, cost: 0 };
}

async function generateWithGiteeMatting(
  request: ImageGenerateRequest,
  baseUrl: string,
  apiKey: string,
  apiModel: string
): Promise<GenerateResult> {
  const url = `${baseUrl}v1/images/mattings`;
  const input = request.images?.[0];
  if (!input?.data) throw new Error('缺少参考图');

  const buildFormData = () => {
    const formData = new FormData();
    formData.append('model', apiModel);

    if (input.data.startsWith('http')) {
      formData.append('image_url', input.data);
    } else {
      const parsed = parseDataUrl(input.data);
      const mimeType = parsed?.mimeType || input.mimeType || 'application/octet-stream';
      const base64Data = parsed?.data || input.data;
      const buffer = Buffer.from(base64Data, 'base64');
      const blob = new Blob([buffer], { type: mimeType });
      formData.append('image', blob, 'input.webp');
    }

    return formData;
  };

  const response = await fetchWithRetry(undiciFetch, url, () => ({
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'X-Failover-Enabled': 'true',
      ...(request.idempotencyKey
        ? {
            'Idempotency-Key': request.idempotencyKey,
            'X-Idempotency-Key': request.idempotencyKey,
          }
        : {}),
    },
    body: buildFormData() as any,
    dispatcher: imageAgent,
  }) as any, GENERATION_POST_RETRY_OPTIONS);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gitee API 错误 (${response.status}): ${errorText}`);
  }

  const data: any = await response.json();
  const imageData = data.data?.[0];
  const remoteImageUrl = pickImageUrl(imageData);
  if (!remoteImageUrl && !imageData?.b64_json) {
    throw new Error('API 返回成功但未包含图片');
  }

  const resultUrl = remoteImageUrl || `data:${imageData.type || 'image/png'};base64,${imageData.b64_json}`;
  return { type: 'gitee-image', url: resultUrl, cost: 0 };
}

// ========================================
// Sora API
// ========================================

// ========================================
// OpenAI Chat Completions API (for image generation)
// ========================================

async function generateWithOpenAIChat(
  request: ImageGenerateRequest,
  baseUrl: string,
  apiKey: string,
  apiModel: string,
  channelId: string
): Promise<GenerateResult> {
  const key = getNextApiKey(apiKey, channelId);
  const url = `${baseUrl.replace(/\/$/, '')}/v1/chat/completions`;

  // Build message content
  const contentParts: Array<{ type: string; text?: string; image_url?: { url: string } }> = [];

  // Add reference images first
  if (request.images && request.images.length > 0) {
    for (const img of request.images) {
      contentParts.push({
        type: 'image_url',
        image_url: { url: img.data },
      });
    }
  }

  // Add prompt text
  if (request.prompt) {
    contentParts.push({ type: 'text', text: request.prompt });
  }

  const payload = {
    model: apiModel,
    messages: [
      {
        role: 'user',
        content: contentParts.length === 1 && contentParts[0].type === 'text'
          ? request.prompt
          : contentParts,
      },
    ],
    stream: true,
  };

  const response = await fetchWithRetry(undiciFetch, url, () => ({
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(request.idempotencyKey
        ? {
            'Idempotency-Key': request.idempotencyKey,
            'X-Idempotency-Key': request.idempotencyKey,
          }
        : {}),
    },
    body: JSON.stringify(payload),
    dispatcher: imageAgent,
  }), GENERATION_POST_RETRY_OPTIONS);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI Chat API error (${response.status}): ${errorText}`);
  }

  // Handle streaming response
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('No response body');
  }

  const decoder = new TextDecoder();
  let fullContent = '';
  let reasoningContent = '';
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // Process SSE events
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') continue;

      try {
        const parsed = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta;
        if (delta?.content) {
          fullContent += delta.content;
        }
        if (delta?.reasoning_content) {
          reasoningContent += delta.reasoning_content;
        }
      } catch {
        // Ignore parse errors for individual chunks
      }
    }
  }

  // Use content first, fallback to reasoning_content
  const responseText = fullContent || reasoningContent;

  if (!responseText) {
    throw new Error('API returned success but no content');
  }

  // Parse response content - extract URL from various formats
  let resultUrl: string | undefined;

  // 1. HTML video/img tags: <video src='...'> or <img src='...'>
  const htmlSrcMatch = responseText.match(/<(?:video|img)[^>]*\ssrc=['"]([^'"]+)['"]/i);
  if (htmlSrcMatch) {
    resultUrl = htmlSrcMatch[1];
  }

  // 2. Markdown image: ![...](URL) or ![...](data:image/...)
  if (!resultUrl) {
    const mdImageMatch = responseText.match(/!\[[^\]]*\]\(([^)]+)\)/);
    if (mdImageMatch) {
      resultUrl = mdImageMatch[1];
    }
  }

  // 3. JSON format: { "url": "..." } or { "preview_url": "..." }
  if (!resultUrl) {
    try {
      const parsed = JSON.parse(responseText);
      resultUrl = pickImageUrl(parsed);
    } catch {
      // Not JSON, continue
    }
  }

  // 4. Direct URL in text
  if (!resultUrl) {
    const urlMatch = responseText.match(/https?:\/\/[^\s"'<>\])`]+/);
    if (urlMatch) {
      resultUrl = urlMatch[0];
    }
  }

  // 5. Direct data URL
  if (!resultUrl && responseText.includes('data:image/')) {
    const dataUrlMatch = responseText.match(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/);
    if (dataUrlMatch) {
      resultUrl = dataUrlMatch[0];
    }
  }

  if (!resultUrl) {
    // Check if response contains error message from upstream
    const errorPatterns = [
      /生成失败[：:]\s*(.+)/,
      /❌\s*(.+)/,
      /error[：:]\s*(.+)/i,
      /failed[：:]\s*(.+)/i,
    ];
    for (const pattern of errorPatterns) {
      const match = responseText.match(pattern);
      if (match) {
        throw new Error(match[1].trim());
      }
    }
    throw new Error(`Cannot parse response: ${responseText.substring(0, 200)}`);
  }

  return {
    type: 'gemini-image',
    url: resultUrl,
    cost: 0,
  };
}

// ========================================
// Sora API
// ========================================

async function generateWithSora(
  request: ImageGenerateRequest,
  baseUrl: string,
  apiKey: string,
  apiModel: string,
  channelId: string
): Promise<GenerateResult> {
  const key = getNextApiKey(apiKey, channelId);
  const normalizedBaseUrl = baseUrl.replace(/\/$/, '');
  const url = `${normalizedBaseUrl}/v1/images/generations`;

  const normalizedApiModel = (apiModel || '').trim().toLowerCase();
  const model = !normalizedApiModel || normalizedApiModel.startsWith('sora-image')
    ? 'gpt-image-2'
    : apiModel;
  let size = '1024x1024';

  if (request.aspectRatio) {
    switch (request.aspectRatio) {
      case '16:9':
        size = '1536x1024';
        break;
      case '9:16':
        size = '1024x1536';
        break;
      case '1:1':
      default:
        size = '1024x1024';
        break;
    }
  }

  const payload: Record<string, unknown> = {
    prompt: request.prompt,
    model,
    size,
    n: 1,
    response_format: 'url',
  };

  // 添加参考图（垫图）- 使用 input_image 参数传递 base64
  if (request.images && request.images.length > 0) {
    const img = request.images[0];
    // API 支持带 data:image/...;base64, 前缀的格式
    payload.input_image = img.data;
  }

  const response = await fetchWithRetry(undiciFetch, url, () => ({
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(request.idempotencyKey
        ? {
            'Idempotency-Key': request.idempotencyKey,
            'X-Idempotency-Key': request.idempotencyKey,
          }
        : {}),
    },
    body: JSON.stringify(payload),
    dispatcher: imageAgent,
  }), GENERATION_POST_RETRY_OPTIONS);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Sora API 错误 (${response.status}): ${errorText}`);
  }

  const data: any = await response.json();

  // OpenAI 格式响应: { data: [{ url: '...' }] }
  const imageData = data.data?.[0];
  const remoteImageUrl = pickImageUrl(imageData);
  if (!remoteImageUrl && !imageData?.b64_json) {
    throw new Error('API 返回成功但未包含图片');
  }

  const resultUrl = remoteImageUrl || `data:image/png;base64,${imageData.b64_json}`;
  return {
    type: 'sora-image',
    url: resultUrl,
    cost: 0,
  };
}

async function pollLingkeMediaImageTask(
  baseUrl: string,
  apiKey: string,
  channelId: string,
  taskId: string,
  onProgress?: ImageGenerationProgressCallback
): Promise<LingkeMediaImageTaskSnapshot> {
  for (let attempt = 0; attempt < LINGKE_MEDIA_IMAGE_MAX_POLLS; attempt += 1) {
    const snapshot = await fetchLingkeMediaImageTaskSnapshot(baseUrl, apiKey, channelId, taskId);

    if (snapshot.final && snapshot.resultUrl) {
      await onProgress?.(100, {
        upstreamTaskId: snapshot.taskId,
        upstreamStatus: snapshot.status || '已完成',
        upstreamState: snapshot.state || 'completed',
        upstreamStatusGroup: 'completed',
        upstreamProgress: 100,
        upstreamResultUrl: snapshot.resultUrl,
        upstreamFinal: true,
      });
      return snapshot;
    }

    if (snapshot.state === 'failed') {
      throw new Error(snapshot.message || snapshot.status || '灵刻媒体任务失败');
    }

    await onProgress?.(Math.min(95, Math.max(snapshot.progress, 10)), {
      upstreamTaskId: snapshot.taskId,
      upstreamStatus: snapshot.status || snapshot.message || undefined,
      upstreamState: snapshot.state || undefined,
      upstreamStatusGroup: snapshot.statusGroup,
      upstreamProgress: Math.min(95, Math.max(snapshot.progress, 10)),
    });

    await new Promise((resolve) => setTimeout(resolve, LINGKE_MEDIA_IMAGE_POLL_INTERVAL_MS));
  }

  throw new Error('灵刻媒体图片任务超时');
}

function normalizeLingkeImageReferenceValue(image: { mimeType: string; data: string }): string | null {
  const value = String(image.data || '').trim();
  if (!value) return null;

  if (value.startsWith('http://') || value.startsWith('https://') || value.startsWith('data:')) {
    return value;
  }

  return `data:${image.mimeType || 'image/jpeg'};base64,${value.replace(/^data:[^;]+;base64,/, '')}`;
}

async function prepareLingkeMediaReferenceImages(
  images: Array<{ mimeType: string; data: string }>,
  publicBaseUrl?: string,
): Promise<Array<{ mimeType: string; data: string }>> {
  if (!Array.isArray(images) || images.length === 0) return [];

  return Promise.all(
    images.map(async (image, index) => {
      const normalized = normalizeLingkeImageReferenceValue(image);
      if (!normalized) {
        return image;
      }

      if (normalized.startsWith('http://') || normalized.startsWith('https://')) {
        return {
          ...image,
          data: normalized,
        };
      }

      const filename = `lingke-image-input-${Date.now()}-${index}`;
      const publicUrl = await saveMediaToPublicFile(filename, normalized, {
        publicBaseUrl,
        filename,
      });

      if (!publicUrl) {
        throw new Error(
          '当前灵刻图片模型上传参考图时，需要站点具备公网可访问地址；请在服务器公网域名下重试。'
        );
      }

      return {
        ...image,
        data: publicUrl,
      };
    })
  );
}

function normalizeLingkeAspectRatio(value?: string, fallback = '1:1'): string {
  const raw = String(value || '').trim();
  if (['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', 'auto'].includes(raw)) {
    return raw;
  }
  return fallback;
}

function resolveOpenAiStyleImageSize(aspectRatio?: string): string {
  switch (normalizeLingkeAspectRatio(aspectRatio, '1:1')) {
    case '16:9':
      return '1536x1024';
    case '9:16':
      return '1024x1536';
    case '3:2':
      return '1536x1024';
    case '2:3':
      return '1024x1536';
    case '4:3':
      return '1280x960';
    case '3:4':
      return '960x1280';
    case '1:1':
    default:
      return '1024x1024';
  }
}

function resolveGrokImageSize(aspectRatio?: string): string {
  switch (normalizeLingkeAspectRatio(aspectRatio, '1:1')) {
    case '16:9':
      return '1280x720';
    case '9:16':
      return '720x1280';
    case '3:2':
      return '1200x800';
    case '2:3':
      return '800x1200';
    case '4:3':
      return '1200x900';
    case '3:4':
      return '900x1200';
    case '1:1':
    default:
      return '1024x1024';
  }
}

function resolveLingkeImageSizeBucket(
  value: string | undefined,
  supported: string[],
  fallback: string
): string {
  const raw = String(value || '').trim().toUpperCase();
  if (raw && supported.includes(raw)) return raw;
  return fallback;
}

function buildLingkeMediaImageParams(
  request: ImageGenerateRequest,
  apiModel: string
): Record<string, unknown> {
  const model = String(apiModel || '').trim().toLowerCase();
  const aspectRatio = normalizeLingkeAspectRatio(request.aspectRatio, '1:1');
  const imageSize = String(request.imageSize || request.size || '').trim();
  const quality = String(request.quality || '').trim().toLowerCase() || 'medium';
  const referenceImages =
    request.images
      ?.map((image) => normalizeLingkeImageReferenceValue(image))
      .filter((value): value is string => Boolean(value)) || [];

  const params: Record<string, unknown> = {};
  if (referenceImages.length > 0) {
    params.images = referenceImages;
  }

  if (model === 'gpt-image-2' || model === 'gpt-image-2-guan') {
    params.size = resolveOpenAiStyleImageSize(aspectRatio);
    params.quality = ['low', 'medium', 'high', 'auto'].includes(quality) ? quality : 'medium';
    return params;
  }

  if (model === 'gemini-3-pro-image-preview' || model === 'gemini-3.1-flash-image-preview') {
    params.aspectRatio = aspectRatio;
    params.imageSize = resolveLingkeImageSizeBucket(imageSize, ['0.5K', '1K', '2K', '4K'], '1K');
    return params;
  }

  if (model === 'vidu-image-2') {
    params.aspect_ratio = aspectRatio;
    params.resolution = resolveLingkeImageSizeBucket(imageSize, ['1K', '2K', '3K'], '1K');
    params.quality = ['low', 'medium', 'high'].includes(quality) ? quality : 'medium';
    params.style = 'general';
    return params;
  }

  if (model === 'wan2.7-image') {
    params.size = aspectRatio;
    params.quality = ['pro', 'standard'].includes(quality) ? quality : 'standard';
    return params;
  }

  if (model === 'wan2.6-image' || model === 'qwen-image') {
    params.size = aspectRatio;
    params.prompt_extend = 'false';
    return params;
  }

  if (model === 'grok-4.1-image' || model === 'grok-4.2-image') {
    params.size = resolveGrokImageSize(aspectRatio);
    return params;
  }

  if (model === 'kling-v3' || model === 'kling-v3-omni' || model === 'kling-image-o1') {
    params.aspect_ratio = aspectRatio;
    params.resolution = resolveLingkeImageSizeBucket(imageSize, ['1K', '2K', '4K'], model === 'kling-v3' ? '1K' : '2K');
    return params;
  }

  if (model === 'mj_imagine') {
    params.botType = 'MID_JOURNEY';
    params.aspectRatio = aspectRatio;
    params.quality = '1';
    params.style = '';
    params.chaos = '0';
    params.stylize = '100';
    return params;
  }

  if (model.startsWith('doubao-seedream-')) {
    params.aspect_ratio = aspectRatio === '1:1' ? 'auto' : aspectRatio;
    const supportedSizes = model.includes('5-0') ? ['2K', '3K'] : ['2K', '4K'];
    params.size = resolveLingkeImageSizeBucket(imageSize, supportedSizes, supportedSizes[0]);
    if (model.includes('5-0')) {
      params.web_search = 'false';
    }
    return params;
  }

  params.aspect_ratio = aspectRatio;
  if (request.size) params.size = request.size;
  if (request.imageSize) params.image_size = request.imageSize;
  if (!params.quality && quality) {
    params.quality = quality;
  }

  return params;
}

async function generateWithLingkeMedia(
  request: ImageGenerateRequest,
  baseUrl: string,
  apiKey: string,
  apiModel: string,
  channelId: string,
  onProgress?: ImageGenerationProgressCallback
): Promise<GenerateResult> {
  const key = getNextApiKey(apiKey, channelId);
  const apiUrl = `${baseUrl.replace(/\/$/, '')}/v1/media/generate`;
  const preparedImages = await prepareLingkeMediaReferenceImages(
    request.images || [],
    request.publicBaseUrl,
  );
  const params = buildLingkeMediaImageParams(
    {
      ...request,
      images: preparedImages,
    },
    apiModel
  );

  const response = await fetchWithRetry(undiciFetch, apiUrl, () => ({
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(request.idempotencyKey
        ? {
            'Idempotency-Key': request.idempotencyKey,
            'X-Idempotency-Key': request.idempotencyKey,
          }
        : {}),
    },
    body: JSON.stringify({
      model: apiModel,
      prompt: request.prompt,
      params,
    }),
    dispatcher: imageAgent,
  }), GENERATION_POST_RETRY_OPTIONS);

  const data: any = await response.json().catch(() => ({}));
  if (!response.ok || Number(data?.code ?? 0) !== 200) {
    const detail = String(data?.msg || data?.data?.详情 || data?.data?.msg || '生成失败');
    throw new Error(`灵刻媒体图片生成失败${response.ok ? '' : ` (${response.status})`}: ${detail}`);
  }

  const directUrl = pickImageUrl(data?.data) || pickImageUrl(data);
  if (directUrl) {
    await onProgress?.(100, {
      upstreamStatus: String(data?.msg || '已完成'),
      upstreamState: 'completed',
      upstreamStatusGroup: 'completed',
      upstreamProgress: 100,
      upstreamResultUrl: directUrl,
      upstreamFinal: true,
    });
    return {
      type: 'gemini-image',
      url: directUrl,
      cost: 0,
    };
  }

  const taskId = data?.data?.task_id || data?.data?.taskId;
  if (!taskId) {
    throw new Error('灵刻媒体未返回任务 ID');
  }

  await onProgress?.(10, {
    upstreamTaskId: String(taskId),
    upstreamStatus: String(data?.msg || '任务创建成功'),
    upstreamState: 'created',
    upstreamStatusGroup: 'pending',
    upstreamProgress: 10,
  });

  const finalSnapshot = await pollLingkeMediaImageTask(
    baseUrl,
    apiKey,
    channelId,
    String(taskId),
    onProgress
  );
  const resultUrl = finalSnapshot.resultUrl;
  if (!resultUrl) {
    throw new Error('灵刻媒体任务完成但未返回图片');
  }

  return {
    type: 'gemini-image',
    url: resultUrl,
    cost: 0,
  };
}

// ========================================
// 统一入口
// ========================================

export async function generateImage(
  request: ImageGenerateRequest,
  onProgress?: ImageGenerationProgressCallback
): Promise<GenerateResult> {
  const modelConfig =
    await getImageModelWithChannel(request.modelId)
    || await resolveImageModelWithChannelSelection({
      modelId: request.modelId,
    });
  if (!modelConfig) {
    throw new Error('模型不存在或未配置');
  }

  const { model, channel, effectiveBaseUrl, effectiveApiKey } = modelConfig;

  if (!model.enabled) {
    throw new Error('模型已禁用');
  }
  if (!channel.enabled) {
    throw new Error('渠道已禁用');
  }
  if (!effectiveBaseUrl) {
    throw new Error('未配置 Base URL');
  }
  if (!effectiveApiKey) {
    throw new Error('未配置 API Key');
  }

  const resolvedTarget = resolveImageTarget(
    model.apiModel,
    model.resolutions as ResolutionMap | undefined,
    request.aspectRatio,
    request.imageSize
  );

  let result: GenerateResult;

  switch (channel.type) {
    case 'apexerapi':
    case 'openai-compatible':
      result = await generateWithOpenAI(
        request,
        effectiveBaseUrl,
        effectiveApiKey,
        resolvedTarget,
        channel.id
      );
      break;

    case 'openai-chat':
      result = await generateWithOpenAIChat(
        request,
        effectiveBaseUrl,
        effectiveApiKey,
        resolvedTarget.model,
        channel.id
      );
      break;

    case 'gemini':
      result = await generateWithGemini(
        request,
        effectiveBaseUrl,
        effectiveApiKey,
        resolvedTarget.model,
        channel.id
      );
      break;

    case 'modelscope':
      result = await generateWithModelScope(
        request,
        effectiveBaseUrl,
        effectiveApiKey,
        model.apiModel,
        channel.id,
        resolvedTarget.size
      );
      break;

    case 'gitee':
      result = await generateWithGitee(
        request,
        effectiveBaseUrl,
        effectiveApiKey,
        model.apiModel,
        channel.id,
        resolvedTarget.size
      );
      break;

    case 'sora':
      result = await generateWithSora(
        request,
        effectiveBaseUrl,
        effectiveApiKey,
        model.apiModel,
        channel.id
      );
      break;

    case 'lingke-media':
      result = await generateWithLingkeMedia(
        request,
        effectiveBaseUrl,
        effectiveApiKey,
        resolvedTarget.model,
        channel.id,
        onProgress
      );
      break;

    default:
      throw new Error(`不支持的渠道类型: ${channel.type}`);
  }

  // 设置实际成本
  result.cost = model.costPerGeneration;

  return result;
}
