'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import {
  Check,
  CheckSquare,
  Clock3,
  Crown,
  ImagePlus,
  Repeat,
  Sparkles,
  Trash2,
  UploadCloud,
  Video,
  Volume2,
  Wand2,
} from 'lucide-react';
import { calculateBillingCost, formatBillingSummary } from '@/lib/billing';
import {
  getEffectiveMembershipLevel,
  MEMBERSHIP_LABELS,
  MEMBERSHIP_RECHARGE_TIERS,
  PRICING_REFERENCE_ROWS,
  getVideoPricingPreviewLabel,
  resolveImageGenerationCost,
  resolveVideoGenerationCost,
} from '@/lib/member-pricing';
import {
  buildTaskFromGeneration,
  deleteGenerationRecord,
  deleteGenerationRecords,
  fetchGenerationSubmit,
  fetchPendingGenerationTasks,
  fetchRecentUserGenerations,
  filterGenerationsByKind,
  filterTasksByKind,
  isFailedGenerationStatus,
  isTerminalGenerationStatus,
  mergeGenerationsById,
  mergeTasksById,
  pollGenerationTask,
  replaceActiveTasks,
} from '@/lib/generation-client';
import { resolveVideoModelImage } from '@/lib/model-images';
import { uploadMediaFileToPublicUrl } from '@/lib/client-media-upload';
import {
  formatMediaDurationRange,
  parseMediaDurationRangeFromText,
  roundMediaDurationSeconds,
  type MediaDurationRange,
  validateMediaDurationAgainstRange,
} from '@/lib/media-duration-rules';
import {
  localizeVideoDynamicOptionLabel,
  localizeVideoUploadDescription,
  localizeVideoUploadLabel,
} from '@/lib/video-upload-presenter';
import { resolveVideoModelLabel } from '@/lib/video-model-label';
import { CustomSelect } from '@/components/ui/select-custom';
import { ResultGallery, type Task } from '@/components/generator/result-gallery';
import {
  LcCard,
  LcCostBar,
  LcInput,
  LcPageTitle,
  LcResultPanel,
  LcSection,
  LcSelect,
  LcTabs,
  LcTextarea,
  LcUploadBox,
} from '@/components/lc/tool-shell';
import { ModelPreview, getImageModelPreviewMeta } from '@/components/model/model-preview';
import { cn } from '@/lib/utils';
import type { Generation, SafeImageModel, SafeVideoModel, VideoConfigObject } from '@/types';

type ImageVariant = 'gptimage' | 'nanobanana';
type VideoVariant = 'supervideo' | 'happyvideo' | 'sora2' | 'grok';

type UploadedMedia = {
  name: string;
  mimeType: string;
  data: string;
  slot?: VideoUploadSlot;
  size?: number;
  durationSeconds?: number;
};

const IMAGE_MODEL_FALLBACKS: Record<ImageVariant, string[]> = {
  gptimage: ['GPT2 图像生成', 'GPT-Image-2', 'gpt-image-2'],
  nanobanana: ['大香蕉2', 'Nano Banana Pro', 'Nano Banana 2'],
};

const VIDEO_MODEL_FALLBACKS: Record<VideoVariant, string[]> = {
  supervideo: ['视频生成 标准', '视频生成 高清'],
  happyvideo: ['视频创作 标准', '视频创作 高清'],
  sora2: ['Sora2', 'Sora2 Pro'],
  grok: ['Grok3 Video'],
};

const COMMON_RATIOS = [
  ['9:16', '竖屏 (9:16)'],
  ['1:1', '方图 (1:1)'],
  ['16:9', '横屏 (16:9)'],
  ['3:4', '竖图 (3:4)'],
  ['4:3', '横图 (4:3)'],
];

type VideoModelSummary = Pick<
  SafeVideoModel,
  | 'id'
  | 'name'
  | 'description'
  | 'apiModel'
  | 'channelType'
  | 'highlight'
  | 'enabled'
  | 'features'
  | 'aspectRatios'
  | 'billingMode'
  | 'billingPrice'
  | 'billingUnit'
  | 'normalPrice'
  | 'vipPrice'
  | 'svipPrice'
  | 'pricingRules'
  | 'durations'
  | 'defaultAspectRatio'
  | 'defaultDuration'
  | 'imageUrl'
  | 'videoConfigObject'
> & {
  durations?: Array<{ value: string; label: string; cost: number }>;
  defaultAspectRatio?: string;
  defaultDuration?: string;
};

type VideoUploadSlot = string;

type VideoReferenceSlotConfig = {
  key: VideoUploadSlot;
  label: string;
  hint: string;
  accept: string;
  kind: 'image' | 'video' | 'audio';
  paramName?: string;
  multiple?: boolean;
  minFiles?: number;
  maxFiles?: number;
  required?: boolean;
  durationRange?: MediaDurationRange | null;
};

type VideoDynamicSelectOption = {
  value: string;
  label: string;
  rawValue: unknown;
};

type VideoAdvancedSelectField = {
  key: string;
  label: string;
  options: VideoDynamicSelectOption[];
  source: 'top-level' | 'extra';
};

type VideoModelFamilyKey =
  | 'vidu'
  | 'jimeng'
  | 'veo'
  | 'kling'
  | 'grok'
  | 'sora'
  | 'hailuo'
  | 'wanxiang'
  | 'runway'
  | 'pixverse'
  | 'happyhorse'
  | 'default';

type VideoModelCardMeta = {
  familyLabel: string;
  familySubtitle: string;
  badge: string;
  imageUrl: string;
  billingText: string;
};

type GroupedVideoModelsSection = {
  key: VideoModelFamilyKey;
  label: string;
  subtitle: string;
  accent: string;
  models: VideoModelSummary[];
};

const VIDEO_MODEL_FAMILY_STYLES: Record<
  VideoModelFamilyKey,
  {
    label: string;
    icon: string;
    subtitle: string;
    colors: [string, string, string];
    accent: string;
  }
> = {
  vidu: {
    label: 'Vidu',
    icon: 'V',
    subtitle: '视频生成',
    colors: ['#090f1f', '#2f2a8f', '#11c5f4'],
    accent: '#7ff4ff',
  },
  jimeng: {
    label: '即梦',
    icon: '梦',
    subtitle: '视频生成',
    colors: ['#120f20', '#7c3aed', '#ff4cc9'],
    accent: '#ffd0f3',
  },
  veo: {
    label: 'Veo 3.1',
    icon: '3.1',
    subtitle: '视频生成',
    colors: ['#09111f', '#1d4ed8', '#a855f7'],
    accent: '#dbeafe',
  },
  kling: {
    label: '可灵',
    icon: '灵',
    subtitle: '视频生成',
    colors: ['#07131d', '#0f9d8a', '#22c55e'],
    accent: '#d8fff7',
  },
  grok: {
    label: 'Grok',
    icon: 'G',
    subtitle: '视频生成',
    colors: ['#0b0d15', '#6d28d9', '#f97316'],
    accent: '#ffe7c7',
  },
  sora: {
    label: 'Sora',
    icon: 'S',
    subtitle: '视频生成',
    colors: ['#09111f', '#0ea5e9', '#7dd3fc'],
    accent: '#d7f8ff',
  },
  hailuo: {
    label: '海螺',
    icon: '螺',
    subtitle: '视频生成',
    colors: ['#071715', '#0f766e', '#38bdf8'],
    accent: '#d6fff4',
  },
  wanxiang: {
    label: '万相',
    icon: '万',
    subtitle: '视频生成',
    colors: ['#130f2d', '#5b21b6', '#38bdf8'],
    accent: '#e0ddff',
  },
  runway: {
    label: 'Runway',
    icon: 'R',
    subtitle: '视频生成',
    colors: ['#0b0f18', '#f59e0b', '#8b5cf6'],
    accent: '#fff1cf',
  },
  pixverse: {
    label: 'PixVerse',
    icon: 'P',
    subtitle: '视频生成',
    colors: ['#130f20', '#db2777', '#fb923c'],
    accent: '#ffd9ef',
  },
  happyhorse: {
    label: '快乐马',
    icon: '马',
    subtitle: '视频生成',
    colors: ['#07111a', '#ea580c', '#facc15'],
    accent: '#fff1c7',
  },
  default: {
    label: '视频',
    icon: 'V',
    subtitle: '视频生成',
    colors: ['#111827', '#334155', '#0ea5e9'],
    accent: '#dbeafe',
  },
};

const VIDEO_MODEL_FAMILY_ORDER: VideoModelFamilyKey[] = [
  'veo',
  'kling',
  'vidu',
  'wanxiang',
  'pixverse',
  'happyhorse',
  'sora',
  'grok',
  'hailuo',
  'jimeng',
  'runway',
  'default',
];

function makeFallbackVideoModels(variant: VideoVariant): VideoModelSummary[] {
  return VIDEO_MODEL_FALLBACKS[variant].map((name, index) => ({
    id: `__fallback_video_${index}`,
    name,
    description: '',
    apiModel: name,
    channelType: 'lingke-media',
    highlight: false,
    enabled: true,
    features: {
      textToVideo: true,
      imageToVideo: false,
      videoToVideo: false,
      supportStyles: false,
    },
    aspectRatios: [
      { value: 'landscape', label: '16:9' },
      { value: 'portrait', label: '9:16' },
    ],
    defaultAspectRatio: 'landscape',
    billingMode: 'per_second',
    billingPrice: 12,
    billingUnit: 1,
    imageUrl: undefined,
    durations: [{ value: '8s', label: '8 秒', cost: 100 }],
    defaultDuration: '8s',
  })) as VideoModelSummary[];
}

function makeFallbackImageModels(variant: ImageVariant): SafeImageModel[] {
  const isGpt = variant === 'gptimage';
  const base = isGpt ? 'GPT Image 2' : 'Nano Banana Pro';
  const alt = isGpt ? 'GPT-Image-2' : 'Nano Banana 2';
  const models = [
    { id: `__fallback_image_0`, name: base, description: '', highlight: true, apiModel: base },
    { id: `__fallback_image_1`, name: alt, description: '', highlight: false, apiModel: alt },
  ];

  return models.map((item) => ({
    ...item,
    channelId: 'fallback',
    channelType: 'lingke-media',
    enabled: true,
    features: {
      textToImage: true,
      imageToImage: !isGpt,
      upscale: false,
      matting: false,
      multipleImages: !isGpt,
      imageSize: !isGpt,
      qualityOptions: [],
    },
    aspectRatios: isGpt ? ['1:1', '16:9', '9:16'] : ['9:16', '1:1', '16:9'],
    resolutions: isGpt
      ? {
          '1:1': '1024x1024',
          '16:9': '1536x864',
          '9:16': '864x1536',
        }
      : {
          '1:1': '1024x1024',
          '16:9': '1536x864',
          '9:16': '864x1536',
        },
    defaultAspectRatio: isGpt ? '1:1' : '9:16',
    defaultImageSize: isGpt ? '1K' : '2K',
    allowEmptyPrompt: false,
    requiresReferenceImage: false,
    costPerGeneration: isGpt ? 0 : 20,
    billingMode: 'per_call',
    billingPrice: isGpt ? 0 : 20,
    billingUnit: 1,
    imageUrl: undefined,
    sortOrder: 0,
    imageSizes: isGpt ? ['1K', '2K'] : ['1K', '2K', '4K'],
  })) as SafeImageModel[];
}

function escapeSvgText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function resolveVideoModelFamily(model: VideoModelSummary): VideoModelFamilyKey {
  const raw = `${model.name} ${model.apiModel || ''}`.toLowerCase();
  if (/vidu|解说漫/.test(raw)) return 'vidu';
  if (/即梦|jimeng/.test(raw)) return 'jimeng';
  if (/veo|veo3|veo 3/.test(raw)) return 'veo';
  if (/可灵|kling/.test(raw)) return 'kling';
  if (/grok/.test(raw)) return 'grok';
  if (/sora/.test(raw)) return 'sora';
  if (/海螺|minimax/.test(raw)) return 'hailuo';
  if (/万相|qwen/.test(raw)) return 'wanxiang';
  if (/runway/.test(raw)) return 'runway';
  if (/pix/.test(raw)) return 'pixverse';
  if (/快乐马|happyhorse/.test(raw)) return 'happyhorse';
  return 'default';
}

function getVideoModelUploadKinds(model?: VideoModelSummary) {
  const uploadMeta = Object.values(getVideoUploadParamMeta(model));
  return {
    hasImage: uploadMeta.some((item) => item.kind === 'image'),
    hasVideo: uploadMeta.some((item) => item.kind === 'video'),
    hasAudio: uploadMeta.some((item) => item.kind === 'audio'),
  };
}

function getVideoModelKindLabel(model: VideoModelSummary): string {
  const inputMode = getVideoModelInputMode(model);
  const { hasImage, hasVideo, hasAudio } = getVideoModelUploadKinds(model);
  switch (inputMode) {
    case 'motion_control':
      return hasAudio ? '动作控制 / 音频' : '动作控制';
    case 'video_continue':
      return hasAudio ? '视频续写 / 音频' : '视频续写';
    case 'video_edit':
      return hasAudio ? '视频编辑 / 音频' : '视频编辑';
    case 'video_reference':
      return hasAudio
        ? (model.features?.textToVideo ? '文生 / 视频参考 / 音频' : '视频参考 / 音频')
        : model.features?.textToVideo ? '文生 / 视频参考' : '视频参考';
    case 'first_last_frame':
      return hasAudio
        ? (model.features?.textToVideo ? '文生 / 首尾帧 / 音频' : '首尾帧 / 音频')
        : model.features?.textToVideo ? '文生 / 首尾帧' : '首尾帧';
    case 'first_frame':
      return hasAudio
        ? (model.features?.textToVideo ? '文生 / 首帧 / 音频' : '首帧 / 音频')
        : model.features?.textToVideo ? '文生 / 首帧' : '首帧参考';
    case 'reference':
      if (!hasImage && hasAudio && !hasVideo) {
        return model.features?.textToVideo ? '文生 / 音频驱动' : '音频驱动';
      }
      return hasAudio
        ? (model.features?.textToVideo ? '文生 / 参考图 / 音频' : '图生 / 音频')
        : model.features?.textToVideo ? '文生 / 参考图' : '图生视频';
    case 'text':
    default:
      if (hasAudio && !hasImage && !hasVideo) {
        return model.features?.textToVideo ? '文生 / 音频驱动' : '音频驱动';
      }
      if (model.features?.textToVideo && (model.features?.imageToVideo || hasImage)) {
        return '文生 / 参考图';
      }
      return model.features?.imageToVideo ? '图生视频' : '文生视频';
  }
}

function getVideoModelBadge(model: VideoModelSummary): string {
  if (model.highlight) return '推荐';
  const { hasAudio, hasImage, hasVideo } = getVideoModelUploadKinds(model);
  switch (getVideoModelInputMode(model)) {
    case 'motion_control':
      return hasAudio ? '动+音' : '动作';
    case 'video_continue':
      return hasAudio ? '续+音' : '续写';
    case 'video_edit':
      return hasAudio ? '编+音' : '编辑';
    case 'video_reference':
      return hasAudio ? '视+音' : '视频参考';
    case 'first_last_frame':
      return hasAudio ? '帧+音' : '首尾帧';
    case 'first_frame':
      return hasAudio ? '首帧+音' : '首帧';
    case 'reference':
      if (!hasImage && hasAudio && !hasVideo) return '音频';
      return hasAudio ? '图+音' : model.features?.textToVideo ? '参考图' : '图生';
    case 'text':
    default:
      if (hasAudio && !hasImage && !hasVideo) return '音频';
      if (model.features?.textToVideo && (model.features?.imageToVideo || hasImage)) return '参考图';
      return model.features?.imageToVideo ? '图生' : '文生';
  }
}

function getVideoModelDisplayDescription(model: VideoModelSummary): string {
  const parts: string[] = [getVideoModelKindLabel(model)];
  const resolutions = getVideoResolutionOptions(model).slice(0, 3);
  if (resolutions.length > 0) {
    parts.push(resolutions.join(' / '));
  }
  const durationLabels = (model.durations || [])
    .slice(0, 4)
    .map((item) => item.label || item.value)
    .filter(Boolean);
  if (durationLabels.length > 0) {
    parts.push(durationLabels.join(' / '));
  }
  return parts.join(' | ');
}

function buildVideoModelCover(model: VideoModelSummary): string {
  const family = VIDEO_MODEL_FAMILY_STYLES[resolveVideoModelFamily(model)];
  const badge = getVideoModelBadge(model);
  const kindLabel = getVideoModelKindLabel(model);
  const billingText =
    getVideoPricingPreviewLabel(model, model.defaultDuration, model.videoConfigObject)
    || formatBillingSummary({
      billingMode: model.billingMode,
      billingPrice: model.billingPrice,
      billingUnit: model.billingUnit,
      legacyCost: model.durations?.[0]?.cost,
    });

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720" fill="none">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${family.colors[0]}" />
          <stop offset="50%" stop-color="${family.colors[1]}" />
          <stop offset="100%" stop-color="${family.colors[2]}" />
        </linearGradient>
        <radialGradient id="glow" cx="0.2" cy="0.18" r="0.9">
          <stop offset="0%" stop-color="#ffffff" stop-opacity="0.38" />
          <stop offset="55%" stop-color="#ffffff" stop-opacity="0.10" />
          <stop offset="100%" stop-color="#ffffff" stop-opacity="0" />
        </radialGradient>
        <filter id="blur" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="30" />
        </filter>
      </defs>
      <rect width="1280" height="720" rx="60" fill="url(#bg)" />
      <circle cx="140" cy="130" r="150" fill="#ffffff" opacity="0.16" filter="url(#blur)" />
      <circle cx="1120" cy="150" r="180" fill="#ffffff" opacity="0.12" filter="url(#blur)" />
      <circle cx="980" cy="560" r="220" fill="url(#glow)" />
      <path d="M0 520C180 430 310 430 470 510C610 580 750 610 930 560C1065 522 1180 450 1280 455V720H0V520Z" fill="#05060b" opacity="0.28" />
      <path d="M80 640C210 560 340 544 486 586C620 624 756 660 930 630C1070 605 1180 548 1280 520" stroke="#ffffff" stroke-opacity="0.18" stroke-width="10" stroke-linecap="round" />
      <rect x="74" y="74" width="138" height="138" rx="40" fill="#ffffff" fill-opacity="0.14" stroke="#ffffff" stroke-opacity="0.22" stroke-width="2" />
      <text x="143" y="166" text-anchor="middle" fill="#ffffff" font-family="PingFang SC, Noto Sans SC, sans-serif" font-size="70" font-weight="800">${escapeSvgText(family.icon)}</text>
      <text x="80" y="312" fill="#ffffff" font-family="PingFang SC, Noto Sans SC, sans-serif" font-size="68" font-weight="800" letter-spacing="-1">${escapeSvgText(family.label)}</text>
      <text x="80" y="368" fill="rgba(255,255,255,0.82)" font-family="PingFang SC, Noto Sans SC, sans-serif" font-size="31" font-weight="600">${escapeSvgText(kindLabel)}</text>
      <text x="80" y="428" fill="rgba(255,255,255,0.70)" font-family="PingFang SC, Noto Sans SC, sans-serif" font-size="25" font-weight="500">${escapeSvgText(billingText)}</text>
      <rect x="958" y="76" width="174" height="62" rx="31" fill="#ffffff" fill-opacity="0.14" stroke="#ffffff" stroke-opacity="0.18" />
      <text x="1045" y="116" text-anchor="middle" fill="#ffffff" font-family="PingFang SC, Noto Sans SC, sans-serif" font-size="28" font-weight="700">${escapeSvgText(badge)}</text>
      <text x="80" y="642" fill="rgba(255,255,255,0.42)" font-family="PingFang SC, Noto Sans SC, sans-serif" font-size="21" font-weight="500">点击卡片切换模型</text>
    </svg>`;

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function buildVideoModelCardMeta(model: VideoModelSummary): VideoModelCardMeta {
  const family = VIDEO_MODEL_FAMILY_STYLES[resolveVideoModelFamily(model)];
  const previewLabel = getVideoPricingPreviewLabel(
    model,
    model.defaultDuration,
    model.videoConfigObject
  );
  return {
    familyLabel: family.label,
    familySubtitle: family.subtitle,
    badge: getVideoModelBadge(model),
    imageUrl:
      resolveVideoModelImage({
        name: model.name,
        apiModel: model.apiModel,
        imageUrl: model.imageUrl,
    }) || buildVideoModelCover(model),
    billingText:
      previewLabel
      || formatBillingSummary({
        billingMode: model.billingMode,
        billingPrice: model.billingPrice,
        billingUnit: model.billingUnit,
        legacyCost: model.durations?.[0]?.cost,
      }),
  };
}

function getVideoModelRawName(model?: VideoModelSummary) {
  return `${model?.name || ''} ${model?.apiModel || ''}`.toLowerCase();
}

function getVideoModelInputMode(model?: VideoModelSummary) {
  const extra = getVideoModelExtraParams(model);
  const configuredMode = String(extra.upload_mode || extra.input_mode || '').trim().toLowerCase();
  if (
    configuredMode === 'text'
    || configuredMode === 'reference'
    || configuredMode === 'first_frame'
    || configuredMode === 'first_last_frame'
    || configuredMode === 'video_reference'
    || configuredMode === 'video_continue'
    || configuredMode === 'video_edit'
    || configuredMode === 'motion_control'
  ) {
    return configuredMode;
  }

  const raw = getVideoModelRawName(model);
  if (raw.includes('动作控制')) return 'motion_control';
  if (raw.includes('视频续写') || raw.includes('续写')) return 'video_continue';
  if (raw.includes('视频编辑') || raw.includes('编辑')) return 'video_edit';
  if (raw.includes('视频参考')) return 'video_reference';
  if (raw.includes('首尾帧')) return 'first_last_frame';
  if (raw.includes('首帧')) return 'first_frame';
  if (raw.includes('参考生') || raw.includes('参考') || model?.features?.imageToVideo) return 'reference';
  return 'text';
}

function getVideoModelExtraParams(model?: VideoModelSummary): Record<string, unknown> {
  const extra = model?.videoConfigObject?.extra_params;
  if (extra && typeof extra === 'object' && !Array.isArray(extra)) {
    return extra as Record<string, unknown>;
  }
  return {};
}

function sanitizeVideoUploadHintText(text: string, paramName?: string): string {
  const raw = String(text || '').trim();
  if (!raw && paramName === 'assets') {
    return '上传角色、场景或道具图片，系统会自动转成上游所需 assets JSON，并生成公网 URL。';
  }

  const withoutUpstreamHostNotice = raw
    .replace(/（?仅接受可公开访问的\s*URL；多文件可传\s*URL\s*数组。平台不提供文件托管，请自行将文件上传至\s*COS\/CDN\s*等对象存储服务后传入\s*URL）?/gi, '')
    .replace(/\(?only accepts publicly accessible urls?;?.*?platform does not provide file hosting.*?url\)?/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  if (paramName === 'assets') {
    return '上传角色、场景或道具图片，系统会自动转成上游所需 assets JSON，并生成公网 URL。';
  }

  if (!withoutUpstreamHostNotice) {
    return '支持直接上传素材，系统会自动转为公网 URL，并在本站服务器保留 24 小时。';
  }

  return `${withoutUpstreamHostNotice} · 支持直接上传，系统会自动转为公网 URL，并在本站服务器保留 24 小时。`;
}

function getVideoUploadParamMeta(model?: VideoModelSummary): Record<string, {
  kind?: 'image' | 'video' | 'audio';
  label?: string;
  description?: string;
  multiple?: boolean;
  minFiles?: number;
  maxFiles?: number;
  accept?: string;
}> {
  const extra = getVideoModelExtraParams(model);
  const meta = extra.upload_param_meta;
  if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
    return meta as Record<string, {
      kind?: 'image' | 'video' | 'audio';
      label?: string;
      description?: string;
      multiple?: boolean;
      minFiles?: number;
      maxFiles?: number;
      accept?: string;
    }>;
  }
  return {};
}

function getVideoRequiredUploadParamNames(model?: VideoModelSummary): Set<string> {
  const extra = getVideoModelExtraParams(model);
  const keys = [
    'required_upload_param_names',
    'required_image_upload_param_names',
    'required_video_upload_param_names',
    'required_audio_upload_param_names',
  ];

  return new Set(
    keys.flatMap((key) => {
      const value = extra[key];
      return Array.isArray(value)
        ? value.map((item) => String(item || '').trim()).filter(Boolean)
        : [];
    })
  );
}

function doesVideoModelRequireUpload(model?: VideoModelSummary): boolean {
  const extra = getVideoModelExtraParams(model);
  return extra.requires_upload === true;
}

async function readBrowserMediaDurationSeconds(file: File): Promise<number | null> {
  if (typeof window === 'undefined') return null;

  const mimeType = String(file.type || '').toLowerCase();
  if (!mimeType.startsWith('audio/') && !mimeType.startsWith('video/')) {
    return null;
  }

  const objectUrl = URL.createObjectURL(file);
  const media = document.createElement(mimeType.startsWith('audio/') ? 'audio' : 'video');
  media.preload = 'metadata';
  media.muted = true;

  try {
    const duration = await new Promise<number | null>((resolve) => {
      let settled = false;
      const cleanup = () => {
        if (settled) return;
        settled = true;
        media.removeAttribute('src');
        media.load();
        URL.revokeObjectURL(objectUrl);
      };

      const finish = (value: number | null) => {
        cleanup();
        resolve(value);
      };

      const timeoutId = window.setTimeout(() => finish(null), 8000);
      media.onloadedmetadata = () => {
        window.clearTimeout(timeoutId);
        const value = Number(media.duration);
        finish(Number.isFinite(value) && value > 0 ? value : null);
      };
      media.onerror = () => {
        window.clearTimeout(timeoutId);
        finish(null);
      };

      media.src = objectUrl;
    });

    return duration;
  } catch {
    URL.revokeObjectURL(objectUrl);
    return null;
  }
}

function buildVideoDurationValidationMessage(
  label: string,
  durationSeconds: number,
  range: MediaDurationRange | null | undefined
): string | null {
  const violation = validateMediaDurationAgainstRange(durationSeconds, range);
  if (!violation) return null;

  const rangeText = formatMediaDurationRange(violation);
  const durationText = roundMediaDurationSeconds(durationSeconds);
  return `${label}当前时长为 ${durationText} 秒，需满足 ${rangeText}`;
}

function buildVideoSlotFromMeta(
  key: VideoUploadSlot,
  fallbackLabel: string,
  fallbackHint: string,
  fallbackAccept: string,
  fallbackKind: 'image' | 'video' | 'audio',
  meta?: {
    kind?: 'image' | 'video' | 'audio';
    label?: string;
    description?: string;
    multiple?: boolean;
    minFiles?: number;
    maxFiles?: number;
    accept?: string;
  },
  options: {
    paramName?: string;
    required?: boolean;
  } = {}
): VideoReferenceSlotConfig {
  const maxFiles = Number(meta?.maxFiles || 0);
  const minFiles = Number(meta?.minFiles || 0);
  const multiple = Boolean(meta?.multiple || maxFiles > 1);
  const countHint = maxFiles > 1
    ? `支持 ${minFiles > 0 ? `${minFiles}-${maxFiles}` : `最多 ${maxFiles}`} 个文件`
    : '';
  const isAssetsParam = options.paramName === 'assets' || key === 'assets';
  const resolvedKind = meta?.kind || fallbackKind;
  const label = isAssetsParam
    ? '角色 / 场景素材图'
    : localizeVideoUploadLabel(meta?.label || fallbackLabel, options.paramName || key, resolvedKind);
  const durationRange = parseMediaDurationRangeFromText(meta?.description);
  const localizedDescription = localizeVideoUploadDescription(
    meta?.description,
    fallbackHint,
    options.paramName || key,
    label,
    resolvedKind,
  );
  const primaryHint = sanitizeVideoUploadHintText(
    localizedDescription || fallbackHint || '',
    options.paramName || key,
  );
  const durationHint = durationRange ? `时长限制 ${formatMediaDurationRange(durationRange)}` : '';

  return {
    key,
    label,
    hint: [primaryHint, durationHint, countHint].filter(Boolean).join(' · '),
    accept: meta?.accept || fallbackAccept,
    kind: resolvedKind,
    paramName: options.paramName,
    multiple,
    minFiles: minFiles > 0 ? minFiles : undefined,
    maxFiles: maxFiles > 0 ? maxFiles : undefined,
    required: options.required,
    durationRange,
  };
}

function getModelReferenceSlots(model?: VideoModelSummary): VideoReferenceSlotConfig[] {
  const mode = getVideoModelInputMode(model);
  const uploadMeta = Object.entries(getVideoUploadParamMeta(model));
  const requiredParamNames = getVideoRequiredUploadParamNames(model);
  const imageMeta = uploadMeta.find(([, value]) => value.kind === 'image')?.[1];
  const videoMeta = uploadMeta.find(([, value]) => value.kind === 'video')?.[1];

  if (uploadMeta.length > 0) {
    return uploadMeta.map(([paramName, meta]) =>
      buildVideoSlotFromMeta(
        paramName,
        meta.label || paramName,
        meta.description || '上传模型所需素材',
        meta.accept || (meta.kind === 'video' ? 'video/*' : meta.kind === 'audio' ? 'audio/*' : 'image/*'),
        meta.kind || 'image',
        meta,
        {
          paramName,
          required: requiredParamNames.has(paramName),
        },
      )
    );
  }

  if (mode === 'first_last_frame' && imageMeta) {
    return [
      buildVideoSlotFromMeta(
        'first-last-frames',
        '首帧 / 尾帧参考',
        '按顺序上传 1-2 张图片：第一张为首帧，第二张为尾帧',
        'image/*',
        'image',
        {
          ...imageMeta,
          multiple: true,
          maxFiles: imageMeta.maxFiles || 2,
        },
      ),
    ];
  }

  if (mode === 'first_frame' && imageMeta) {
    return [
      buildVideoSlotFromMeta(
        'first-frame',
        '首帧参考',
        '上传单张首帧作为镜头起始',
        'image/*',
        'image',
        imageMeta,
      ),
    ];
  }

  if ((mode === 'video_reference' || mode === 'video_continue' || mode === 'video_edit') && (videoMeta || imageMeta)) {
    const slots: VideoReferenceSlotConfig[] = [];
    if (videoMeta) {
      slots.push(
        buildVideoSlotFromMeta(
          'reference-video',
          mode === 'video_continue' ? '续写视频' : '参考视频',
          mode === 'video_edit' ? '上传待编辑视频，延续原视频内容' : '上传参考视频，跟随上游能力继续生成',
          'video/*',
          'video',
          videoMeta,
        )
      );
    }
    if (imageMeta) {
      slots.push(
        buildVideoSlotFromMeta(
          'reference-image',
          '参考图',
          '上传参考图片，辅助主体、风格或镜头控制',
          'image/*',
          'image',
          imageMeta,
        )
      );
    }
    if (slots.length > 0) return slots;
  }

  if (mode === 'reference' && imageMeta) {
    return [
      buildVideoSlotFromMeta(
        'reference-image',
        '参考图',
        '上传参考图片，控制主体、风格或构图',
        'image/*',
        'image',
        imageMeta,
      ),
    ];
  }

  switch (mode) {
    case 'first_last_frame':
      return [
        {
          key: 'first-frame',
          label: '首帧参考',
          hint: '上传开场关键帧，控制起始画面',
          accept: 'image/*',
          kind: 'image',
          minFiles: 1,
          maxFiles: 1,
          required: true,
        },
        {
          key: 'last-frame',
          label: '尾帧参考',
          hint: '上传收尾关键帧，控制结束画面',
          accept: 'image/*',
          kind: 'image',
          minFiles: 1,
          maxFiles: 1,
          required: true,
        },
      ];
    case 'first_frame':
      return [
        {
          key: 'first-frame',
          label: '首帧参考',
          hint: '上传单张首帧作为镜头起始',
          accept: 'image/*',
          kind: 'image',
          minFiles: 1,
          maxFiles: 1,
          required: true,
        },
      ];
    case 'video_reference':
    case 'video_continue':
    case 'video_edit':
      return [
        {
          key: 'reference-video',
          label: mode === 'video_continue' ? '续写视频' : '参考视频',
          hint: mode === 'video_edit' ? '上传待编辑视频，延续原视频内容' : '上传视频素材，跟随上游能力继续生成',
          accept: 'video/*',
          kind: 'video',
          minFiles: 1,
          required: true,
        },
      ];
    case 'motion_control':
      return [
        {
          key: 'motion-reference',
          label: '主体参考图',
          hint: '上传人物/主体图，用于动作控制与外观锁定',
          accept: 'image/*',
          kind: 'image',
          minFiles: 1,
          maxFiles: 1,
          required: true,
        },
        {
          key: 'reference-video',
          label: '动作参考视频',
          hint: '上传动作参考视频，让生成结果跟随动作轨迹',
          accept: 'video/*',
          kind: 'video',
          minFiles: 1,
          required: true,
        },
      ];
    case 'reference':
      return [
        {
          key: 'reference-image',
          label: '参考图',
          hint: '上传参考图片，控制主体、风格或构图',
          accept: 'image/*',
          kind: 'image',
          multiple: true,
          minFiles: 1,
          required: true,
        },
      ];
    default:
      return [];
  }
}

function getVideoAspectOptions(model?: VideoModelSummary) {
  if (model?.aspectRatios?.length) {
    return model.aspectRatios;
  }
  return COMMON_RATIOS.map(([value, label]) => ({ value, label }));
}

function getVideoDurationOptions(model?: VideoModelSummary) {
  if (model?.durations?.length) {
    return model.durations;
  }
  return [
    { value: '5s', label: '5 秒', cost: 0 },
    { value: '8s', label: '8 秒', cost: 0 },
    { value: '10s', label: '10 秒', cost: 0 },
  ];
}

function normalizeIncomingVideoAspectRatios(value: unknown): Array<{ value: string; label: string }> {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const ratioValue = String((item as { value?: unknown }).value ?? '').trim();
      if (!ratioValue) return null;
      const rawLabel = String((item as { label?: unknown }).label ?? ratioValue).trim() || ratioValue;
      return {
        value: ratioValue,
        label: localizeVideoDynamicOptionLabel('aspect_ratio', rawLabel, ratioValue),
      };
    })
    .filter(Boolean) as Array<{ value: string; label: string }>;
}

function normalizeIncomingVideoDurations(
  value: unknown
): Array<{ value: string; label: string; cost: number }> {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const durationValue = String((item as { value?: unknown }).value ?? '').trim();
      if (!durationValue) return null;
      const rawLabel = String((item as { label?: unknown }).label ?? durationValue).trim() || durationValue;
      return {
        value: durationValue,
        label: localizeVideoDynamicOptionLabel('duration', rawLabel, durationValue.replace(/s$/i, '')),
        cost: Number((item as { cost?: unknown }).cost || 0),
      };
    })
    .filter(Boolean) as Array<{ value: string; label: string; cost: number }>;
}

function getVideoResolutionOptions(model?: VideoModelSummary): string[] {
  const extra = getVideoModelExtraParams(model);
  const dynamic = extra.image_resolution_options;
  if (Array.isArray(dynamic)) {
    const next = dynamic
      .map((item) => String(item || '').trim())
      .filter(Boolean);
    if (next.length > 0) return next;
  }

  const raw = getVideoModelRawName(model);
  if (raw.includes('veo')) return ['720P', '1080P'];
  if (raw.includes('可灵') || raw.includes('kling')) return ['720P', '1080P', '2K'];
  if (raw.includes('万相') || raw.includes('vidu')) return ['720P', '1080P'];
  return ['720P', '1080P', '2K'];
}

function getVideoReferenceCountOptions(model?: VideoModelSummary): string[] {
  const extra = getVideoModelExtraParams(model);
  const dynamic = extra.reference_image_count_options;
  if (Array.isArray(dynamic)) {
    const next = dynamic
      .map((item) => String(item || '').trim())
      .filter(Boolean);
    if (next.length > 0) return next;
  }

  const hasExplicitMin = Object.prototype.hasOwnProperty.call(extra, 'min_reference_image_count');
  const hasExplicitMax = Object.prototype.hasOwnProperty.call(extra, 'max_reference_image_count');
  const min = Number(extra.min_reference_image_count);
  const max = Number(extra.max_reference_image_count);
  if ((hasExplicitMin || hasExplicitMax) && Number.isFinite(min) && Number.isFinite(max) && max >= min && max > 1) {
    return Array.from({ length: Math.min(6, max - min + 1) }, (_, index) => String(min + index));
  }

  if (getVideoModelInputMode(model) === 'reference' || getVideoModelInputMode(model) === 'motion_control') {
    return ['1', '2', '3', '4'];
  }
  return ['1'];
}

function getDefaultReferenceCount(model?: VideoModelSummary) {
  const extra = getVideoModelExtraParams(model);
  const defaultCount = String(extra.default_reference_image_count ?? '').trim();
  if (defaultCount) return defaultCount;
  return getVideoReferenceCountOptions(model)[0] || '1';
}

function shouldAttachReferenceCount(model?: VideoModelSummary) {
  const extra = getVideoModelExtraParams(model);
  if (Array.isArray(extra.reference_image_count_options) && extra.reference_image_count_options.length > 0) {
    return true;
  }
  if (Object.prototype.hasOwnProperty.call(extra, 'default_reference_image_count')) {
    return true;
  }
  const inputMode = getVideoModelInputMode(model);
  return inputMode === 'reference' || inputMode === 'motion_control';
}

function getDefaultResolution(model?: VideoModelSummary) {
  const modelDefault = String(model?.videoConfigObject?.resolution || '').trim();
  if (modelDefault) return modelDefault.toUpperCase();
  return getVideoResolutionOptions(model)[0] || '';
}

const VIDEO_ADVANCED_LABELS: Record<string, string> = {
  version: '版本',
  model_version: '模型版本',
  quality_version: '质量档位',
  generation_mode: '生成模式',
  off_peak: '错峰模式',
  mode: '模式',
  enhance_prompt: '提示词增强',
  prompt_extend: '提示词扩展',
  keep_original_sound: '保留原声',
  enable_upsample: '超清增强',
  watermark: '水印',
  character_orientation: '人物朝向',
  shot_type: '镜头类型',
  generation_type: '生成类型',
  audio_setting: '音频设置',
  refer_type: '参考方式',
  lip_sync: '口型同步',
  sound: '声音',
  _quan_neng_mode: '全能模式',
  quality: '质量',
  ratio: '比例',
  size: '尺寸',
};

function serializeVideoDynamicOptionValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return String(value ?? '').trim();
}

function humanizeVideoAdvancedLabel(key: string): string {
  const direct = VIDEO_ADVANCED_LABELS[key];
  if (direct) return direct;
  return key
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(' ');
}

function toVideoDynamicSelectOptions(value: unknown): VideoDynamicSelectOption[] {
  if (!Array.isArray(value)) return [];

  const options: VideoDynamicSelectOption[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
      const optionValue = serializeVideoDynamicOptionValue(item);
      if (!optionValue || seen.has(optionValue)) continue;
      seen.add(optionValue);
      options.push({
        value: optionValue,
        label: optionValue,
        rawValue: item,
      });
      continue;
    }

    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const rawValue =
        'value' in item
          ? (item as { value?: unknown }).value
          : 'label' in item
            ? (item as { label?: unknown }).label
            : undefined;
      const optionValue = serializeVideoDynamicOptionValue(rawValue);
      if (!optionValue || seen.has(optionValue)) continue;
      seen.add(optionValue);
      const label = String(
        ('label' in item ? (item as { label?: unknown }).label : undefined) ?? optionValue
      ).trim() || optionValue;
      options.push({
        value: optionValue,
        label,
        rawValue,
      });
    }
  }

  return options;
}

function localizeVideoDynamicOptions(
  key: string,
  options: VideoDynamicSelectOption[]
): VideoDynamicSelectOption[] {
  return options.map((option) => ({
    ...option,
    label: localizeVideoDynamicOptionLabel(key, option.label, option.rawValue ?? option.value),
  }));
}

function getVideoTopLevelOptions(
  model: VideoModelSummary | undefined,
  optionKey:
    | 'version_options'
    | 'model_version_options'
    | 'quality_version_options'
    | 'generation_mode_options'
): VideoDynamicSelectOption[] {
  const extra = getVideoModelExtraParams(model);
  return localizeVideoDynamicOptions(
    optionKey.replace(/_options$/, ''),
    toVideoDynamicSelectOptions(extra[optionKey])
  );
}

function getVideoTopLevelFieldLabel(
  model: VideoModelSummary | undefined,
  key: 'version' | 'model_version' | 'quality_version' | 'generation_mode' | 'off_peak'
): string {
  const extra = getVideoModelExtraParams(model);
  const aliasMap: Record<string, string | undefined> = {
    generation_mode: typeof extra.generation_mode_param_name === 'string' ? extra.generation_mode_param_name : undefined,
    model_version: typeof extra.model_version_param_name === 'string' ? extra.model_version_param_name : undefined,
    quality_version: typeof extra.quality_version_param_name === 'string' ? extra.quality_version_param_name : undefined,
    version: typeof extra.version_param_name === 'string' ? extra.version_param_name : undefined,
  };

  if (key === 'off_peak') return '错峰模式';
  const actualKey = aliasMap[key] || key;
  return humanizeVideoAdvancedLabel(actualKey);
}


function getVideoDynamicParamOptions(
  model?: VideoModelSummary
): Record<string, VideoDynamicSelectOption[]> {
  const extra = getVideoModelExtraParams(model);
  const dynamic = extra.dynamic_param_options;
  if (!dynamic || typeof dynamic !== 'object' || Array.isArray(dynamic)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(dynamic).map(([key, value]) => [key, localizeVideoDynamicOptions(key, toVideoDynamicSelectOptions(value))])
  );
}

function getVideoOffPeakOptions(model?: VideoModelSummary): VideoDynamicSelectOption[] {
  const dynamicOptions = getVideoDynamicParamOptions(model);
  const provided = dynamicOptions.off_peak || [];
  if (provided.length > 0) return provided;

  const hasRuleBasedOffPeak = Array.isArray(model?.pricingRules)
    && model.pricingRules.some((rule) => typeof rule.offPeak === 'boolean');
  const hasDefault = typeof model?.videoConfigObject?.off_peak === 'boolean';
  if (!hasRuleBasedOffPeak && !hasDefault) return [];

  return [
    { value: 'false', label: '关闭', rawValue: false },
    { value: 'true', label: '开启', rawValue: true },
  ];
}

function getVideoAdvancedSelectFields(model?: VideoModelSummary): VideoAdvancedSelectField[] {
  if (!model) return [];

  const fields: VideoAdvancedSelectField[] = [];
  const pushField = (
    key: string,
    label: string,
    options: VideoDynamicSelectOption[],
    source: 'top-level' | 'extra',
  ) => {
    if (options.length <= 1) return;
    fields.push({ key, label, options, source });
  };

  pushField('version', getVideoTopLevelFieldLabel(model, 'version'), getVideoTopLevelOptions(model, 'version_options'), 'top-level');
  pushField('model_version', getVideoTopLevelFieldLabel(model, 'model_version'), getVideoTopLevelOptions(model, 'model_version_options'), 'top-level');
  pushField('quality_version', getVideoTopLevelFieldLabel(model, 'quality_version'), getVideoTopLevelOptions(model, 'quality_version_options'), 'top-level');
  pushField('generation_mode', getVideoTopLevelFieldLabel(model, 'generation_mode'), getVideoTopLevelOptions(model, 'generation_mode_options'), 'top-level');
  pushField('off_peak', getVideoTopLevelFieldLabel(model, 'off_peak'), getVideoOffPeakOptions(model), 'top-level');

  const dynamicOptions = getVideoDynamicParamOptions(model);
  const reservedKeys = new Set([
    'duration',
    'aspect_ratio',
    'resolution',
    'quality',
    'ratio',
    'size',
    'mode',
    'orientation',
    'model_variant',
    'version',
    'model_version',
    'quality_version',
    'generation_mode',
    'off_peak',
  ]);

  for (const [key, options] of Object.entries(dynamicOptions)) {
    if (reservedKeys.has(key) || options.length <= 1) continue;
    pushField(key, humanizeVideoAdvancedLabel(key), options, 'extra');
  }

  return fields;
}

function getVideoAdvancedFieldDefaultValue(
  model: VideoModelSummary | undefined,
  field: VideoAdvancedSelectField
): string {
  if (!model) return field.options[0]?.value || '';

  const baseConfig = model.videoConfigObject || {};
  const extra = getVideoModelExtraParams(model);
  const defaultDynamicValues =
    extra.default_dynamic_param_values
    && typeof extra.default_dynamic_param_values === 'object'
    && !Array.isArray(extra.default_dynamic_param_values)
      ? extra.default_dynamic_param_values as Record<string, unknown>
      : {};

  const rawValue =
    field.source === 'top-level'
      ? (baseConfig as Record<string, unknown>)[field.key]
      : defaultDynamicValues[field.key] ?? extra[field.key];

  const serialized = serializeVideoDynamicOptionValue(rawValue);
  if (serialized && field.options.some((option) => option.value === serialized)) {
    return serialized;
  }

  return field.options[0]?.value || '';
}

function resolveVideoAdvancedFieldRawValue(
  field: VideoAdvancedSelectField,
  selectedValue: string
): unknown {
  const rawValue = field.options.find((option) => option.value === selectedValue)?.rawValue ?? selectedValue;
  if (field.key === 'off_peak') {
    if (rawValue === true || rawValue === false) return rawValue;
    if (String(rawValue).trim().toLowerCase() === 'true') return true;
    if (String(rawValue).trim().toLowerCase() === 'false') return false;
  }
  return rawValue;
}

function buildVideoBillingNote(model?: VideoModelSummary): string {
  const extra = getVideoModelExtraParams(model);
  const note = String(extra.billing_note || '').trim();
  return note;
}

function validateVideoReferenceInputs(
  model: VideoModelSummary | undefined,
  slots: VideoReferenceSlotConfig[],
  files: UploadedMedia[],
  referenceCountValue?: string,
  selectedDurationValue?: string,
): string | null {
  if (!model) return '请先选择一个可用模型';

  const filesBySlot = new Map<VideoUploadSlot, UploadedMedia[]>();
  for (const file of files) {
    const key = (file.slot || 'generic') as VideoUploadSlot;
    if (!filesBySlot.has(key)) filesBySlot.set(key, []);
    filesBySlot.get(key)!.push(file);
  }

  for (const slot of slots) {
    const currentFiles = filesBySlot.get(slot.key) || [];
    if (slot.required && currentFiles.length === 0) {
      return `${slot.label}为必填素材，请先上传后再生成`;
    }
    if (slot.minFiles && currentFiles.length < slot.minFiles) {
      return `${slot.label}至少需要上传 ${slot.minFiles} 个文件`;
    }
    if (slot.durationRange) {
      for (const file of currentFiles) {
        if (!file.durationSeconds) continue;
        const validationError = buildVideoDurationValidationMessage(
          slot.label,
          file.durationSeconds,
          slot.durationRange,
        );
        if (validationError) return validationError;
      }
    }
  }

  const inputMode = getVideoModelInputMode(model);
  const requiresUpload = doesVideoModelRequireUpload(model);
  const imageCount = files.filter((file) => file.mimeType.startsWith('image/')).length;
  const videoCount = files.filter((file) => file.mimeType.startsWith('video/')).length;
  const audioCount = files.filter((file) => file.mimeType.startsWith('audio/')).length;
  const requestedDurationSeconds = parseDurationSeconds(
    selectedDurationValue || model.defaultDuration,
    8,
  );

  if (
    (inputMode === 'reference' ||
      inputMode === 'first_frame' ||
      inputMode === 'first_last_frame' ||
      inputMode === 'motion_control') &&
    requiresUpload &&
    imageCount === 0
  ) {
    return '当前模型至少需要上传 1 张参考图后再生成';
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
    const tooLongVideo = files.find((file) => (
      file.mimeType.startsWith('video/')
      && Number.isFinite(file.durationSeconds)
      && Number(file.durationSeconds) >= requestedDurationSeconds
    ));

    if (tooLongVideo?.durationSeconds) {
      return `续写视频当前时长为 ${roundMediaDurationSeconds(tooLongVideo.durationSeconds)} 秒，需小于所选生成时长 ${requestedDurationSeconds} 秒`;
    }
  }

  if (inputMode === 'motion_control' && requiresUpload && videoCount === 0) {
    return '当前动作控制模型还需要上传动作参考视频后再生成';
  }

  if (slots.some((slot) => slot.kind === 'audio' && slot.required) && audioCount === 0) {
    return '当前模型需要先上传音频素材后再生成';
  }

  if ((inputMode === 'reference' || inputMode === 'motion_control') && referenceCountValue) {
    const requiredCount = Number(referenceCountValue);
    if (
      Number.isFinite(requiredCount)
      && requiredCount > 0
      && imageCount > 0
      && imageCount < requiredCount
    ) {
      return `当前参考图数量设置为 ${requiredCount}，请至少上传 ${requiredCount} 张参考图`;
    }
  }

  return null;
}

function getVideoCapabilityChips(model?: VideoModelSummary): string[] {
  if (!model) return [];
  const chips = new Set<string>();
  const inputMode = getVideoModelInputMode(model);
  const uploadMeta = Object.values(getVideoUploadParamMeta(model));
  if (inputMode === 'reference') chips.add('支持参考图');
  if (inputMode === 'first_frame') chips.add('支持首帧');
  if (inputMode === 'first_last_frame') {
    chips.add('支持首帧');
    chips.add('支持尾帧');
  }
  if (inputMode === 'video_reference') chips.add('支持参考视频');
  if (inputMode === 'video_continue') chips.add('支持续写视频');
  if (inputMode === 'video_edit') chips.add('支持待编辑视频');
  if (inputMode === 'motion_control') {
    chips.add('支持动作控制');
    chips.add('支持参考视频');
  }
  if (uploadMeta.some((item) => item.kind === 'audio')) chips.add('支持音频驱动');
  if (model.features?.textToVideo) chips.add('文生视频');
  if (model.features?.imageToVideo) chips.add('图生视频');
  if (model.features?.videoToVideo && inputMode === 'text') chips.add('视频输入');
  return Array.from(chips);
}

function sortUploadedFilesForSubmit(files: UploadedMedia[]) {
  const slotOrder: VideoUploadSlot[] = [
    'first-frame',
    'first-last-frames',
    'last-frame',
    'motion-reference',
    'reference-image',
    'reference-video',
    'generic',
  ];

  return [...files].sort((left, right) => {
    const leftIndex = slotOrder.indexOf((left.slot || 'generic') as VideoUploadSlot);
    const rightIndex = slotOrder.indexOf((right.slot || 'generic') as VideoUploadSlot);
    const safeLeft = leftIndex === -1 ? 99 : leftIndex;
    const safeRight = rightIndex === -1 ? 99 : rightIndex;
    return safeLeft - safeRight;
  });
}

function filterVideoModelsByVariant(variant: VideoVariant, models: VideoModelSummary[]) {
  if (variant === 'sora2') {
    const filtered = models.filter((model) => /sora/i.test(`${model.name} ${model.apiModel || ''}`));
    return filtered.length > 0 ? filtered : makeFallbackVideoModels(variant);
  }

  if (variant === 'grok') {
    const filtered = models.filter((model) => /grok/i.test(`${model.name} ${model.apiModel || ''}`));
    return filtered.length > 0 ? filtered : makeFallbackVideoModels(variant);
  }

  return models.length > 0 ? models : makeFallbackVideoModels(variant);
}

function pickPreferredVideoModel(models: VideoModelSummary[]): VideoModelSummary | undefined {
  if (models.length === 0) return undefined;

  const score = (model: VideoModelSummary) => getVideoModelDisplayScore(model);

  return [...models].sort((a, b) => score(b) - score(a))[0];
}

function getVideoModelDisplayScore(model: VideoModelSummary) {
  const raw = `${model.name} ${model.apiModel || ''}`.toLowerCase();
  let total = 0;

  if (model.features?.textToVideo) total += 6;
  if (!model.features?.imageToVideo) total += 2;
  if (model.highlight) total += 1;

  if (raw.includes('文生')) total += 8;
  if (raw.includes('veo3.1')) total += 7;
  if (raw.includes('快乐马-文生视频')) total += 7;

  if (raw.includes('参考生') || raw.includes('参考')) total -= 8;
  if (raw.includes('首尾帧')) total -= 6;
  if (raw.includes('续写')) total -= 7;
  if (raw.includes('编辑')) total -= 7;

  return total;
}

function groupVideoModelsByFamily(models: VideoModelSummary[]): GroupedVideoModelsSection[] {
  const buckets = new Map<VideoModelFamilyKey, VideoModelSummary[]>();

  for (const model of models) {
    const familyKey = resolveVideoModelFamily(model);
    if (!buckets.has(familyKey)) {
      buckets.set(familyKey, []);
    }
    buckets.get(familyKey)!.push(model);
  }

  return VIDEO_MODEL_FAMILY_ORDER
    .map((familyKey) => {
      const familyModels = buckets.get(familyKey) || [];
      if (familyModels.length === 0) return null;

      const family = VIDEO_MODEL_FAMILY_STYLES[familyKey];
      return {
        key: familyKey,
        label: family.label,
        subtitle: family.subtitle,
        accent: family.accent,
        models: familyModels,
      } satisfies GroupedVideoModelsSection;
    })
    .filter((item): item is GroupedVideoModelsSection => Boolean(item));
}

function parseDurationSeconds(value?: string, fallback = 8): number {
  const matched = String(value || '').match(/(\d+)/);
  return matched ? Number.parseInt(matched[1], 10) || fallback : fallback;
}

function estimateVideoCost(
  model: VideoModelSummary | undefined,
  duration: string,
  user?: { membershipLevel?: 'normal' | 'vip' | 'svip'; membershipExpiresAt?: number },
  resolution?: string,
  aspectRatio?: string,
  videoConfigObject?: VideoConfigObject
): number | null {
  if (!model) return null;

  const seconds = parseDurationSeconds(duration || model.defaultDuration, 8);
  return resolveVideoGenerationCost({
    user,
    model,
    duration: seconds,
    aspectRatio,
    videoConfigObject: videoConfigObject || {
      ...(model.videoConfigObject || {}),
      ...(aspectRatio ? { aspect_ratio: aspectRatio as VideoConfigObject['aspect_ratio'] } : {}),
      ...(resolution ? { resolution: resolution.toUpperCase() } : {}),
    },
  });
}

function isFallbackModelId(id: string) {
  return id.startsWith('__fallback_');
}

function parseQuantityCount(value: string) {
  const matched = value.match(/(\d+)/);
  return Math.max(1, Number.parseInt(matched?.[1] || '1', 10) || 1);
}

type FloatingGenerateBarProps = {
  costLabel: string;
  buttonLabel: string;
  loading?: boolean;
  disabled?: boolean;
  onClick: () => void;
  quantityValue?: string;
  quantityOptions?: string[];
  onQuantityChange?: (value: string) => void;
  modelLabel?: string;
  metaLabel?: string;
};

function FloatingGenerateBar({
  costLabel,
  buttonLabel,
  loading = false,
  disabled = false,
  onClick,
  quantityValue = '1 条',
  quantityOptions,
  onQuantityChange,
  modelLabel,
  metaLabel,
}: FloatingGenerateBarProps) {
  const options = quantityOptions && quantityOptions.length > 0 ? quantityOptions : [quantityValue];

  return (
    <div className="fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] left-1/2 z-40 w-[calc(100%-1.5rem)] max-w-[980px] -translate-x-1/2 lg:bottom-6 lg:left-[calc(50%+8rem)] lg:w-[calc(100%-18rem)]">
      <div className="rounded-full border border-emerald-400/15 bg-[#0b1017]/92 px-4 py-3 shadow-[0_20px_70px_rgba(0,0,0,0.45)] backdrop-blur-2xl sm:px-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-4 sm:gap-6">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-white/32">预计消耗</div>
              <div className="mt-1 text-xl font-semibold text-white">{costLabel}</div>
            </div>

            <div className="hidden h-10 w-px bg-white/10 sm:block" />

            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-white/32">生成数量</div>
              <select
                value={quantityValue}
                onChange={(event) => onQuantityChange?.(event.target.value)}
                disabled={!onQuantityChange}
                className="mt-1 rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none disabled:cursor-default disabled:opacity-100"
              >
                {options.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </div>

            {(modelLabel || metaLabel) ? <div className="hidden h-10 w-px bg-white/10 lg:block" /> : null}

            {(modelLabel || metaLabel) ? (
              <div className="hidden lg:block">
                <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-white/32">当前模型</div>
                <div className="mt-1 text-sm text-white/72">{modelLabel || '未选择'}</div>
                {metaLabel ? <div className="mt-1 text-[11px] text-white/40">{metaLabel}</div> : null}
              </div>
            ) : null}
          </div>

          <button
            type="button"
            disabled={disabled || loading}
            onClick={onClick}
            className="inline-flex h-14 items-center justify-center gap-2 rounded-full bg-emerald-400 px-8 text-base font-semibold text-[#062a1b] shadow-[0_16px_40px_rgba(16,185,129,0.35)] transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-55"
          >
            <Sparkles className={cn('h-4 w-4', loading ? 'animate-spin' : '')} />
            {loading ? '正在提交任务...' : buttonLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function toVideoConfigAspectRatio(
  aspect?: {
    value?: string;
    label?: string;
  }
) {
  const raw = `${aspect?.label || ''} ${aspect?.value || ''}`.toLowerCase();
  if (raw.includes('9:16') || raw.includes('portrait')) return '9:16';
  if (raw.includes('1:1') || raw.includes('square')) return '1:1';
  if (raw.includes('2:3')) return '2:3';
  if (raw.includes('3:2')) return '3:2';
  return '16:9';
}

function filterImageModelsByVariant(variant: ImageVariant, models: SafeImageModel[]) {
  const isGptModel = (name: string) => /gpt/i.test(name);
  const filtered = variant === 'gptimage'
    ? models.filter((item) => isGptModel(item.name))
    : models.filter((item) => !isGptModel(item.name));

  const base = filtered.length > 0 ? filtered : models;

  if (variant === 'gptimage') {
    return [...base].sort((left, right) => {
      const leftPreferred = /官转|official|openai/i.test(`${left.name} ${left.apiModel || ''}`) ? 1 : 0;
      const rightPreferred = /官转|official|openai/i.test(`${right.name} ${right.apiModel || ''}`) ? 1 : 0;
      if (leftPreferred !== rightPreferred) return rightPreferred - leftPreferred;
      return 0;
    });
  }

  return base;
}

function isGptLikeIdentifier(value?: string | null) {
  return /gpt/i.test(String(value || ''));
}

function filterImageGenerationsByVariant(variant: ImageVariant, generations: Generation[]) {
  const images = filterGenerationsByKind(generations, 'image');
  return images.filter((generation) => {
    const raw = `${generation.params?.modelId || ''} ${generation.params?.model || ''}`;
    return variant === 'gptimage'
      ? isGptLikeIdentifier(raw)
      : !isGptLikeIdentifier(raw);
  });
}

function filterImageTasksByVariant(variant: ImageVariant, tasks: Task[]) {
  const images = tasks.filter((task) => !task.type?.includes('video'));
  return images.filter((task) => {
    const raw = `${task.modelId || ''} ${task.model || ''}`;
    return variant === 'gptimage'
      ? isGptLikeIdentifier(raw)
      : !isGptLikeIdentifier(raw);
  });
}

export function ImageToolPage({ variant }: { variant: ImageVariant }) {
  const { data: session, update } = useSession();
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());
  const refreshGenerationFeedRef = useRef<() => Promise<void>>(async () => {});
  const isGpt = variant === 'gptimage';
  const [prompt, setPrompt] = useState('');
  const [modelId, setModelId] = useState('');
  const [aspect, setAspect] = useState(isGpt ? '' : '9:16');
  const [size, setSize] = useState('');
  const [quantity, setQuantity] = useState('1条');
  const [models, setModels] = useState<SafeImageModel[]>([]);
  const [generations, setGenerations] = useState<Generation[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [busyGenerationId, setBusyGenerationId] = useState<string | null>(null);
  const [clearingFailedTasks, setClearingFailedTasks] = useState(false);
  const [uploadedImages, setUploadedImages] = useState<UploadedMedia[]>([]);
  const [uploadingImages, setUploadingImages] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      const fallbackModels = makeFallbackImageModels(variant);
      try {
        const res = await fetch('/api/image-models', { credentials: 'include', cache: 'no-store' });
        if (!res.ok) {
          setModels(fallbackModels);
          setModelId((current) => (current && fallbackModels.some((item) => item.id === current) ? current : fallbackModels[0]?.id || ''));
          return;
        }
        const data = await res.json();
        let next = (data.data?.models || []) as SafeImageModel[];
        next = filterImageModelsByVariant(variant, next);
        if (next.length === 0) {
          next = fallbackModels;
        }
        setModels(next);
        setModelId((current) => (current && next.some((item) => item.id === current) ? current : next[0]?.id || ''));
      } catch {
        setModels(fallbackModels);
        setModelId((current) => (current && fallbackModels.some((item) => item.id === current) ? current : fallbackModels[0]?.id || ''));
      }
    };
    void load();
  }, [variant]);

  const title = isGpt ? 'GPT2 图像生成' : '大香蕉2 图像生成';
  const selectedModel = useMemo(
    () => models.find((item) => item.id === modelId) || models[0],
    [modelId, models]
  );
  const effectiveModelId = selectedModel?.id || modelId;
  const hasConfiguredModel = Boolean(effectiveModelId && !isFallbackModelId(effectiveModelId));
  const canUseReferenceImage = Boolean(
    selectedModel?.features?.imageToImage || selectedModel?.requiresReferenceImage
  );
  const supportsMultipleReferenceImages = Boolean(selectedModel?.features?.multipleImages);
  const imageGenerationCount = parseQuantityCount(quantity);
  const imageEstimatedCost = useMemo(() => {
    if (!hasConfiguredModel || !selectedModel) return null;
    const perImageCost = resolveImageGenerationCost({
      user: session?.user,
      model: selectedModel,
      imageSize: size,
      aspectRatio: aspect || selectedModel.defaultAspectRatio,
    });
    return perImageCost * imageGenerationCount;
  }, [aspect, hasConfiguredModel, imageGenerationCount, selectedModel, session?.user, size]);
  const imageCostLabel = hasConfiguredModel
    ? `${imageEstimatedCost ?? 0} 积分`
    : '请先选择模型';
  const imageAspectLabel = aspect || selectedModel?.defaultAspectRatio || (isGpt ? '1:1' : '9:16');
  const imageSizeLabel = size || selectedModel?.defaultImageSize || (isGpt ? '1K' : '2K');

  useEffect(() => {
    setUploadedImages((prev) => (supportsMultipleReferenceImages ? prev : prev.slice(0, 1)));
  }, [supportsMultipleReferenceImages]);

  const loadRecentGenerations = useCallback(async () => {
    try {
      const recent = await fetchRecentUserGenerations(24);
      const imageGenerations = filterImageGenerationsByVariant(variant, recent);
      const completedImageGenerations = imageGenerations.filter(
        (generation) =>
          generation.status === 'completed' && isTerminalGenerationStatus(generation.status)
      );
      const failedImageTasks = imageGenerations
        .filter((generation) => isFailedGenerationStatus(generation.status))
        .map(
          (generation) =>
            ({
              ...buildTaskFromGeneration(generation),
              persisted: true,
            }) satisfies Task
        );

      setGenerations((prev) => mergeGenerationsById(prev, completedImageGenerations));
      if (failedImageTasks.length > 0) {
        setTasks((prev) => mergeTasksById(prev, failedImageTasks));
      }
    } catch (loadError) {
      console.error('[ImageToolPage] 加载最近作品失败:', loadError);
    }
  }, [variant]);

  const markTaskAsFailed = useCallback((taskId: string, errorMessage: string, persisted = true) => {
    setTasks((prev) =>
      prev.map((task) =>
        task.id === taskId
          ? {
              ...task,
              status: 'failed',
              errorMessage,
              persisted,
            }
          : task
      )
    );
  }, []);

  const pollTaskStatus = useCallback(
    async (taskId: string, taskPrompt: string) => {
      if (abortControllersRef.current.has(taskId)) return;

      const controller = new AbortController();
      let shouldResyncAfterPoll = false;
      abortControllersRef.current.set(taskId, controller);

      try {
        await pollGenerationTask({
          taskId,
          taskPrompt,
          taskType: 'image',
          signal: controller.signal,
          onProgress: (payload) => {
            const nextStatus = payload.status === 'processing' ? 'processing' : 'pending';
            setTasks((prev) =>
              prev.map((task) =>
                task.id === taskId
                  ? {
                      ...task,
                      status: nextStatus,
                      progress:
                        typeof payload.progress === 'number' ? payload.progress : task.progress,
                      model:
                        (typeof payload.params?.model === 'string' && payload.params.model) ||
                        task.model,
                      modelId:
                        (typeof payload.params?.modelId === 'string' && payload.params.modelId) ||
                        task.modelId,
                      upstreamTaskId:
                        (typeof payload.params?.upstreamTaskId === 'string' &&
                          payload.params.upstreamTaskId) ||
                        task.upstreamTaskId,
                      upstreamStatus:
                        (typeof payload.params?.upstreamStatus === 'string' &&
                          payload.params.upstreamStatus) ||
                        task.upstreamStatus,
                      upstreamState:
                        (typeof payload.params?.upstreamState === 'string' &&
                          payload.params.upstreamState) ||
                        task.upstreamState,
                      upstreamStatusGroup:
                        (typeof payload.params?.upstreamStatusGroup === 'string' &&
                          payload.params.upstreamStatusGroup) ||
                        task.upstreamStatusGroup,
                      upstreamProgress:
                        typeof payload.params?.upstreamProgress === 'number'
                          ? payload.params.upstreamProgress
                          : task.upstreamProgress,
                      upstreamUpdatedAt:
                        typeof payload.params?.upstreamUpdatedAt === 'number'
                          ? payload.params.upstreamUpdatedAt
                          : task.upstreamUpdatedAt,
                      persisted: true,
                    }
                  : task
              )
            );
          },
          onCompleted: async (generation) => {
            await update();
            setTasks((prev) => prev.filter((task) => task.id !== taskId));
            setGenerations((prev) => mergeGenerationsById(prev, [generation]));
            await loadRecentGenerations();
          },
          onFailed: async (errorMessage, payload) => {
            if (!payload) {
              markTaskAsFailed(taskId, errorMessage, false);
              shouldResyncAfterPoll = true;
              return;
            }

            markTaskAsFailed(taskId, errorMessage, true);
          },
          onTimeout: async () => {
            markTaskAsFailed(taskId, '任务查询超时，请稍后刷新或到作品库查看最终状态', false);
            shouldResyncAfterPoll = true;
          },
        });
      } finally {
        abortControllersRef.current.delete(taskId);
        if (shouldResyncAfterPoll) {
          await refreshGenerationFeedRef.current();
        }
      }
    },
    [loadRecentGenerations, markTaskAsFailed, update]
  );

  const loadPendingTasks = useCallback(async () => {
    try {
      const imageTasks = filterImageTasksByVariant(
        variant,
        filterTasksByKind(await fetchPendingGenerationTasks(50), 'image').map(
          (task) =>
            ({
              ...task,
              status: task.status === 'processing' ? 'processing' : 'pending',
              progress: typeof task.progress === 'number' ? task.progress : 0,
              persisted: true,
            }) satisfies Task
        )
      );

      setTasks((prev) => {
        const preservedActiveTasks = prev.filter(
          (task) =>
            (task.status === 'pending' || task.status === 'processing') &&
            !imageTasks.some((incoming) => incoming.id === task.id) &&
            (task.persisted === false || imageTasks.length === 0)
        );

        const next = replaceActiveTasks(prev, imageTasks);
        return preservedActiveTasks.length > 0
          ? mergeTasksById(next, preservedActiveTasks)
          : next;
      });

      imageTasks.forEach((task) => {
        void pollTaskStatus(task.id, task.prompt);
      });
    } catch (loadError) {
      console.error('[ImageToolPage] 加载进行中任务失败:', loadError);
    }
  }, [pollTaskStatus, variant]);

  const refreshGenerationFeed = useCallback(async () => {
    await Promise.allSettled([loadRecentGenerations(), loadPendingTasks()]);
  }, [loadPendingTasks, loadRecentGenerations]);

  useEffect(() => {
    refreshGenerationFeedRef.current = refreshGenerationFeed;
  }, [refreshGenerationFeed]);

  useEffect(() => {
    void refreshGenerationFeed();

    const handleWindowFocus = () => {
      void refreshGenerationFeed();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void refreshGenerationFeed();
      }
    };
    const intervalId = window.setInterval(() => {
      void refreshGenerationFeed();
    }, 15000);

    window.addEventListener('focus', handleWindowFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      const controllers = abortControllersRef.current;
      window.clearInterval(intervalId);
      window.removeEventListener('focus', handleWindowFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      controllers.forEach((controller) => controller.abort());
      controllers.clear();
    };
  }, [refreshGenerationFeed]);

  const handleRemoveTask = useCallback(async (taskId: string) => {
    const controller = abortControllersRef.current.get(taskId);
    if (controller) {
      controller.abort();
      abortControllersRef.current.delete(taskId);
    }

    try {
      await fetch(`/api/user/tasks/${taskId}`, { method: 'DELETE' });
    } catch (cancelError) {
      console.error('[ImageToolPage] 取消任务失败:', cancelError);
    }

    setTasks((prev) => prev.filter((task) => task.id !== taskId));
  }, []);

  const handleRemoveGeneration = useCallback(
    async (generation: Generation) => {
      if (busyGenerationId) return;

      const confirmed = window.confirm('确认删除这条已生成记录吗？删除后将无法在当前站点继续访问该作品。');
      if (!confirmed) return;

      setBusyGenerationId(generation.id);
      setGenerations((prev) => prev.filter((item) => item.id !== generation.id));

      try {
        await deleteGenerationRecord(generation.id);
      } catch (deleteError) {
        console.error('[ImageToolPage] 删除作品失败:', deleteError);
        setGenerations((prev) => mergeGenerationsById(prev, [generation]));
      } finally {
        setBusyGenerationId(null);
      }
    },
    [busyGenerationId]
  );

  const handleClearFailedTasks = useCallback(async () => {
    if (clearingFailedTasks) return;

    const failedTasks = tasks.filter((task) => isFailedGenerationStatus(task.status));
    if (failedTasks.length === 0) return;

    const confirmed = window.confirm('确认清理当前生成页的错误记录吗？');
    if (!confirmed) return;

    const failedTaskIds = failedTasks
      .filter((task) => task.persisted !== false)
      .map((task) => task.id);
    setClearingFailedTasks(true);
    setTasks((prev) => prev.filter((task) => !isFailedGenerationStatus(task.status)));

    try {
      await deleteGenerationRecords(failedTaskIds);
    } catch (deleteError) {
      console.error('[ImageToolPage] 清理错误任务失败:', deleteError);
      setTasks((prev) => mergeTasksById(prev, failedTasks));
    } finally {
      setClearingFailedTasks(false);
    }
  }, [clearingFailedTasks, tasks]);

  const handleUploadReferenceImages = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files || []);
      if (files.length === 0) return;

      if (!canUseReferenceImage) {
        setError('当前模型暂不支持参考图输入，请切换支持图生图的模型');
        event.target.value = '';
        return;
      }

      setUploadingImages(true);
      setError('');
      try {
        const uploaded = await Promise.all(
          files.map(async (file) => {
            const result = await uploadMediaFileToPublicUrl(file);
            return {
              name: result.name || file.name,
              mimeType: result.mimeType || file.type || 'application/octet-stream',
              data: result.url,
              size: result.size || file.size,
            } satisfies UploadedMedia;
          })
        );

        setUploadedImages((prev) => {
          const merged = supportsMultipleReferenceImages ? [...prev, ...uploaded] : uploaded;
          return supportsMultipleReferenceImages ? merged : merged.slice(0, 1);
        });
      } catch (uploadError) {
        setError(uploadError instanceof Error ? uploadError.message : '上传参考图失败');
      } finally {
        event.target.value = '';
        setUploadingImages(false);
      }
    },
    [canUseReferenceImage, supportsMultipleReferenceImages]
  );

  const handleRemoveUploadedImage = useCallback((target: UploadedMedia) => {
    setUploadedImages((prev) => prev.filter((item) => item !== target));
  }, []);

  const handleGenerate = async () => {
    if (!prompt.trim() && uploadedImages.length === 0) {
      setError('请输入提示词或上传参考图');
      return;
    }
    if (!hasConfiguredModel) {
      setError('请先选择一个可用模型');
      return;
    }
    if (selectedModel?.requiresReferenceImage && uploadedImages.length === 0) {
      setError('当前模型需要至少上传 1 张参考图后再生成');
      return;
    }
    if (uploadedImages.length > 0 && !canUseReferenceImage) {
      setError('当前模型暂不支持参考图输入，请切换支持图生图的模型');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const taskPrompt = prompt.trim();
      const taskCount = parseQuantityCount(quantity);
      const results = await Promise.allSettled(
        Array.from({ length: taskCount }, async () => {
          const res = await fetchGenerationSubmit('/api/generate/image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              modelId: effectiveModelId,
              prompt: taskPrompt,
              aspectRatio: aspect || undefined,
              imageSize: size || undefined,
              referenceImages: uploadedImages.map((item) => item.data),
            }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || '生成失败');

          const newTask: Task = {
            id: data.data.id,
            prompt: taskPrompt,
            model: selectedModel?.name || selectedModel?.apiModel || '图像生成',
            modelId: effectiveModelId,
            type: data.data.type || 'gemini-image',
            status: 'pending',
            progress: 0,
            createdAt: Date.now(),
            persisted: false,
          };

          setTasks((prev) => mergeTasksById([newTask], prev));
          void pollTaskStatus(data.data.id, taskPrompt);
          return data.data.id as string;
        })
      );
      const failed = results.find(
        (result): result is PromiseRejectedResult => result.status === 'rejected'
      );
      const successCount = results.filter((result) => result.status === 'fulfilled').length;

      if (successCount === 0) {
        throw new Error(
          failed?.reason instanceof Error ? failed.reason.message : '生成失败'
        );
      }

      await update();
      if (failed) {
        setError(
          failed.reason instanceof Error
            ? `已提交 ${successCount} 个任务，部分失败：${failed.reason.message}`
            : `已提交 ${successCount} 个任务，部分提交失败`
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '生成失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4 pb-52 lg:pb-36">
      <LcPageTitle title={title} />
      <section className="overflow-hidden rounded-[26px] border border-white/10 bg-[#10141c]/90 shadow-[0_20px_60px_rgba(0,0,0,0.24)]">
        <ResultGallery
          generations={generations}
          tasks={tasks}
          onRemoveTask={handleRemoveTask}
          onClearFailedTasks={handleClearFailedTasks}
          onRemoveGeneration={handleRemoveGeneration}
          busyGenerationId={busyGenerationId}
          clearingFailedTasks={clearingFailedTasks}
        />
      </section>
      <LcCard>
        <div className="space-y-5 p-5">
          <LcUploadBox
            label={supportsMultipleReferenceImages ? '上传参考图（支持多张）' : '上传参考图'}
            sublabel={
              canUseReferenceImage
                ? '上传后会自动转为公网 URL，并在本站服务器保留 24 小时'
                : '当前模型以文生图为主，可切换支持图生图的模型'
            }
            accept="image/*"
            multiple={supportsMultipleReferenceImages}
            onChange={handleUploadReferenceImages}
          />
          {uploadingImages ? (
            <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
              正在上传参考图并转换为服务器公网 URL...
            </div>
          ) : null}
          {uploadedImages.length > 0 ? (
            <div className="rounded-[22px] border border-white/8 bg-[#0f1319] p-3">
              <div className="mb-2 text-xs text-white/45">已上传参考图</div>
              <div className="flex flex-wrap gap-2">
                {uploadedImages.map((file, index) => (
                  <span
                    key={`${file.name}-${index}`}
                    className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-[11px] text-white/72"
                  >
                    {file.name}
                    <span className="rounded-full bg-emerald-400/10 px-2 py-0.5 text-[10px] text-emerald-300">公网URL</span>
                    <button
                      type="button"
                      className="text-white/40 transition hover:text-white"
                      onClick={() => handleRemoveUploadedImage(file)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          <div className="rounded-xl border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-100/85">
            生成结果与上传参考图会优先缓存到本站服务器，默认保留 24 小时，过期后自动删除；如需长期保存，请及时下载。
          </div>
          <LcTextarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="请输入要生成或编辑的图像描述" />
          <div className="grid gap-4 md:grid-cols-2">
            <LcSection title="模型版本" subtitle="点击卡片切换模型">
              <CustomSelect
                value={modelId}
                onValueChange={setModelId}
                options={models.map((item) => ({
                  value: item.id,
                  label: item.name,
                  description: item.description,
                  highlight: item.highlight,
                  icon: <ModelPreview {...getImageModelPreviewMeta(item)} />,
                }))}
                placeholder="选择模型版本"
              />
            </LcSection>
            <LcSection title="画面比例">
              <LcSelect value={aspect} onChange={(e) => setAspect(e.target.value)}>
                <option value="">{isGpt ? '选择画面比例' : '竖屏 (9:16)'}</option>
                {COMMON_RATIOS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </LcSelect>
            </LcSection>
          </div>
          {!isGpt && (
            <LcSection title="输出尺寸">
              <LcSelect value={size} onChange={(e) => setSize(e.target.value)}>
                <option value="">选择输出尺寸</option>
                <option value="1K">1K</option>
                <option value="2K">2K</option>
                <option value="4K">4K</option>
              </LcSelect>
            </LcSection>
          )}
          {selectedModel ? (
            <div className="rounded-[24px] border border-white/8 bg-[#0f1319] p-3">
              <div className="h-28 overflow-hidden rounded-[18px]">
                <ModelPreview {...getImageModelPreviewMeta(selectedModel)} />
              </div>
            </div>
          ) : null}
          {error ? <p className="text-sm text-red-300">{error}</p> : null}
        </div>
      </LcCard>

      <FloatingGenerateBar
        costLabel={imageCostLabel}
        buttonLabel="开始生成"
        loading={loading}
        disabled={!hasConfiguredModel || loading || uploadingImages}
        onClick={handleGenerate}
        quantityValue={quantity}
        quantityOptions={['1条', '2条', '3条', '4条']}
        onQuantityChange={setQuantity}
        modelLabel={selectedModel?.name || '未选择'}
        metaLabel={`${imageAspectLabel} · ${imageSizeLabel} · ${imageGenerationCount} 条`}
      />
    </div>
  );
}

export function VideoToolPage({ variant }: { variant: VideoVariant }) {
  const { data: session, update } = useSession();
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());
  const refreshGenerationFeedRef = useRef<() => Promise<void>>(async () => {});
  const [prompt, setPrompt] = useState('');
  const [modelId, setModelId] = useState('');
  const [aspect, setAspect] = useState('');
  const [duration, setDuration] = useState('');
  const [resolution, setResolution] = useState('');
  const [referenceCount, setReferenceCount] = useState('1');
  const [motionPreset, setMotionPreset] = useState<'fun' | 'normal' | 'spicy'>('normal');
  const [advancedSelectValues, setAdvancedSelectValues] = useState<Record<string, string>>({});
  const [quantity, setQuantity] = useState('1 条');
  const [uploadedFiles, setUploadedFiles] = useState<UploadedMedia[]>([]);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [models, setModels] = useState<VideoModelSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [generations, setGenerations] = useState<Generation[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const currentModel = useMemo(
    () => models.find((item) => item.id === modelId) || models[0],
    [models, modelId]
  );
  const effectiveModelId = currentModel?.id || modelId;
  const hasConfiguredModel = Boolean(effectiveModelId && !isFallbackModelId(effectiveModelId));
  const aspectOptions = useMemo(
    () => getVideoAspectOptions(currentModel),
    [currentModel]
  );
  const durationOptions = useMemo(
    () => getVideoDurationOptions(currentModel),
    [currentModel]
  );
  const resolutionOptions = useMemo(
    () => getVideoResolutionOptions(currentModel),
    [currentModel]
  );
  const referenceCountOptions = useMemo(
    () => getVideoReferenceCountOptions(currentModel),
    [currentModel]
  );
  const advancedSelectFields = useMemo(
    () => getVideoAdvancedSelectFields(currentModel),
    [currentModel]
  );
  const referenceSlots = useMemo(
    () => getModelReferenceSlots(currentModel),
    [currentModel]
  );
  const inputMode = useMemo(
    () => getVideoModelInputMode(currentModel),
    [currentModel]
  );
  const capabilityChips = useMemo(
    () => getVideoCapabilityChips(currentModel),
    [currentModel]
  );
  const videoModelMap = useMemo(
    () => new Map(models.map((item) => [item.id, item.name])),
    [models]
  );
  const selectedAspect = useMemo(
    () =>
      aspectOptions.find((item) => item.value === aspect)
      || aspectOptions.find((item) => item.value === currentModel?.defaultAspectRatio)
      || aspectOptions[0],
    [aspect, aspectOptions, currentModel]
  );
  const currentVideoConfigObject = useMemo(() => {
    const baseVideoConfig = (currentModel?.videoConfigObject || {}) as VideoConfigObject;
    const mergedExtraParams = {
      ...(baseVideoConfig.extra_params && typeof baseVideoConfig.extra_params === 'object'
        ? baseVideoConfig.extra_params
        : {}),
    } as Record<string, unknown>;
    if (shouldAttachReferenceCount(currentModel)) {
      mergedExtraParams.reference_image_count = Number(referenceCount || '1');
    } else {
      delete mergedExtraParams.reference_image_count;
    }

    const nextConfig: VideoConfigObject = {
      ...baseVideoConfig,
      aspect_ratio: toVideoConfigAspectRatio(selectedAspect),
      video_length: parseDurationSeconds(duration || currentModel?.defaultDuration || '8s', 8),
      ...(resolution ? { resolution: resolution.toUpperCase() } : {}),
      preset: motionPreset,
      extra_params: mergedExtraParams,
    };

    for (const field of advancedSelectFields) {
      const selectedValue = advancedSelectValues[field.key];
      if (!selectedValue) continue;
      const rawValue = resolveVideoAdvancedFieldRawValue(field, selectedValue);
      if (field.source === 'top-level') {
        (nextConfig as Record<string, unknown>)[field.key] = rawValue;
      } else {
        mergedExtraParams[field.key] = rawValue;
      }
    }

    nextConfig.extra_params = mergedExtraParams;
    return nextConfig;
  }, [
    advancedSelectFields,
    advancedSelectValues,
    currentModel,
    duration,
    motionPreset,
    referenceCount,
    resolution,
    selectedAspect,
  ]);
  const estimatedCost = useMemo(
    () => estimateVideoCost(
      currentModel,
      duration,
      session?.user,
      resolution || getDefaultResolution(currentModel),
      selectedAspect?.value || currentModel?.defaultAspectRatio,
      currentVideoConfigObject
    ),
    [currentModel, currentVideoConfigObject, duration, resolution, selectedAspect?.value, session?.user]
  );
  const costLabel = hasConfiguredModel
    ? `${estimatedCost ?? currentModel?.durations?.[0]?.cost ?? 0} 积分`
    : '请先选择模型';
  const sortedModels = useMemo(
    () => [...models].sort((left, right) => {
      const scoreDiff = getVideoModelDisplayScore(right) - getVideoModelDisplayScore(left);
      if (scoreDiff !== 0) return scoreDiff;
      if (Boolean(right.highlight) !== Boolean(left.highlight)) return Number(Boolean(right.highlight)) - Number(Boolean(left.highlight));
      return (left.name || '').localeCompare(right.name || '', 'zh-CN');
    }),
    [models]
  );
  const groupedVideoModels = useMemo(
    () => groupVideoModelsByFamily(sortedModels),
    [sortedModels]
  );
  const billingNote = useMemo(
    () => buildVideoBillingNote(currentModel),
    [currentModel]
  );
  const hasInput = Boolean(prompt.trim() || uploadedFiles.length > 0);
  const groupedUploads = useMemo(
    () =>
      referenceSlots.map((slot) => ({
        slot,
        files: uploadedFiles.filter((file) => (file.slot || 'generic') === slot.key),
      })),
    [referenceSlots, uploadedFiles]
  );

  useEffect(() => {
    const load = async () => {
      const fallbackModels = makeFallbackVideoModels(variant);
      try {
        const res = await fetch('/api/video-models', { credentials: 'include', cache: 'no-store' });
        if (!res.ok) {
          setModels(fallbackModels);
          setModelId((current) => (current && fallbackModels.some((item) => item.id === current) ? current : fallbackModels[0]?.id || ''));
          return;
        }
        const data = await res.json();
        const next = filterVideoModelsByVariant(
          variant,
          ((data.data?.models || []) as VideoModelSummary[]).map((item: any) => ({
            id: item.id,
            name: item.name,
            description: item.description || '',
            apiModel: item.apiModel,
            channelType: item.channelType,
            highlight: Boolean(item.highlight),
            enabled: Boolean(item.enabled),
            features: item.features,
            aspectRatios: normalizeIncomingVideoAspectRatios(item.aspectRatios || []),
            defaultAspectRatio: item.defaultAspectRatio || 'landscape',
            billingMode: item.billingMode,
            billingPrice: item.billingPrice,
            billingUnit: item.billingUnit,
            normalPrice: item.normalPrice,
            vipPrice: item.vipPrice,
            svipPrice: item.svipPrice,
            pricingRules: item.pricingRules,
            durations: normalizeIncomingVideoDurations(item.durations || []),
            defaultDuration: item.defaultDuration || '8s',
            imageUrl: item.imageUrl,
            videoConfigObject: item.videoConfigObject,
          }))
        );
        setModels(next);
        const preferred = pickPreferredVideoModel(next);
        setModelId((current) => (current && next.some((item) => item.id === current) && !isFallbackModelId(current) ? current : preferred?.id || next[0]?.id || ''));
      } catch {
        setModels(fallbackModels);
        const preferred = pickPreferredVideoModel(fallbackModels);
        setModelId((current) => (current && fallbackModels.some((item) => item.id === current) ? current : preferred?.id || fallbackModels[0]?.id || ''));
      }
    };
    void load();
  }, [variant]);

  useEffect(() => {
    if (!modelId && models.length > 0) {
      const preferred = pickPreferredVideoModel(models);
      setModelId(preferred?.id || models[0].id);
    }
  }, [modelId, models]);

  useEffect(() => {
    if (!modelId && models.length > 0) {
      setModelId(models[0].id);
    }
  }, [modelId, models]);

  useEffect(() => {
    if (!currentModel) return;
    setDuration((current) => {
      if (current && durationOptions.some((item) => item.value === current)) {
        return current;
      }
      return currentModel.defaultDuration || durationOptions[0]?.value || '8s';
    });
    setAspect((current) => {
      if (current && aspectOptions.some((item) => item.value === current)) {
        return current;
      }
      return currentModel.defaultAspectRatio || aspectOptions[0]?.value || '16:9';
    });
    setResolution((current) => {
      if (current && resolutionOptions.includes(current)) {
        return current;
      }
      return getDefaultResolution(currentModel);
    });
    setReferenceCount((current) => {
      if (current && referenceCountOptions.includes(current)) {
        return current;
      }
      return getDefaultReferenceCount(currentModel);
    });
    setMotionPreset((current) => {
      const preset = currentModel.videoConfigObject?.preset;
      if (current === 'fun' || current === 'normal' || current === 'spicy') {
        return current;
      }
      if (preset === 'fun' || preset === 'normal' || preset === 'spicy') {
        return preset;
      }
      return 'normal';
    });
    setAdvancedSelectValues(() =>
      Object.fromEntries(
        advancedSelectFields.map((field) => [
          field.key,
          getVideoAdvancedFieldDefaultValue(currentModel, field),
        ])
      )
    );
  }, [advancedSelectFields, aspectOptions, currentModel, durationOptions, referenceCountOptions, resolutionOptions]);

  useEffect(() => {
    const allowedSlots = new Map(referenceSlots.map((slot) => [slot.key, slot]));
    setUploadedFiles((prev) => {
      const counters = new Map<VideoUploadSlot, number>();
      return prev.filter((file) => {
        const slotKey = (file.slot || 'generic') as VideoUploadSlot;
        const slot = allowedSlots.get(slotKey);
        if (!slot) return false;
        const nextCount = (counters.get(slotKey) || 0) + 1;
        counters.set(slotKey, nextCount);
        if (slot.maxFiles && nextCount > slot.maxFiles) {
          return false;
        }
        return true;
      });
    });
  }, [referenceSlots]);

  const config = useMemo(() => {
    switch (variant) {
      case 'supervideo':
        return { title: '视频生成', placeholder: '请输入视频提示词，输入 @ 可引用已上传的图片或视频素材', noteA: '时长', noteB: '清晰度', hint: '图片上传最大 15MB，视频上传最大 30MB' };
      case 'happyvideo':
        return { title: '视频创作', placeholder: '请输入视频提示词，输入 @ 可引用已上传的图片或视频素材', noteA: '时长', noteB: '清晰度', hint: '图片上传最大 15MB，视频上传最大 30MB' };
      case 'sora2':
        return { title: 'Sora2 视频生成', placeholder: '描述视频内容，或上传参考图生成图生视频。输入 @ 可引用角色卡', noteA: '模型', noteB: '', hint: '' };
      default:
        return { title: 'Grok3 视频生成', placeholder: '请输入视频提示词', noteA: '视频时长', noteB: '', hint: '图生视频的比例以图像为主，参考图建议直接使用目标比例。' };
    }
  }, [variant]);

  const loadRecentGenerations = useCallback(async () => {
    try {
      const recent = await fetchRecentUserGenerations(24);
      const videoGenerations = filterGenerationsByKind(recent, 'video');
      const activeVideoTasks = videoGenerations
        .filter(
          (generation) =>
            generation.status === 'pending' || generation.status === 'processing'
        )
        .map(
          (generation) =>
            ({
              ...buildTaskFromGeneration(generation),
              persisted: true,
            }) satisfies Task
        );
      const completedVideoGenerations = videoGenerations.filter(
        (generation) =>
          generation.status === 'completed' &&
          isTerminalGenerationStatus(generation.status)
      );
      const failedVideoTasks = videoGenerations
        .filter((generation) => isFailedGenerationStatus(generation.status))
        .map(
          (generation) =>
            ({
              ...buildTaskFromGeneration(generation),
              persisted: true,
            }) satisfies Task
        );
      setGenerations((prev) => mergeGenerationsById(prev, completedVideoGenerations));
      if (activeVideoTasks.length > 0) {
        setTasks((prev) => mergeTasksById(prev, activeVideoTasks));
      }
      if (failedVideoTasks.length > 0) {
        setTasks((prev) => mergeTasksById(prev, failedVideoTasks));
      }
    } catch (loadError) {
      console.error('[VideoToolPage] 加载最近作品失败:', loadError);
    }
  }, []);

  const markTaskAsFailed = useCallback((taskId: string, errorMessage: string, persisted = true) => {
    setTasks((prev) =>
      prev.map((task) =>
        task.id === taskId
          ? {
              ...task,
              status: 'failed',
              errorMessage,
              persisted,
            }
          : task
      )
    );
  }, []);

  const pollTaskStatus = useCallback(
    async (taskId: string, taskPrompt: string) => {
      if (abortControllersRef.current.has(taskId)) return;

      const controller = new AbortController();
      let shouldResyncAfterPoll = false;
      abortControllersRef.current.set(taskId, controller);

      try {
        await pollGenerationTask({
          taskId,
          taskPrompt,
          taskType: 'video',
          signal: controller.signal,
          onProgress: (payload) => {
            const nextStatus =
              payload.status === 'pending' || payload.status === 'processing'
                ? payload.status
                : 'processing';

            setTasks((prev) =>
              prev.map((task) =>
                task.id === taskId
                  ? {
                      ...task,
                      status: nextStatus,
                      progress:
                        typeof payload.progress === 'number' ? payload.progress : task.progress,
                      model:
                        (typeof payload.params?.model === 'string' && payload.params.model) ||
                        task.model,
                      modelId:
                        (typeof payload.params?.modelId === 'string' && payload.params.modelId) ||
                        task.modelId,
                      upstreamTaskId:
                        (typeof payload.params?.upstreamTaskId === 'string' &&
                          payload.params.upstreamTaskId) ||
                        task.upstreamTaskId,
                      upstreamStatus:
                        (typeof payload.params?.upstreamStatus === 'string' &&
                          payload.params.upstreamStatus) ||
                        task.upstreamStatus,
                      upstreamState:
                        (typeof payload.params?.upstreamState === 'string' &&
                          payload.params.upstreamState) ||
                        task.upstreamState,
                      upstreamStatusGroup:
                        (typeof payload.params?.upstreamStatusGroup === 'string' &&
                          payload.params.upstreamStatusGroup) ||
                        task.upstreamStatusGroup,
                      upstreamProgress:
                        typeof payload.params?.upstreamProgress === 'number'
                          ? payload.params.upstreamProgress
                          : task.upstreamProgress,
                      upstreamUpdatedAt:
                        typeof payload.params?.upstreamUpdatedAt === 'number'
                          ? payload.params.upstreamUpdatedAt
                          : task.upstreamUpdatedAt,
                      persisted: true,
                    }
                  : task
              )
            );
          },
          onCompleted: async (generation) => {
            await update();
            setTasks((prev) => prev.filter((task) => task.id !== taskId));
            setGenerations((prev) => mergeGenerationsById(prev, [generation]));
            await loadRecentGenerations();
          },
          onFailed: async (errorMessage, payload) => {
            if (!payload) {
              markTaskAsFailed(taskId, errorMessage, false);
              shouldResyncAfterPoll = true;
              return;
            }

            markTaskAsFailed(taskId, errorMessage, true);
          },
          onTimeout: async () => {
            markTaskAsFailed(taskId, '任务查询超时，请稍后刷新或到作品库查看最终状态', false);
            shouldResyncAfterPoll = true;
          },
        });
      } finally {
        abortControllersRef.current.delete(taskId);
        if (shouldResyncAfterPoll) {
          await refreshGenerationFeedRef.current();
        }
      }
    },
    [loadRecentGenerations, markTaskAsFailed, update]
  );

  const loadPendingTasks = useCallback(async () => {
    try {
      const videoTasks = filterTasksByKind(await fetchPendingGenerationTasks(50), 'video').map(
        (task) =>
          ({
            ...task,
            status: task.status === 'processing' ? 'processing' : 'pending',
            progress: typeof task.progress === 'number' ? task.progress : 0,
            persisted: true,
          }) satisfies Task
      );

      setTasks((prev) => {
        const preservedActiveTasks = prev.filter(
          (task) =>
            (task.status === 'pending' || task.status === 'processing') &&
            !videoTasks.some((incoming) => incoming.id === task.id) &&
            (task.persisted === false || videoTasks.length === 0)
        );

        const next = replaceActiveTasks(prev, videoTasks);
        return preservedActiveTasks.length > 0
          ? mergeTasksById(next, preservedActiveTasks)
          : next;
      });
      videoTasks.forEach((task) => {
        void pollTaskStatus(task.id, task.prompt);
      });
    } catch (loadError) {
      console.error('[VideoToolPage] 加载进行中任务失败:', loadError);
    }
  }, [pollTaskStatus]);

  const refreshGenerationFeed = useCallback(async () => {
    await Promise.allSettled([loadRecentGenerations(), loadPendingTasks()]);
  }, [loadPendingTasks, loadRecentGenerations]);

  useEffect(() => {
    refreshGenerationFeedRef.current = refreshGenerationFeed;
  }, [refreshGenerationFeed]);

  useEffect(() => {
    void refreshGenerationFeed();

    const handleWindowFocus = () => {
      void refreshGenerationFeed();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void refreshGenerationFeed();
      }
    };
    const intervalId = window.setInterval(() => {
      void refreshGenerationFeed();
    }, 15000);

    window.addEventListener('focus', handleWindowFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      const controllers = abortControllersRef.current;
      window.clearInterval(intervalId);
      window.removeEventListener('focus', handleWindowFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      controllers.forEach((controller) => controller.abort());
      controllers.clear();
    };
  }, [refreshGenerationFeed]);

  const handleUploadFiles = useCallback(
    (slot: VideoUploadSlot): React.ChangeEventHandler<HTMLInputElement> =>
      async (event) => {
        const fileList = Array.from(event.target.files || []);
        if (fileList.length === 0) return;
        const slotConfig = referenceSlots.find((item) => item.key === slot);
        const currentSlotFiles = uploadedFiles.filter((file) => (file.slot || 'generic') === slot);
        const remaining = slotConfig?.maxFiles
          ? Math.max(0, slotConfig.maxFiles - currentSlotFiles.length)
          : fileList.length;
        if (remaining <= 0) {
          setError(`${slotConfig?.label || '该上传项'}已达到上游允许数量`);
          event.target.value = '';
          return;
        }

        const effectiveFiles = slotConfig?.maxFiles ? fileList.slice(0, remaining) : fileList;
        setUploadingMedia(true);
        setError('');
        try {
          const next = await Promise.all(
            effectiveFiles.map(async (file) => {
              const durationSeconds = await readBrowserMediaDurationSeconds(file);
              if (slotConfig?.durationRange && durationSeconds) {
                const validationError = buildVideoDurationValidationMessage(
                  slotConfig.label,
                  durationSeconds,
                  slotConfig.durationRange,
                );
                if (validationError) {
                  throw new Error(validationError);
                }
              }

              const uploaded = await uploadMediaFileToPublicUrl(file);
              return {
                name: uploaded.name || file.name,
                mimeType: uploaded.mimeType || file.type || 'application/octet-stream',
                data: uploaded.url,
                size: uploaded.size || file.size,
                durationSeconds: durationSeconds || undefined,
                slot,
              } satisfies UploadedMedia;
            })
          );
          setUploadedFiles((prev) => [...prev, ...next]);
          event.target.value = '';
        } catch (uploadError) {
          setError(uploadError instanceof Error ? uploadError.message : '上传素材失败');
        } finally {
          setUploadingMedia(false);
        }
      },
    [referenceSlots, uploadedFiles]
  );

  const handleRemoveUploadedFile = useCallback((target: UploadedMedia) => {
    setUploadedFiles((prev) => prev.filter((file) => file !== target));
  }, []);

  const submitVideoTask = useCallback(
    async (taskPrompt: string) => {
      const effectiveDuration = duration || currentModel?.defaultDuration || '8s';
      const aspectRatio = selectedAspect?.value || currentModel?.defaultAspectRatio || 'landscape';

      const res = await fetchGenerationSubmit('/api/generate/sora', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: currentModel?.name || currentModel?.apiModel || '视频生成',
          modelId: effectiveModelId,
          aspectRatio,
          duration: effectiveDuration,
          prompt: taskPrompt,
          videoConfigObject: currentVideoConfigObject,
          files: sortUploadedFilesForSubmit(uploadedFiles).map((file) => ({
            mimeType: file.mimeType,
            data: file.data,
            slot: file.slot,
            durationSeconds: file.durationSeconds,
          })),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || '生成失败');
      }

      const newTask: Task = {
        id: data.data.id,
        prompt: taskPrompt,
        model: currentModel?.name || currentModel?.apiModel || '视频生成',
        modelId: effectiveModelId,
        type: 'sora-video',
        status: 'pending',
        progress: 0,
        createdAt: Date.now(),
        persisted: false,
      };

      setTasks((prev) => mergeTasksById([newTask], prev));
      void pollTaskStatus(data.data.id, taskPrompt);
      return data.data.id as string;
    },
    [currentModel, currentVideoConfigObject, duration, effectiveModelId, pollTaskStatus, selectedAspect, uploadedFiles]
  );

  const handleGenerate = async () => {
    if (!hasConfiguredModel) {
      setError('请先选择一个可用模型');
      return;
    }

    const referenceError = validateVideoReferenceInputs(
      currentModel,
      referenceSlots,
      uploadedFiles,
      referenceCount,
      duration || currentModel?.defaultDuration,
    );
    if (referenceError) {
      setError(referenceError);
      return;
    }

    if (!hasInput) {
      setError('请输入提示词或上传参考素材');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const taskPrompt = prompt.trim();
      const taskCount = parseQuantityCount(quantity);
      const results = await Promise.allSettled(
        Array.from({ length: taskCount }, () => submitVideoTask(taskPrompt))
      );
      const failed = results.find(
        (result): result is PromiseRejectedResult => result.status === 'rejected'
      );
      const successCount = results.filter((result) => result.status === 'fulfilled').length;

      if (successCount === 0) {
        throw new Error(
          failed?.reason instanceof Error ? failed.reason.message : '生成失败'
        );
      }

      await update();
      if (failed) {
        setError(
          failed.reason instanceof Error
            ? `已提交 ${successCount} 个任务，部分失败：${failed.reason.message}`
            : `已提交 ${successCount} 个任务，部分提交失败`
        );
      }
    } catch (generateError) {
      setError(generateError instanceof Error ? generateError.message : '生成失败');
    } finally {
      setLoading(false);
    }
  };

  const resolvedTasks = useMemo(
    () =>
      tasks.map((task) => ({
        ...task,
        model: resolveVideoModelLabel({
          modelId: task.modelId,
          model: task.model,
          modelNameMap: videoModelMap,
        }),
      })),
    [tasks, videoModelMap]
  );
  const currentModelMeta = currentModel ? buildVideoModelCardMeta(currentModel) : null;
  const currentBillingText = currentModel
    ? (
        getVideoPricingPreviewLabel(
          currentModel,
          duration || currentModel.defaultDuration,
          currentVideoConfigObject
        ) || currentModelMeta?.billingText || ''
      )
    : '';
  const selectedDurationOption =
    durationOptions.find((item) => item.value === duration)
    || durationOptions.find((item) => item.value === currentModel?.defaultDuration)
    || durationOptions[0];
  const selectedResolution = resolution || getDefaultResolution(currentModel);
  const generationCount = parseQuantityCount(quantity);

  return (
    <div className="space-y-8 pb-52 lg:pb-36">
      <div className="space-y-4">
        <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/15 bg-emerald-400/[0.08] px-4 py-2 text-xs text-emerald-200/90 backdrop-blur-xl">
          <Sparkles className="h-3.5 w-3.5" />
          引擎已就绪 · 参数会跟随所选模型自动切换
        </div>

        <div>
          <h1 className="text-[2.35rem] font-semibold tracking-[-0.05em] text-white sm:text-5xl">
            {config.title}
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-white/52 sm:text-base">
            选择模型后，首帧 / 尾帧 / 参考图 / 参考视频会按模型能力自动切换。
          </p>
        </div>

        {capabilityChips.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {capabilityChips.map((chip) => (
              <span
                key={chip}
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-white/72"
              >
                <Check className="h-3.5 w-3.5 text-emerald-300" />
                {chip}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <section className="overflow-hidden rounded-[32px] border border-white/10 bg-[#0c1219]/86 shadow-[0_24px_80px_rgba(0,0,0,0.30)] backdrop-blur-2xl">
        <ResultGallery generations={generations} tasks={resolvedTasks} videoModelMap={videoModelMap} />
      </section>

      <section className="overflow-hidden rounded-[32px] border border-white/10 bg-[#0d131c]/84 shadow-[0_24px_80px_rgba(0,0,0,0.28)] backdrop-blur-2xl">
        <div className="flex flex-col gap-3 border-b border-white/8 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div>
            <div className="text-lg font-semibold text-white">选择视频模型</div>
            <div className="mt-1 text-xs text-white/45">所有可用模型已全部展示，并按家族分组；点击卡片即可切换引擎，支持按次 / 按秒计费</div>
          </div>
          <div className="flex flex-wrap gap-2 text-[11px] text-white/55">
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5">
              共 {sortedModels.length} 个公开视频模型
            </span>
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5">
              共 {groupedVideoModels.length} 个模型家族
            </span>
          </div>
        </div>

        <div className="space-y-6 p-4 sm:p-6">
          {groupedVideoModels.length === 0 ? (
            <div className="rounded-[28px] border border-dashed border-white/10 bg-white/[0.02] px-5 py-8 text-center text-sm text-white/45">
              {models.length === 0 ? '视频模型加载中，请稍候…' : '当前没有可用的视频模型'}
            </div>
          ) : null}

          {groupedVideoModels.map((group) => (
            <div key={group.key} className="space-y-4">
              <div className="flex flex-col gap-2 rounded-[24px] border border-white/8 bg-white/[0.025] px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex items-center gap-3">
                    <div
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: group.accent }}
                    />
                    <div className="text-base font-semibold text-white">{group.label}</div>
                  </div>
                  <div className="mt-1 text-xs text-white/42">
                    {group.subtitle} · {group.models.length} 个模型
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 text-[11px] text-white/55">
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5">
                    {group.models.filter((item) => item.features?.textToVideo).length} 个支持文生
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5">
                    {group.models.filter((item) => item.features?.imageToVideo).length} 个支持图生
                  </span>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {group.models.map((model) => {
                  const meta = buildVideoModelCardMeta(model);
                  const active = model.id === modelId;
                  return (
                    <button
                      key={model.id}
                      type="button"
                      onClick={() => setModelId(model.id)}
                      className={cn(
                        'group overflow-hidden rounded-[28px] border text-left transition-all',
                        active
                          ? 'border-emerald-400/55 bg-emerald-400/[0.08] shadow-[0_0_0_1px_rgba(52,211,153,0.12),0_26px_60px_rgba(16,185,129,0.10)]'
                          : 'border-white/10 bg-white/[0.03] hover:border-white/18 hover:bg-white/[0.05]'
                      )}
                    >
                      <div className="relative aspect-[21/10] overflow-hidden">
                        <img
                          src={meta.imageUrl}
                          alt={model.name}
                          className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]"
                          loading="lazy"
                        />
                        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.04)_15%,rgba(6,10,16,0.9)_100%)]" />
                        <div className="absolute left-3 top-3 inline-flex rounded-full border border-white/15 bg-black/25 px-2.5 py-1 text-[11px] font-medium text-white/88 backdrop-blur-md">
                          {meta.familyLabel}
                        </div>
                        <div className="absolute right-3 top-3 rounded-full border border-white/15 bg-white/15 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-md">
                          {meta.badge}
                        </div>
                        {active ? (
                          <div className="absolute bottom-3 right-3 flex h-8 w-8 items-center justify-center rounded-full bg-emerald-400 text-[#052616] shadow-lg shadow-emerald-500/25">
                            <Check className="h-4 w-4" />
                          </div>
                        ) : null}
                        <div className="absolute inset-x-4 bottom-4">
                          <div className="truncate text-[19px] font-semibold text-white">{model.name}</div>
                          <div className="mt-1 truncate text-[11px] text-white/58">
                            {getVideoModelDisplayDescription(model) || model.description || meta.billingText}
                          </div>
                        </div>
                      </div>

                      <div className="space-y-3 px-4 py-4">
                        <div className="flex flex-wrap gap-2 text-[11px]">
                          <span className="rounded-full border border-white/8 bg-white/[0.04] px-2.5 py-1 text-white/68">
                            {getVideoModelKindLabel(model)}
                          </span>
                          <span className="rounded-full border border-white/8 bg-white/[0.04] px-2.5 py-1 text-emerald-300">
                            {meta.billingText}
                          </span>
                          {model.defaultAspectRatio ? (
                            <span className="rounded-full border border-white/8 bg-white/[0.04] px-2.5 py-1 text-white/52">
                              默认 {getVideoAspectOptions(model).find((item) => item.value === model.defaultAspectRatio)?.label || model.defaultAspectRatio}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
        <div className="overflow-hidden rounded-[32px] border border-white/10 bg-[#0d131c]/84 p-5 shadow-[0_24px_80px_rgba(0,0,0,0.28)] backdrop-blur-2xl sm:p-6">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold uppercase tracking-[0.2em] text-white/34">视频提示词</div>
              <div className="mt-2 text-base font-medium text-white/78">描述画面主体、动作、镜头语言、光效与风格</div>
            </div>
            <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-white/45">
              {prompt.length} / 2000 字符
            </div>
          </div>

          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={config.placeholder}
            className="min-h-[300px] w-full resize-none rounded-[26px] border border-white/8 bg-[#121922] p-5 text-base leading-7 text-white outline-none placeholder:text-white/24 focus:border-emerald-400/30"
          />

          <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-white/45">
            <span className="inline-flex items-center gap-2 rounded-full border border-emerald-400/15 bg-emerald-400/10 px-3 py-1.5 text-emerald-300">
              <Sparkles className="h-3.5 w-3.5" />
              引擎就绪
            </span>
            <span>当前模型：{currentModel?.name || '未选择'}</span>
            {currentBillingText ? <span>计费：{currentBillingText}</span> : null}
          </div>

          {error ? (
            <div className="mt-4 rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              {error}
            </div>
          ) : null}
          {uploadingMedia ? (
            <div className="mt-4 rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
              正在上传素材并转换为服务器公网 URL...
            </div>
          ) : null}
          <div className="mt-4 rounded-2xl border border-amber-400/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100/85">
            生成结果会优先缓存到本站服务器，默认保留 24 小时，过期后自动删除；如需长期保存，请及时下载。
          </div>
        </div>

        <div className="overflow-hidden rounded-[32px] border border-white/10 bg-[#0d131c]/84 p-5 shadow-[0_24px_80px_rgba(0,0,0,0.28)] backdrop-blur-2xl sm:p-6">
          <div className="mb-4">
            <div className="text-sm font-semibold uppercase tracking-[0.2em] text-white/34">参考素材</div>
            <div className="mt-2 text-base font-medium text-white/78">首帧 / 尾帧 / 参考图 / 参考视频会按模型能力自动切换</div>
          </div>

          <div className="grid gap-3">
            {groupedUploads.length > 0 ? (
              groupedUploads.map(({ slot, files }) => {
                const isVideoSlot = slot.kind === 'video';
                const isAudioSlot = slot.kind === 'audio';
                return (
                  <label
                    key={slot.key}
                    className="cursor-pointer rounded-[26px] border border-dashed border-white/10 bg-[#121922] p-4 transition hover:border-emerald-400/30 hover:bg-white/[0.03]"
                  >
                    <input
                      type="file"
                      className="hidden"
                      accept={slot.accept}
                      multiple={slot.multiple}
                      onChange={handleUploadFiles(slot.key)}
                    />

                    <div className="flex items-start gap-3">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/[0.04] text-white/55">
                        {isVideoSlot ? (
                          <Video className="h-5 w-5" />
                        ) : isAudioSlot ? (
                          <Volume2 className="h-5 w-5" />
                        ) : (
                          <ImagePlus className="h-5 w-5" />
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold text-white">{slot.label}</p>
                          <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] text-white/40">
                            {slot.required ? '必填 · ' : ''}
                            {slot.maxFiles && slot.maxFiles > 1
                              ? `最多 ${slot.maxFiles} 个`
                              : slot.multiple ? '多文件' : '单文件'}
                          </span>
                        </div>
                        <p className="mt-1 text-xs leading-5 text-white/40">{slot.hint}</p>

                        {files.length > 0 ? (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {files.map((file, index) => (
                              <span
                                key={`${file.name}-${index}`}
                                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-[11px] text-white/72"
                              >
                                {file.name}
                                {file.data.startsWith('http') ? (
                                  <span className="rounded-full bg-emerald-400/10 px-2 py-0.5 text-[10px] text-emerald-300">公网URL</span>
                                ) : null}
                                <button
                                  type="button"
                                  className="text-white/40 transition hover:text-white"
                                  onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    handleRemoveUploadedFile(file);
                                  }}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </span>
                            ))}
                          </div>
                        ) : (
                          <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] text-white/45">
                            <UploadCloud className="h-3.5 w-3.5" />
                            点击上传素材
                          </div>
                        )}
                      </div>
                    </div>
                  </label>
                );
              })
            ) : (
              <div className="rounded-[26px] border border-white/10 bg-[#121922] px-4 py-5 text-sm text-white/55">
                当前模型为纯文本生成，无需上传参考素材；如需参考图/参考视频，请切换到支持图生或视频参考的模型。
              </div>
            )}
          </div>

          <div className="mt-4 rounded-[24px] border border-white/8 bg-white/[0.03] p-4 text-xs leading-6 text-white/42">
            {config.hint || '图片建议 15MB 以内，视频建议 30MB 以内；上传后会自动同步到对应上游参数。'}
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-[32px] border border-white/10 bg-[#0d131c]/84 p-5 shadow-[0_24px_80px_rgba(0,0,0,0.28)] backdrop-blur-2xl sm:p-6 lg:p-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xl font-semibold text-white">生成参数</div>
            <div className="mt-1 text-xs text-white/42">设置会优先跟随模型默认值与上游限制自动切换</div>
          </div>
          <button
            type="button"
            onClick={() => {
              setAspect(currentModel?.defaultAspectRatio || aspectOptions[0]?.value || '16:9');
              setDuration(currentModel?.defaultDuration || durationOptions[0]?.value || '8s');
              setResolution(getDefaultResolution(currentModel));
              setReferenceCount(getDefaultReferenceCount(currentModel));
              setMotionPreset('normal');
              setAdvancedSelectValues(
                Object.fromEntries(
                  advancedSelectFields.map((field) => [
                    field.key,
                    getVideoAdvancedFieldDefaultValue(currentModel, field),
                  ])
                )
              );
            }}
            className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-xs text-white/70 transition hover:bg-white/[0.07]"
          >
            恢复默认
          </button>
        </div>

        <div className="grid gap-5 lg:grid-cols-4">
          <div className="rounded-[26px] border border-white/8 bg-[#121922] p-4">
            <div className="mb-4 text-[11px] font-semibold uppercase tracking-[0.22em] text-white/32">画面比例</div>
            <div className="grid grid-cols-3 gap-2">
              {aspectOptions.slice(0, 6).map((item) => {
                const active = selectedAspect?.value === item.value;
                const label = item.label || item.value;
                return (
                  <button
                    key={`${item.value}-${label}`}
                    type="button"
                    onClick={() => setAspect(item.value)}
                    className={cn(
                      'rounded-2xl border px-3 py-4 text-center text-xs font-semibold transition',
                      active
                        ? 'border-emerald-400/20 bg-emerald-400 text-[#052616] shadow-[0_12px_28px_rgba(16,185,129,0.20)]'
                        : 'border-white/10 bg-white/[0.03] text-white/62 hover:bg-white/[0.06] hover:text-white'
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-[26px] border border-white/8 bg-[#121922] p-4">
            <div className="mb-4 text-[11px] font-semibold uppercase tracking-[0.22em] text-white/32">视频时长</div>
            <LcSelect value={duration} onChange={(e) => setDuration(e.target.value)}>
              {durationOptions.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label || item.value}
                </option>
              ))}
            </LcSelect>
            <div className="mt-3 flex items-center gap-2 text-[11px] text-white/35">
              <Clock3 className="h-3.5 w-3.5" />
              当前：{selectedDurationOption?.label || duration || '未设置'}
            </div>
          </div>

          <div className="rounded-[26px] border border-white/8 bg-[#121922] p-4">
            <div className="mb-4 text-[11px] font-semibold uppercase tracking-[0.22em] text-white/32">视频清晰度</div>
            <LcSelect value={resolution} onChange={(e) => setResolution(e.target.value)}>
              {resolutionOptions.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </LcSelect>
            <div className="mt-3 text-[11px] text-white/35">当前：{selectedResolution || '未设置'}</div>
          </div>

          <div className="rounded-[26px] border border-white/8 bg-[#121922] p-4">
            <div className="mb-4 text-[11px] font-semibold uppercase tracking-[0.22em] text-white/32">运动 / 参考强度</div>
            <div className="grid grid-cols-3 gap-2">
              {[
                ['fun', '灵动'],
                ['normal', '稳定'],
                ['spicy', '创意'],
              ].map(([value, label]) => {
                const active = motionPreset === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setMotionPreset(value as 'fun' | 'normal' | 'spicy')}
                    className={cn(
                      'rounded-2xl border px-3 py-4 text-center text-xs font-semibold transition',
                      active
                        ? 'border-white/15 bg-white text-[#0b1017]'
                        : 'border-white/10 bg-white/[0.03] text-white/62 hover:bg-white/[0.06] hover:text-white'
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            {shouldAttachReferenceCount(currentModel) && referenceCountOptions.length > 1 ? (
              <div className="mt-4">
                <div className="mb-2 text-[11px] text-white/35">参考图数量</div>
                <LcSelect value={referenceCount} onChange={(e) => setReferenceCount(e.target.value)}>
                  {referenceCountOptions.map((item) => (
                    <option key={item} value={item}>
                      {item} 张
                    </option>
                  ))}
                </LcSelect>
              </div>
            ) : (
              <div className="mt-4 text-[11px] text-white/35">
                当前模式：{inputMode === 'text' ? '纯文本生成' : getVideoModelKindLabel(currentModel || models[0])}
              </div>
            )}
          </div>
        </div>

        {advancedSelectFields.length > 0 ? (
          <div className="mt-5 grid gap-5 lg:grid-cols-4">
            {advancedSelectFields.map((field) => (
              <div
                key={field.key}
                className="rounded-[26px] border border-white/8 bg-[#121922] p-4"
              >
                <div className="mb-4 text-[11px] font-semibold uppercase tracking-[0.22em] text-white/32">
                  {field.label}
                </div>
                <LcSelect
                  value={advancedSelectValues[field.key] || ''}
                  onChange={(event) =>
                    setAdvancedSelectValues((prev) => ({
                      ...prev,
                      [field.key]: event.target.value,
                    }))
                  }
                >
                  {field.options.map((option) => (
                    <option key={`${field.key}-${option.value}`} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </LcSelect>
                <div className="mt-3 text-[11px] text-white/35">
                  当前：{field.options.find((option) => option.value === advancedSelectValues[field.key])?.label || '未设置'}
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {billingNote ? (
          <div className="mt-5 rounded-[24px] border border-amber-400/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100/85">
            {billingNote}
          </div>
        ) : null}
      </section>

      <div className="fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] left-1/2 z-40 w-[calc(100%-1.5rem)] max-w-[980px] -translate-x-1/2 lg:bottom-6 lg:left-[calc(50%+8rem)] lg:w-[calc(100%-18rem)]">
        <div className="rounded-full border border-emerald-400/15 bg-[#0b1017]/92 px-4 py-3 shadow-[0_20px_70px_rgba(0,0,0,0.45)] backdrop-blur-2xl sm:px-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-4 sm:gap-6">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-white/32">预计消耗</div>
                <div className="mt-1 text-xl font-semibold text-white">{costLabel}</div>
              </div>

              <div className="hidden h-10 w-px bg-white/10 sm:block" />

              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-white/32">生成数量</div>
                <select
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                  className="mt-1 rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none"
                >
                  {['1 条', '2 条', '3 条', '4 条'].map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </div>

              <div className="hidden h-10 w-px bg-white/10 lg:block" />

              <div className="hidden lg:block">
                <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-white/32">当前模型</div>
                <div className="mt-1 text-sm text-white/72">{currentModel?.name || '未选择'}</div>
                <div className="mt-1 text-[11px] text-white/40">
                  {selectedAspect?.label || selectedAspect?.value || '默认比例'} · {selectedResolution || '默认清晰度'} · {generationCount} 条
                </div>
              </div>
            </div>

            <button
              type="button"
              disabled={!hasConfiguredModel || loading || uploadingMedia}
              onClick={handleGenerate}
              className="inline-flex h-14 items-center justify-center gap-2 rounded-full bg-emerald-400 px-8 text-base font-semibold text-[#062a1b] shadow-[0_16px_40px_rgba(16,185,129,0.35)] transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-55"
            >
              <Sparkles className={cn('h-4 w-4', loading || uploadingMedia ? 'animate-spin' : '')} />
              {uploadingMedia ? '素材上传中...' : loading ? '正在提交任务...' : '开始生成'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function DianshangPage() {
  return (
    <div className="space-y-4">
      <LcPageTitle title="电商助手" />
      <LcResultPanel />
      <LcCard>
        <div className="space-y-5 p-5">
          <div className="grid gap-4 md:grid-cols-2">
            <LcUploadBox label="模特图上传" />
            <LcUploadBox label="服装图上传" />
          </div>
          <LcSection title="功能选择">
            <LcSelect defaultValue="change"><option value="change">一键换装</option></LcSelect>
          </LcSection>
          <LcCostBar cost="20" buttonLabel="立即生成" disabled />
        </div>
      </LcCard>
    </div>
  );
}

export function TtsPage() {
  const [tab, setTab] = useState('create');
  const [prompt, setPrompt] = useState('');
  const [voicePrompt, setVoicePrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [generations, setGenerations] = useState<Generation[]>([]);
  const [busyGenerationId, setBusyGenerationId] = useState<string | null>(null);
  const [clearingFailedTasks, setClearingFailedTasks] = useState(false);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const [pending, recent] = await Promise.all([
          fetchPendingGenerationTasks(100),
          fetchRecentUserGenerations(50),
        ]);
        if (!mounted) return;
        setTasks(filterTasksByKind(pending, 'audio').filter((task) => task.type === 'voice') as Task[]);
        setGenerations(
          filterGenerationsByKind(recent, 'audio').filter((generation) => generation.type === 'voice')
        );
      } catch (err) {
        console.error('[TtsPage] load failed', err);
      }
    };

    void load();
    const id = window.setInterval(() => {
      void load();
    }, 15000);
    return () => {
      mounted = false;
      window.clearInterval(id);
    };
  }, []);

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/generate/voice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, voice: voicePrompt || undefined, format: 'mp3' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '生成失败');

      const taskId = data?.data?.id as string | undefined;
      if (taskId) {
        const createdAt = Date.now();
        setTasks((prev) => replaceActiveTasks(prev, mergeTasksById(prev, [{
          id: taskId,
          prompt,
          type: 'voice',
          status: 'processing',
          progress: 0,
          model: 'TTS 语音',
          createdAt,
          updatedAt: createdAt,
        } as Task])) as Task[]);

        void pollGenerationTask({
          taskId,
          taskPrompt: prompt,
          taskType: 'audio',
          onProgress: (payload) => {
            setTasks((prev) => mergeTasksById(prev, [{
              id: payload.id,
              prompt,
              type: payload.type,
              status: payload.status === 'processing' ? 'processing' : 'pending',
              progress: payload.progress,
              model: String(payload.params?.model || 'TTS 语音'),
              errorMessage: payload.errorMessage,
              createdAt: payload.createdAt,
              updatedAt: payload.updatedAt,
              upstreamTaskId: typeof payload.params?.upstreamTaskId === 'string' ? payload.params.upstreamTaskId : undefined,
              upstreamStatus: typeof payload.params?.upstreamStatus === 'string' ? payload.params.upstreamStatus : undefined,
              upstreamState: typeof payload.params?.upstreamState === 'string' ? payload.params.upstreamState : undefined,
              upstreamStatusGroup: typeof payload.params?.upstreamStatusGroup === 'string' ? payload.params.upstreamStatusGroup : undefined,
              upstreamProgress: typeof payload.params?.upstreamProgress === 'number' ? payload.params.upstreamProgress : undefined,
              upstreamUpdatedAt: typeof payload.params?.upstreamUpdatedAt === 'number' ? payload.params.upstreamUpdatedAt : undefined,
            } as Task]) as Task[]);
          },
          onCompleted: async (generation) => {
            setGenerations((prev) => mergeGenerationsById(prev, [generation]));
            setTasks((prev) => prev.filter((task) => task.id !== generation.id));
          },
          onFailed: async (message, payload) => {
            setTasks((prev) => mergeTasksById(prev, [{
              id: taskId,
              prompt,
              type: payload?.type || 'voice',
              status: 'failed',
              progress: payload?.progress,
              model: String(payload?.params?.model || 'TTS 语音'),
              errorMessage: message,
              createdAt: payload?.createdAt || createdAt,
              updatedAt: payload?.updatedAt || Date.now(),
              upstreamTaskId: typeof payload?.params?.upstreamTaskId === 'string' ? payload.params.upstreamTaskId : undefined,
              upstreamStatus: typeof payload?.params?.upstreamStatus === 'string' ? payload.params.upstreamStatus : undefined,
              upstreamState: typeof payload?.params?.upstreamState === 'string' ? payload.params.upstreamState : undefined,
            } as Task]) as Task[]);
          },
          onTimeout: async () => {
            setTasks((prev) => mergeTasksById(prev, [{
              id: taskId,
              prompt,
              type: 'voice',
              status: 'failed',
              model: 'TTS 语音',
              errorMessage: '轮询超时，请稍后在作品库查看',
              createdAt,
              updatedAt: Date.now(),
            } as Task]) as Task[]);
          },
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '生成失败');
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveTask = useCallback((taskId: string) => {
    setTasks((prev) => prev.filter((task) => task.id !== taskId));
  }, []);

  const handleClearFailedTasks = useCallback(async () => {
    setClearingFailedTasks(true);
    try {
      const failedIds = tasks.filter((task) => task.status === 'failed' || task.status === 'cancelled').map((task) => task.id);
      if (failedIds.length > 0) {
        await deleteGenerationRecords(failedIds);
      }
      setTasks((prev) => prev.filter((task) => task.status !== 'failed' && task.status !== 'cancelled'));
    } catch (err) {
      console.error('[TtsPage] clear failed tasks failed', err);
    } finally {
      setClearingFailedTasks(false);
    }
  }, [tasks]);

  const handleRemoveGeneration = useCallback(async (generation: Generation) => {
    setBusyGenerationId(generation.id);
    try {
      await deleteGenerationRecord(generation.id);
      setGenerations((prev) => prev.filter((item) => item.id !== generation.id));
    } catch (err) {
      console.error('[TtsPage] delete generation failed', err);
    } finally {
      setBusyGenerationId(null);
    }
  }, []);

  return (
    <div className="space-y-4 pb-52 lg:pb-36">
      <LcPageTitle title="TTS语音" description="创建声音、TTS语音克隆、音色替换" />
      <ResultGallery
        generations={generations}
        tasks={tasks}
        onRemoveTask={handleRemoveTask}
        onClearFailedTasks={handleClearFailedTasks}
        onRemoveGeneration={handleRemoveGeneration}
        busyGenerationId={busyGenerationId}
        clearingFailedTasks={clearingFailedTasks}
      />
      <LcCard>
        <div className="space-y-5 p-5">
          <LcTabs
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'create', label: '创建声音', icon: <Wand2 className="h-4 w-4" /> },
              { value: 'clone', label: 'TTS语音克隆', icon: <Volume2 className="h-4 w-4" /> },
              { value: 'replace', label: '音色替换', icon: <Repeat className="h-4 w-4" /> },
            ]}
          />
          <LcSection title="音色特点">
            <LcInput value={voicePrompt} onChange={(e) => setVoicePrompt(e.target.value)} placeholder="示例：御姐音、性感妩媚、略带埋怨、语调温柔" />
          </LcSection>
          <LcSection title="内容输入" subtitle="基于文本和音色描述生成全新语音">
            <LcTextarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="请输入需要生成语音的内容" className="min-h-[180px]" />
          </LcSection>
          {error ? <p className="text-sm text-red-300">{error}</p> : null}
        </div>
      </LcCard>

      <FloatingGenerateBar
        costLabel="5 积分"
        buttonLabel="开始生成"
        loading={loading}
        disabled={!prompt.trim()}
        onClick={handleGenerate}
        modelLabel="TTS 语音"
        metaLabel={`${voicePrompt.trim() ? '自定义音色' : '默认音色'} · MP3 · 1 条`}
      />
    </div>
  );
}

export function MusicPage() {
  const { data: session } = useSession();
  const [stylePrompt, setStylePrompt] = useState('');
  const [model, setModel] = useState('海螺 音乐生成 2.5+');
  const [lyrics, setLyrics] = useState('');
  const [duration, setDuration] = useState('1 分钟');
  const [customMode, setCustomMode] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [generations, setGenerations] = useState<Generation[]>([]);
  const [busyGenerationId, setBusyGenerationId] = useState<string | null>(null);
  const [clearingFailedTasks, setClearingFailedTasks] = useState(false);

  const musicCost = useMemo(() => calculateBillingCost({
    billingMode: 'per_call',
    billingPrice: 10,
    billingUnit: 1,
    legacyCost: 10,
  }), []);
  const musicCostLabel = useMemo(() => `${musicCost} 积分`, [musicCost]);
  const musicMetaLabel = useMemo(() => `${duration} · ${customMode ? '自定义歌词' : '自动歌词'} · 1 条`, [duration, customMode]);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const [pending, recent] = await Promise.all([
          fetchPendingGenerationTasks(100),
          fetchRecentUserGenerations(50),
        ]);
        if (!mounted) return;
        setTasks(filterTasksByKind(pending, 'audio') as Task[]);
        setGenerations(filterGenerationsByKind(recent, 'audio'));
      } catch (err) {
        console.error('[MusicPage] load failed', err);
      }
    };

    void load();
    const id = window.setInterval(() => {
      void load();
    }, 15000);
    return () => {
      mounted = false;
      window.clearInterval(id);
    };
  }, []);

  const handleGenerate = async () => {
    const prompt = [stylePrompt.trim(), lyrics.trim()].filter(Boolean).join('\n\n');
    if (!prompt) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/generate/music', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, model }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '生成失败');

      const taskId = data?.data?.id as string | undefined;
      if (taskId) {
        const createdAt = Date.now();
        setTasks((prev) => replaceActiveTasks(prev, mergeTasksById(prev, [{
          id: taskId,
          prompt,
          type: 'music',
          status: 'processing',
          progress: 0,
          model,
          createdAt,
          updatedAt: createdAt,
        } as Task])) as Task[]);

        void pollGenerationTask({
          taskId,
          taskPrompt: prompt,
          taskType: 'audio',
          onProgress: (payload) => {
            setTasks((prev) => mergeTasksById(prev, [{
              id: payload.id,
              prompt,
              type: payload.type,
              status: payload.status === 'processing' ? 'processing' : 'pending',
              progress: payload.progress,
              model: String(payload.params?.model || model),
              errorMessage: payload.errorMessage,
              createdAt: payload.createdAt,
              updatedAt: payload.updatedAt,
              upstreamTaskId: typeof payload.params?.upstreamTaskId === 'string' ? payload.params.upstreamTaskId : undefined,
              upstreamStatus: typeof payload.params?.upstreamStatus === 'string' ? payload.params.upstreamStatus : undefined,
              upstreamState: typeof payload.params?.upstreamState === 'string' ? payload.params.upstreamState : undefined,
              upstreamStatusGroup: typeof payload.params?.upstreamStatusGroup === 'string' ? payload.params.upstreamStatusGroup : undefined,
              upstreamProgress: typeof payload.params?.upstreamProgress === 'number' ? payload.params.upstreamProgress : undefined,
              upstreamUpdatedAt: typeof payload.params?.upstreamUpdatedAt === 'number' ? payload.params.upstreamUpdatedAt : undefined,
            } as Task]) as Task[]);
          },
          onCompleted: async (generation) => {
            setGenerations((prev) => mergeGenerationsById(prev, [generation]));
            setTasks((prev) => prev.filter((task) => task.id !== generation.id));
          },
          onFailed: async (message, payload) => {
            setTasks((prev) => mergeTasksById(prev, [{
              id: taskId,
              prompt,
              type: payload?.type || 'music',
              status: 'failed',
              progress: payload?.progress,
              model: String(payload?.params?.model || model),
              errorMessage: message,
              createdAt: payload?.createdAt || createdAt,
              updatedAt: payload?.updatedAt || Date.now(),
              upstreamTaskId: typeof payload?.params?.upstreamTaskId === 'string' ? payload.params.upstreamTaskId : undefined,
              upstreamStatus: typeof payload?.params?.upstreamStatus === 'string' ? payload.params.upstreamStatus : undefined,
              upstreamState: typeof payload?.params?.upstreamState === 'string' ? payload.params.upstreamState : undefined,
            } as Task]) as Task[]);
          },
          onTimeout: async () => {
            setTasks((prev) => mergeTasksById(prev, [{
              id: taskId,
              prompt,
              type: 'music',
              status: 'failed',
              model,
              errorMessage: '轮询超时，请稍后在作品库查看',
              createdAt,
              updatedAt: Date.now(),
            } as Task]) as Task[]);
          },
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '生成失败');
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveTask = useCallback((taskId: string) => {
    setTasks((prev) => prev.filter((task) => task.id !== taskId));
  }, []);

  const handleClearFailedTasks = useCallback(async () => {
    setClearingFailedTasks(true);
    try {
      const failedIds = tasks.filter((task) => task.status === 'failed' || task.status === 'cancelled').map((task) => task.id);
      if (failedIds.length > 0) {
        await deleteGenerationRecords(failedIds);
      }
      setTasks((prev) => prev.filter((task) => task.status !== 'failed' && task.status !== 'cancelled'));
    } catch (err) {
      console.error('[MusicPage] clear failed tasks failed', err);
    } finally {
      setClearingFailedTasks(false);
    }
  }, [tasks]);

  const handleRemoveGeneration = useCallback(async (generation: Generation) => {
    setBusyGenerationId(generation.id);
    try {
      await deleteGenerationRecord(generation.id);
      setGenerations((prev) => prev.filter((item) => item.id !== generation.id));
    } catch (err) {
      console.error('[MusicPage] delete generation failed', err);
    } finally {
      setBusyGenerationId(null);
    }
  }, []);

  return (
    <div className="space-y-4 pb-52 lg:pb-36">
      <LcPageTitle title="AI音乐" />
      <LcCard>
        <div className="space-y-5 p-5">
          <LcSection title="音乐风格提示词" subtitle="描述歌曲风格、情绪、乐器、速度和人声特点">
            <LcTextarea
              value={stylePrompt}
              onChange={(e) => setStylePrompt(e.target.value)}
              placeholder="示例：抒情中文男声情歌，钢琴主导旋律，弦乐层层和声推进，中速律动，情绪从克制到释放，副歌要有记忆点，整体质感温暖细腻。"
              className="min-h-[150px]"
            />
          </LcSection>
          <LcSection title="自定义歌词">
            <button type="button" onClick={() => setCustomMode((v) => !v)} className="flex h-12 w-full items-center justify-start gap-3 rounded-2xl border border-white/8 bg-[#171b24] px-4 text-sm text-white">
              <span className={`inline-flex h-5 w-5 items-center justify-center rounded border ${customMode ? 'border-white/30 bg-white/90 text-black' : 'border-white/20 bg-transparent text-transparent'}`}><CheckSquare className="h-3.5 w-3.5" /></span>
              开启自定义歌词模式
            </button>
          </LcSection>
          <LcSection title="歌词">
            <LcTextarea
              value={lyrics}
              onChange={(e) => setLyrics(e.target.value)}
              placeholder={customMode ? "[主歌1]\n把夜色写进你的眼睛\n我在回声里轻声靠近\n..." : "可以留空，让系统根据风格自动生成歌词。"}
              className="min-h-[220px]"
            />
          </LcSection>
          <LcSection title="音乐模型" subtitle="当前仅保留可直接提交的音乐模型，VIDU-音乐MV 请到视频生成页使用">
            <LcSelect value={model} onChange={(e) => setModel(e.target.value)}>
              <option value="海螺 音乐生成 2.5+">海螺 音乐生成 2.5+</option>
            </LcSelect>
          </LcSection>
          <LcSection title="音乐时长">
            <LcSelect value={duration} onChange={(e) => setDuration(e.target.value)}>
              <option value="1 分钟">1 分钟</option>
              <option value="2 分钟">2 分钟</option>
            </LcSelect>
          </LcSection>
          <LcSection title="高级模式">
            <button type="button" onClick={() => setAdvanced((v) => !v)} className="flex h-12 w-full items-center justify-start gap-3 rounded-2xl border border-white/8 bg-[#171b24] px-4 text-sm text-white">
              <span className={`inline-flex h-5 w-5 items-center justify-center rounded border ${advanced ? 'border-white/30 bg-white/90 text-black' : 'border-white/20 bg-transparent text-transparent'}`}><CheckSquare className="h-3.5 w-3.5" /></span>
              开启高级参数
            </button>
          </LcSection>
          {advanced ? (
            <div className="grid gap-4 md:grid-cols-2">
              <LcSection title="速度"><LcSelect defaultValue="中速"><option>中速</option><option>慢速</option><option>快速</option></LcSelect></LcSection>
              <LcSection title="语言"><LcSelect defaultValue="中文"><option>中文</option><option>英文</option><option>日文</option></LcSelect></LcSection>
              <LcSection title="调式"><LcSelect defaultValue="流行"><option>流行</option><option>民谣</option><option>电子</option></LcSelect></LcSection>
              <LcSection title="节拍"><LcSelect defaultValue="4/4"><option>4/4</option><option>3/4</option><option>6/8</option></LcSelect></LcSection>
            </div>
          ) : null}
          {error ? <p className="text-sm text-red-300">{error}</p> : null}
        </div>
      </LcCard>
      <ResultGallery
        generations={generations}
        tasks={tasks}
        onRemoveTask={handleRemoveTask}
        onClearFailedTasks={handleClearFailedTasks}
        onRemoveGeneration={handleRemoveGeneration}
        busyGenerationId={busyGenerationId}
        clearingFailedTasks={clearingFailedTasks}
      />

      <FloatingGenerateBar
        costLabel={musicCostLabel}
        buttonLabel="开始生成"
        loading={loading}
        disabled={!stylePrompt.trim() && !lyrics.trim()}
        onClick={handleGenerate}
        modelLabel={model}
        metaLabel={musicMetaLabel}
      />
    </div>
  );
}

export function ChatPage() {
  type ChatModelOption = {
    id: string;
    name: string;
    costPerMessage: number;
    billingMode?: 'per_call' | 'per_second' | 'per_1k_tokens';
    billingPrice?: number;
    billingUnit?: number;
    imageUrl?: string;
    supportsVision?: boolean;
    modelId?: string;
  };
  const [instruction, setInstruction] = useState('');
  const [content, setContent] = useState('');
  const [models, setModels] = useState<ChatModelOption[]>([]);
  const fallbackChatModels = useMemo<ChatModelOption[]>(
    () => [{ id: '__fallback_chat_0', name: 'GPT-5.4', costPerMessage: 0, billingMode: 'per_call', billingPrice: 0, billingUnit: 1 }],
    []
  );
  const [modelId, setModelId] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch('/api/chat/models');
        if (!res.ok) return;
        const data = await res.json();
        let next = (data.data || []) as ChatModelOption[];
        if (next.length === 0) next = fallbackChatModels;
        setModels(next);
        setModelId((current) => (current && next.some((item) => item.id === current) ? current : next[0]?.id || ''));
      } catch {
        const next = fallbackChatModels;
        setModels(next);
        setModelId((current) => (current && next.some((item) => item.id === current) ? current : next[0].id));
      }
    };
    void load();
  }, [fallbackChatModels]);

  const currentModel = models.find((item) => item.id === modelId);
  const hasConfiguredModel = Boolean(modelId && !isFallbackModelId(modelId));
  const chatCostLabel = currentModel
    ? formatBillingSummary({
        billingMode: currentModel.billingMode,
        billingPrice: currentModel.billingPrice,
        billingUnit: currentModel.billingUnit,
        legacyCost: currentModel.costPerMessage,
      })
    : '0 积分 / 次';

  const handleSubmit = async () => {
    const prompt = [instruction.trim(), content.trim()].filter(Boolean).join('\n\n');
    if (!prompt) return;
    if (!hasConfiguredModel) {
      setError('请先在后台配置聊天模型后再提交');
      return;
    }
    setLoading(true);
    setError('');
    setResult('');
    try {
      const res = await fetch('/api/chat/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId, prompt }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '处理失败');
      setResult(data.data?.content || '');
    } catch (e) {
      setError(e instanceof Error ? e.message : '处理失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <LcPageTitle title="全能推理" />
      <LcCard>
        <div className="space-y-5 p-5">
          <div className="text-sm text-white/45">0 个任务</div>
          <LcSection title="指令">
            <div className="mb-2"><button type="button" className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-white/75">常用指令</button></div>
            <LcInput value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="例如：总结、润色、翻译、分析" />
          </LcSection>
          <LcSection title="文本"><LcTextarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="请输入需要处理的文本内容" className="min-h-[220px]" /></LcSection>
          <LcSection title="模型">
            <CustomSelect
              value={modelId}
              onValueChange={setModelId}
              options={models.map((item) => ({
                value: item.id,
                label: item.name,
                description: `${item.modelId || ''}${item.supportsVision ? ' · 支持图片' : ''}`.replace(/^\s*·\s*/, ''),
                icon: <ModelPreview {...getImageModelPreviewMeta({
                  name: item.name,
                  apiModel: item.modelId || item.name,
                  billingMode: item.billingMode,
                  billingPrice: item.billingPrice,
                  billingUnit: item.billingUnit,
                  costPerGeneration: item.costPerMessage,
                  imageUrl: item.imageUrl,
                })} />,
              }))}
              placeholder="选择模型"
            />
          </LcSection>
          {result ? <div className="whitespace-pre-wrap rounded-2xl border border-white/8 bg-[#171b24] p-4 text-sm leading-7 text-white/80">{result}</div> : null}
          {error ? <p className="text-sm text-red-300">{error}</p> : null}
          <LcCostBar cost={chatCostLabel} buttonLabel="提交" loading={loading} disabled={(!instruction.trim() && !content.trim()) || !hasConfiguredModel} onClick={handleSubmit} />
        </div>
      </LcCard>
    </div>
  );
}

export function RechargePage() {
  const { data: session } = useSession();
  const [amount, setAmount] = useState('10');
  const [code, setCode] = useState('');
  const [payType, setPayType] = useState('alipay');
  const [orders, setOrders] = useState<Array<{ outTradeNo: string; amount: number; points: number; status: string; createdAt: number }>>([]);
  const [paying, setPaying] = useState(false);
  const [redeeming, setRedeeming] = useState(false);
  const [message, setMessage] = useState('');
  const currentMembershipLevel = getEffectiveMembershipLevel(session?.user);
  const currentMembershipLabel = MEMBERSHIP_LABELS[currentMembershipLevel];

  useEffect(() => {
    const loadOrders = async () => {
      try {
        const res = await fetch('/api/payment/orders', { cache: 'no-store' });
        const data = await res.json();
        if (res.ok) setOrders(data.data || []);
      } catch {}
    };
    void loadOrders();
  }, []);

  const handlePay = async () => {
    setPaying(true);
    setMessage('');
    try {
      const res = await fetch('/api/payment/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: Number(amount), payType }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '创建支付订单失败');
      window.location.href = data.data.payUrl;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '创建支付订单失败');
    } finally {
      setPaying(false);
    }
  };

  const handleRedeem = async () => {
    if (!code.trim()) return;
    setRedeeming(true);
    setMessage('');
    try {
      const res = await fetch('/api/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '兑换失败');
      setMessage(data.message || '兑换成功');
      setCode('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '兑换失败');
    } finally {
      setRedeeming(false);
    }
  };

  return (
    <div className="space-y-4">
      <LcPageTitle title="钱包中心" description="在线支付、兑换码兑换、订单状态追踪" />
      <LcCard><div className="p-5"><button type="button" className="flex h-12 w-full items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.02] px-4 text-sm text-white/75"><Sparkles className="h-4 w-4" />账号设置</button></div></LcCard>
      <LcCard><div className="p-5"><div className="rounded-[24px] border border-white/8 bg-white/[0.02] p-5"><p className="text-sm text-white/45">说明</p><p className="mt-3 text-sm leading-7 text-white/72">当前页面用于积分充值、兑换码兑换与订单状态追踪。积分比例默认为 1:100，支付结果通常会在几秒内回写到余额；如遇异常，请通过站内反馈或联系管理员处理。生成结果默认仅在本站缓存 24 小时，请及时下载保存。</p></div></div></LcCard>
      <LcCard>
        <div className="p-5">
          <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-[#274d38] bg-[#12271c] text-[#8eedb2]"><Sparkles className="h-5 w-5" /></div>
          <p className="text-2xl font-semibold text-white">当前积分</p>
          <p className="mt-1 text-sm text-white/45">积分余额与兑换比例</p>
          <div className="mt-5 rounded-2xl border border-[#274d38] bg-[#12271c] px-5 py-4 text-white/85">1 元 = <span className="text-3xl font-semibold text-[#8eedb2]">100</span> 积分</div>
          <div className="mt-5 text-5xl font-semibold tracking-[-0.04em] text-white">{session?.user?.balance ?? 50} <span className="text-lg font-normal text-white/45">积分</span></div>
          <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-[#3a2b53] bg-[#181225] px-4 py-2 text-sm text-[#e8d7ff]">
            <Crown className="h-4 w-4" />
            当前等级：{currentMembershipLabel}
            {session?.user?.membershipExpiresAt && session.user.membershipExpiresAt > Date.now() ? (
              <span className="text-xs text-[#cbb0ff]">
                · 有效期至 {new Date(session.user.membershipExpiresAt).toLocaleDateString('zh-CN')}
              </span>
            ) : null}
          </div>
        </div>
      </LcCard>
      <LcCard>
        <div className="border-b border-white/8 px-5 py-4">
          <p className="text-2xl font-semibold text-white">会员定价表</p>
          <p className="mt-1 text-sm text-white/45">按你给的表同步：SVIP 6 折，VIP 85 折，普通原价</p>
        </div>
        <div className="space-y-5 p-5">
          <div className="grid gap-3 md:grid-cols-3">
            {MEMBERSHIP_RECHARGE_TIERS.map((tier) => (
              <div key={tier.level} className="rounded-[24px] border border-white/8 bg-[#0f1319] p-4 text-white/75">
                <div className="text-sm font-semibold text-white">{tier.label}</div>
                <div className="mt-2 text-2xl font-semibold text-[#8eedb2]">¥{tier.amount}</div>
                <div className="mt-1 text-xs text-white/40">开通/顺延 {tier.days} 天</div>
              </div>
            ))}
          </div>
          <div className="overflow-hidden rounded-[24px] border border-white/8">
            <div className="grid grid-cols-[1.5fr_repeat(4,minmax(0,1fr))] bg-white/[0.04] px-4 py-3 text-xs font-semibold text-white/55">
              <div>模型</div>
              <div>SVIP</div>
              <div>VIP</div>
              <div>普通</div>
              <div>对应时长</div>
            </div>
            {PRICING_REFERENCE_ROWS.map((row) => (
              <div key={row.label} className="grid grid-cols-[1.5fr_repeat(4,minmax(0,1fr))] border-t border-white/8 px-4 py-3 text-sm text-white/78">
                <div>{row.label}</div>
                <div>¥{row.prices.svip}/{row.unit}</div>
                <div>¥{row.prices.vip}/{row.unit}</div>
                <div>¥{row.prices.normal}/{row.unit}</div>
                <div>{row.seconds || '-'}</div>
              </div>
            ))}
          </div>
          <div className="text-xs text-white/35">说明：站内仍按积分扣费，当前按 1 元 = 100 积分换算并四舍五入到整数积分。</div>
        </div>
      </LcCard>
      {message ? <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/75">{message}</div> : null}
      <LcCard>
        <div className="border-b border-white/8 px-5 py-4"><p className="text-2xl font-semibold text-white">在线支付</p><p className="mt-1 text-sm text-white/45">当前可用：支付宝</p></div>
        <div className="space-y-5 p-5">
          <LcSection title="选择支付额度"><div className="flex flex-wrap gap-3">{['10', '30', '50', '100', '300', '500', '1000'].map((item) => <button key={item} type="button" onClick={() => setAmount(item)} className={`rounded-2xl border px-4 py-3 text-sm ${amount === item ? 'border-[#4f7cff]/60 bg-[#4f7cff]/18 text-white' : 'border-white/10 bg-white/[0.02] text-white/65'}`}>¥{item}</button>)}</div></LcSection>
          <LcSection title="支付金额"><LcInput value={amount} onChange={(e) => setAmount(e.target.value)} /></LcSection>
          <LcSection title="支付方式">
            <div className="grid grid-cols-2 gap-3">
              {[
                ['alipay', '支付宝'],
                ['wxpay', '微信支付'],
              ].map(([type, label]) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setPayType(type)}
                  className={`flex h-12 w-full items-center justify-center rounded-2xl border text-sm ${payType === type ? 'border-[#4057a9] bg-[#25335f] text-white' : 'border-white/10 bg-white/[0.02] text-white/60'}`}
                >
                  {payType === type ? '✓ ' : ''}{label}
                </button>
              ))}
            </div>
          </LcSection>
          <div className="text-sm text-white/45">预计到账： {Number(amount || 0) * 100} 积分</div>
          <button type="button" onClick={handlePay} disabled={paying || Number(amount) <= 0} className="h-12 w-full rounded-full bg-[linear-gradient(90deg,#59d9a8,#6c7cff)] text-sm font-medium text-white disabled:opacity-50">{paying ? '正在创建订单...' : '立即支付'}</button>
        </div>
      </LcCard>
      <LcCard>
        <div className="border-b border-white/8 px-5 py-4"><p className="text-2xl font-semibold text-white">兑换码</p><p className="mt-1 text-sm text-white/45">可在这里直接兑换积分</p></div>
        <div className="space-y-4 p-5"><LcInput value={code} onChange={(e) => setCode(e.target.value)} placeholder="请输入兑换码" /><button type="button" onClick={handleRedeem} disabled={redeeming || !code.trim()} className="h-12 w-full rounded-2xl border border-[#6c5330] bg-[#4e3922] text-sm font-medium text-[#f0c77f] disabled:opacity-50">{redeeming ? '兑换中...' : '立即兑换'}</button></div>
      </LcCard>
      <LcCard>
        <div className="border-b border-white/8 px-5 py-4"><p className="text-2xl font-semibold text-white">支付订单</p><p className="mt-1 text-sm text-white/45">可手动刷新未支付订单状态</p></div>
        <div className="space-y-4 p-5">
          <button type="button" onClick={() => window.location.reload()} className="inline-flex h-11 items-center justify-center rounded-full border border-white/10 bg-white/[0.03] px-5 text-sm text-white/80">刷新列表</button>
          {orders.length === 0 ? (
            <div className="rounded-[24px] border border-dashed border-white/10 bg-[#0f1319] px-6 py-12 text-center text-sm text-white/35">暂无支付订单</div>
          ) : (
            <div className="space-y-3">
              {orders.map((order) => (
                <div key={order.outTradeNo} className="rounded-2xl border border-white/8 bg-[#0f1319] p-4 text-sm text-white/70">
                  <div className="flex items-center justify-between gap-3"><span>{order.outTradeNo}</span><span className={order.status === 'paid' ? 'text-[#8eedb2]' : 'text-[#f0c77f]'}>{order.status === 'paid' ? '已支付' : '待支付'}</span></div>
                  <div className="mt-2 text-white/40">¥{Number(order.amount).toFixed(2)} · {order.points} 积分</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </LcCard>
    </div>
  );
}
