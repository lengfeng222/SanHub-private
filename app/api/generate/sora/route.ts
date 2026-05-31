/* eslint-disable no-console */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { generateWithSora } from '@/lib/sora';
import { saveGeneration, updateUserBalance, getUserById, updateGeneration, getSystemConfig, refundGenerationBalance, updateVideoModel } from '@/lib/db';
import type { Generation, SoraGenerateRequest } from '@/types';
import { checkRateLimit } from '@/lib/rate-limit';
import { fetchReferenceImage } from '@/lib/reference-image';
import { processVideoPrompt } from '@/lib/prompt-processor';
import { assertPromptsAllowed, isPromptBlockedError } from '@/lib/prompt-blocklist';
import { saveMediaAsset } from '@/lib/media-storage';
import { extractRuntimeMediaFilenameFromUrl } from '@/lib/media-storage';
import { resolveVideoModelWithChannelSelection } from '@/lib/model-channel-resolver';
import { getBaseUrlFromRequest } from '@/lib/epay';
import { resolveVideoGenerationCost } from '@/lib/member-pricing';
import type { VideoModel } from '@/types';
import { getMediaKindLabel } from '@/lib/media-kind';
import { localizeVideoUploadLabel } from '@/lib/video-upload-presenter';
import { sanitizeLingkeVideoConfigObject } from '@/lib/lingke-video-config';
import {
  formatMediaDurationRange,
  parseMediaDurationRangeFromText,
  roundMediaDurationSeconds,
  validateMediaDurationAgainstRange,
} from '@/lib/media-duration-rules';

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getVideoExtraParams(model?: VideoModel): Record<string, unknown> {
  const extra = model?.videoConfigObject?.extra_params;
  if (extra && typeof extra === 'object' && !Array.isArray(extra)) {
    return extra as Record<string, unknown>;
  }
  return {};
}

function getVideoInputMode(model?: VideoModel): string {
  const extra = getVideoExtraParams(model);
  const configured = String(extra.upload_mode || extra.input_mode || '').trim().toLowerCase();
  if (configured) return configured;
  return 'text';
}

function getVideoUploadParamMeta(model?: VideoModel): Record<string, {
  kind?: 'image' | 'video' | 'audio';
  label?: string;
  description?: string;
  minFiles?: number;
  maxFiles?: number;
}> {
  const extra = getVideoExtraParams(model);
  const meta = extra.upload_param_meta;
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(meta as Record<string, {
      kind?: 'image' | 'video' | 'audio';
      label?: string;
      description?: string;
      minFiles?: number;
      maxFiles?: number;
    }>).map(([key, value]) => [
      key,
      {
        ...value,
        label: localizeVideoUploadLabel(value?.label || key, key, value?.kind),
        description: typeof value?.description === 'string' ? value.description : undefined,
      },
    ])
  );
}

function getRequestFileDurationSeconds(file: NonNullable<SoraGenerateRequest['files']>[number]): number | null {
  const value = Number(file.durationSeconds);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

function getRequestedVideoDurationSeconds(
  request: SoraGenerateRequest,
  model?: VideoModel
): number {
  const configured =
    Number(request.videoConfigObject?.video_length)
    || Number(request.video_config?.video_length)
    || Number(String(request.duration || model?.defaultDuration || '').match(/(\d+)/)?.[1] || 0);

  if (!Number.isFinite(configured) || configured <= 0) {
    return 8;
  }

  return Math.floor(configured);
}

function buildDurationValidationError(
  slotLabel: string,
  mediaKind: 'image' | 'video' | 'audio' | undefined,
  durationSeconds: number,
  description?: string
): string | null {
  const range = parseMediaDurationRangeFromText(description);
  const violation = validateMediaDurationAgainstRange(durationSeconds, range);
  if (!violation) return null;

  const kindLabel = mediaKind === 'video'
    ? '视频素材'
    : mediaKind === 'audio'
      ? '音频素材'
      : '素材';
  const label = String(slotLabel || kindLabel).trim() || kindLabel;
  const currentDuration = roundMediaDurationSeconds(durationSeconds);
  const expectedRange = formatMediaDurationRange(violation);
  return `${label}当前时长为 ${currentDuration} 秒，需满足 ${expectedRange}`;
}

function getSelectedReferenceCount(request: SoraGenerateRequest, model?: VideoModel): number {
  const extra = request.videoConfigObject?.extra_params;
  const selected = Number(
    (isPlainObject(extra) ? extra.reference_image_count : undefined)
    ?? getVideoExtraParams(model).default_reference_image_count
    ?? 0
  );
  return Number.isFinite(selected) && selected > 0 ? Math.floor(selected) : 0;
}

function validateVideoRequestInputs(
  request: SoraGenerateRequest,
  model?: VideoModel
): string | null {
  const files = Array.isArray(request.files) ? request.files : [];
  const extra = getVideoExtraParams(model);
  const inputMode = getVideoInputMode(model);
  const imageCount = files.filter((file) => file.mimeType.startsWith('image/')).length;
  const videoCount = files.filter((file) => file.mimeType.startsWith('video/')).length;
  const audioCount = files.filter((file) => file.mimeType.startsWith('audio/')).length;
  const filesBySlot = new Map<string, number>();

  for (const file of files) {
    const slot = String(file.slot || '').trim();
    if (!slot) continue;
    filesBySlot.set(slot, (filesBySlot.get(slot) || 0) + 1);
  }

  const requiredImageSlots = toStringArray(extra.required_image_upload_param_names);
  const requiredVideoSlots = toStringArray(extra.required_video_upload_param_names);
  const requiredAudioSlots = toStringArray(extra.required_audio_upload_param_names);
  const requiresUpload = extra.requires_upload === true;
  const uploadMeta = getVideoUploadParamMeta(model);
  const requestedDurationSeconds = getRequestedVideoDurationSeconds(request, model);

  for (const slot of requiredImageSlots) {
    if ((filesBySlot.get(slot) || 0) === 0 && imageCount === 0) {
      const slotLabel = String(uploadMeta[slot]?.label || slot).trim();
      return `当前模型需要先上传${slotLabel}后再生成`;
    }
  }
  for (const slot of requiredVideoSlots) {
    if ((filesBySlot.get(slot) || 0) === 0 && videoCount === 0) {
      const slotLabel = String(uploadMeta[slot]?.label || slot).trim();
      return slot.includes('continue') || slot.includes('clips')
        ? `当前模型需要先上传${slotLabel || '续写视频'}后再生成`
        : `当前模型需要先上传${slotLabel || '参考视频'}后再生成`;
    }
  }
  for (const slot of requiredAudioSlots) {
    if ((filesBySlot.get(slot) || 0) === 0 && audioCount === 0) {
      const slotLabel = String(uploadMeta[slot]?.label || slot).trim();
      return `当前模型需要先上传${slotLabel || '音频素材'}后再生成`;
    }
  }

  for (const [slot, meta] of Object.entries(uploadMeta)) {
    const minFiles = Number(meta?.minFiles || 0);
    if (!Number.isFinite(minFiles) || minFiles <= 0) continue;
    const currentCount = filesBySlot.get(slot) || 0;
    const fallbackCount =
      meta?.kind === 'video'
        ? videoCount
        : meta?.kind === 'audio'
          ? audioCount
          : imageCount;
    const effectiveCount = currentCount > 0 ? currentCount : fallbackCount;
    if (effectiveCount >= minFiles) continue;

    const slotLabel = String(meta?.label || slot).trim();
    return `${slotLabel}至少需要上传 ${minFiles} 个文件`;
  }

  for (const [slot, meta] of Object.entries(uploadMeta)) {
    const slotFiles = files.filter((file) => String(file.slot || '').trim() === slot);
    const fallbackFiles = slotFiles.length > 0
      ? slotFiles
      : files.filter((file) => (
        meta?.kind === 'video'
          ? file.mimeType.startsWith('video/')
          : meta?.kind === 'audio'
            ? file.mimeType.startsWith('audio/')
            : file.mimeType.startsWith('image/')
      ));

    for (const file of fallbackFiles) {
      const durationSeconds = getRequestFileDurationSeconds(file);
      if (!durationSeconds) continue;

      const slotLabel = String(meta?.label || slot).trim();
      const validationError = buildDurationValidationError(
        slotLabel,
        meta?.kind,
        durationSeconds,
        meta?.description,
      );
      if (validationError) {
        return validationError;
      }
    }
  }

  if (
    (inputMode === 'reference' ||
      inputMode === 'first_frame' ||
      inputMode === 'first_last_frame') &&
    requiresUpload &&
    imageCount === 0
  ) {
    return '当前模型至少需要上传 1 张参考图后再生成';
  }

  if (inputMode === 'motion_control') {
    if (requiresUpload && imageCount === 0) {
      return '当前动作控制模型需要先上传人物/主体参考图后再生成';
    }
    if (requiresUpload && videoCount === 0) {
      return '当前动作控制模型还需要上传动作参考视频后再生成';
    }
  }

  if (
    (inputMode === 'video_reference' ||
      inputMode === 'video_continue' ||
      inputMode === 'video_edit') &&
    requiresUpload &&
    videoCount === 0
  ) {
    return inputMode === 'video_continue'
      ? '当前模型需要先上传续写视频后再生成'
      : inputMode === 'video_edit'
        ? '当前模型需要先上传待编辑视频后再生成'
        : '当前模型需要先上传参考视频后再生成';
  }

  if (inputMode === 'video_continue' && requestedDurationSeconds > 0) {
    const continuationLabel =
      String(
        uploadMeta.clips?.label
        || uploadMeta.video?.label
        || uploadMeta.reference_video?.label
        || '续写视频'
      ).trim() || '续写视频';
    const tooLongVideo = files.find((file) => {
      if (!file.mimeType.startsWith('video/')) return false;
      const durationSeconds = getRequestFileDurationSeconds(file);
      return Boolean(durationSeconds && durationSeconds >= requestedDurationSeconds);
    });

    if (tooLongVideo) {
      const sourceDuration = getRequestFileDurationSeconds(tooLongVideo);
      if (sourceDuration) {
        return `${continuationLabel}当前时长为 ${roundMediaDurationSeconds(sourceDuration)} 秒，需小于所选生成时长 ${requestedDurationSeconds} 秒`;
      }
    }
  }

  const selectedReferenceCount = getSelectedReferenceCount(request, model);
  if (
    selectedReferenceCount > 0 &&
    (inputMode === 'reference' || inputMode === 'motion_control') &&
    imageCount > 0 &&
    imageCount < selectedReferenceCount
  ) {
    return `当前参考图数量设置为 ${selectedReferenceCount}，请至少上传 ${selectedReferenceCount} 张参考图`;
  }

  return null;
}

function normalizeIncomingVideoConfigObject(input: SoraGenerateRequest): SoraGenerateRequest['videoConfigObject'] {
  const raw = (input.videoConfigObject || input.video_config) as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== 'object') return undefined;

  const output: NonNullable<SoraGenerateRequest['videoConfigObject']> = {};

  if (typeof raw.aspect_ratio === 'string' && ['16:9', '9:16', '1:1', '2:3', '3:2'].includes(raw.aspect_ratio.trim())) {
    output.aspect_ratio = raw.aspect_ratio.trim() as NonNullable<SoraGenerateRequest['videoConfigObject']>['aspect_ratio'];
  }

  if (typeof raw.video_length === 'number' && Number.isFinite(raw.video_length)) {
    output.video_length = Math.max(1, Math.min(30, Math.floor(raw.video_length)));
  }

  if (typeof raw.resolution === 'string') {
    const resolution = raw.resolution.trim().toUpperCase();
    if (resolution) {
      output.resolution = resolution;
    }
  }

  if (typeof raw.preset === 'string') {
    const preset = raw.preset.trim().toLowerCase();
    if (preset === 'fun' || preset === 'normal' || preset === 'spicy') {
      output.preset = preset;
    }
  }

  if (typeof raw.generation_mode === 'string' && raw.generation_mode.trim()) {
    output.generation_mode = raw.generation_mode.trim();
  }

  if (typeof raw.off_peak === 'boolean') {
    output.off_peak = raw.off_peak;
  }

  if (typeof raw.quality_version === 'string' && raw.quality_version.trim()) {
    output.quality_version = raw.quality_version.trim();
  }

  if (typeof raw.model_version === 'string' && raw.model_version.trim()) {
    output.model_version = raw.model_version.trim();
  }

  if (typeof raw.version === 'string' && raw.version.trim()) {
    output.version = raw.version.trim();
  }

  if (raw.extra_params && typeof raw.extra_params === 'object' && !Array.isArray(raw.extra_params)) {
    try {
      const cloned = JSON.parse(JSON.stringify(raw.extra_params)) as unknown;
      if (cloned && typeof cloned === 'object' && !Array.isArray(cloned) && Object.keys(cloned).length > 0) {
        output.extra_params = cloned as NonNullable<SoraGenerateRequest['videoConfigObject']>['extra_params'];
      }
    } catch {
      // Ignore invalid extra params payload.
    }
  }

  return Object.keys(output).length > 0 ? output : undefined;
}

// 配置路由段选项
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const MAX_REFERENCE_IMAGE_BYTES = 50 * 1024 * 1024;
const RATE_LIMIT_RETRIES = 3;
const RATE_LIMIT_BASE_DELAY_MS = 1500;
const RATE_LIMIT_MAX_DELAY_MS = 10000;
const UPSTREAM_DISABLE_MODEL_ERROR_SNIPPETS = [
  '当前分组下该模型暂未配置渠道',
];

function isRateLimitError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes('429') ||
    message.includes('rate limit') ||
    message.includes('rate limited') ||
    message.includes('too many requests')
  );
}

function getRateLimitDelayMs(attempt: number): number {
  const delay = Math.min(RATE_LIMIT_BASE_DELAY_MS * 2 ** (attempt - 1), RATE_LIMIT_MAX_DELAY_MS);
  const jitter = Math.floor(delay * 0.25 * Math.random());
  return delay - jitter;
}

function shouldDisableVideoModelForUpstreamError(message: string): boolean {
  const normalized = String(message || '').trim();
  if (!normalized) return false;
  return UPSTREAM_DISABLE_MODEL_ERROR_SNIPPETS.some((snippet) => normalized.includes(snippet));
}

async function generateWithRateLimitRetry(
  body: SoraGenerateRequest,
  onProgress: (progress: number, meta?: Record<string, unknown>) => void | Promise<void>,
  taskId: string
) {
  let attempt = 0;
  while (true) {
    try {
      if (attempt > 0) {
        console.warn(`[Task ${taskId}] Retry attempt ${attempt} after rate limit`);
      }
      return await generateWithSora(body, onProgress);
    } catch (error) {
      if (!isRateLimitError(error) || attempt >= RATE_LIMIT_RETRIES) {
        throw error;
      }
      attempt += 1;
      const delayMs = getRateLimitDelayMs(attempt);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

// 后台处理任务
async function processGenerationTask(
  generationId: string,
  userId: string,
  body: SoraGenerateRequest,
  prechargedCost: number,
  publicBaseUrl?: string
): Promise<void> {
  const baseParams = {
    model: body.model,
    modelId: body.modelId,
    aspectRatio: body.aspectRatio,
    duration: body.duration,
    videoConfigObject: body.videoConfigObject,
  };
  let promptParams: {
    originalPrompt?: string;
    filteredPrompt?: string;
    translatedPrompt?: string;
    processedPrompt?: string;
  } = {};
  let persistedUpstreamMeta: Record<string, unknown> = {};
  let lastProgress = 0;

  const buildPersistedParams = (
    progress: number,
    meta?: Record<string, unknown>
  ): Generation['params'] => {
    if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
      const normalizedMeta = Object.fromEntries(
        Object.entries(meta).filter(([, value]) => value !== undefined)
      );

      if (Object.keys(normalizedMeta).length > 0) {
        persistedUpstreamMeta = {
          ...persistedUpstreamMeta,
          ...normalizedMeta,
          upstreamUpdatedAt: Date.now(),
        };
      }
    }

    return {
      ...baseParams,
      ...promptParams,
      ...persistedUpstreamMeta,
      progress,
    };
  };

  try {
    console.log(`[Task ${generationId}] 开始处理生成任务`);
    
    // 更新状态为 processing
    await updateGeneration(generationId, {
      status: 'processing',
      params: buildPersistedParams(0),
    }).catch(err => {
      console.error(`[Task ${generationId}] 更新状态失败:`, err);
    });

    // 进度更新回调（节流：每5%更新一次）
    let lastMetaSignature = '';
    const onProgress = async (progress: number, meta?: Record<string, unknown>) => {
      const nextMeta =
        meta && typeof meta === 'object' && !Array.isArray(meta)
          ? meta
          : {};
      const nextMetaSignature = JSON.stringify(nextMeta);

      if (progress - lastProgress >= 5 || progress >= 100 || nextMetaSignature !== lastMetaSignature) {
        lastProgress = progress;
        lastMetaSignature = nextMetaSignature;
        await updateGeneration(generationId, { 
          params: buildPersistedParams(progress, nextMeta),
        }).catch(err => {
          console.error(`[Task ${generationId}] 更新进度失败:`, err);
        });
      }
    };

    // Process prompt (filter + translate)
    let processedBody = body;
    if (body.prompt && body.prompt.trim()) {
      try {
        const processed = await processVideoPrompt(body.prompt);
        promptParams = {
          originalPrompt: processed.originalPrompt,
          filteredPrompt: processed.filteredPrompt,
          translatedPrompt: processed.translatedPrompt,
          processedPrompt: processed.processedPrompt,
        };
        processedBody = {
          ...body,
          prompt: processed.processedPrompt,
        };
        await updateGeneration(generationId, {
          params: buildPersistedParams(lastProgress),
        }).catch(err => {
          console.error(`[Task ${generationId}] 更新提示词处理结果失败:`, err);
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Prompt processing failed';
        console.error(`[Task ${generationId}] 提示词处理失败:`, message);
        throw new Error(message);
      }
    }

    // 调用 Sora API 生成内容
    const result = await generateWithRateLimitRetry(processedBody, onProgress, generationId);

    persistedUpstreamMeta = {
      ...persistedUpstreamMeta,
      upstreamFinal: true,
      upstreamResultUrl: result.url,
      upstreamUpdatedAt: Date.now(),
    };

    const savedAsset = await saveMediaAsset(generationId, result.url, {
      publicBaseUrl,
      storageMode: 'runtime',
    });
    if (savedAsset.kind === 'image' || savedAsset.kind === 'audio') {
      throw new Error(
        `上游返回的是${getMediaKindLabel(savedAsset.kind)}而不是视频，请更换模型或分组后重试`
      );
    }

    const savedUrl = savedAsset.url;
    const runtimeMediaFilename = extractRuntimeMediaFilenameFromUrl(savedUrl, publicBaseUrl);
    if (runtimeMediaFilename) {
      persistedUpstreamMeta = {
        ...persistedUpstreamMeta,
        runtimeMediaCachedAt: Date.now(),
        runtimeMediaCachedFrom: result.url,
        runtimeMediaOriginTimestamp: Date.now(),
      };
    }

    console.log(`[Task ${generationId}] 生成成功:`, savedUrl);

    // 更新生成记录为完成状态
    await updateGeneration(generationId, {
      status: 'completed',
      resultUrl: savedUrl,
      params: {
        ...buildPersistedParams(100),
        videoId: result.videoId,
        videoChannelId: result.videoChannelId,
        permalink: result.permalink,
        revised_prompt: result.revised_prompt,
      },
    }).catch(err => {
      console.error(`[Task ${generationId}] 更新完成状态失败:`, err);
    });

    console.log(`[Task ${generationId}] 任务完成`);
  } catch (error) {
    console.error(`[Task ${generationId}] 任务失败:`, error);
    
    // 确保错误消息格式正确
    let errorMessage = '生成失败';
    if (error instanceof Error) {
      errorMessage = error.message;
      // 处理 cause 属性中的额外信息
      if ('cause' in error && error.cause) {
        console.error(`[Task ${generationId}] 错误原因:`, error.cause);
      }
    }
    
    // 更新为失败状态（用 try-catch 确保不会抛出）
    try {
      const failedParams = buildPersistedParams(Math.max(lastProgress, 0));
      if (errorMessage.includes('超时')) {
        failedParams.upstreamStatusGroup = 'timeout';
      }
      await updateGeneration(generationId, {
        status: 'failed',
        errorMessage,
        params: failedParams,
      });
    } catch (updateErr) {
      console.error(`[Task ${generationId}] 更新失败状态时出错:`, updateErr);
    }

    try {
      await refundGenerationBalance(generationId, userId, prechargedCost);
    } catch (refundErr) {
      console.error(`[Task ${generationId}] Refund failed:`, refundErr);
    }

    if (body.modelId && shouldDisableVideoModelForUpstreamError(errorMessage)) {
      try {
        await updateVideoModel(body.modelId, { enabled: false });
        console.warn(`[Task ${generationId}] 已自动禁用上游无渠道的视频模型: ${body.modelId}`);
      } catch (disableErr) {
        console.error(`[Task ${generationId}] 自动禁用无渠道模型失败:`, disableErr);
      }
    }
  }
}

export async function POST(request: NextRequest) {
  try {
    const systemConfig = await getSystemConfig();
    const videoMaxRequests = Math.max(1, Number(systemConfig.rateLimit?.videoMaxRequests) || 30);
    const videoWindowSeconds = Math.max(1, Number(systemConfig.rateLimit?.videoWindowSeconds) || 60);
    const rateLimit = checkRateLimit(
      request,
      { maxRequests: videoMaxRequests, windowSeconds: videoWindowSeconds },
      'generate-sora-video'
    );
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Too many requests' },
        { status: 429, headers: rateLimit.headers }
      );
    }

    // 验证登录
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 });
    }

    const body: SoraGenerateRequest = await request.json();
    const hasPrompt = Boolean(body.prompt && body.prompt.trim());
    const hasFiles = Boolean(body.files && body.files.length > 0);
    const hasReferenceUrl = Boolean(body.referenceImageUrl);

    if (!hasPrompt && !hasFiles && !hasReferenceUrl) {
      return NextResponse.json(
        { error: '请输入提示词或上传参考文件' },
        { status: 400 }
      );
    }

    await assertPromptsAllowed([body.prompt, body.style_id]);

    const origin = getBaseUrlFromRequest(request);
    const normalizedVideoConfigObject = normalizeIncomingVideoConfigObject(body);
    const normalizedBody: SoraGenerateRequest = {
      ...body,
      publicBaseUrl: origin,
      videoConfigObject: normalizedVideoConfigObject,
      video_config: normalizedVideoConfigObject,
      files: body.files ? [...body.files] : [],
    };

    if (body.referenceImageUrl) {
      const referenceImage = await fetchReferenceImage(body.referenceImageUrl, {
        origin,
        userId: session.user.id,
        userRole: session.user.role,
        maxBytes: MAX_REFERENCE_IMAGE_BYTES,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      });
      normalizedBody.files?.push({
        mimeType: referenceImage.mimeType,
        data: referenceImage.base64,
      });
    }

    // 获取最新用户信息
    const user = await getUserById(session.user.id);
    if (!user) {
      return NextResponse.json({ error: '用户不存在' }, { status: 401 });
    }

    const videoModelConfig = normalizedBody.modelId || normalizedBody.model
      ? await resolveVideoModelWithChannelSelection({
          modelId: normalizedBody.modelId,
          model: normalizedBody.model,
        })
      : null;
    if (normalizedBody.modelId && !videoModelConfig) {
      return NextResponse.json(
        { error: '当前选择的模型已下线或渠道已变更，请刷新页面后重新选择模型' },
        { status: 400 }
      );
    }
    if (videoModelConfig?.model && !videoModelConfig.model.enabled) {
      return NextResponse.json({ error: '视频模型已禁用' }, { status: 400 });
    }
    if (videoModelConfig?.channel && !videoModelConfig.channel.enabled) {
      return NextResponse.json({ error: '视频渠道已禁用' }, { status: 400 });
    }
    if (videoModelConfig?.model?.name) {
      normalizedBody.modelId = videoModelConfig.model.id;
      normalizedBody.model = videoModelConfig.model.name;
    }
    if (
      videoModelConfig?.model
      && ['veo3.1-lite'].includes(String(videoModelConfig.model.apiModel || videoModelConfig.model.name || '').trim().toLowerCase())
    ) {
      return NextResponse.json(
        { error: '该旧模型已下线，请改用 veo3.1、veo3.1-4KHD 或其他当前可用模型' },
        { status: 400 }
      );
    }

    const sanitizedVideoConfigObject = sanitizeLingkeVideoConfigObject(normalizedVideoConfigObject);
    normalizedBody.videoConfigObject = sanitizedVideoConfigObject;
    normalizedBody.video_config = sanitizedVideoConfigObject;
    const inputValidationError = validateVideoRequestInputs(
      normalizedBody,
      videoModelConfig?.model,
    );
    if (inputValidationError) {
      return NextResponse.json({ error: inputValidationError }, { status: 400 });
    }
    const configuredSeconds =
      normalizedVideoConfigObject?.video_length
      || (() => {
        const matched = String(body.duration || body.model || '').match(/(\d+)/);
        return matched ? Number.parseInt(matched[1], 10) : 8;
      })();
    const estimatedCost = videoModelConfig
      ? resolveVideoGenerationCost({
          user,
          model: videoModelConfig.model,
          duration: configuredSeconds,
          videoConfigObject: sanitizedVideoConfigObject,
        })
      : (() => {
          const normalizedDuration = (body.duration || body.model || '').toLowerCase();
          const effectiveDurationSeconds = normalizedVideoConfigObject?.video_length;
          if (normalizedDuration.includes('25')) return systemConfig.pricing.soraVideo25s;
          if ((effectiveDurationSeconds && effectiveDurationSeconds >= 15) || normalizedDuration.includes('15')) {
            return systemConfig.pricing.soraVideo15s;
          }
          return systemConfig.pricing.soraVideo10s;
        })();

    // 检查余额
    if (user.balance < estimatedCost) {
      return NextResponse.json(
        { error: `余额不足，需要至少 ${estimatedCost} 积分` },
        { status: 402 }
      );
    }

    try {
      await updateUserBalance(user.id, -estimatedCost, 'strict');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Insufficient balance';
      if (message.includes('Insufficient balance')) {
        return NextResponse.json(
          { error: `余额不足，需要至少 ${estimatedCost} 积分` },
          { status: 402 }
        );
      }
      throw err;
    }

    // 生成类型固定为视频
    const type = 'sora-video';

    // 立即创建生成记录（状态为 pending）
    let generation: Generation;
    try {
      generation = await saveGeneration({
        userId: user.id,
        type,
        prompt: body.prompt || '',
        params: {
          model: normalizedBody.model,
          modelId: normalizedBody.modelId,
          aspectRatio: body.aspectRatio,
          duration: body.duration,
          videoConfigObject: sanitizedVideoConfigObject,
          progress: 0,
        },
        resultUrl: '',
        cost: estimatedCost,
        status: 'pending',
        balancePrecharged: true,
        balanceRefunded: false,
      });
    } catch (saveErr) {
      await updateUserBalance(user.id, estimatedCost, 'strict').catch(refundErr => {
        console.error('[API] Precharge rollback failed:', refundErr);
      });
      throw saveErr;
    }

    // 在后台异步处理（不等待完成）
    processGenerationTask(generation.id, user.id, normalizedBody, estimatedCost, origin).catch((err) => {
      console.error('[API] 后台任务启动失败:', err);
    });

    // 立即返回任务 ID
    return NextResponse.json({
      success: true,
      data: {
        id: generation.id,
        status: 'pending',
        message: '任务已创建，正在后台处理中',
      },
    });
  } catch (error) {
    console.error('[API] Sora generation error:', error);

    if (isPromptBlockedError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Prompt blocked by safety policy' },
        { status: 400 }
      );
    }
    
    const errorMessage = error instanceof Error ? error.message : '生成失败';
    const errorStack = error instanceof Error ? error.stack : undefined;
    
    console.error('[API] Error details:', {
      message: errorMessage,
      stack: errorStack,
    });

    return NextResponse.json(
      { 
        error: errorMessage,
        details: process.env.NODE_ENV === 'development' ? errorStack : undefined,
      },
      { status: 500 }
    );
  }
}
