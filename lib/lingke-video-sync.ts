import type { VideoConfigObject, VideoDuration, VideoModelFeatures } from '@/types';
import { estimateVideoDurationCost } from '@/lib/video-model-normalizer';
import { sanitizeLingkeVideoConfigObject } from '@/lib/lingke-video-config';
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
const IMAGE_UPLOAD_PARAM_NAMES = [
  'images',
  'image',
  'image_url',
  'image_urls',
  'img_url',
  'img_urls',
  'reference_urls',
  'reference_image',
  'reference_image_url',
  'reference_image_urls',
  'input_reference',
  'first_frame_url',
  '_first_frame_url',
  'last_frame_url',
  'assets',
];
const VIDEO_UPLOAD_PARAM_NAMES = ['video', 'video_url', 'reference_video', 'clips'];
const AUDIO_UPLOAD_PARAM_NAMES = ['audio_url', 'sound_file', 'lip_ref_url'];

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
const RETIRED_LINGKE_VIDEO_MODEL_ALIASES = new Set([
  'veo3.1-lite',
  'hailuo 2.3',
  'hailuo-2.3',
]);

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

export function isRetiredLingkeVideoModel(...values: Array<string | null | undefined>): boolean {
  return dedupeStrings(values)
    .some((value) => RETIRED_LINGKE_VIDEO_MODEL_ALIASES.has(value.toLowerCase()));
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

function buildRemoteCapabilityText(remote: LingkeRemoteApiVideoModel): string {
  return [
    remote.name,
    remote.display_name,
    remote.description,
    remote.input_hint,
    ...(remote.tags || []),
    ...getRemoteParams(remote).flatMap((param) => [
      param.name,
      param.label,
      param.description,
      ...getParamOptions(param).flatMap((option) => [option.value, option.label, option.description]),
    ]),
  ]
    .map((item) => normalizeName(item).toLowerCase())
    .filter(Boolean)
    .join(' ');
}

function hasRemoteUploadParam(remote: LingkeRemoteApiVideoModel, names: string[]): boolean {
  const normalizedNames = new Set(names.map((name) => name.toLowerCase()));
  return getRemoteParams(remote).some((param) => normalizedNames.has(normalizeName(param.name).toLowerCase()));
}

function hasRemoteTextCapability(remote: LingkeRemoteApiVideoModel, haystack = buildRemoteCapabilityText(remote)): boolean {
  return (
    /\btext[-\s]?to[-\s]?video\b|文生视频|文本生成视频|leave empty for text[-\s]?to[-\s]?video|omit for text[-\s]?to[-\s]?video/i.test(haystack)
    || getRemoteParams(remote).some((param) => normalizeName(param.name).toLowerCase() === 'generation_type')
  );
}

function findRemoteParam(remote: LingkeRemoteApiVideoModel, names: string[]): LingkeRemoteApiParam | undefined {
  const lowerNames = names.map((name) => name.toLowerCase());
  return getRemoteParams(remote).find((param) => lowerNames.includes(normalizeName(param.name).toLowerCase()));
}

function getParamOptions(param?: LingkeRemoteApiParam): LingkeRemoteApiParamOption[] {
  return Array.isArray(param?.options) ? param.options.filter(Boolean) : [];
}

type LingkeParamOptionEntry = {
  value: string;
  label: string;
};

function collectParamOptionEntries(value: unknown): LingkeParamOptionEntry[] {
  if (!Array.isArray(value)) return [];

  const entries: LingkeParamOptionEntry[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
      const optionValue = normalizeName(item);
      if (!optionValue) continue;
      const key = optionValue.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({ value: optionValue, label: optionValue });
      continue;
    }

    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const optionValue = normalizeName((item as { value?: unknown }).value ?? (item as { label?: unknown }).label);
    if (!optionValue) continue;
    const key = optionValue.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({
      value: optionValue,
      label: normalizeName((item as { label?: unknown }).label) || optionValue,
    });
  }

  return entries;
}

function getMergedExtraParamEntries(
  extraParams: Record<string, unknown>,
  paramNames: string[],
): LingkeParamOptionEntry[] {
  const dynamic = extraParams.dynamic_param_options;
  if (dynamic && typeof dynamic === 'object' && !Array.isArray(dynamic)) {
    for (const paramName of paramNames) {
      const entries = collectParamOptionEntries((dynamic as Record<string, unknown>)[paramName]);
      if (entries.length > 0) return entries;
    }
  }

  const upstreamParams = Array.isArray(extraParams.upstream_params) ? extraParams.upstream_params : [];
  for (const paramName of paramNames) {
    const matched = upstreamParams.find(
      (item) => item && typeof item === 'object' && !Array.isArray(item) && normalizeName((item as { name?: unknown }).name) === paramName
    );
    if (!matched || typeof matched !== 'object' || Array.isArray(matched)) continue;
    const entries = collectParamOptionEntries((matched as { options?: unknown }).options);
    if (entries.length > 0) return entries;
  }

  return [];
}

function resolvePreferredTopLevelOption(
  extraParams: Record<string, unknown>,
  paramNames: string[],
  templateValue: unknown,
  remoteValue: unknown,
): string | undefined {
  const entries = getMergedExtraParamEntries(extraParams, paramNames);

  const matchCandidate = (value: unknown): string | undefined => {
    const normalized = normalizeName(value).toLowerCase();
    if (!normalized) return undefined;

    if (entries.length === 0) {
      return normalizeName(value) || undefined;
    }

    const matched = entries.find((entry) => (
      entry.value.toLowerCase() === normalized || entry.label.toLowerCase() === normalized
    ));
    return matched?.value;
  };

  return (
    matchCandidate(templateValue)
    || matchCandidate(remoteValue)
    || entries[0]?.value
    || normalizeName(templateValue)
    || normalizeName(remoteValue)
    || undefined
  );
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
  const hasOptionalMarker =
    /\boptional\b/i.test(text)
    || /omit\s+for\s+text[-\s]?to[-\s]?video/i.test(text)
    || /0\s*[=:]\s*text[-\s]?to[-\s]?video/i.test(text)
    || /0\s*[=:]\s*文生视频/i.test(text);

  const rangeMatch = text.match(/(\d+)\s*[-~]\s*(\d+)\s*(images?|files?|张)/i);
  if (rangeMatch) {
    const min = Number.parseInt(rangeMatch[1], 10);
    const max = Number.parseInt(rangeMatch[2], 10);
    if (Number.isFinite(min) && Number.isFinite(max) && min >= 0 && max >= min) {
      if (min === 0 || hasOptionalMarker) {
        return { max };
      }
      if (min > 0) {
        return { min, max };
      }
    }
  }

  const zeroToTextModeRangeMatch = text.match(/0\s*(images?|files?|张).*?text[-\s]?to[-\s]?video/i);
  if (zeroToTextModeRangeMatch) {
    const fallbackRange = text.match(/0\s*[-~]\s*(\d+)\s*(images?|files?|张)/i);
    if (fallbackRange) {
      const max = Number.parseInt(fallbackRange[1], 10);
      if (Number.isFinite(max) && max > 0) {
        return { max };
      }
    }
  }

  const upperBoundMatch = text.match(
    /(?:up to|at most|max(?:imum)?|no more than|最多(?:支持)?|至多|不超过)\s*(\d+)\s*(images?|files?|张)/i
  );
  if (upperBoundMatch) {
    const max = Number.parseInt(upperBoundMatch[1], 10);
    if (Number.isFinite(max) && max > 0) {
      return { max };
    }
  }

  const singleMatch = text.match(/(\d+)\s*(images?|files?|张)/i);
  if (singleMatch) {
    const value = Number.parseInt(singleMatch[1], 10);
    if (Number.isFinite(value) && value > 0) {
      if (hasOptionalMarker) {
        return { max: value };
      }
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
  const rawName = `${normalizeName(remote.name)} ${normalizeName(remote.display_name)}`.toLowerCase();
  const hasVideoUpload = hasRemoteUploadParam(remote, VIDEO_UPLOAD_PARAM_NAMES);
  const hasImageUpload = hasRemoteUploadParam(remote, IMAGE_UPLOAD_PARAM_NAMES);
  const imageParamText = params
    .filter((param) => IMAGE_UPLOAD_PARAM_NAMES.includes(normalizeName(param.name).toLowerCase()))
    .flatMap((param) => [param.label, param.description])
    .map((item) => normalizeName(item).toLowerCase())
    .join(' ');
  const haystack = buildRemoteCapabilityText(remote);

  if (/动作控制|motion control/.test(rawName)) return 'motion_control';
  if (/video extension|续写/.test(rawName) || params.some((param) => normalizeName(param.name).toLowerCase() === 'clips')) {
    return 'video_continue';
  }
  if (/video editing|face swap|视频编辑/.test(rawName)) {
    return 'video_edit';
  }
  if (
    /first\/last|first and last|首尾帧/.test(rawName)
    || imageParamText.includes('first and last')
    || imageParamText.includes('first/last')
  ) {
    return 'first_last_frame';
  }
  if (/first frame|首帧/.test(rawName) || imageParamText.includes('first frame')) return 'first_frame';
  if (/video reference|视频参考/.test(rawName) && hasVideoUpload) return 'video_reference';
  if (hasVideoUpload && hasImageUpload) return 'video_reference';
  if (hasVideoUpload) {
    return /video editing|face swap|视频编辑/.test(haystack) ? 'video_edit' : 'video_reference';
  }
  if (hasImageUpload) {
    return 'reference';
  }
  if (/first\/last|first and last|首尾帧/.test(rawName)) return 'first_last_frame';
  if (/first frame|首帧/.test(rawName)) return 'first_frame';
  if (/reference-to-video|参考生|参考/.test(rawName)) return 'reference';
  return 'text';
}

function inferFeatures(remote: LingkeRemoteApiVideoModel, uploadMode: ReturnType<typeof inferUploadMode>): VideoModelFeatures {
  const paramNames = new Set(getRemoteParams(remote).map((param) => normalizeName(param.name).toLowerCase()));
  const hasImageUpload = IMAGE_UPLOAD_PARAM_NAMES.some((name) => paramNames.has(name));
  const hasVideoUpload = VIDEO_UPLOAD_PARAM_NAMES.some((name) => paramNames.has(name));
  const haystack = buildRemoteCapabilityText(remote);
  const textToVideo =
    hasRemoteTextCapability(remote, haystack)
    || /\bpure text[-\s]?to[-\s]?video\b|仅文本|纯文本/i.test(haystack);
  const imageToVideo =
    hasImageUpload
    || /\bimage[-\s]?to[-\s]?video\b|图生视频|reference[-\s]?based|reference[-\s]?to[-\s]?video|first[-\s]?frame|first and last|首帧|首尾帧|multi[-\s]?image|多图参考/i.test(haystack);
  const videoToVideo =
    hasVideoUpload
    || /\bvideo[-\s]?to[-\s]?video\b|视频转视频|video reference|video extension|video editing|续写|编辑|动作控制/i.test(haystack);

  return {
    textToVideo,
    imageToVideo: imageToVideo || ['reference', 'first_frame', 'first_last_frame', 'motion_control'].includes(uploadMode),
    videoToVideo: videoToVideo || ['video_reference', 'video_continue', 'video_edit', 'motion_control'].includes(uploadMode),
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
  features: VideoModelFeatures,
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
  const durationParam = findRemoteParam(remote, ['duration', 'video_length', 'length', 'time', 'seconds']);
  const generationModeParam = findRemoteParam(remote, ['generation_mode', 'mode']);
  const referenceCountOptions = extractReferenceCountOptions(remote);
  const imageUploadParamNames: string[] = [];
  const videoUploadParamNames: string[] = [];
  const audioUploadParamNames: string[] = [];
  const requiredUploadParamNames: string[] = [];
  const requiredImageUploadParamNames: string[] = [];
  const requiredVideoUploadParamNames: string[] = [];
  const requiredAudioUploadParamNames: string[] = [];
  const dynamicDefaults: Record<string, unknown> = {};
  const dynamicParamOptions: Record<string, Array<{ value: string; label: string; description?: string }>> = {};
  const uploadParamMeta: Record<string, LingkeUploadParamMeta> = {};

  for (const param of params) {
    const paramName = normalizeName(param.name);
    if (!paramName || paramName === 'prompt') continue;

    const lowerName = paramName.toLowerCase();
    const paramType = normalizeName(param.type).toLowerCase();
    const options = getParamOptions(param);

    if (IMAGE_UPLOAD_PARAM_NAMES.includes(lowerName)) {
      imageUploadParamNames.push(paramName);
      const fileRange = extractUploadFileRange(param);
      const isRequired = Boolean(param.required);
      if (isRequired) {
        requiredUploadParamNames.push(paramName);
        requiredImageUploadParamNames.push(paramName);
      }
      uploadParamMeta[paramName] = {
        kind: 'image',
        label:
          lowerName === 'assets'
            ? '角色 / 场景素材图'
            : normalizeName(param.label) || undefined,
        description:
          lowerName === 'assets'
            ? '上传角色、场景或道具图片，系统会自动转换为上游需要的 assets JSON 素材结构。'
            : normalizeName(param.description) || undefined,
        multiple: lowerName === 'assets' || (fileRange.max || 0) > 1 || lowerName.endsWith('s'),
        minFiles: fileRange.min,
        maxFiles: fileRange.max,
        accept: 'image/*',
      };
      continue;
    }
    if (VIDEO_UPLOAD_PARAM_NAMES.includes(lowerName)) {
      videoUploadParamNames.push(paramName);
      const fileRange = extractUploadFileRange(param);
      const isRequired = Boolean(param.required);
      if (isRequired) {
        requiredUploadParamNames.push(paramName);
        requiredVideoUploadParamNames.push(paramName);
      }
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
    if (AUDIO_UPLOAD_PARAM_NAMES.includes(lowerName)) {
      const fileRange = extractUploadFileRange(param);
      const isLipReference =
        lowerName === 'lip_ref_url'
        || /face|lip[-\s]?sync|人脸|头像|口型|close-up/i.test(
          `${normalizeName(param.label)} ${normalizeName(param.description)}`
        );
      const kind = isLipReference ? 'image' : 'audio';
      if (kind === 'image') {
        imageUploadParamNames.push(paramName);
      } else {
        audioUploadParamNames.push(paramName);
      }
      const isRequired = Boolean(param.required);
      if (isRequired) {
        requiredUploadParamNames.push(paramName);
        if (kind === 'image') {
          requiredImageUploadParamNames.push(paramName);
        } else {
          requiredAudioUploadParamNames.push(paramName);
        }
      }
      uploadParamMeta[paramName] = {
        kind,
        label: normalizeName(param.label) || undefined,
        description: normalizeName(param.description) || undefined,
        multiple: (fileRange.max || 0) > 1 || lowerName.endsWith('s'),
        minFiles: fileRange.min,
        maxFiles: fileRange.max,
        accept: kind === 'image' ? 'image/*' : 'audio/*',
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

  const hasAnyUploadParams = imageUploadParamNames.length > 0 || videoUploadParamNames.length > 0 || audioUploadParamNames.length > 0;
  const uploadIsIntrinsicallyRequired =
    uploadMode === 'motion_control'
    || (!features.textToVideo && hasAnyUploadParams);

  const extraParams: Record<string, unknown> = {
    upload_mode: uploadMode,
    requires_upload:
      dedupeStrings(requiredUploadParamNames).length > 0
      || uploadIsIntrinsicallyRequired,
    upload_param_names: dedupeStrings([...imageUploadParamNames, ...videoUploadParamNames, ...audioUploadParamNames]),
    image_upload_param_names: dedupeStrings(imageUploadParamNames),
    video_upload_param_names: dedupeStrings(videoUploadParamNames),
    audio_upload_param_names: dedupeStrings(audioUploadParamNames),
    required_upload_param_names: dedupeStrings(requiredUploadParamNames),
    required_image_upload_param_names: dedupeStrings(requiredImageUploadParamNames),
    required_video_upload_param_names: dedupeStrings(requiredVideoUploadParamNames),
    required_audio_upload_param_names: dedupeStrings(requiredAudioUploadParamNames),
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
  if (durationParam && normalizeName(durationParam.name) && normalizeName(durationParam.name) !== 'duration') {
    extraParams.duration_param_name = normalizeName(durationParam.name);
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
    const normalizedAspectRatioParamName = normalizeName(aspectRatioParam?.name).toLowerCase();
    const normalizedDurationParamName = normalizeName(durationParam?.name).toLowerCase();
    const isCanonicalVideoField = [
      'aspect_ratio',
      'ratio',
      'orientation',
      'duration',
      'video_length',
      'length',
      'time',
      'seconds',
      'resolution',
      'size',
    ].includes(key);
    const isAspectRatioField = key === normalizedAspectRatioParamName;
    const isDurationField = key === normalizedDurationParamName;
    if (!isTopLevelMapped && !isAspectRatioField && !isDurationField && !isCanonicalVideoField) {
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
  const hasCuratedTemplate = template.description !== DEFAULT_TEMPLATE_DESCRIPTION;
  const uploadMode = inferUploadMode(remote);
  const remoteFeatures = inferFeatures(remote, uploadMode);
  const mergedFeatures: VideoModelFeatures = hasCuratedTemplate
    ? {
        ...remoteFeatures,
        ...template.features,
        supportStyles: Boolean(template.features.supportStyles || remoteFeatures.supportStyles),
      }
    : {
        ...template.features,
        ...remoteFeatures,
      };
  const aspectRatios = extractAspectRatios(remote);
  const resolutions = extractResolutionOptions(remote);
  const durations = buildDurationOptions(remote, template);
  const preferredTemplateAspectRatio = normalizeAspectRatioValue(template.defaultAspectRatio || '');
  const defaultAspectRatio =
    aspectRatios.find((ratio) => ratio.value === preferredTemplateAspectRatio)?.value
    || aspectRatios[0]?.value
    || template.defaultAspectRatio
    || '16:9';
  const defaultDuration =
    durations.find((duration) => duration.value === template.defaultDuration)?.value
    || durations[0]?.value
    || template.defaultDuration
    || '8s';
  const defaultVideoLength = Number.parseInt(defaultDuration, 10) || template.videoConfigObject.video_length || 8;
  const preferredTemplateResolution = normalizeResolutionValue(String(template.videoConfigObject.resolution || ''));
  const defaultResolution =
    resolutions.find((resolution) => resolution === preferredTemplateResolution)
    || resolutions[0]
    || preferredTemplateResolution
    || '720P';
  const remoteDefaults = buildRemoteExtraParams(remote, uploadMode, remoteFeatures, aspectRatios, resolutions);

  const mergedExtraParams = {
    ...(template.videoConfigObject.extra_params || {}),
    ...remoteDefaults.extraParams,
  };

  const videoConfigObject: VideoConfigObject = {
    ...template.videoConfigObject,
    aspect_ratio: defaultAspectRatio as VideoConfigObject['aspect_ratio'],
    video_length: defaultVideoLength,
    resolution: defaultResolution as VideoConfigObject['resolution'],
    generation_mode: resolvePreferredTopLevelOption(
      mergedExtraParams,
      ['generation_mode', 'mode'],
      template.videoConfigObject.generation_mode,
      remoteDefaults.generationMode,
    ),
    quality_version: resolvePreferredTopLevelOption(
      mergedExtraParams,
      ['quality_version'],
      template.videoConfigObject.quality_version,
      remoteDefaults.qualityVersion,
    ),
    model_version: resolvePreferredTopLevelOption(
      mergedExtraParams,
      ['model_version', 'model_variant'],
      template.videoConfigObject.model_version,
      remoteDefaults.modelVersion,
    ),
    version: resolvePreferredTopLevelOption(
      mergedExtraParams,
      ['version'],
      template.videoConfigObject.version,
      remoteDefaults.version,
    ),
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
      hasCuratedTemplate
        ? template.description
        : normalizeName(remote.description) || template.description,
    features: mergedFeatures,
    aspectRatios: aspectRatios.length > 0 ? aspectRatios : template.aspectRatios,
    defaultAspectRatio,
    durations,
    defaultDuration,
    videoConfigObject: sanitizeLingkeVideoConfigObject(videoConfigObject) || videoConfigObject,
    imageUrl: imageUrl || template.imageUrl,
  };
}

function buildVisibleImageMap(items: LingkeVisibleVideoModel[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const item of items) {
    const displayName = normalizeName(item.展示名称);
    const imageUrl = normalizeName(item.模型图标);
    if (!displayName || !imageUrl || isRetiredLingkeVideoModel(displayName)) continue;
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
        })
        .filter((item) => !isRetiredLingkeVideoModel(item.apiModel, item.name, ...(item.matchKeys || [])));

      return syncedRemoteModels
        .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    }
  }

  return visibleItems
    .map((item) => createLingkeSyncedVideoModelFromName(normalizeName(item.展示名称), normalizeName(item.模型图标) || undefined))
    .filter((item) => !isRetiredLingkeVideoModel(item.apiModel, item.name, ...(item.matchKeys || [])))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
}
