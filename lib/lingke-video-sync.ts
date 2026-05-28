import type { VideoConfigObject, VideoDuration, VideoModelFeatures } from '@/types';
import { estimateVideoDurationCost } from '@/lib/video-model-normalizer';
import {
  createLingkeSyncedVideoModelFromName,
  fetchLingkeVisibleVideoModels,
  type LingkeSyncedVideoModel,
} from '@/lib/lingke-video-pricing';

type LingkeVisibleVideoModel = {
  id?: number;
  展示名称?: string;
  模型图标?: string;
};

type LingkeRemoteApiParamOption = {
  value?: string;
  label?: string;
  description?: string;
};

type LingkeRemoteApiParam = {
  name?: string;
  label?: string;
  type?: string;
  required?: boolean;
  description?: string;
  options?: LingkeRemoteApiParamOption[];
};

type LingkeUploadParamMeta = {
  kind: 'image' | 'video' | 'audio';
  label?: string;
  description?: string;
  multiple?: boolean;
  minFiles?: number;
  maxFiles?: number;
  accept?: string;
};

export type LingkeRemoteApiVideoModel = {
  name: string;
  display_name?: string;
  type?: string;
  description?: string;
  input_hint?: string;
  tags?: string[];
  params?: LingkeRemoteApiParam[];
};

const DEFAULT_TEMPLATE_DESCRIPTION = '灵刻/lk666 视频模型 | 默认同步模板';

const LINGKE_VIDEO_ALIAS_GROUPS: string[][] = [
  ['Sora-2 官转版', 'Sora-2 Official'],
  ['grok-video-3', 'Grok Video 3'],
  ['veo3.1-4K高清', 'veo3.1-4KHD', 'veo3.1-4k'],
  ['快乐马-文生视频', 'HappyHorse-Text-to-video'],
  ['快乐马-首帧', 'HappyHorse-First Frame'],
  ['快乐马-参考生', 'HappyHorse-Reference-to-Video'],
  ['快乐马-视频编辑', 'HappyHorse-Video Editing'],
  ['VIDU-解说漫', 'Vidu-Narrated Comic'],
  ['Vidu Q3', 'Vidu Q3 Text-to-Video'],
  ['Vidu Q3 参考生', 'Vidu Q3 Reference-to-Video'],
  ['万相 2.7 视频续写', 'Wanxiang 2.7 Video Extension'],
  ['万相 2.7 参考生', 'Wanxiang 2.7 Reference-to-Video'],
  ['万相 2.7 首尾帧', 'Wanxiang 2.7 First/Last Frames'],
  ['万相 2.6 参考生', 'Wanxiang 2.6 Reference-to-Video'],
  ['万相 2.6 首帧', 'Wanxiang 2.6 First Frame'],
  ['可灵-动作控制 V3', 'Kling-Motion Control V3'],
  ['可灵-动作控制', 'Kling-Motion Control'],
  ['可灵-Omni 视频参考', 'Kling-Omni Video Reference'],
  ['可灵-Omni 参考生', 'Kling-Omni Reference-to-Video'],
  ['可灵-Omni 首尾帧', 'Kling-Omni First/Last Frames'],
  ['可灵-V3-video', 'Kling-V3-video'],
  ['可灵-V3', 'Kling-V3'],
  ['可灵-V3-Omni', 'Kling-V3-Omni'],
  ['Pix C1 参考生', 'Pix C1 Reference-to-Video'],
  ['Pix C1 首尾帧', 'Pix C1 First/Last Frames'],
  ['Pix V5.6 参考生', 'Pix V5.6 Reference-to-Video'],
  ['Pix V5.6 首尾帧', 'Pix V5.6 First/Last Frames'],
  ['Pix V6 首尾帧', 'Pix V6 First/Last Frames'],
  ['SD 2.0 参考生', 'SD 2.0 Reference-to-Video'],
  ['SD 2.0 首尾帧', 'SD 2.0 First/Last Frames'],
  ['SD 2.0 全能参考', 'SD 2.0 All-purpose Reference'],
];

function normalizeName(value: unknown): string {
  return String(value || '').trim();
}

function dedupeStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = normalizeName(value);
    if (!normalized) continue;
    const lower = normalized.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    result.push(normalized);
  }
  return result;
}

export function getLingkeVideoAliases(...values: Array<string | null | undefined>): string[] {
  const direct = dedupeStrings(values);
  const lowered = new Set(direct.map((item) => item.toLowerCase()));
  const aliases = [...direct];

  for (const group of LINGKE_VIDEO_ALIAS_GROUPS) {
    if (group.some((item) => lowered.has(item.toLowerCase()))) {
      aliases.push(...group);
    }
  }

  return dedupeStrings(aliases);
}

function normalizeAspectRatioValue(value: string): string | null {
  const raw = normalizeName(value).toLowerCase();
  if (!raw) return null;
  if (raw === 'landscape') return '16:9';
  if (raw === 'portrait') return '9:16';
  if (raw === 'square') return '1:1';
  const matched = raw.match(/(\d+)\s*[:/]\s*(\d+)/);
  if (matched) {
    return `${matched[1]}:${matched[2]}`;
  }
  return null;
}

function normalizeResolutionValue(value: string): string | null {
  const raw = normalizeName(value).toLowerCase();
  if (!raw) return null;
  if (raw === 'sd') return 'SD';
  if (raw === 'hd') return 'HD';
  if (raw === '1k') return '1K';
  if (raw === '2k') return '2K';
  if (raw === '4k' || raw === '4khd') return '4K';
  if (raw === '360p') return '360P';
  if (raw === '540p') return '540P';
  if (raw === '720p') return '720P';
  if (raw === '1080p') return '1080P';
  const matched = raw.match(/(\d{3,4})p/);
  if (matched) return `${matched[1]}P`;
  return null;
}

function toBooleanOptionValue(value: string): boolean | null {
  const raw = normalizeName(value).toLowerCase();
  if (raw === 'true' || raw === '1' || raw === 'on' || raw === 'yes') return true;
  if (raw === 'false' || raw === '0' || raw === 'off' || raw === 'no') return false;
  return null;
}

function getRemoteParams(remote: LingkeRemoteApiVideoModel): LingkeRemoteApiParam[] {
  return Array.isArray(remote.params) ? remote.params.filter(Boolean) : [];
}

function findRemoteParam(remote: LingkeRemoteApiVideoModel, names: string[]): LingkeRemoteApiParam | undefined {
  const lowerNames = names.map((name) => name.toLowerCase());
  return getRemoteParams(remote).find((param) => lowerNames.includes(normalizeName(param.name).toLowerCase()));
}

function getParamOptions(param?: LingkeRemoteApiParam): LingkeRemoteApiParamOption[] {
  return Array.isArray(param?.options) ? param.options.filter(Boolean) : [];
}

function extractAspectRatios(remote: LingkeRemoteApiVideoModel): Array<{ value: string; label: string }> {
  const param = findRemoteParam(remote, ['aspect_ratio', 'ratio', 'orientation']);
  const values = getParamOptions(param)
    .map((option) => normalizeAspectRatioValue(option.value || option.label || ''))
    .filter((value): value is string => Boolean(value));

  const unique = dedupeStrings(values);
  return unique.map((value) => ({ value, label: value }));
}

function extractDurationValues(remote: LingkeRemoteApiVideoModel): number[] {
  const param = findRemoteParam(remote, ['duration']);
  const values = getParamOptions(param)
    .map((option) => {
      const raw = normalizeName(option.value || option.label || '');
      const matched = raw.match(/\d+/);
      return matched ? Number.parseInt(matched[0], 10) : NaN;
    })
    .filter((value) => Number.isFinite(value) && value > 0) as number[];

  return Array.from(new Set(values)).sort((a, b) => a - b);
}

function extractResolutionOptions(remote: LingkeRemoteApiVideoModel): string[] {
  const candidates: string[] = [];
  for (const name of ['resolution', 'quality', 'size']) {
    const param = findRemoteParam(remote, [name]);
    for (const option of getParamOptions(param)) {
      const normalized = normalizeResolutionValue(option.value || option.label || '');
      if (normalized) candidates.push(normalized);
    }
  }
  return dedupeStrings(candidates);
}

function extractReferenceCountOptions(remote: LingkeRemoteApiVideoModel): string[] {
  const text = [remote.display_name, remote.description, remote.input_hint]
    .concat(
      getRemoteParams(remote).flatMap((param) => [param.label, param.description])
    )
    .map((item) => normalizeName(item).toLowerCase())
    .join(' ');

  const rangeMatch = text.match(/(\d+)\s*[-~]\s*(\d+)\s*images?/i);
  if (rangeMatch) {
    const start = Number.parseInt(rangeMatch[1], 10);
    const end = Number.parseInt(rangeMatch[2], 10);
    if (Number.isFinite(start) && Number.isFinite(end) && start > 0 && end >= start && end - start <= 12) {
      return Array.from({ length: end - start + 1 }, (_, index) => String(start + index));
    }
  }

  if (text.includes('multi-image')) {
    return ['1', '2', '3', '4'];
  }

  return [];
}

function extractUploadFileRange(param?: LingkeRemoteApiParam): { min?: number; max?: number } {
  const text = [param?.label, param?.description]
    .map((item) => normalizeName(item).toLowerCase())
    .join(' ');

  const rangeMatch = text.match(/(\\d+)\\s*[-~]\\s*(\\d+)\\s*(images?|files?|张)/i);
  if (rangeMatch) {
    const min = Number.parseInt(rangeMatch[1], 10);
    const max = Number.parseInt(rangeMatch[2], 10);
    if (Number.isFinite(min) && Number.isFinite(max) && min > 0 && max >= min) {
      return { min, max };
    }
  }

  const singleMatch = text.match(/(\\d+)\\s*(images?|files?|张)/i);
  if (singleMatch) {
    const value = Number.parseInt(singleMatch[1], 10);
    if (Number.isFinite(value) && value > 0) {
      return { min: value, max: value };
    }
  }

  return {};
}

function inferUploadMode(remote: LingkeRemoteApiVideoModel):
  | 'text'
  | 'reference'
  | 'first_frame'
  | 'first_last_frame'
  | 'video_reference'
  | 'video_continue'
  | 'video_edit'
  | 'motion_control' {
  const params = getRemoteParams(remote);
  const hasVideoUpload = params.some((param) => ['video', 'video_url', 'reference_video', 'clips'].includes(normalizeName(param.name).toLowerCase()));
  const hasImageUpload = params.some((param) => ['images', 'image', 'image_url', 'reference_urls', 'input_reference'].includes(normalizeName(param.name).toLowerCase()));
  const imageParamText = params
    .filter((param) => ['images', 'image', 'image_url', 'reference_urls', 'input_reference'].includes(normalizeName(param.name).toLowerCase()))
    .flatMap((param) => [param.label, param.description])
    .map((item) => normalizeName(item).toLowerCase())
    .join(' ');
  const haystack = [
    remote.name,
    remote.display_name,
    remote.description,
    remote.input_hint,
    ...params.flatMap((param) => [param.name, param.label, param.description]),
  ]
    .map((item) => normalizeName(item).toLowerCase())
    .join(' ');

  if (haystack.includes('motion control')) return 'motion_control';
  if (haystack.includes('video extension') || haystack.includes('续写') || params.some((param) => normalizeName(param.name).toLowerCase() === 'clips')) {
    return 'video_continue';
  }
  if (haystack.includes('video editing') || haystack.includes('face swap')) return 'video_edit';
  if (imageParamText.includes('first and last') || imageParamText.includes('first/last')) return 'first_last_frame';
  if (imageParamText.includes('first frame')) return 'first_frame';
  if (haystack.includes('video reference')) return 'video_reference';
  if (hasVideoUpload && hasImageUpload) return 'video_reference';
  if (hasVideoUpload) return 'video_edit';
  if (haystack.includes('first/last') || haystack.includes('首尾帧')) return 'first_last_frame';
  if (haystack.includes('first frame') || haystack.includes('首帧')) return 'first_frame';
  if (haystack.includes('reference-to-video') || haystack.includes('参考')) return 'reference';
  if (hasImageUpload) {
    return 'reference';
  }
  return 'text';
}

function inferFeatures(remote: LingkeRemoteApiVideoModel, uploadMode: ReturnType<typeof inferUploadMode>): VideoModelFeatures {
  const paramNames = new Set(getRemoteParams(remote).map((param) => normalizeName(param.name).toLowerCase()));
  const hasImageUpload = ['images', 'image', 'image_url', 'reference_urls', 'input_reference'].some((name) => paramNames.has(name));
  const hasVideoUpload = ['video', 'video_url', 'reference_video', 'clips'].some((name) => paramNames.has(name));

  return {
    textToVideo: uploadMode !== 'video_edit' && uploadMode !== 'video_reference',
    imageToVideo: hasImageUpload || ['reference', 'first_frame', 'first_last_frame', 'motion_control'].includes(uploadMode),
    videoToVideo: hasVideoUpload || ['video_reference', 'video_continue', 'video_edit'].includes(uploadMode),
    supportStyles: false,
  };
}

function estimateDurationCost(durationSeconds: number, model: LingkeSyncedVideoModel): number {
  const value = `${durationSeconds}s`;
  return estimateVideoDurationCost(
    value,
    {
      billingMode: model.billingMode === 'per_1k_tokens' ? 'per_call' : model.billingMode,
      billingPrice: model.billingPrice,
      billingUnit: model.billingUnit,
    },
    model.durations[0]?.cost || Math.max(1, model.billingPrice || 96),
  );
}

function buildDurationOptions(remote: LingkeRemoteApiVideoModel, model: LingkeSyncedVideoModel): VideoDuration[] {
  const seconds = extractDurationValues(remote);
  if (seconds.length === 0) return model.durations;
  return seconds.map((value) => ({
    value: `${value}s`,
    label: `${value} 秒`,
    cost: estimateDurationCost(value, model),
  }));
}

function buildRemoteExtraParams(
  remote: LingkeRemoteApiVideoModel,
  uploadMode: ReturnType<typeof inferUploadMode>,
  aspectRatios: Array<{ value: string; label: string }>,
  resolutions: string[],
): {
  extraParams: Record<string, unknown>;
  generationMode?: string;
  qualityVersion?: string;
  modelVersion?: string;
  version?: string;
  offPeak?: boolean;
} {
  const params = getRemoteParams(remote);
  const upstreamParamNames = params
    .map((param) => normalizeName(param.name))
    .filter((name) => name && name !== 'prompt');

  const aspectRatioParam = findRemoteParam(remote, ['aspect_ratio', 'ratio', 'orientation']);
  const generationModeParam = findRemoteParam(remote, ['generation_mode', 'mode']);
  const referenceCountOptions = extractReferenceCountOptions(remote);
  const imageUploadParamNames: string[] = [];
  const videoUploadParamNames: string[] = [];
  const audioUploadParamNames: string[] = [];
  const dynamicDefaults: Record<string, unknown> = {};
  const dynamicParamOptions: Record<string, Array<{ value: string; label: string; description?: string }>> = {};
  const uploadParamMeta: Record<string, LingkeUploadParamMeta> = {};

  for (const param of params) {
    const paramName = normalizeName(param.name);
    if (!paramName || paramName === 'prompt') continue;

    const lowerName = paramName.toLowerCase();
    const paramType = normalizeName(param.type).toLowerCase();
    const options = getParamOptions(param);

    if (lowerName === 'images' || lowerName === 'image' || lowerName === 'image_url' || lowerName === 'reference_urls' || lowerName === 'input_reference') {
      imageUploadParamNames.push(paramName);
      const fileRange = extractUploadFileRange(param);
      uploadParamMeta[paramName] = {
        kind: 'image',
        label: normalizeName(param.label) || undefined,
        description: normalizeName(param.description) || undefined,
        multiple: (fileRange.max || 0) > 1 || lowerName.endsWith('s'),
        minFiles: fileRange.min,
        maxFiles: fileRange.max,
        accept: 'image/*',
      };
      continue;
    }
    if (lowerName === 'video' || lowerName === 'video_url' || lowerName === 'reference_video' || lowerName === 'clips') {
      videoUploadParamNames.push(paramName);
      const fileRange = extractUploadFileRange(param);
      uploadParamMeta[paramName] = {
        kind: 'video',
        label: normalizeName(param.label) || undefined,
        description: normalizeName(param.description) || undefined,
        multiple: (fileRange.max || 0) > 1 || lowerName.endsWith('s'),
        minFiles: fileRange.min,
        maxFiles: fileRange.max,
        accept: 'video/*',
      };
      continue;
    }
    if (lowerName === 'audio_url' || lowerName === 'sound_file' || lowerName === 'lip_ref_url') {
      audioUploadParamNames.push(paramName);
      const fileRange = extractUploadFileRange(param);
      uploadParamMeta[paramName] = {
        kind: 'audio',
        label: normalizeName(param.label) || undefined,
        description: normalizeName(param.description) || undefined,
        multiple: (fileRange.max || 0) > 1 || lowerName.endsWith('s'),
        minFiles: fileRange.min,
        maxFiles: fileRange.max,
        accept: 'audio/*',
      };
      continue;
    }

    if (options.length > 0) {
      dynamicParamOptions[paramName] = options.map((option) => ({
        value: normalizeName(option.value || option.label || ''),
        label: normalizeName(option.label || option.value || ''),
        description: normalizeName(option.description) || undefined,
      })).filter((option) => option.value);
    }

    const firstOption = options[0];
    const firstValue = normalizeName(firstOption?.value || firstOption?.label || '');
    if (!firstValue) {
      if (paramType === 'switch') {
        dynamicDefaults[paramName] = false;
      }
      continue;
    }

    if (paramType === 'switch') {
      dynamicDefaults[paramName] = toBooleanOptionValue(firstValue) ?? false;
      continue;
    }

    dynamicDefaults[paramName] = firstValue;
  }

  const extraParams: Record<string, unknown> = {
    upload_mode: uploadMode,
    requires_upload: uploadMode !== 'text',
    upload_param_names: dedupeStrings([...imageUploadParamNames, ...videoUploadParamNames, ...audioUploadParamNames]),
    image_upload_param_names: dedupeStrings(imageUploadParamNames),
    video_upload_param_names: dedupeStrings(videoUploadParamNames),
    audio_upload_param_names: dedupeStrings(audioUploadParamNames),
    upstream_param_names: dedupeStrings(upstreamParamNames),
    submit_only_upstream_params: upstreamParamNames.length > 0,
    dynamic_param_options: dynamicParamOptions,
    default_dynamic_param_values: dynamicDefaults,
    upload_param_meta: uploadParamMeta,
  };

  if (aspectRatioParam && normalizeName(aspectRatioParam.name) && normalizeName(aspectRatioParam.name) !== 'aspect_ratio') {
    extraParams.aspect_ratio_param_name = normalizeName(aspectRatioParam.name);
  }
  if (generationModeParam && normalizeName(generationModeParam.name) && normalizeName(generationModeParam.name) !== 'generation_mode') {
    extraParams.generation_mode_param_name = normalizeName(generationModeParam.name);
  }
  if (resolutions.length > 0) {
    extraParams.image_resolution_options = resolutions;
  }
  if (referenceCountOptions.length > 0) {
    extraParams.min_reference_image_count = Number.parseInt(referenceCountOptions[0], 10);
    extraParams.max_reference_image_count = Number.parseInt(referenceCountOptions[referenceCountOptions.length - 1], 10);
    extraParams.reference_image_count_options = referenceCountOptions;
    extraParams.default_reference_image_count = Number.parseInt(referenceCountOptions[0], 10);
  }

  const topLevel = {
    generationMode:
      typeof dynamicDefaults.generation_mode === 'string'
        ? dynamicDefaults.generation_mode
        : typeof dynamicDefaults.mode === 'string'
          ? dynamicDefaults.mode
          : undefined,
    qualityVersion:
      typeof dynamicDefaults.quality_version === 'string'
        ? dynamicDefaults.quality_version
        : undefined,
    modelVersion:
      typeof dynamicDefaults.model_version === 'string'
        ? dynamicDefaults.model_version
        : typeof dynamicDefaults.model_variant === 'string'
          ? dynamicDefaults.model_variant
          : undefined,
    version:
      typeof dynamicDefaults.version === 'string'
        ? dynamicDefaults.version
        : undefined,
    offPeak:
      typeof dynamicDefaults.off_peak === 'boolean'
        ? dynamicDefaults.off_peak
        : undefined,
  };

  for (const [key, value] of Object.entries(dynamicDefaults)) {
    const isTopLevelMapped = ['generation_mode', 'mode', 'quality_version', 'model_version', 'model_variant', 'version', 'off_peak'].includes(key);
    const isAspectRatioField = key === normalizeName(aspectRatioParam?.name).toLowerCase();
    if (!isTopLevelMapped && !isAspectRatioField) {
      extraParams[key] = value;
    }
  }

  if (aspectRatios.length > 0 && !extraParams.aspect_ratio_param_name) {
    extraParams.aspect_ratio_param_name = 'aspect_ratio';
  }

  return {
    extraParams,
    ...topLevel,
  };
}

function mergeRemoteModel(remote: LingkeRemoteApiVideoModel, imageUrl?: string): LingkeSyncedVideoModel {
  const displayName = normalizeName(remote.display_name) || normalizeName(remote.name);
  const aliases = getLingkeVideoAliases(displayName, remote.name);
  const template =
    aliases
      .map((alias) => createLingkeSyncedVideoModelFromName(alias, imageUrl))
      .find((candidate) => candidate.description !== DEFAULT_TEMPLATE_DESCRIPTION)
    || createLingkeSyncedVideoModelFromName(displayName, imageUrl);
  const uploadMode = inferUploadMode(remote);
  const remoteFeatures = inferFeatures(remote, uploadMode);
  const aspectRatios = extractAspectRatios(remote);
  const resolutions = extractResolutionOptions(remote);
  const durations = buildDurationOptions(remote, template);
  const defaultAspectRatio = aspectRatios[0]?.value || template.defaultAspectRatio || '16:9';
  const defaultDuration = durations[0]?.value || template.defaultDuration || '8s';
  const defaultVideoLength = Number.parseInt(defaultDuration, 10) || template.videoConfigObject.video_length || 8;
  const defaultResolution = resolutions[0] || normalizeResolutionValue(String(template.videoConfigObject.resolution || '')) || '720P';
  const remoteDefaults = buildRemoteExtraParams(remote, uploadMode, aspectRatios, resolutions);

  const mergedExtraParams = {
    ...(template.videoConfigObject.extra_params || {}),
    ...remoteDefaults.extraParams,
  };

  const videoConfigObject: VideoConfigObject = {
    ...template.videoConfigObject,
    aspect_ratio: defaultAspectRatio as VideoConfigObject['aspect_ratio'],
    video_length: defaultVideoLength,
    resolution: defaultResolution as VideoConfigObject['resolution'],
    generation_mode: template.videoConfigObject.generation_mode || remoteDefaults.generationMode,
    quality_version: template.videoConfigObject.quality_version || remoteDefaults.qualityVersion,
    model_version: template.videoConfigObject.model_version || remoteDefaults.modelVersion,
    version: template.videoConfigObject.version || remoteDefaults.version,
    off_peak:
      typeof template.videoConfigObject.off_peak === 'boolean'
        ? template.videoConfigObject.off_peak
        : remoteDefaults.offPeak,
    extra_params: mergedExtraParams,
  };

  return {
    ...template,
    apiModel: normalizeName(remote.name),
    matchKeys: aliases,
    name: displayName,
    description:
      template.description !== DEFAULT_TEMPLATE_DESCRIPTION
        ? template.description
        : normalizeName(remote.description) || template.description,
    features: {
      ...template.features,
      ...remoteFeatures,
    },
    aspectRatios: aspectRatios.length > 0 ? aspectRatios : template.aspectRatios,
    defaultAspectRatio,
    durations,
    defaultDuration,
    videoConfigObject,
    imageUrl: imageUrl || template.imageUrl,
  };
}

function buildVisibleImageMap(items: LingkeVisibleVideoModel[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const item of items) {
    const displayName = normalizeName(item.展示名称);
    const imageUrl = normalizeName(item.模型图标);
    if (!displayName || !imageUrl) continue;
    for (const alias of getLingkeVideoAliases(displayName)) {
      if (!map.has(alias.toLowerCase())) {
        map.set(alias.toLowerCase(), imageUrl);
      }
    }
  }
  return map;
}

export async function fetchLingkeRemoteVideoModels(baseUrl: string, apiKey: string): Promise<LingkeRemoteApiVideoModel[]> {
  const normalizedBaseUrl = normalizeName(baseUrl).replace(/\/$/, '');
  const normalizedApiKey = normalizeName(apiKey).split(',')[0]?.trim() || '';
  if (!normalizedBaseUrl || !normalizedApiKey) {
    throw new Error('灵刻媒体渠道缺少 Base URL 或 API Key');
  }

  const response = await fetch(`${normalizedBaseUrl}/v1/media/models?type=video`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${normalizedApiKey}`,
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    const details = await response.text().catch(() => '');
    throw new Error(`拉取灵刻视频模型失败 (${response.status})${details ? `: ${details}` : ''}`);
  }

  const data = await response.json().catch(() => ({}));
  const models = Array.isArray(data?.models) ? data.models : [];
  return models.filter((item: LingkeRemoteApiVideoModel) => normalizeName(item?.name));
}

export async function fetchLingkeSyncedVideoModelsForChannel(options: {
  baseUrl?: string;
  apiKey?: string;
} = {}): Promise<LingkeSyncedVideoModel[]> {
  const visibleItems = await fetchLingkeVisibleVideoModels().catch(() => [] as LingkeVisibleVideoModel[]);
  const visibleImageMap = buildVisibleImageMap(visibleItems);

  if (options.baseUrl && options.apiKey) {
    const remoteModels = await fetchLingkeRemoteVideoModels(options.baseUrl, options.apiKey);
    if (remoteModels.length > 0) {
      const syncedRemoteModels = remoteModels
        .map((remote) => {
          const imageUrl = getLingkeVideoAliases(remote.display_name, remote.name)
            .map((alias) => visibleImageMap.get(alias.toLowerCase()))
            .find(Boolean);
          return mergeRemoteModel(remote, imageUrl);
        });

      const coveredVisibleAliases = new Set(
        syncedRemoteModels.flatMap((model) =>
          getLingkeVideoAliases(model.apiModel, model.name, ...(model.matchKeys || []))
            .map((alias) => alias.toLowerCase())
        )
      );

      const visibleOnlyModels = visibleItems
        .filter((item) => {
          const aliases = getLingkeVideoAliases(normalizeName(item.展示名称));
          return aliases.some((alias) => !coveredVisibleAliases.has(alias.toLowerCase()));
        })
        .map((item) =>
          createLingkeSyncedVideoModelFromName(
            normalizeName(item.展示名称),
            normalizeName(item.模型图标) || undefined,
          )
        );

      return [...syncedRemoteModels, ...visibleOnlyModels]
        .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    }
  }

  return visibleItems
    .map((item) => createLingkeSyncedVideoModelFromName(normalizeName(item.展示名称), normalizeName(item.模型图标) || undefined))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
}
