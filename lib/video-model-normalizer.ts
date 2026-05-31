import type {
  SafeVideoModel,
  VideoAspectRatio,
  VideoChannel,
  VideoDuration,
  VideoModel,
  VideoModelFeatures,
} from '@/types';
import { isRetiredLingkeVideoModel } from '@/lib/lingke-video-sync';

type VideoModelWithChannel = {
  model: VideoModel;
  channel: VideoChannel;
};

type VeoFamily = 'fast' | 'ultra' | 'ultra_relaxed' | 'lite' | 'standard';
type FlowVeoKind = 't2v' | 'i2v' | 'r2v' | 'interpolation';
type FlowVeoAspect = 'landscape' | 'portrait';
type SupportedVideoBillingMode = Extract<NonNullable<VideoModel['billingMode']>, 'per_call' | 'per_second'>;
type BillingCandidateObject = Record<string, unknown>;

export type VideoBillingProfile = {
  billingMode: SupportedVideoBillingMode;
  billingPrice: number;
  billingUnit: number;
  inferredFrom: 'remote' | 'heuristic' | 'fallback';
};

const USER_VIDEO_DURATION_VALUE = '8s';
const USER_VIDEO_DURATION_LABEL = '8 秒';

const ASPECT_RATIO_ORDER = ['landscape', 'portrait', 'square', '16:9', '9:16', '1:1'];
const BILLING_OBJECT_KEY_PATTERN = /(pricing|billing|price|cost|meta|detail|extra|capabilit)/i;
const BILLING_MODE_KEYS = [
  'billingMode',
  'billing_mode',
  'billingType',
  'billing_type',
  'chargeType',
  'charge_type',
  'pricingMode',
  'pricing_mode',
  'mode',
  'unitType',
  'unit_type',
];
const BILLING_PRICE_KEYS = [
  'billingPrice',
  'billing_price',
  'price',
  'cost',
  'amount',
  'credits',
  'credit',
  'fee',
  'value',
  'charge',
];
const BILLING_UNIT_KEYS = [
  'billingUnit',
  'billing_unit',
  'unit',
  'step',
  'interval',
  'block',
  'seconds',
  'durationUnit',
  'duration_unit',
];
const BILLING_TEXT_KEYS = [
  'description',
  'summary',
  'priceText',
  'price_text',
  'billingText',
  'billing_text',
  'pricingText',
  'pricing_text',
  'note',
];
const PER_SECOND_VALUE_KEYS = [
  'price_per_second',
  'billing_price_per_second',
  'credits_per_second',
  'credit_per_second',
  'cost_per_second',
  'per_second',
  'pricePerSecond',
  'billingPricePerSecond',
  'creditsPerSecond',
  'costPerSecond',
];
const PER_CALL_VALUE_KEYS = [
  'price_per_call',
  'billing_price_per_call',
  'credits_per_call',
  'credit_per_call',
  'cost_per_call',
  'per_call',
  'pricePerCall',
  'billingPricePerCall',
  'creditsPerCall',
  'costPerCall',
  'price_per_generation',
  'billing_price_per_generation',
  'credits_per_generation',
  'cost_per_generation',
  'pricePerGeneration',
  'creditsPerGeneration',
  'costPerGeneration',
];

const VEO_31_MODEL_MATRIX: Record<
  VeoFamily,
  Partial<Record<FlowVeoKind, Record<FlowVeoAspect, string>>>
> = {
  fast: {
    t2v: {
      landscape: 'veo_3_1_t2v_fast_landscape',
      portrait: 'veo_3_1_t2v_fast_portrait',
    },
    i2v: {
      landscape: 'veo_3_1_i2v_s_fast_fl',
      portrait: 'veo_3_1_i2v_s_fast_portrait_fl',
    },
    r2v: {
      landscape: 'veo_3_1_r2v_fast',
      portrait: 'veo_3_1_r2v_fast_portrait',
    },
  },
  ultra: {
    t2v: {
      landscape: 'veo_3_1_t2v_fast_ultra',
      portrait: 'veo_3_1_t2v_fast_portrait_ultra',
    },
    i2v: {
      landscape: 'veo_3_1_i2v_s_fast_ultra_fl',
      portrait: 'veo_3_1_i2v_s_fast_portrait_ultra_fl',
    },
    r2v: {
      landscape: 'veo_3_1_r2v_fast_ultra',
      portrait: 'veo_3_1_r2v_fast_portrait_ultra',
    },
  },
  ultra_relaxed: {
    t2v: {
      landscape: 'veo_3_1_t2v_fast_ultra_relaxed',
      portrait: 'veo_3_1_t2v_fast_portrait_ultra_relaxed',
    },
    i2v: {
      landscape: 'veo_3_1_i2v_s_fast_ultra_relaxed',
      portrait: 'veo_3_1_i2v_s_fast_portrait_ultra_relaxed',
    },
    r2v: {
      landscape: 'veo_3_1_r2v_fast_ultra_relaxed',
      portrait: 'veo_3_1_r2v_fast_portrait_ultra_relaxed',
    },
  },
  lite: {
    t2v: {
      landscape: 'veo_3_1_t2v_lite_landscape',
      portrait: 'veo_3_1_t2v_lite_portrait',
    },
    i2v: {
      landscape: 'veo_3_1_i2v_lite_landscape',
      portrait: 'veo_3_1_i2v_lite_portrait',
    },
    interpolation: {
      landscape: 'veo_3_1_interpolation_lite_landscape',
      portrait: 'veo_3_1_interpolation_lite_portrait',
    },
  },
  standard: {
    t2v: {
      landscape: 'veo_3_1_t2v_landscape',
      portrait: 'veo_3_1_t2v_portrait',
    },
    i2v: {
      landscape: 'veo_3_1_i2v_s_landscape',
      portrait: 'veo_3_1_i2v_s_portrait',
    },
  },
};

export function isVeoApiModel(apiModel?: string): boolean {
  return /^veo_\d+(?:_\d+)?_/i.test((apiModel || '').trim());
}

export function isVeo31ApiModel(apiModel?: string): boolean {
  return /^veo_3_1_/i.test((apiModel || '').trim());
}

export function inferVeoFamily(apiModel: string): VeoFamily {
  const lower = apiModel.toLowerCase();
  if (lower.includes('ultra_relaxed')) return 'ultra_relaxed';
  if (lower.includes('ultra')) return 'ultra';
  if (lower.includes('lite')) return 'lite';
  if (lower.includes('fast')) return 'fast';
  return 'standard';
}

export function inferVeoVersionLabel(apiModel: string): string {
  const lower = apiModel.toLowerCase();
  const minorMatch = lower.match(/^veo_(\d+)_(\d+)/);
  if (minorMatch) return `Veo ${minorMatch[1]}.${minorMatch[2]}`;
  const majorMatch = lower.match(/^veo_(\d+)/);
  if (majorMatch) return `Veo ${majorMatch[1]}`;
  return 'Veo';
}

export function inferVeoTierLabel(apiModel: string): string {
  switch (inferVeoFamily(apiModel)) {
    case 'ultra_relaxed':
      return 'Ultra Relaxed';
    case 'ultra':
      return 'Ultra';
    case 'lite':
      return 'Lite';
    case 'fast':
      return 'Fast';
    default:
      return 'Standard';
  }
}

export function getVeoDisplayName(apiModel: string): string {
  return `${inferVeoVersionLabel(apiModel)} ${inferVeoTierLabel(apiModel)}`;
}

export function getVeoGroupKey(apiModel: string, channelId = ''): string {
  const version = inferVeoVersionLabel(apiModel).toLowerCase().replace(/\s+/g, '-');
  const key = `veo:${version}:${inferVeoFamily(apiModel)}`;
  return channelId ? `${channelId}:${key}` : key;
}

function toBillingCandidateObject(value: unknown): BillingCandidateObject | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as BillingCandidateObject;
}

function toRoundedNonNegativeInt(value: unknown): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return Math.round(parsed);
}

function toPositiveInt(value: unknown): number | undefined {
  const parsed = toRoundedNonNegativeInt(value);
  if (!parsed || parsed < 1) return undefined;
  return parsed;
}

function normalizeBillingModeToken(value: unknown): SupportedVideoBillingMode | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;

  if (
    normalized === 'per_second' ||
    normalized === 'per-second' ||
    normalized === 'second' ||
    normalized === 'seconds' ||
    normalized === 'sec' ||
    normalized === 'secs' ||
    normalized === '按秒' ||
    normalized === '每秒' ||
    /\/\s*(sec|second|seconds|秒)\b/i.test(normalized) ||
    /\bper\s*(sec|second|seconds)\b/i.test(normalized) ||
    /每\s*\d*\s*秒/.test(normalized)
  ) {
    return 'per_second';
  }

  if (
    normalized === 'per_call' ||
    normalized === 'per-call' ||
    normalized === 'call' ||
    normalized === 'calls' ||
    normalized === 'generation' ||
    normalized === 'generations' ||
    normalized === 'request' ||
    normalized === 'requests' ||
    normalized === 'task' ||
    normalized === 'tasks' ||
    normalized === '按次' ||
    normalized === '每次' ||
    /\/\s*(call|calls|generation|generations|request|requests|task|tasks|次)\b/i.test(normalized) ||
    /\bper\s*(call|generation|request|task)\b/i.test(normalized) ||
    /每\s*\d*\s*次/.test(normalized)
  ) {
    return 'per_call';
  }

  return undefined;
}

function parseBillingProfileFromText(text: string): Omit<VideoBillingProfile, 'inferredFrom'> | null {
  const normalized = text.trim();
  if (!normalized) return null;

  const perSecondMatch = normalized.match(
    /(\d+(?:\.\d+)?)\s*(?:credits?|积分)?\s*(?:\/|per\s*)(\d+(?:\.\d+)?)?\s*(?:sec|second|seconds|秒)/i
  );
  if (perSecondMatch) {
    return {
      billingMode: 'per_second',
      billingPrice: Math.round(Number(perSecondMatch[1])),
      billingUnit: Math.max(1, Math.round(Number(perSecondMatch[2] || 1))),
    };
  }

  const perCallMatch = normalized.match(
    /(\d+(?:\.\d+)?)\s*(?:credits?|积分)?\s*(?:\/|per\s*)(\d+(?:\.\d+)?)?\s*(?:call|calls|generation|generations|request|requests|task|tasks|次)/i
  );
  if (perCallMatch) {
    return {
      billingMode: 'per_call',
      billingPrice: Math.round(Number(perCallMatch[1])),
      billingUnit: Math.max(1, Math.round(Number(perCallMatch[2] || 1))),
    };
  }

  const chineseModePriceMatch = normalized.match(/每\s*(\d+(?:\.\d+)?)?\s*(秒|次)[^\d]{0,8}(\d+(?:\.\d+)?)\s*积分/i);
  if (chineseModePriceMatch) {
    return {
      billingMode: chineseModePriceMatch[2] === '秒' ? 'per_second' : 'per_call',
      billingPrice: Math.round(Number(chineseModePriceMatch[3])),
      billingUnit: Math.max(1, Math.round(Number(chineseModePriceMatch[1] || 1))),
    };
  }

  return null;
}

function collectRemoteBillingCandidateObjects(root: BillingCandidateObject): BillingCandidateObject[] {
  const queue: Array<{ value: unknown; depth: number }> = [{ value: root, depth: 0 }];
  const results: BillingCandidateObject[] = [];
  const seen = new Set<BillingCandidateObject>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;

    const objectValue = toBillingCandidateObject(current.value);
    if (objectValue) {
      if (seen.has(objectValue)) continue;
      seen.add(objectValue);
      results.push(objectValue);

      if (current.depth >= 2) continue;
      for (const [key, value] of Object.entries(objectValue)) {
        if (current.depth > 0 && !BILLING_OBJECT_KEY_PATTERN.test(key)) continue;
        if (Array.isArray(value)) {
          value.forEach((item) => queue.push({ value: item, depth: current.depth + 1 }));
          continue;
        }
        queue.push({ value, depth: current.depth + 1 });
      }
    } else if (Array.isArray(current.value)) {
      current.value.forEach((item) => queue.push({ value: item, depth: current.depth }));
    }
  }

  return results;
}

function findNumericBillingValue(source: BillingCandidateObject, keys: string[]): number | undefined {
  for (const key of keys) {
    if (!(key in source)) continue;
    const numeric = toRoundedNonNegativeInt(source[key]);
    if (numeric !== undefined) return numeric;
  }
  return undefined;
}

function findPositiveBillingUnit(source: BillingCandidateObject, keys: string[]): number | undefined {
  for (const key of keys) {
    if (!(key in source)) continue;
    const numeric = toPositiveInt(source[key]);
    if (numeric !== undefined) return numeric;
  }
  return undefined;
}

function findStringBillingTexts(source: BillingCandidateObject): string[] {
  const texts: string[] = [];
  for (const key of BILLING_TEXT_KEYS) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) {
      texts.push(value.trim());
    }
  }

  for (const [key, value] of Object.entries(source)) {
    if (!BILLING_OBJECT_KEY_PATTERN.test(key)) continue;
    if (typeof value === 'string' && value.trim()) {
      texts.push(value.trim());
    }
  }

  return texts;
}

function extractRemoteBillingProfile(source: BillingCandidateObject): Omit<VideoBillingProfile, 'inferredFrom'> | null {
  const perSecondPrice = findNumericBillingValue(source, PER_SECOND_VALUE_KEYS);
  if (perSecondPrice !== undefined) {
    return {
      billingMode: 'per_second',
      billingPrice: perSecondPrice,
      billingUnit: findPositiveBillingUnit(source, BILLING_UNIT_KEYS) ?? 1,
    };
  }

  const perCallPrice = findNumericBillingValue(source, PER_CALL_VALUE_KEYS);
  if (perCallPrice !== undefined) {
    return {
      billingMode: 'per_call',
      billingPrice: perCallPrice,
      billingUnit: findPositiveBillingUnit(source, BILLING_UNIT_KEYS) ?? 1,
    };
  }

  const billingMode =
    BILLING_MODE_KEYS.map((key) => normalizeBillingModeToken(source[key])).find(Boolean) ||
    BILLING_UNIT_KEYS.map((key) => normalizeBillingModeToken(source[key])).find(Boolean);
  const billingPrice = findNumericBillingValue(source, BILLING_PRICE_KEYS);
  const billingUnit = findPositiveBillingUnit(source, BILLING_UNIT_KEYS) ?? 1;

  if (billingMode && billingPrice !== undefined) {
    return {
      billingMode,
      billingPrice,
      billingUnit,
    };
  }

  const textProfile = findStringBillingTexts(source)
    .map((text) => parseBillingProfileFromText(text))
    .find(Boolean);
  if (textProfile) return textProfile;

  return null;
}

function inferHeuristicVideoBillingProfile(
  channelType: VideoChannel['type'] | undefined,
  apiModel: string | undefined,
  fallback: Omit<VideoBillingProfile, 'inferredFrom'>
): VideoBillingProfile {
  const normalizedApiModel = (apiModel || '').trim().toLowerCase();

  if (
    channelType === 'apexerapi' ||
    normalizedApiModel === 'sora' ||
    normalizedApiModel === 'sora-2' ||
    normalizedApiModel.startsWith('sora-video') ||
    normalizedApiModel.startsWith('sora2')
  ) {
    return {
      billingMode: 'per_call',
      billingPrice: 96,
      billingUnit: 1,
      inferredFrom: 'heuristic',
    };
  }

  if (
    channelType === 'flow2api' ||
    isVeoApiModel(apiModel) ||
    normalizedApiModel.includes('veo')
  ) {
    return {
      billingMode: 'per_second',
      billingPrice: 12,
      billingUnit: 1,
      inferredFrom: 'heuristic',
    };
  }

  return {
    ...fallback,
    inferredFrom: 'fallback',
  };
}

export function inferVideoBillingProfile(params: {
  channelType?: VideoChannel['type'];
  apiModel?: string;
  remoteModel?: BillingCandidateObject | null;
  fallbackMode?: SupportedVideoBillingMode;
  fallbackPrice?: number;
  fallbackUnit?: number;
}): VideoBillingProfile {
  const fallback: Omit<VideoBillingProfile, 'inferredFrom'> = {
    billingMode: params.fallbackMode || 'per_second',
    billingPrice: params.fallbackPrice ?? 12,
    billingUnit: Math.max(1, params.fallbackUnit ?? 1),
  };

  const remoteModel = params.remoteModel ? toBillingCandidateObject(params.remoteModel) : undefined;
  if (remoteModel) {
    const candidateObjects = collectRemoteBillingCandidateObjects(remoteModel);
    for (const candidate of candidateObjects) {
      const explicit = extractRemoteBillingProfile(candidate);
      if (!explicit) continue;
      return {
        ...explicit,
        inferredFrom: 'remote',
      };
    }
  }

  return inferHeuristicVideoBillingProfile(params.channelType, params.apiModel, fallback);
}

export function estimateVideoDurationCost(
  durationValue: string | undefined,
  billing: Pick<VideoBillingProfile, 'billingMode' | 'billingPrice' | 'billingUnit'>,
  fallbackCost = 100
): number {
  const secondsMatch = String(durationValue || '').match(/(\d+)/);
  const seconds = Math.max(1, Number(secondsMatch?.[1] || 8));
  const billingUnit = Math.max(1, billing.billingUnit || 1);

  if (billing.billingMode === 'per_second') {
    return Math.ceil(seconds / billingUnit) * Math.max(0, billing.billingPrice || 0);
  }

  if (billing.billingMode === 'per_call') {
    return Math.max(0, billing.billingPrice || 0);
  }

  return fallbackCost;
}

export function normalizeFlowVeoAspect(aspectRatio?: string): FlowVeoAspect {
  const normalized = (aspectRatio || '').trim().toLowerCase();
  if (normalized === 'portrait' || normalized === '9:16') return 'portrait';
  return 'landscape';
}

function inferVeoAspectRatio(apiModel: string): { value: string; label: string } | null {
  const lower = apiModel.toLowerCase();
  if (lower.includes('portrait')) return { value: 'portrait', label: '9:16' };
  if (lower.includes('square')) return { value: 'square', label: '1:1' };
  if (isVeoApiModel(apiModel)) return { value: 'landscape', label: '16:9' };
  return null;
}

function sortAspectRatios(
  ratios: Array<{ value: string; label: string }>
): Array<{ value: string; label: string }> {
  return [...ratios].sort((left, right) => {
    const leftIndex = ASPECT_RATIO_ORDER.indexOf(left.value);
    const rightIndex = ASPECT_RATIO_ORDER.indexOf(right.value);
    const normalizedLeft = leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex;
    const normalizedRight = rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex;
    if (normalizedLeft !== normalizedRight) return normalizedLeft - normalizedRight;
    return left.label.localeCompare(right.label);
  });
}

export function mergeVideoAspectRatios(models: VideoModel[]): Array<{ value: string; label: string }> {
  const ratioMap = new Map<string, { value: string; label: string }>();

  for (const model of models) {
    for (const ratio of model.aspectRatios || []) {
      if (ratio.value && !ratioMap.has(ratio.value)) {
        ratioMap.set(ratio.value, ratio);
      }
    }

    const inferred = inferVeoAspectRatio(model.apiModel);
    if (inferred && !ratioMap.has(inferred.value)) {
      ratioMap.set(inferred.value, inferred);
    }
  }

  if (ratioMap.size === 0) {
    ratioMap.set('landscape', { value: 'landscape', label: '16:9' });
    ratioMap.set('portrait', { value: 'portrait', label: '9:16' });
  }

  return sortAspectRatios(Array.from(ratioMap.values()));
}

function pickDurationCost(models: VideoModel[]): number {
  const durations = models.flatMap((model) => model.durations || []);
  const exact = durations.find((duration) => duration.value === USER_VIDEO_DURATION_VALUE);
  if (exact && Number.isFinite(exact.cost)) return exact.cost;

  const tenSeconds = durations.find((duration) => duration.value === '10s');
  if (tenSeconds && Number.isFinite(tenSeconds.cost)) return tenSeconds.cost;

  const first = durations.find((duration) => Number.isFinite(duration.cost));
  return first ? first.cost : 100;
}

function parseDurationSecondsFromValue(value?: string): number {
  const matched = String(value || '').match(/(\d+)/);
  return matched ? Math.max(1, Number.parseInt(matched[1], 10) || 8) : 8;
}

function getDefaultDurationValue(models: VideoModel[]): string {
  const explicit = models
    .map((model) => String(model.defaultDuration || '').trim())
    .find(Boolean);
  if (explicit) return explicit;

  const firstDuration = models
    .flatMap((model) => model.durations || [])
    .map((duration) => String(duration.value || '').trim())
    .find(Boolean);
  return firstDuration || USER_VIDEO_DURATION_VALUE;
}

export function getUserFacingVideoDurations(models: VideoModel[]): VideoDuration[] {
  return [
    {
      value: USER_VIDEO_DURATION_VALUE,
      label: USER_VIDEO_DURATION_LABEL,
      cost: pickDurationCost(models),
    },
  ];
}

function getDefaultAspectRatio(ratios: Array<{ value: string; label: string }>): string {
  if (ratios.some((ratio) => ratio.value === 'landscape')) return 'landscape';
  if (ratios.some((ratio) => ratio.value === '16:9')) return '16:9';
  return ratios[0]?.value || 'landscape';
}

function mergeFeatures(models: VideoModel[]): VideoModelFeatures {
  return {
    textToVideo: models.some((model) => model.features.textToVideo || model.apiModel.includes('_t2v_')),
    imageToVideo: models.some(
      (model) =>
        model.features.imageToVideo ||
        model.apiModel.includes('_i2v_') ||
        model.apiModel.includes('_r2v_') ||
        model.apiModel.includes('_interpolation_')
    ),
    videoToVideo: models.some((model) => model.features.videoToVideo),
    supportStyles: models.some((model) => model.features.supportStyles),
  };
}

export function buildVideoModelDescription(params: {
  features: VideoModelFeatures;
  aspectRatios: Array<{ value: string; label: string }>;
  sourceCount?: number;
}): string {
  const abilities: string[] = [];
  if (params.features.textToVideo) abilities.push('文生视频');
  if (params.features.imageToVideo) abilities.push('图生视频');
  if (params.features.videoToVideo) abilities.push('视频转视频');

  const ratioLabels = params.aspectRatios.map((ratio) => ratio.label).join(' / ');
  const parts = [
    abilities.length > 0 ? abilities.join(' / ') : '视频生成',
    ratioLabels ? `比例 ${ratioLabels}` : '',
    '时长 8 秒',
    params.sourceCount && params.sourceCount > 1 ? `已合并 ${params.sourceCount} 个模型` : '',
  ];

  return parts.filter(Boolean).join(' | ');
}

function toSafeVideoModel(model: VideoModel, channel: VideoChannel): SafeVideoModel {
  const aspectRatios = mergeVideoAspectRatios([model]);
  const defaultDuration = getDefaultDurationValue([model]);
  return {
    id: model.id,
    channelId: model.channelId,
    channelType: channel.type,
    apiModel: isVeoApiModel(model.apiModel) ? undefined : model.apiModel,
    name: model.name,
    description: isVeoApiModel(model.apiModel)
      ? buildVideoModelDescription({
          features: mergeFeatures([model]),
          aspectRatios,
        })
      : model.description,
    features: model.features,
    aspectRatios,
    durations: Array.isArray(model.durations) && model.durations.length > 0
      ? model.durations
      : getUserFacingVideoDurations([model]),
    defaultAspectRatio: getDefaultAspectRatio(aspectRatios),
    defaultDuration,
    videoConfigObject: model.videoConfigObject
      ? {
          ...model.videoConfigObject,
          video_length:
            typeof model.videoConfigObject.video_length === 'number' && Number.isFinite(model.videoConfigObject.video_length)
              ? model.videoConfigObject.video_length
              : parseDurationSecondsFromValue(defaultDuration),
        }
      : undefined,
    highlight: model.highlight,
    enabled: model.enabled,
    billingMode: model.billingMode,
    billingPrice: model.billingPrice,
    billingUnit: model.billingUnit,
    normalPrice: model.normalPrice,
    vipPrice: model.vipPrice,
    svipPrice: model.svipPrice,
    pricingRules: model.pricingRules,
    imageUrl: model.imageUrl,
  };
}

function toMergedVeoModel(models: VideoModel[], channel: VideoChannel): SafeVideoModel {
  const representative = models[0];
  const aspectRatios = mergeVideoAspectRatios(models);
  const features = mergeFeatures(models);

  return {
    id: representative.id,
    channelId: representative.channelId,
    channelType: channel.type,
    name: getVeoDisplayName(representative.apiModel),
    description: buildVideoModelDescription({
      features,
      aspectRatios,
      sourceCount: models.length,
    }),
    features,
    aspectRatios,
    durations: getUserFacingVideoDurations(models),
    defaultAspectRatio: getDefaultAspectRatio(aspectRatios),
    defaultDuration: USER_VIDEO_DURATION_VALUE,
    highlight: models.some((model) => model.highlight),
    enabled: models.some((model) => model.enabled),
    billingMode: representative.billingMode,
    billingPrice: representative.billingPrice,
    billingUnit: representative.billingUnit,
    normalPrice: representative.normalPrice,
    vipPrice: representative.vipPrice,
    svipPrice: representative.svipPrice,
    pricingRules: representative.pricingRules,
    imageUrl: representative.imageUrl || models.find((model) => model.imageUrl)?.imageUrl,
  };
}

export function buildSafeVideoModels(
  models: VideoModel[],
  channels: VideoChannel[],
  enabledOnly = false
): SafeVideoModel[] {
  const channelMap = new Map(channels.map((channel) => [channel.id, channel]));
  const grouped = new Map<
    string,
    { index: number; channel: VideoChannel; models: VideoModel[] }
  >();
  const entries: Array<
    | { index: number; kind: 'single'; model: VideoModel; channel: VideoChannel }
    | { index: number; kind: 'group'; groupKey: string }
  > = [];

  models.forEach((model, index) => {
    if (isRetiredLingkeVideoModel(model.apiModel, model.name)) return;

    const channel = channelMap.get(model.channelId);
    if (!channel || (enabledOnly && !channel.enabled)) return;

    if (channel.type === 'flow2api' && isVeoApiModel(model.apiModel)) {
      const groupKey = getVeoGroupKey(model.apiModel, model.channelId);
      const existing = grouped.get(groupKey);
      if (existing) {
        existing.models.push(model);
        return;
      }

      grouped.set(groupKey, { index, channel, models: [model] });
      entries.push({ index, kind: 'group', groupKey });
      return;
    }

    entries.push({ index, kind: 'single', model, channel });
  });

  const safeModels = entries
    .sort((left, right) => left.index - right.index)
    .map((entry) => {
      if (entry.kind === 'single') {
        return toSafeVideoModel(entry.model, entry.channel);
      }

      const group = grouped.get(entry.groupKey);
      if (!group) return null;
      return toMergedVeoModel(group.models, group.channel);
    })
    .filter((model): model is SafeVideoModel => Boolean(model));

  const seenNames = new Set<string>();
  return safeModels.filter((model) => {
    if (seenNames.has(model.name)) return false;
    seenNames.add(model.name);
    return true;
  });
}

function resolveFlowVeoKind(family: VeoFamily, imageCount: number): FlowVeoKind {
  if (imageCount <= 0) return 't2v';
  if (family === 'lite' && imageCount >= 2) return 'interpolation';
  if (imageCount >= 3) return 'r2v';
  return 'i2v';
}

export function resolveFlowVeoModel(
  apiModel: string,
  aspectRatio: string | undefined,
  imageCount: number
): string | null {
  if (!isVeo31ApiModel(apiModel)) return null;

  const family = inferVeoFamily(apiModel);
  const aspect = normalizeFlowVeoAspect(aspectRatio);
  const preferredKind = resolveFlowVeoKind(family, imageCount);
  const familyModels = VEO_31_MODEL_MATRIX[family];
  const variants =
    familyModels[preferredKind] ||
    familyModels.i2v ||
    familyModels.t2v ||
    VEO_31_MODEL_MATRIX.fast.t2v;

  return variants?.[aspect] || variants?.landscape || null;
}

export function toVideoConfigAspectRatio(
  aspectRatio: string | undefined
): VideoAspectRatio {
  const normalized = (aspectRatio || '').trim().toLowerCase();
  if (normalized === 'portrait') return '9:16';
  if (normalized === 'square') return '1:1';
  if (normalized === '2:3' || normalized === '3:2') return normalized;
  return '16:9';
}
