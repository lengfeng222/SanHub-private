import type {
  BillingMode,
  VideoConfigObject,
  VideoDuration,
  VideoModelFeatures,
  VideoPricingRule,
} from '@/types';
import { estimateVideoDurationCost } from '@/lib/video-model-normalizer';

type LingkeRemoteVisibleModel = {
  id: number;
  展示名称: string;
  模型图标?: string;
};

export type LingkeSyncedVideoModel = {
  apiModel: string;
  remoteId?: number;
  matchKeys?: string[];
  name: string;
  description: string;
  features: VideoModelFeatures;
  aspectRatios: Array<{ value: string; label: string }>;
  defaultAspectRatio: string;
  durations: VideoDuration[];
  defaultDuration: string;
  videoConfigObject: VideoConfigObject;
  billingMode: BillingMode;
  billingPrice: number;
  billingUnit: number;
  normalPrice?: number;
  vipPrice?: number;
  svipPrice?: number;
  pricingRules: VideoPricingRule[];
  imageUrl?: string;
  highlight?: boolean;
};

const LK_VISIBLE_MODELS_URL = 'https://api.lingkeai.ai/peizhi/shouye_moxing';
const LK_VISIBLE_DOMAIN = 'svip.lk666.ai';

const DEFAULT_FEATURES: VideoModelFeatures = {
  textToVideo: true,
  imageToVideo: false,
  videoToVideo: false,
  supportStyles: false,
};

const ALL_ASPECT_RATIOS = [
  { value: '16:9', label: '16:9' },
  { value: '9:16', label: '9:16' },
  { value: '1:1', label: '1:1' },
  { value: '2:3', label: '2:3' },
  { value: '3:2', label: '3:2' },
] as const;

const STANDARD_VIDEO_ASPECT_RATIOS = [
  { value: '16:9', label: '16:9' },
  { value: '9:16', label: '9:16' },
  { value: '1:1', label: '1:1' },
] as const;

function normalizeName(value: string): string {
  return String(value || '').trim();
}

function hasAlias(raw: string, aliases: string[]): boolean {
  const normalized = normalizeName(raw).toLowerCase();
  return aliases.some((alias) => normalized === alias.toLowerCase());
}

function hasAliasIncludes(raw: string, aliases: string[]): boolean {
  const normalized = normalizeName(raw).toLowerCase();
  return aliases.some((alias) => normalized.includes(alias.toLowerCase()));
}

function makeDurations(
  values: number[],
  billingMode: BillingMode,
  billingPrice: number,
  billingUnit: number,
  fallbackCost = 100,
): VideoDuration[] {
  return values.map((seconds) => {
    const value = `${seconds}s`;
    return {
      value,
      label: `${seconds} 秒`,
      cost: estimateVideoDurationCost(
        value,
        {
          billingMode: billingMode === 'per_1k_tokens' ? 'per_call' : (billingMode as 'per_call' | 'per_second'),
          billingPrice,
          billingUnit,
        },
        fallbackCost,
      ),
    };
  });
}

function buildExtraParams(extra?: Record<string, unknown>): Record<string, unknown> {
  return extra ? JSON.parse(JSON.stringify(extra)) : {};
}

function buildRules(rows: Array<{
  label: string;
  duration?: string;
  aspectRatio?: string;
  resolution?: string;
  qualityVersion?: string;
  modelVersion?: string;
  version?: string;
  generationMode?: string;
  offPeak?: boolean;
  normalPrice?: number;
  vipPrice?: number;
  svipPrice?: number;
}>): VideoPricingRule[] {
  return rows.map((row, index) => ({
    id: `lingke_rule_${index}_${row.label.replace(/\s+/g, '_')}`,
    label: row.label,
    duration: row.duration,
    aspectRatio: row.aspectRatio,
    resolution: row.resolution,
    qualityVersion: row.qualityVersion,
    modelVersion: row.modelVersion,
    version: row.version,
    generationMode: row.generationMode,
    offPeak: row.offPeak,
    normalPrice: row.normalPrice,
    vipPrice: row.vipPrice,
    svipPrice: row.svipPrice,
    enabled: true,
  }));
}

function yuanToPoints(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.max(1, Math.round(value * 100));
}

function makeDurationOptionsFromPointMap(durationPointMap: Record<number, number>): VideoDuration[] {
  return Object.entries(durationPointMap)
    .map(([seconds, cost]) => {
      const parsedSeconds = Number(seconds);
      return {
        value: `${parsedSeconds}s`,
        label: `${parsedSeconds} 秒`,
        cost: Math.max(1, Math.round(cost)),
      };
    })
    .sort((left, right) => Number.parseInt(left.value, 10) - Number.parseInt(right.value, 10));
}

function buildPerSecondResolutionRules(options: {
  durations: number[];
  perSecondYuanByResolution: Record<string, number>;
  labelPrefix: string;
}): VideoPricingRule[] {
  const rows: Array<{
    label: string;
    duration: string;
    resolution: string;
    normalPrice: number;
  }> = [];

  for (const seconds of options.durations) {
    for (const [resolution, perSecondYuan] of Object.entries(options.perSecondYuanByResolution)) {
      rows.push({
        label: `${options.labelPrefix} ${resolution} ${seconds}s`,
        duration: `${seconds}s`,
        resolution,
        normalPrice: yuanToPoints(perSecondYuan * seconds),
      });
    }
  }

  return buildRules(rows);
}

function buildDurationResolutionRules(options: {
  labelPrefix: string;
  yuanByDurationAndResolution: Record<number, Record<string, number>>;
}): VideoPricingRule[] {
  const rows: Array<{
    label: string;
    duration: string;
    resolution: string;
    normalPrice: number;
  }> = [];

  for (const [seconds, resolutionMap] of Object.entries(options.yuanByDurationAndResolution)) {
    for (const [resolution, yuan] of Object.entries(resolutionMap)) {
      rows.push({
        label: `${options.labelPrefix} ${resolution} ${seconds}s`,
        duration: `${seconds}s`,
        resolution,
        normalPrice: yuanToPoints(yuan),
      });
    }
  }

  return buildRules(rows);
}

function buildDurationQualityRules(options: {
  labelPrefix: string;
  yuanByDurationAndQuality: Record<number, Record<string, number>>;
}): VideoPricingRule[] {
  const rows: Array<{
    label: string;
    duration: string;
    qualityVersion: string;
    normalPrice: number;
  }> = [];

  for (const [seconds, qualityMap] of Object.entries(options.yuanByDurationAndQuality)) {
    for (const [qualityVersion, yuan] of Object.entries(qualityMap)) {
      rows.push({
        label: `${options.labelPrefix} ${qualityVersion} ${seconds}s`,
        duration: `${seconds}s`,
        qualityVersion,
        normalPrice: yuanToPoints(yuan),
      });
    }
  }

  return buildRules(rows);
}

function buildDurationQualityPairRules(options: {
  labelPrefix: string;
  yuanByDurationAndQuality: Record<number, Record<string, number[]>>;
  qualityOrder?: string[];
}): VideoPricingRule[] {
  const rows: Array<{
    label: string;
    duration: string;
    qualityVersion: string;
    normalPrice: number;
  }> = [];

  for (const [seconds, qualityMap] of Object.entries(options.yuanByDurationAndQuality)) {
    const qualities = options.qualityOrder && options.qualityOrder.length > 0
      ? options.qualityOrder.filter((item) => Object.prototype.hasOwnProperty.call(qualityMap, item))
      : Object.keys(qualityMap);

    for (const qualityVersion of qualities) {
      const values = qualityMap[qualityVersion] || [];
      if (!Array.isArray(values)) continue;
      values.forEach((yuan, index) => {
        rows.push({
          label: `${options.labelPrefix} ${qualityVersion} ${index === 0 ? '标准' : '高品质'} ${seconds}s`,
          duration: `${seconds}s`,
          qualityVersion,
          normalPrice: yuanToPoints(yuan),
        });
      });
    }
  }

  return buildRules(rows);
}

function buildDurationQualityVersionRules(options: {
  labelPrefix: string;
  yuanByDurationAndVersion: Record<number, Record<string, Record<string, number>>>;
}): VideoPricingRule[] {
  const rows: Array<{
    label: string;
    duration: string;
    version: string;
    qualityVersion: string;
    normalPrice: number;
  }> = [];

  for (const [seconds, versionMap] of Object.entries(options.yuanByDurationAndVersion)) {
    for (const [version, qualityMap] of Object.entries(versionMap)) {
      for (const [qualityVersion, yuan] of Object.entries(qualityMap)) {
        rows.push({
          label: `${options.labelPrefix} ${version} ${qualityVersion} ${seconds}s`,
          duration: `${seconds}s`,
          version,
          qualityVersion,
          normalPrice: yuanToPoints(yuan),
        });
      }
    }
  }

  return buildRules(rows);
}

function buildPerSecondQualityRules(options: {
  labelPrefix: string;
  durations: number[];
  perSecondYuanByQuality: Record<string, number>;
}): VideoPricingRule[] {
  const rows: Array<{
    label: string;
    duration: string;
    qualityVersion: string;
    normalPrice: number;
  }> = [];

  for (const seconds of options.durations) {
    for (const [qualityVersion, yuanPerSecond] of Object.entries(options.perSecondYuanByQuality)) {
      rows.push({
        label: `${options.labelPrefix} ${qualityVersion} ${seconds}s`,
        duration: `${seconds}s`,
        qualityVersion,
        normalPrice: yuanToPoints(seconds * yuanPerSecond),
      });
    }
  }

  return buildRules(rows);
}

function createModelConfig(name: string, imageUrl?: string): LingkeSyncedVideoModel {
  const raw = normalizeName(name);
  const lower = raw.toLowerCase();

  if (hasAlias(raw, ['Sora-2 官转版', 'Sora-2 Official'])) {
    return {
      apiModel: raw,
      name: raw,
      description: '灵刻/lk666 视频模型 | 文生视频 | 4/8/12 秒 | 按条计费',
      features: { ...DEFAULT_FEATURES, textToVideo: true, imageToVideo: false },
      aspectRatios: [...STANDARD_VIDEO_ASPECT_RATIOS],
      defaultAspectRatio: '16:9',
      durations: makeDurationOptionsFromPointMap({
        4: yuanToPoints(1.4112),
        8: yuanToPoints(2.8224),
        12: yuanToPoints(4.2336),
      }),
      defaultDuration: '8s',
      videoConfigObject: {
        aspect_ratio: '16:9',
        video_length: 8,
        resolution: '720P',
        preset: 'normal',
        version: 'MC-sora2特价',
        extra_params: buildExtraParams({
          image_resolution_options: ['720P', '1080P'],
          version_options: ['MC-sora2特价', '优质官转OpenAI分组'],
          billing_note: '支持 MC-sora2 特价与优质官转 OpenAI 分组按次计费。',
        }),
      },
      billingMode: 'per_call',
      billingPrice: yuanToPoints(2.8224),
      billingUnit: 1,
      pricingRules: buildDurationQualityVersionRules({
        labelPrefix: raw,
        yuanByDurationAndVersion: {
          4: {
            'MC-sora2特价': { 标准: 1.4112 },
            '优质官转OpenAI分组': { 标准: 9.0318 },
          },
          8: {
            'MC-sora2特价': { 标准: 2.8224 },
            '优质官转OpenAI分组': { 标准: 18.0636 },
          },
          12: {
            'MC-sora2特价': { 标准: 4.2336 },
            '优质官转OpenAI分组': { 标准: 27.0954 },
          },
        },
      }),
      imageUrl,
      highlight: true,
    };
  }

  if (hasAlias(raw, ['grok-video-3', 'Grok Video 3'])) {
    return {
      apiModel: raw,
      name: raw,
      description: '灵刻/lk666 视频模型 | 文生视频 | 720P | 6/10 秒 | 按条计费',
      features: { ...DEFAULT_FEATURES, textToVideo: true, imageToVideo: false },
      aspectRatios: [...STANDARD_VIDEO_ASPECT_RATIOS],
      defaultAspectRatio: '16:9',
      durations: [
        { value: '6s', label: '6 秒', cost: yuanToPoints(1.3548) },
        { value: '10s', label: '10 秒', cost: yuanToPoints(1.3548) },
      ],
      defaultDuration: '6s',
      videoConfigObject: {
        aspect_ratio: '16:9',
        video_length: 6,
        resolution: '720P',
        preset: 'normal',
        version: '默认分组',
        extra_params: buildExtraParams({
          image_resolution_options: ['720P'],
          version_options: ['默认分组', 'MM默认分组'],
        }),
      },
      billingMode: 'per_call',
      billingPrice: yuanToPoints(1.3548),
      billingUnit: 1,
      pricingRules: buildRules([
        { label: 'grok-video-3 默认分组 720P', duration: '6s', resolution: '720P', version: '默认分组', normalPrice: yuanToPoints(1.3548) },
        { label: 'grok-video-3 默认分组 720P', duration: '10s', resolution: '720P', version: '默认分组', normalPrice: yuanToPoints(1.3548) },
        { label: 'grok-video-3 MM默认分组 720P', duration: '6s', resolution: '720P', version: 'MM默认分组', normalPrice: yuanToPoints(2.1072) },
        { label: 'grok-video-3 MM默认分组 720P', duration: '10s', resolution: '720P', version: 'MM默认分组', normalPrice: yuanToPoints(2.1072) },
      ]),
      imageUrl,
      highlight: true,
    };
  }

  if (raw === 'veo3.1') {
    return {
      apiModel: raw,
      name: raw,
      description: '灵刻/lk666 视频模型 | 文生视频 | 8 秒 | 快速/标准/高质量/多图参考 | 按条计费',
      features: { ...DEFAULT_FEATURES, textToVideo: true, imageToVideo: true },
      aspectRatios: [...ALL_ASPECT_RATIOS],
      defaultAspectRatio: '16:9',
      durations: [{ value: '8s', label: '8 秒', cost: yuanToPoints(2.2578) }],
      defaultDuration: '8s',
      videoConfigObject: {
        aspect_ratio: '16:9',
        video_length: 8,
        resolution: '720P',
        preset: 'normal',
        version: 'DM_默认',
        quality_version: '快速',
        extra_params: buildExtraParams({
          image_resolution_options: ['720P'],
          version_options: ['DM_默认', '限时体验'],
          quality_version_options: ['快速', '标准', '高质量', '多图参考'],
        }),
      },
      billingMode: 'per_call',
      billingPrice: yuanToPoints(2.2578),
      billingUnit: 1,
      pricingRules: buildDurationQualityVersionRules({
        labelPrefix: raw,
        yuanByDurationAndVersion: {
          8: {
            'DM_默认': {
              快速: 2.2578,
              标准: 2.2578,
              高质量: 7.9023,
              多图参考: 2.2578,
            },
            限时体验: {
              快速: 3.0921,
              标准: 3.0921,
              高质量: 15.4605,
              多图参考: 3.0921,
            },
          },
        },
      }),
      imageUrl,
      highlight: true,
    };
  }

  if (raw === 'veo3.1-4K高清') {
    return {
      apiModel: raw,
      name: raw,
      description: '灵刻/lk666 视频模型 | 文生视频 | 8 秒 | 4K | 快速/标准/高质量/多图参考 | 按条计费',
      features: { ...DEFAULT_FEATURES, textToVideo: true, imageToVideo: true },
      aspectRatios: [...ALL_ASPECT_RATIOS],
      defaultAspectRatio: '16:9',
      durations: [{ value: '8s', label: '8 秒', cost: yuanToPoints(2.8224) }],
      defaultDuration: '8s',
      videoConfigObject: {
        aspect_ratio: '16:9',
        video_length: 8,
        resolution: '4K',
        preset: 'normal',
        version: '4KDM_默认',
        quality_version: '快速',
        extra_params: buildExtraParams({
          image_resolution_options: ['4K'],
          version_options: ['4KDM_默认', '限时体验'],
          quality_version_options: ['快速', '标准', '高质量', '多图参考'],
        }),
      },
      billingMode: 'per_call',
      billingPrice: yuanToPoints(2.8224),
      billingUnit: 1,
      pricingRules: buildDurationQualityVersionRules({
        labelPrefix: raw,
        yuanByDurationAndVersion: {
          8: {
            '4KDM_默认': {
              快速: 2.8224,
              标准: 2.8224,
              高质量: 8.4672,
              多图参考: 2.8224,
            },
            限时体验: {
              快速: 1.8999,
              标准: 4.4184,
              高质量: 15.4641,
              多图参考: 4.4184,
            },
          },
        },
      }),
      imageUrl,
      highlight: true,
    };
  }

  if (raw === 'veo3.1-lite') {
    return {
      apiModel: raw,
      name: raw,
      description: '灵刻/lk666 视频模型 | 文生视频 | 支持 8 秒 | 默认 16:9 | 按条计费',
      features: { ...DEFAULT_FEATURES, textToVideo: true, imageToVideo: false },
      aspectRatios: [...ALL_ASPECT_RATIOS],
      defaultAspectRatio: '16:9',
      durations: [
        { value: '8s', label: '8 秒', cost: yuanToPoints(0.5268) },
      ],
      defaultDuration: '8s',
      videoConfigObject: {
        aspect_ratio: '16:9',
        video_length: 8,
        resolution: 'SD',
        preset: 'normal',
        model_version: 'lite',
        extra_params: buildExtraParams({
          image_resolution_options: ['SD', '4K'],
          billing_note: 'veo3.1-lite 当前上游为按次计费，不同渠道存在默认分组 / 限时体验差异。',
        }),
      },
      billingMode: 'per_call',
      billingPrice: yuanToPoints(0.5268),
      billingUnit: 1,
      pricingRules: buildRules([
        { label: 'veo3.1-lite 默认分组 标清', duration: '8s', resolution: 'SD', normalPrice: yuanToPoints(0.4704) },
        { label: 'veo3.1-lite 默认分组 4K', duration: '8s', resolution: '4K', normalPrice: yuanToPoints(0.5174) },
        { label: 'veo3.1-lite 限时体验 标清', duration: '8s', resolution: 'SD', version: '限时体验', normalPrice: yuanToPoints(0.6586) },
        { label: 'veo3.1-lite 限时体验 4K', duration: '8s', resolution: '4K', version: '限时体验', normalPrice: yuanToPoints(0.7245) },
      ]),
      imageUrl,
      highlight: true,
    };
  }

  if (raw === 'omni-flash') {
    return {
      apiModel: raw,
      name: raw,
      description: '灵刻/lk666 视频模型 | 文生视频/多图参考 | 支持 6/8/10 秒 | 默认 16:9 | 按条计费',
      features: { ...DEFAULT_FEATURES, textToVideo: true, imageToVideo: true },
      aspectRatios: [
        { value: '16:9', label: '16:9' },
        { value: '9:16', label: '9:16' },
      ],
      defaultAspectRatio: '16:9',
      durations: [
        { value: '10s', label: '10 秒', cost: yuanToPoints(2.4461) },
      ],
      defaultDuration: '10s',
      videoConfigObject: {
        aspect_ratio: '16:9',
        video_length: 10,
        resolution: '720P',
        preset: 'normal',
        generation_mode: 'omni_flash',
        extra_params: buildExtraParams({
          upload_mode: 'reference',
          min_reference_image_count: 1,
          max_reference_image_count: 3,
          reference_image_count_options: ['1', '2', '3'],
          default_reference_image_count: 1,
          image_resolution_options: ['720P', '1080P'],
          billing_note: 'omni-flash 当前上游展示默认单次价格。',
        }),
      },
      billingMode: 'per_call',
      billingPrice: yuanToPoints(2.4461),
      billingUnit: 1,
      pricingRules: buildRules([
        { label: 'omni-flash 默认价格', duration: '10s', generationMode: 'omni_flash', normalPrice: yuanToPoints(2.4461) },
      ]),
      imageUrl,
      highlight: true,
    };
  }

  if (hasAlias(raw, ['快乐马-文生视频', 'HappyHorse-Text-to-video'])) {
    return {
      apiModel: raw,
      name: raw,
      description: '灵刻/lk666 视频模型 | 文生视频 | 支持 3-15 秒 | 720P/1080P | 默认 16:9',
      features: { ...DEFAULT_FEATURES, textToVideo: true, imageToVideo: false },
      aspectRatios: [...ALL_ASPECT_RATIOS],
      defaultAspectRatio: '16:9',
      durations: makeDurationOptionsFromPointMap({
        3: yuanToPoints(0.6435 * 3),
        5: yuanToPoints(0.6435 * 5),
        8: yuanToPoints(0.6435 * 8),
        10: yuanToPoints(0.6435 * 10),
        15: yuanToPoints(0.6435 * 15),
      }),
      defaultDuration: '8s',
      videoConfigObject: {
        aspect_ratio: '16:9',
        video_length: 8,
        resolution: '720P',
        preset: 'normal',
        extra_params: buildExtraParams({
          image_resolution_options: ['720P', '1080P'],
          billing_note: '快乐马文生视频上游为按秒计费，支持 720P / 1080P。',
        }),
      },
      billingMode: 'per_second',
      billingPrice: yuanToPoints(0.6435),
      billingUnit: 1,
      pricingRules: buildPerSecondResolutionRules({
        labelPrefix: raw,
        durations: [3, 5, 8, 10, 15],
        perSecondYuanByResolution: {
          '720P': 0.6435,
          '1080P': 1.144,
        },
      }),
      imageUrl,
      highlight: true,
    };
  }

  if (hasAlias(raw, ['快乐马-首帧', 'HappyHorse-First Frame'])) {
    return {
      apiModel: raw,
      name: raw,
      description: '灵刻/lk666 视频模型 | 图生视频 | 支持 3-15 秒 | 720P/1080P | 默认 16:9',
      features: { ...DEFAULT_FEATURES, textToVideo: true, imageToVideo: true },
      aspectRatios: [...ALL_ASPECT_RATIOS],
      defaultAspectRatio: '16:9',
      durations: makeDurationOptionsFromPointMap({
        3: yuanToPoints(0.6435 * 3),
        5: yuanToPoints(0.6435 * 5),
        8: yuanToPoints(0.6435 * 8),
        10: yuanToPoints(0.6435 * 10),
        15: yuanToPoints(0.6435 * 15),
      }),
      defaultDuration: '8s',
      videoConfigObject: {
        aspect_ratio: '16:9',
        video_length: 8,
        resolution: '720P',
        preset: 'normal',
        extra_params: buildExtraParams({
          upload_mode: 'first_frame',
          image_resolution_options: ['720P', '1080P'],
        }),
      },
      billingMode: 'per_second',
      billingPrice: yuanToPoints(0.6435),
      billingUnit: 1,
      pricingRules: buildPerSecondResolutionRules({
        labelPrefix: raw,
        durations: [3, 5, 8, 10, 15],
        perSecondYuanByResolution: {
          '720P': 0.6435,
          '1080P': 1.144,
        },
      }),
      imageUrl,
      highlight: true,
    };
  }

  if (hasAlias(raw, ['快乐马-参考生', 'HappyHorse-Reference-to-Video'])) {
    return {
      apiModel: raw,
      name: raw,
      description: '灵刻/lk666 视频模型 | 图生视频 | 支持 3-15 秒 | 720P/1080P | 默认 16:9',
      features: { ...DEFAULT_FEATURES, textToVideo: true, imageToVideo: true },
      aspectRatios: [...ALL_ASPECT_RATIOS],
      defaultAspectRatio: '16:9',
      durations: makeDurationOptionsFromPointMap({
        3: yuanToPoints(0.6435 * 3),
        5: yuanToPoints(0.6435 * 5),
        8: yuanToPoints(0.6435 * 8),
        10: yuanToPoints(0.6435 * 10),
        15: yuanToPoints(0.6435 * 15),
      }),
      defaultDuration: '8s',
      videoConfigObject: {
        aspect_ratio: '16:9',
        video_length: 8,
        resolution: '720P',
        preset: 'normal',
        extra_params: buildExtraParams({
          upload_mode: 'reference',
          image_resolution_options: ['720P', '1080P'],
          min_reference_image_count: 1,
          max_reference_image_count: 4,
          reference_image_count_options: ['1', '2', '3', '4'],
          default_reference_image_count: 1,
        }),
      },
      billingMode: 'per_second',
      billingPrice: yuanToPoints(0.6435),
      billingUnit: 1,
      pricingRules: buildPerSecondResolutionRules({
        labelPrefix: raw,
        durations: [3, 5, 8, 10, 15],
        perSecondYuanByResolution: {
          '720P': 0.6435,
          '1080P': 1.144,
        },
      }),
      imageUrl,
      highlight: false,
    };
  }

  if (hasAlias(raw, ['快乐马-视频编辑', 'HappyHorse-Video Editing'])) {
    return {
      apiModel: raw,
      name: raw,
      description: '灵刻/lk666 视频模型 | 视频编辑 | 支持 8-15 秒 | 默认 16:9 | 特殊计费',
      features: { ...DEFAULT_FEATURES, textToVideo: false, imageToVideo: false, videoToVideo: true },
      aspectRatios: [...STANDARD_VIDEO_ASPECT_RATIOS],
      defaultAspectRatio: '16:9',
      durations: makeDurationOptionsFromPointMap({
        8: yuanToPoints(0.6435 * 8),
        10: yuanToPoints(0.6435 * 10),
        15: yuanToPoints(0.6435 * 15),
      }),
      defaultDuration: '8s',
      videoConfigObject: {
        aspect_ratio: '16:9',
        video_length: 8,
        resolution: '720P',
        preset: 'normal',
        extra_params: buildExtraParams({
          upload_mode: 'video_edit',
          image_resolution_options: ['720P', '1080P'],
          billing_note: '快乐马-视频编辑上游为按秒计费，实际扣费按输入视频时长 + 输出视频时长合计。',
        }),
      },
      billingMode: 'per_second',
      billingPrice: yuanToPoints(0.6435),
      billingUnit: 1,
      pricingRules: buildPerSecondResolutionRules({
        labelPrefix: raw,
        durations: [8, 10, 15],
        perSecondYuanByResolution: {
          '720P': 0.6435,
          '1080P': 1.144,
        },
      }),
      imageUrl,
      highlight: true,
    };
  }

  if (hasAlias(raw, ['VIDU-解说漫', 'Vidu-Narrated Comic'])) {
    return {
      apiModel: raw,
      name: raw,
      description: '灵刻/lk666 视频模型 | 图生视频 | 720P/1080P | 多参考图 | 按成片秒数计费',
      features: { ...DEFAULT_FEATURES, textToVideo: true, imageToVideo: true },
      aspectRatios: [...STANDARD_VIDEO_ASPECT_RATIOS],
      defaultAspectRatio: '16:9',
      durations: makeDurationOptionsFromPointMap({
        8: yuanToPoints(0.6469 * 8),
        10: yuanToPoints(0.6469 * 10),
        15: yuanToPoints(0.6469 * 15),
      }),
      defaultDuration: '8s',
      videoConfigObject: {
        aspect_ratio: '16:9',
        video_length: 8,
        resolution: '720P',
        preset: 'normal',
        model_version: 'standard',
        quality_version: 'standard',
        extra_params: buildExtraParams({
          upload_mode: 'reference',
          image_resolution_options: ['720P', '1080P'],
          min_reference_image_count: 1,
          max_reference_image_count: 7,
          reference_image_count_options: ['1', '2', '3', '4', '5', '6', '7'],
          default_reference_image_count: 1,
          billing_note: 'VIDU-解说漫按实际成片秒数计费。',
        }),
      },
      billingMode: 'per_second',
      billingPrice: yuanToPoints(0.6469),
      billingUnit: 1,
      pricingRules: buildPerSecondResolutionRules({
        labelPrefix: raw,
        durations: [8, 10, 15],
        perSecondYuanByResolution: {
          '720P': 0.6469,
          '1080P': 0.6469,
        },
      }),
      imageUrl,
      highlight: false,
    };
  }

  if (hasAlias(raw, ['Vidu Q3', 'Vidu Q3 Text-to-Video'])) {
    const baseByModelVersion = {
      'TX-Y3': {
        4: { '540P': 2.2524, '720P': 3.7389, '1080P': 4.5048 },
        8: { '540P': 4.5048, '720P': 7.4781, '1080P': 9.0096 },
        12: { '540P': 6.7572, '720P': 11.217, '1080P': 13.5144 },
        16: { '540P': 9.0096, '720P': 14.9559, '1080P': 18.0192 },
      },
      'TX-Y5': {
        4: { '540P': 3.387, '720P': 5.0805, '1080P': 6.0966 },
        8: { '540P': 6.774, '720P': 10.161, '1080P': 12.1932 },
        12: { '540P': 10.161, '720P': 15.2415, '1080P': 18.2898 },
        16: { '540P': 13.548, '720P': 20.322, '1080P': 24.3864 },
      },
    } as const;
    const highQualityMultiplier: Record<string, number> = {
      'TX-Y3': 1.88,
      'TX-Y5': 2.09,
    };
    const rows: Array<{
      label: string;
      duration: string;
      resolution: string;
      qualityVersion: string;
      modelVersion: string;
      offPeak?: boolean;
      normalPrice: number;
    }> = [];

    for (const [modelVersion, durationMap] of Object.entries(baseByModelVersion)) {
      for (const [seconds, resolutionMap] of Object.entries(durationMap as Record<string, Record<string, number>>)) {
        for (const [resolution, yuan] of Object.entries(resolutionMap as Record<string, number>)) {
          rows.push({
            label: `${raw} ${modelVersion} 标准 ${resolution} ${seconds}s`,
            duration: `${seconds}s`,
            resolution,
            qualityVersion: '标准',
            modelVersion,
            normalPrice: yuanToPoints(yuan),
          });
          rows.push({
            label: `${raw} ${modelVersion} 标准 错峰 ${resolution} ${seconds}s`,
            duration: `${seconds}s`,
            resolution,
            qualityVersion: '标准',
            modelVersion,
            offPeak: true,
            normalPrice: yuanToPoints(yuan * 0.5),
          });
          rows.push({
            label: `${raw} ${modelVersion} 高质量 ${resolution} ${seconds}s`,
            duration: `${seconds}s`,
            resolution,
            qualityVersion: '高质量',
            modelVersion,
            normalPrice: yuanToPoints(yuan * (highQualityMultiplier[modelVersion] || 1)),
          });
          rows.push({
            label: `${raw} ${modelVersion} 高质量 错峰 ${resolution} ${seconds}s`,
            duration: `${seconds}s`,
            resolution,
            qualityVersion: '高质量',
            modelVersion,
            offPeak: true,
            normalPrice: yuanToPoints(yuan * (highQualityMultiplier[modelVersion] || 1) * 0.5),
          });
        }
      }
    }

    return {
      apiModel: raw,
      name: raw,
      description: '灵刻/lk666 视频模型 | 文生视频 | 支持 4-16 秒 | 540P/720P/1080P | 按条计费',
      features: { ...DEFAULT_FEATURES, textToVideo: true, imageToVideo: false },
      aspectRatios: [...STANDARD_VIDEO_ASPECT_RATIOS],
      defaultAspectRatio: '16:9',
      durations: makeDurationOptionsFromPointMap({
        4: yuanToPoints(3.7389),
        8: yuanToPoints(7.4781),
        12: yuanToPoints(11.217),
        16: yuanToPoints(14.9559),
      }),
      defaultDuration: '8s',
      videoConfigObject: {
        aspect_ratio: '16:9',
        video_length: 8,
        resolution: '720P',
        preset: 'normal',
        model_version: 'TX-Y3',
        quality_version: '标准',
        off_peak: false,
        extra_params: buildExtraParams({
          image_resolution_options: ['540P', '720P', '1080P'],
          model_version_options: ['TX-Y3', 'TX-Y5'],
          quality_version_options: ['标准', '高质量'],
          billing_note: 'Vidu Q3：TX-Y3 高质量为基价×1.88，TX-Y5 高质量为基价×2.09，错峰模式为基价×0.5。',
        }),
      },
      billingMode: 'per_call',
      billingPrice: yuanToPoints(7.4781),
      billingUnit: 1,
      pricingRules: buildRules(rows),
      imageUrl,
      highlight: true,
    };
  }

  if (hasAlias(raw, ['Vidu Q3 参考生', 'Vidu Q3 Reference-to-Video'])) {
    const baseByModelVersion = {
      'Vidu官方默认': {
        4: { '540P': 3.8838, '720P': 7.7673, '1080P': 11.6532 },
        8: { '540P': 7.7673, '720P': 15.5346, '1080P': 23.3067 },
        12: { '540P': 11.6511, '720P': 23.3019, '1080P': 34.9599 },
        16: { '540P': 15.5346, '720P': 31.0692, '1080P': 46.6131 },
      },
      'TX-Y5': {
        4: { '540P': 4.2405, '720P': 8.481, '1080P': 10.6014 },
        8: { '540P': 8.481, '720P': 16.962, '1080P': 21.2025 },
        12: { '540P': 12.7215, '720P': 25.443, '1080P': 31.8039 },
        16: { '540P': 16.962, '720P': 33.924, '1080P': 42.405 },
      },
    } as const;
    const rows: Array<{
      label: string;
      duration: string;
      resolution: string;
      modelVersion: string;
      version: string;
      offPeak?: boolean;
      normalPrice: number;
    }> = [];

    for (const [modelVersion, durationMap] of Object.entries(baseByModelVersion)) {
      for (const [seconds, resolutionMap] of Object.entries(durationMap as Record<string, Record<string, number>>)) {
        for (const [resolution, yuan] of Object.entries(resolutionMap as Record<string, number>)) {
          rows.push({
            label: `${raw} ${modelVersion} 标准 ${resolution} ${seconds}s`,
            duration: `${seconds}s`,
            resolution,
            modelVersion,
            version: '标准',
            normalPrice: yuanToPoints(yuan),
          });
          rows.push({
            label: `${raw} ${modelVersion} 标准 错峰 ${resolution} ${seconds}s`,
            duration: `${seconds}s`,
            resolution,
            modelVersion,
            version: '标准',
            offPeak: true,
            normalPrice: yuanToPoints(yuan * 0.5),
          });
          rows.push({
            label: `${raw} ${modelVersion} 全能版 ${resolution} ${seconds}s`,
            duration: `${seconds}s`,
            resolution,
            modelVersion,
            version: '全能版',
            normalPrice: yuanToPoints(yuan * 1.25),
          });
          rows.push({
            label: `${raw} ${modelVersion} 全能版 错峰 ${resolution} ${seconds}s`,
            duration: `${seconds}s`,
            resolution,
            modelVersion,
            version: '全能版',
            offPeak: true,
            normalPrice: yuanToPoints(yuan * 1.25 * 0.5),
          });
        }
      }
    }

    return {
      apiModel: raw,
      name: raw,
      description: '灵刻/lk666 视频模型 | 图生视频 | 支持 4-16 秒 | 540P/720P/1080P | 按条计费',
      features: { ...DEFAULT_FEATURES, textToVideo: true, imageToVideo: true },
      aspectRatios: [...STANDARD_VIDEO_ASPECT_RATIOS],
      defaultAspectRatio: '16:9',
      durations: makeDurationOptionsFromPointMap({
        4: yuanToPoints(7.7673),
        8: yuanToPoints(15.5346),
        12: yuanToPoints(23.3019),
        16: yuanToPoints(31.0692),
      }),
      defaultDuration: '8s',
      videoConfigObject: {
        aspect_ratio: '16:9',
        video_length: 8,
        resolution: '720P',
        preset: 'normal',
        model_version: 'Vidu官方默认',
        version: '标准',
        off_peak: false,
        extra_params: buildExtraParams({
          upload_mode: 'reference',
          image_resolution_options: ['540P', '720P', '1080P'],
          min_reference_image_count: 1,
          max_reference_image_count: 4,
          reference_image_count_options: ['1', '2', '3', '4'],
          default_reference_image_count: 1,
          model_version_options: ['Vidu官方默认', 'TX-Y5'],
          version_options: ['标准', '全能版'],
          billing_note: 'Vidu Q3 参考生：全能版为基价×1.25，错峰模式为基价×0.5。',
        }),
      },
      billingMode: 'per_call',
      billingPrice: yuanToPoints(15.5346),
      billingUnit: 1,
      pricingRules: buildRules(rows),
      imageUrl,
      highlight: true,
    };
  }

  if (hasAlias(raw, ['万相 2.7 视频续写', 'Wanxiang 2.7 Video Extension'])) {
    return {
      apiModel: raw,
      name: raw,
      description: '灵刻/lk666 视频模型 | 视频续写 | 支持 8-15 秒 | 默认 16:9',
      features: { ...DEFAULT_FEATURES, textToVideo: false, imageToVideo: false, videoToVideo: true },
      aspectRatios: [...STANDARD_VIDEO_ASPECT_RATIOS],
      defaultAspectRatio: '16:9',
      durations: makeDurationOptionsFromPointMap({
        3: yuanToPoints(1.6934),
        6: yuanToPoints(3.3868),
        9: yuanToPoints(5.0802),
        12: yuanToPoints(6.7736),
        15: yuanToPoints(8.467),
      }),
      defaultDuration: '8s',
      videoConfigObject: {
        aspect_ratio: '16:9',
        video_length: 8,
        resolution: '720P',
        preset: 'normal',
        extra_params: buildExtraParams({
          upload_mode: 'video_continue',
          image_resolution_options: ['720P', '1080P'],
        }),
      },
      billingMode: 'per_call',
      billingPrice: yuanToPoints(6.7736),
      billingUnit: 1,
      pricingRules: buildDurationResolutionRules({
        labelPrefix: raw,
        yuanByDurationAndResolution: {
          3: { '720P': 1.6934, '1080P': 2.8224 },
          6: { '720P': 3.3868, '1080P': 5.6448 },
          9: { '720P': 5.0802, '1080P': 8.4672 },
          12: { '720P': 6.7736, '1080P': 11.2896 },
          15: { '720P': 8.467, '1080P': 14.1119 },
        },
      }),
      imageUrl,
      highlight: true,
    };
  }

  if (hasAlias(raw, ['万相 2.7 参考生', 'Wanxiang 2.7 Reference-to-Video'])) {
    return {
      apiModel: raw,
      name: raw,
      description: '灵刻/lk666 视频模型 | 图生视频 | 支持 8-15 秒 | 默认 16:9',
      features: { ...DEFAULT_FEATURES, textToVideo: true, imageToVideo: true },
      aspectRatios: [...STANDARD_VIDEO_ASPECT_RATIOS],
      defaultAspectRatio: '16:9',
      durations: makeDurationOptionsFromPointMap({
        3: yuanToPoints(1.6934),
        6: yuanToPoints(3.3868),
        9: yuanToPoints(5.0802),
        12: yuanToPoints(6.7736),
        15: yuanToPoints(8.467),
      }),
      defaultDuration: '8s',
      videoConfigObject: {
        aspect_ratio: '16:9',
        video_length: 8,
        resolution: '720P',
        preset: 'normal',
        extra_params: buildExtraParams({
          upload_mode: 'reference',
          image_resolution_options: ['720P', '1080P'],
          min_reference_image_count: 1,
          max_reference_image_count: 4,
          reference_image_count_options: ['1', '2', '3', '4'],
          default_reference_image_count: 1,
        }),
      },
      billingMode: 'per_call',
      billingPrice: yuanToPoints(6.7736),
      billingUnit: 1,
      pricingRules: buildDurationResolutionRules({
        labelPrefix: raw,
        yuanByDurationAndResolution: {
          3: { '720P': 1.6934, '1080P': 2.8224 },
          6: { '720P': 3.3868, '1080P': 5.6448 },
          9: { '720P': 5.0802, '1080P': 8.4672 },
          12: { '720P': 6.7736, '1080P': 11.2896 },
          15: { '720P': 8.467, '1080P': 14.1119 },
        },
      }),
      imageUrl,
      highlight: true,
    };
  }

  if (hasAlias(raw, ['万相 2.7 首尾帧', 'Wanxiang 2.7 First/Last Frames'])) {
    return {
      apiModel: raw,
      name: raw,
      description: '灵刻/lk666 视频模型 | 首尾帧视频 | 支持 8-15 秒 | 默认 16:9',
      features: { ...DEFAULT_FEATURES, textToVideo: true, imageToVideo: true },
      aspectRatios: [...STANDARD_VIDEO_ASPECT_RATIOS],
      defaultAspectRatio: '16:9',
      durations: makeDurationOptionsFromPointMap({
        3: yuanToPoints(1.6934),
        6: yuanToPoints(3.3868),
        9: yuanToPoints(5.0802),
        12: yuanToPoints(6.7736),
        15: yuanToPoints(8.467),
      }),
      defaultDuration: '8s',
      videoConfigObject: {
        aspect_ratio: '16:9',
        video_length: 8,
        resolution: '720P',
        preset: 'normal',
        extra_params: buildExtraParams({
          upload_mode: 'first_last_frame',
          image_resolution_options: ['720P', '1080P'],
        }),
      },
      billingMode: 'per_call',
      billingPrice: yuanToPoints(6.7736),
      billingUnit: 1,
      pricingRules: buildDurationResolutionRules({
        labelPrefix: raw,
        yuanByDurationAndResolution: {
          3: { '720P': 1.6934, '1080P': 2.8224 },
          6: { '720P': 3.3868, '1080P': 5.6448 },
          9: { '720P': 5.0802, '1080P': 8.4672 },
          12: { '720P': 6.7736, '1080P': 11.2896 },
          15: { '720P': 8.467, '1080P': 14.1119 },
        },
      }),
      imageUrl,
      highlight: false,
    };
  }

  if (hasAliasIncludes(raw, ['pix c1 参考生', 'pix c1 reference-to-video'])) {
    const baseByVersion = {
      '官方直连': {
        3: { '360P': 3.2544, '540P': 4.068, '720P': 5.2884, '1080P': 9.6276 },
        6: { '360P': 6.5088, '540P': 8.136, '720P': 10.5768, '1080P': 19.2552 },
        9: { '360P': 9.7632, '540P': 12.204, '720P': 15.8652, '1080P': 28.8828 },
        12: { '360P': 13.0176, '540P': 16.272, '720P': 21.1536, '1080P': 38.5104 },
        15: { '360P': 16.272, '540P': 20.34, '720P': 26.442, '1080P': 48.138 },
      },
      'PIX-默认': {
        3: { '360P': 2.5776, '540P': 3.222, '720P': 4.1886, '1080P': 7.7328 },
        6: { '360P': 5.1552, '540P': 6.444, '720P': 8.3772, '1080P': 15.4656 },
        9: { '360P': 7.7328, '540P': 9.666, '720P': 12.5658, '1080P': 23.1984 },
        12: { '360P': 10.3104, '540P': 12.888, '720P': 16.7544, '1080P': 30.9312 },
        15: { '360P': 12.888, '540P': 16.11, '720P': 20.943, '1080P': 38.664 },
      },
    } as const;

    const rows: Array<{
      label: string;
      duration: string;
      resolution: string;
      version: string;
      normalPrice: number;
    }> = [];

    for (const [version, durationMap] of Object.entries(baseByVersion)) {
      for (const [seconds, resolutionMap] of Object.entries(durationMap as Record<string, Record<string, number>>)) {
        for (const [resolution, yuan] of Object.entries(resolutionMap as Record<string, number>)) {
          rows.push({
            label: `${raw} ${version} ${resolution} ${seconds}s`,
            duration: `${seconds}s`,
            resolution,
            version,
            normalPrice: yuanToPoints(yuan),
          });
        }
      }
    }

    return {
      apiModel: raw,
      name: raw,
      description: '灵刻/lk666 视频模型 | 图生视频 | 官方直连/PIX-默认 | 1-7 参考图 | 360P-1080P | 3-15 秒 | 按条计费',
      features: { ...DEFAULT_FEATURES, textToVideo: true, imageToVideo: true },
      aspectRatios: [...STANDARD_VIDEO_ASPECT_RATIOS],
      defaultAspectRatio: '16:9',
      durations: makeDurationOptionsFromPointMap({
        3: yuanToPoints(5.2884),
        6: yuanToPoints(10.5768),
        9: yuanToPoints(15.8652),
        12: yuanToPoints(21.1536),
        15: yuanToPoints(26.442),
      }),
      defaultDuration: '6s',
      videoConfigObject: {
        aspect_ratio: '16:9',
        video_length: 6,
        resolution: '720P',
        preset: 'normal',
        version: '官方直连',
        extra_params: buildExtraParams({
          upload_mode: 'reference',
          image_resolution_options: ['360P', '540P', '720P', '1080P'],
          min_reference_image_count: 1,
          max_reference_image_count: 7,
          reference_image_count_options: ['1', '2', '3', '4', '5', '6', '7'],
          default_reference_image_count: 1,
          version_options: ['官方直连', 'PIX-默认'],
          billing_note: 'Pix C1 参考生按分组 + 分辨率 + 时长计费。',
        }),
      },
      billingMode: 'per_call',
      billingPrice: yuanToPoints(10.5768),
      billingUnit: 1,
      pricingRules: buildRules(rows),
      imageUrl,
      highlight: false,
    };
  }

  if (hasAliasIncludes(raw, ['pix c1 首尾帧', 'pix c1 first/last frames'])) {
    return {
      apiModel: raw,
      name: raw,
      description: '灵刻/lk666 视频模型 | 首尾帧视频 | 360P-1080P | 3-15 秒 | 按条计费',
      features: { ...DEFAULT_FEATURES, textToVideo: true, imageToVideo: true },
      aspectRatios: [...STANDARD_VIDEO_ASPECT_RATIOS],
      defaultAspectRatio: '16:9',
      durations: makeDurationOptionsFromPointMap({
        3: yuanToPoints(1.7628),
        6: yuanToPoints(3.5256),
        9: yuanToPoints(5.2884),
        12: yuanToPoints(7.0512),
        15: yuanToPoints(8.814),
      }),
      defaultDuration: '6s',
      videoConfigObject: {
        aspect_ratio: '16:9',
        video_length: 6,
        resolution: '720P',
        preset: 'normal',
        extra_params: buildExtraParams({
          upload_mode: 'first_last_frame',
          image_resolution_options: ['360P', '540P', '720P', '1080P'],
        }),
      },
      billingMode: 'per_call',
      billingPrice: yuanToPoints(3.5256),
      billingUnit: 1,
      pricingRules: buildDurationResolutionRules({
        labelPrefix: raw,
        yuanByDurationAndResolution: {
          3: { '360P': 1.0848, '540P': 1.356, '720P': 1.7628, '1080P': 3.2092 },
          6: { '360P': 2.1696, '540P': 2.712, '720P': 3.5256, '1080P': 6.4184 },
          9: { '360P': 3.2544, '540P': 4.068, '720P': 5.2884, '1080P': 9.6276 },
          12: { '360P': 4.3392, '540P': 5.424, '720P': 7.0512, '1080P': 12.8368 },
          15: { '360P': 5.424, '540P': 6.78, '720P': 8.814, '1080P': 16.046 },
        },
      }),
      imageUrl,
      highlight: false,
    };
  }

  if (hasAliasIncludes(raw, ['pix v6 首尾帧', 'pix v6 first/last frames'])) {
    return {
      apiModel: raw,
      name: raw,
      description: '灵刻/lk666 视频模型 | 首尾帧视频 | 360P-1080P | 按秒计费',
      features: { ...DEFAULT_FEATURES, textToVideo: true, imageToVideo: true },
      aspectRatios: [...STANDARD_VIDEO_ASPECT_RATIOS],
      defaultAspectRatio: '16:9',
      durations: makeDurationOptionsFromPointMap({
        3: yuanToPoints(0.4361 * 3),
        5: yuanToPoints(0.4361 * 5),
        8: yuanToPoints(0.4361 * 8),
        10: yuanToPoints(0.4361 * 10),
        15: yuanToPoints(0.4361 * 15),
      }),
      defaultDuration: '8s',
      videoConfigObject: {
        aspect_ratio: '16:9',
        video_length: 8,
        resolution: '720P',
        preset: 'normal',
        extra_params: buildExtraParams({
          upload_mode: 'first_last_frame',
          image_resolution_options: ['360P', '540P', '720P', '1080P'],
        }),
      },
      billingMode: 'per_second',
      billingPrice: yuanToPoints(0.4361),
      billingUnit: 1,
      pricingRules: buildPerSecondResolutionRules({
        labelPrefix: raw,
        durations: [3, 5, 8, 10, 15],
        perSecondYuanByResolution: {
          '360P': 0.3161,
          '540P': 0.3641,
          '720P': 0.4361,
          '1080P': 0.6921,
        },
      }),
      imageUrl,
      highlight: false,
    };
  }

  if (hasAliasIncludes(raw, ['pix v5.6 首尾帧', 'pix v5.6 first/last frames'])) {
    return {
      apiModel: raw,
      name: raw,
      description: '灵刻/lk666 视频模型 | 首尾帧视频 | 360P-1080P | 按秒计费',
      features: { ...DEFAULT_FEATURES, textToVideo: true, imageToVideo: true },
      aspectRatios: [...STANDARD_VIDEO_ASPECT_RATIOS],
      defaultAspectRatio: '16:9',
      durations: makeDurationOptionsFromPointMap({
        3: yuanToPoints(0.7555 * 3),
        5: yuanToPoints(0.7555 * 5),
        8: yuanToPoints(0.7555 * 8),
        10: yuanToPoints(0.7555 * 10),
        15: yuanToPoints(0.7555 * 15),
      }),
      defaultDuration: '8s',
      videoConfigObject: {
        aspect_ratio: '16:9',
        video_length: 8,
        resolution: '720P',
        preset: 'normal',
        extra_params: buildExtraParams({
          upload_mode: 'first_last_frame',
          image_resolution_options: ['360P', '540P', '720P', '1080P'],
        }),
      },
      billingMode: 'per_second',
      billingPrice: yuanToPoints(0.7555),
      billingUnit: 1,
      pricingRules: buildPerSecondResolutionRules({
        labelPrefix: raw,
        durations: [3, 5, 8, 10, 15],
        perSecondYuanByResolution: {
          '360P': 0.7075,
          '540P': 0.7075,
          '720P': 0.7555,
          '1080P': 0.8915,
        },
      }),
      imageUrl,
      highlight: false,
    };
  }

  if (hasAliasIncludes(raw, ['pix v5.6 参考生', 'pix v5.6 reference-to-video'])) {
    return {
      apiModel: raw,
      name: raw,
      description: '灵刻/lk666 视频模型 | 图生视频 | 360P-1080P | 按秒计费',
      features: { ...DEFAULT_FEATURES, textToVideo: true, imageToVideo: true },
      aspectRatios: [...STANDARD_VIDEO_ASPECT_RATIOS],
      defaultAspectRatio: '16:9',
      durations: makeDurationOptionsFromPointMap({
        3: yuanToPoints(0.7555 * 3),
        5: yuanToPoints(0.7555 * 5),
        8: yuanToPoints(0.7555 * 8),
        10: yuanToPoints(0.7555 * 10),
        15: yuanToPoints(0.7555 * 15),
      }),
      defaultDuration: '8s',
      videoConfigObject: {
        aspect_ratio: '16:9',
        video_length: 8,
        resolution: '720P',
        preset: 'normal',
        extra_params: buildExtraParams({
          upload_mode: 'reference',
          image_resolution_options: ['360P', '540P', '720P', '1080P'],
          min_reference_image_count: 1,
          max_reference_image_count: 4,
          reference_image_count_options: ['1', '2', '3', '4'],
          default_reference_image_count: 1,
        }),
      },
      billingMode: 'per_second',
      billingPrice: yuanToPoints(0.7555),
      billingUnit: 1,
      pricingRules: buildPerSecondResolutionRules({
        labelPrefix: raw,
        durations: [3, 5, 8, 10, 15],
        perSecondYuanByResolution: {
          '360P': 0.7075,
          '540P': 0.7075,
          '720P': 0.7555,
          '1080P': 0.8915,
        },
      }),
      imageUrl,
      highlight: false,
    };
  }

  if (hasAlias(raw, ['可灵-动作控制 V3', 'Kling-Motion Control V3'])) {
    return {
      apiModel: raw,
      name: raw,
      description: '灵刻/lk666 视频模型 | 动作控制 | 标准/专家模式 | 按秒计费 | 默认 16:9',
      features: { ...DEFAULT_FEATURES, textToVideo: true, imageToVideo: true },
      aspectRatios: [...STANDARD_VIDEO_ASPECT_RATIOS],
      defaultAspectRatio: '16:9',
      durations: makeDurationOptionsFromPointMap({
        5: yuanToPoints(1.2955 * 5),
        10: yuanToPoints(1.2955 * 10),
        15: yuanToPoints(1.2955 * 15),
      }),
      defaultDuration: '5s',
      videoConfigObject: {
        aspect_ratio: '16:9',
        video_length: 5,
        resolution: '720P',
        preset: 'normal',
        generation_mode: '标准模式',
        extra_params: buildExtraParams({
          upload_mode: 'motion_control',
          image_resolution_options: ['720P', '1080P'],
        }),
      },
      billingMode: 'per_second',
      billingPrice: yuanToPoints(1.2955),
      billingUnit: 1,
      pricingRules: buildPerSecondQualityRules({
        labelPrefix: raw,
        durations: [5, 10, 15],
        perSecondYuanByQuality: {
          '标准模式': 1.2955,
          '专家模式': 1.7273,
        },
      }),
      imageUrl,
      highlight: false,
    };
  }

  if (hasAlias(raw, ['可灵-Omni 视频参考', 'Kling-Omni Video Reference'])) {
    return {
      apiModel: raw,
      name: raw,
      description: '灵刻/lk666 视频模型 | 视频参考 | 标准/高品质 | 按秒计费 | 默认 16:9',
      features: { ...DEFAULT_FEATURES, textToVideo: false, imageToVideo: false, videoToVideo: true },
      aspectRatios: [...STANDARD_VIDEO_ASPECT_RATIOS],
      defaultAspectRatio: '16:9',
      durations: makeDurationOptionsFromPointMap({
        5: yuanToPoints(1.4394 * 5),
        10: yuanToPoints(1.4394 * 10),
        15: yuanToPoints(1.4394 * 15),
      }),
      defaultDuration: '5s',
      videoConfigObject: {
        aspect_ratio: '16:9',
        video_length: 5,
        resolution: '720P',
        preset: 'normal',
        quality_version: '标准',
        extra_params: buildExtraParams({
          upload_mode: 'video_reference',
          image_resolution_options: ['720P', '1080P'],
          billing_note: '可灵-Omni 视频参考按秒计费。',
        }),
      },
      billingMode: 'per_second',
      billingPrice: yuanToPoints(1.4394),
      billingUnit: 1,
      pricingRules: buildPerSecondQualityRules({
        labelPrefix: raw,
        durations: [5, 10, 15],
        perSecondYuanByQuality: {
          '标准': 1.4394,
          '高品质': 1.9192,
        },
      }),
      imageUrl,
      highlight: false,
    };
  }

  if (hasAlias(raw, ['可灵-Omni 参考生', 'Kling-Omni Reference-to-Video'])) {
    const baseByModelVersion = {
      '默认分组': {
        5: { '标准': 19.1922, '高品质': 23.9904 },
        10: { '标准': 38.3844, '高品质': 47.9805 },
        15: { '标准': 57.5766, '高品质': 71.9709 },
      },
      'TX-Y3': {
        5: { '标准': 11.2839, '高品质': 14.1048 },
        10: { '标准': 22.5678, '高品质': 28.2099 },
        15: { '标准': 33.8517, '高品质': 42.3147 },
      },
      'TX-Y5': {
        5: { '标准': 13.5474, '高品质': 16.9341 },
        10: { '标准': 27.0948, '高品质': 33.8685 },
        15: { '标准': 40.6422, '高品质': 50.8029 },
      },
    } as const;

    const rows: Array<{
      label: string;
      duration: string;
      modelVersion: string;
      qualityVersion: string;
      normalPrice: number;
    }> = [];

    for (const [modelVersion, durationMap] of Object.entries(baseByModelVersion)) {
      for (const [seconds, qualityMap] of Object.entries(durationMap as Record<string, Record<string, number>>)) {
        for (const [qualityVersion, yuan] of Object.entries(qualityMap as Record<string, number>)) {
          rows.push({
            label: `${raw} ${modelVersion} ${qualityVersion} ${seconds}s`,
            duration: `${seconds}s`,
            modelVersion,
            qualityVersion,
            normalPrice: yuanToPoints(yuan),
          });
        }
      }
    }

    return {
      apiModel: raw,
      name: raw,
      description: '灵刻/lk666 视频模型 | 图生视频 | 5/10/15 秒 | 默认分组/TX-Y3/TX-Y5 | 标准/高品质 | 按条计费',
      features: { ...DEFAULT_FEATURES, textToVideo: true, imageToVideo: true },
      aspectRatios: [...STANDARD_VIDEO_ASPECT_RATIOS],
      defaultAspectRatio: '16:9',
      durations: makeDurationOptionsFromPointMap({
        5: yuanToPoints(11.2839),
        10: yuanToPoints(22.5678),
        15: yuanToPoints(33.8517),
      }),
      defaultDuration: '5s',
      videoConfigObject: {
        aspect_ratio: '16:9',
        video_length: 5,
        resolution: '720P',
        preset: 'normal',
        model_version: 'TX-Y3',
        quality_version: '标准',
        extra_params: buildExtraParams({
          upload_mode: 'reference',
          image_resolution_options: ['720P', '1080P'],
          min_reference_image_count: 1,
          max_reference_image_count: 4,
          reference_image_count_options: ['1', '2', '3', '4'],
          default_reference_image_count: 1,
          model_version_options: ['默认分组', 'TX-Y3', 'TX-Y5'],
          quality_version_options: ['标准', '高品质'],
          billing_note: '可灵-Omni 参考生按分组 + 质量 + 时长计费。',
        }),
      },
      billingMode: 'per_call',
      billingPrice: yuanToPoints(11.2839),
      billingUnit: 1,
      pricingRules: buildRules(rows),
      imageUrl,
      highlight: false,
    };
  }

  if (hasAlias(raw, ['可灵-Omni 首尾帧', 'Kling-Omni First/Last Frames'])) {
    const baseByModelVersion = {
      '默认分组': {
        5: { '标准': 19.1922, '高品质': 23.9904 },
        10: { '标准': 38.3844, '高品质': 47.9805 },
        15: { '标准': 57.5766, '高品质': 71.9709 },
      },
      'TX-Y3': {
        5: { '标准': 11.2839, '高品质': 14.1048 },
        10: { '标准': 22.5678, '高品质': 28.2099 },
        15: { '标准': 33.8517, '高品质': 42.3147 },
      },
      'TX-Y5': {
        5: { '标准': 13.5474, '高品质': 16.9341 },
        10: { '标准': 27.0948, '高品质': 33.8685 },
        15: { '标准': 40.6422, '高品质': 50.8029 },
      },
    } as const;

    const rows: Array<{
      label: string;
      duration: string;
      modelVersion: string;
      qualityVersion: string;
      normalPrice: number;
    }> = [];

    for (const [modelVersion, durationMap] of Object.entries(baseByModelVersion)) {
      for (const [seconds, qualityMap] of Object.entries(durationMap as Record<string, Record<string, number>>)) {
        for (const [qualityVersion, yuan] of Object.entries(qualityMap as Record<string, number>)) {
          rows.push({
            label: `${raw} ${modelVersion} ${qualityVersion} ${seconds}s`,
            duration: `${seconds}s`,
            modelVersion,
            qualityVersion,
            normalPrice: yuanToPoints(yuan),
          });
        }
      }
    }

    return {
      apiModel: raw,
      name: raw,
      description: '灵刻/lk666 视频模型 | 首尾帧视频 | 5/10/15 秒 | 默认分组/TX-Y3/TX-Y5 | 标准/高品质 | 按条计费',
      features: { ...DEFAULT_FEATURES, textToVideo: true, imageToVideo: true },
      aspectRatios: [...STANDARD_VIDEO_ASPECT_RATIOS],
      defaultAspectRatio: '16:9',
      durations: makeDurationOptionsFromPointMap({
        5: yuanToPoints(11.2839),
        10: yuanToPoints(22.5678),
        15: yuanToPoints(33.8517),
      }),
      defaultDuration: '5s',
      videoConfigObject: {
        aspect_ratio: '16:9',
        video_length: 5,
        resolution: '720P',
        preset: 'normal',
        model_version: 'TX-Y3',
        quality_version: '标准',
        extra_params: buildExtraParams({
          upload_mode: 'first_last_frame',
          image_resolution_options: ['720P', '1080P'],
          model_version_options: ['默认分组', 'TX-Y3', 'TX-Y5'],
          quality_version_options: ['标准', '高品质'],
          billing_note: '可灵-Omni 首尾帧按分组 + 质量 + 时长计费。',
        }),
      },
      billingMode: 'per_call',
      billingPrice: yuanToPoints(11.2839),
      billingUnit: 1,
      pricingRules: buildRules(rows),
      imageUrl,
      highlight: false,
    };
  }

  if (hasAlias(raw, ['可灵-V3-video', 'Kling-V3-video'])) {
    return {
      apiModel: raw,
      name: raw,
      description: '灵刻/lk666 视频模型 | 文生视频 | 标准/高品质 | 5/10/15 秒 | 按条计费',
      features: { ...DEFAULT_FEATURES, textToVideo: true, imageToVideo: false },
      aspectRatios: [...STANDARD_VIDEO_ASPECT_RATIOS],
      defaultAspectRatio: '16:9',
      durations: makeDurationOptionsFromPointMap({
        5: yuanToPoints(7.1971),
        10: yuanToPoints(14.3942),
        15: yuanToPoints(21.5913),
      }),
      defaultDuration: '5s',
      videoConfigObject: {
        aspect_ratio: '16:9',
        video_length: 5,
        resolution: '720P',
        preset: 'normal',
        quality_version: '标准',
        extra_params: buildExtraParams({
          image_resolution_options: ['720P', '1080P'],
        }),
      },
      billingMode: 'per_call',
      billingPrice: yuanToPoints(7.1971),
      billingUnit: 1,
      pricingRules: buildDurationQualityRules({
        labelPrefix: raw,
        yuanByDurationAndQuality: {
          5: { '标准': 7.1971, '高品质': 9.5959 },
          10: { '标准': 14.3942, '高品质': 19.1918 },
          15: { '标准': 21.5913, '高品质': 28.7877 },
        },
      }),
      imageUrl,
      highlight: false,
    };
  }

  if (hasAlias(raw, ['可灵-V3', 'Kling-V3'])) {
    return {
      apiModel: raw,
      name: raw,
      description: '灵刻/lk666 视频模型 | 文生视频 | 默认 16:9',
      features: { ...DEFAULT_FEATURES, textToVideo: true, imageToVideo: false },
      aspectRatios: [...STANDARD_VIDEO_ASPECT_RATIOS],
      defaultAspectRatio: '16:9',
      durations: makeDurationOptionsFromPointMap({ 5: 60 }),
      defaultDuration: '5s',
      videoConfigObject: {
        aspect_ratio: '16:9',
        video_length: 5,
        resolution: '720P',
        preset: 'normal',
        extra_params: buildExtraParams({ image_resolution_options: ['720P', '1080P'] }),
      },
      billingMode: 'per_call',
      billingPrice: 60,
      billingUnit: 1,
      pricingRules: [],
      imageUrl,
      highlight: false,
    };
  }

  if (hasAlias(raw, ['可灵-V3-Omni', 'Kling-V3-Omni'])) {
    return {
      apiModel: raw,
      name: raw,
      description: '灵刻/lk666 视频模型 | 文生视频 | 默认 1K',
      features: { ...DEFAULT_FEATURES, textToVideo: true, imageToVideo: false },
      aspectRatios: [...STANDARD_VIDEO_ASPECT_RATIOS],
      defaultAspectRatio: '16:9',
      durations: makeDurationOptionsFromPointMap({ 5: 60 }),
      defaultDuration: '5s',
      videoConfigObject: {
        aspect_ratio: '16:9',
        video_length: 5,
        resolution: '1K',
        preset: 'normal',
        extra_params: buildExtraParams({ image_resolution_options: ['1K'], billing_note: '该模型常用固定 1K。' }),
      },
      billingMode: 'per_call',
      billingPrice: 60,
      billingUnit: 1,
      pricingRules: [],
      imageUrl,
      highlight: false,
    };
  }

  if (hasAliasIncludes(raw, ['sd 2.0'])) {
    const uploadMode = raw.includes('首尾帧') || raw.toLowerCase().includes('first/last')
      ? 'first_last_frame'
      : raw.includes('全能') || raw.toLowerCase().includes('all-purpose')
        ? 'reference'
        : 'reference';
    const isAllPurpose = raw.includes('全能') || raw.toLowerCase().includes('all-purpose');
    const baseTokensPerMillion = isAllPurpose ? 86.5536 : 86.5506;
    const fallbackDisplayCost = yuanToPoints(baseTokensPerMillion / 1000);
    return {
      apiModel: raw,
      name: raw,
      description: '灵刻/lk666 视频模型 | Token 计费 | 默认 16:9',
      features: { ...DEFAULT_FEATURES, textToVideo: true, imageToVideo: true },
      aspectRatios: [...STANDARD_VIDEO_ASPECT_RATIOS],
      defaultAspectRatio: '16:9',
      durations: makeDurationOptionsFromPointMap({ 5: fallbackDisplayCost, 10: fallbackDisplayCost, 15: fallbackDisplayCost }),
      defaultDuration: '5s',
      videoConfigObject: {
        aspect_ratio: '16:9',
        video_length: 5,
        resolution: '720P',
        preset: 'normal',
        version: '标准',
        extra_params: buildExtraParams({
          upload_mode: uploadMode,
          image_resolution_options: ['720P', '1080P'],
          billing_note: 'SD 2.0 系列上游为 Token 计费，当前这里按每 1000 token 计积分展示。',
        }),
      },
      billingMode: 'per_1k_tokens',
      billingPrice: fallbackDisplayCost,
      billingUnit: 1,
      pricingRules: buildRules(
        isAllPurpose
          ? [
              { label: `${raw} 火山官方`, normalPrice: yuanToPoints(86.5536 / 1000), version: '火山官方' },
              { label: `${raw} ABX 默认`, normalPrice: yuanToPoints(79.5729 / 1000), version: 'ABX 默认' },
            ]
          : [
              { label: `${raw} 火山官方 标准`, normalPrice: yuanToPoints(86.5506 / 1000), version: '火山官方', qualityVersion: '标准' },
              { label: `${raw} 火山官方 快速`, normalPrice: yuanToPoints(69.6192 / 1000), version: '火山官方', qualityVersion: '快速' },
              { label: `${raw} ABX 默认 标准`, normalPrice: yuanToPoints(79.5733 / 1000), version: 'ABX 默认', qualityVersion: '标准' },
              { label: `${raw} ABX 默认 快速`, normalPrice: yuanToPoints(64.012 / 1000), version: 'ABX 默认', qualityVersion: '快速' },
            ]
      ),
      imageUrl,
      highlight: false,
    };
  }

  return {
    apiModel: raw,
    name: raw,
    description: '灵刻/lk666 视频模型 | 默认同步模板',
    features: {
      ...DEFAULT_FEATURES,
      imageToVideo: /参考|首帧|首尾帧/.test(raw),
      videoToVideo: /视频参考|续写|编辑/.test(raw),
    },
    aspectRatios: [...STANDARD_VIDEO_ASPECT_RATIOS],
    defaultAspectRatio: '16:9',
    durations: makeDurations([8], 'per_second', 12, 1, 96),
    defaultDuration: '8s',
    videoConfigObject: {
      aspect_ratio: '16:9',
      video_length: 8,
      resolution: '720P',
      preset: 'normal',
      extra_params: buildExtraParams({
        upload_mode: /视频参考/.test(raw)
          ? 'video_reference'
          : /续写/.test(raw)
            ? 'video_continue'
            : /编辑/.test(raw)
              ? 'video_edit'
              : /首尾帧/.test(raw)
                ? 'first_last_frame'
                : /首帧/.test(raw)
                  ? 'first_frame'
                  : /参考/.test(raw)
                    ? 'reference'
                    : 'text',
        image_resolution_options: ['720P', '1080P'],
      }),
    },
    billingMode: 'per_second',
    billingPrice: 12,
    billingUnit: 1,
    pricingRules: [],
    imageUrl,
    highlight: false,
  };
}

function isVideoModelName(name: string): boolean {
  const normalized = normalizeName(name).toLowerCase();
  if (!normalized) {
    return false;
  }
  if (
    /(tts|music generation|suno|gpt image|image\b|iamge\b|gemini\b|qwen\b|deepseek\b|reasoning\b|opus\b|doubao tts|minimax-m2\.7)/i.test(normalized)
  ) {
    return false;
  }
  if (
    normalized === '可灵-v3'
    || normalized === 'kling-v3'
    || normalized === '可灵-v3-omni'
    || normalized === 'kling-v3-omni'
  ) {
    return true;
  }
  return /(视频|video|first frame|first\/last|reference|extension|motion control|omni-flash|veo3\.1(?:-4khd|-4k高清|-lite)?|vidu q[23]|happyhorse|wanxiang|kling|pix|sora|grok|hailuo|seedance|sd 2\.0)/i.test(name);
}

export async function fetchLingkeVisibleVideoModels(): Promise<LingkeRemoteVisibleModel[]> {
  const response = await fetch(LK_VISIBLE_MODELS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json;charset=UTF-8',
      'User-Agent': 'Mozilla/5.0',
    },
    body: JSON.stringify({ 域名: LK_VISIBLE_DOMAIN }),
    cache: 'no-store',
  });

  if (!response.ok) {
    const details = await response.text().catch(() => '');
    throw new Error(`拉取灵刻公开模型失败 (${response.status})${details ? `: ${details}` : ''}`);
  }

  const data = await response.json().catch(() => ({}));
  const items = Array.isArray(data?.data) ? data.data : [];
  return items.filter((item: LingkeRemoteVisibleModel) => isVideoModelName(item?.展示名称));
}

export async function fetchLingkeSyncedVideoModels(): Promise<LingkeSyncedVideoModel[]> {
  const visibleModels = await fetchLingkeVisibleVideoModels();
  return visibleModels
    .map((item) => {
      const model = createModelConfig(item.展示名称, item.模型图标);
      return {
        ...model,
        remoteId: item.id,
        imageUrl: model.imageUrl || item.模型图标,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
}

export function createLingkeSyncedVideoModelFromName(name: string, imageUrl?: string): LingkeSyncedVideoModel {
  return createModelConfig(name, imageUrl);
}
