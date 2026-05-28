import { calculateBillingCost, formatBillingSummary } from '@/lib/billing';
import type {
  ImagePricingRule,
  MembershipLevel,
  SafeImageModel,
  SafeUser,
  SafeVideoModel,
  User,
  VideoConfigObject,
  VideoPricingRule,
} from '@/types';

const DAY_MS = 24 * 60 * 60 * 1000;

type MembershipContext =
  | Pick<User, 'membershipLevel' | 'membershipExpiresAt'>
  | Pick<SafeUser, 'membershipLevel' | 'membershipExpiresAt'>
  | null
  | undefined;

type ImageLike = Pick<
  SafeImageModel,
  | 'name'
  | 'apiModel'
  | 'billingMode'
  | 'billingPrice'
  | 'billingUnit'
  | 'costPerGeneration'
  | 'defaultImageSize'
  | 'defaultAspectRatio'
  | 'normalPrice'
  | 'vipPrice'
  | 'svipPrice'
  | 'pricingRules'
>;

type VideoLike = Pick<
  SafeVideoModel,
  | 'name'
  | 'apiModel'
  | 'billingMode'
  | 'billingPrice'
  | 'billingUnit'
  | 'durations'
  | 'defaultDuration'
  | 'defaultAspectRatio'
  | 'videoConfigObject'
  | 'normalPrice'
  | 'vipPrice'
  | 'svipPrice'
  | 'pricingRules'
>;

type TierPricePoints = Record<MembershipLevel, number>;

type PricingReferenceRow = {
  label: string;
  unit: string;
  seconds?: string;
  prices: Record<MembershipLevel, string>;
};

export const MEMBERSHIP_LABELS: Record<MembershipLevel, string> = {
  normal: '普通',
  vip: 'VIP',
  svip: 'SVIP',
};

export const MEMBERSHIP_PRIORITY: Record<MembershipLevel, number> = {
  normal: 0,
  vip: 1,
  svip: 2,
};

export const MEMBERSHIP_RECHARGE_TIERS: Array<{
  level: MembershipLevel;
  label: string;
  amount: number;
  days: number;
}> = [
  { level: 'svip', label: 'SVIP（6折）', amount: 4000, days: 180 },
  { level: 'vip', label: 'VIP（85折）', amount: 798, days: 90 },
  { level: 'normal', label: '普通', amount: 200, days: 90 },
];

export const PRICING_REFERENCE_ROWS: PricingReferenceRow[] = [
  {
    label: 'veo3.1 快速 720p',
    unit: '条',
    seconds: '8s',
    prices: { svip: '0.483', vip: '0.686', normal: '0.805' },
  },
  {
    label: 'veo3.1 快速 1080p',
    unit: '条',
    seconds: '8s',
    prices: { svip: '0.588', vip: '0.833', normal: '0.98' },
  },
  {
    label: 'veo3.1 高质量 720p',
    unit: '次',
    seconds: '8s',
    prices: { svip: '0.588', vip: '0.833', normal: '0.98' },
  },
  {
    label: 'veo3.1 高质量 1080p',
    unit: '条',
    seconds: '8s',
    prices: { svip: '0.735', vip: '0.805', normal: '1.225' },
  },
  {
    label: 'veo3.1 omni flash',
    unit: '条',
    seconds: '10s',
    prices: { svip: '1.575', vip: '2.24', normal: '2.625' },
  },
  {
    label: 'sora2 12s',
    unit: '条',
    seconds: '12s',
    prices: { svip: '2.1', vip: '2.975', normal: '3.5' },
  },
  {
    label: 'GPT-Image2',
    unit: '张',
    prices: { svip: '0.105', vip: '0.1488', normal: '0.175' },
  },
  {
    label: 'GPT-Image2 2k4k',
    unit: '张',
    prices: { svip: '0.21', vip: '0.2975', normal: '0.35' },
  },
  {
    label: 'nanobanana',
    unit: '张',
    prices: { svip: '0.35', vip: '0.525', normal: '0.63' },
  },
  {
    label: 'nanobanana pro 2k',
    unit: '张',
    prices: { svip: '0.483', vip: '0.686', normal: '0.805' },
  },
  {
    label: 'nanobanana pro 4k',
    unit: '张',
    prices: { svip: '0.525', vip: '0.735', normal: '0.875' },
  },
];

const VIDEO_PRICE_POINTS: Record<string, TierPricePoints> = {
  veo31_fast_720p_8s: { normal: 81, vip: 69, svip: 48 },
  veo31_fast_1080p_8s: { normal: 98, vip: 83, svip: 59 },
  veo31_high_720p_8s: { normal: 98, vip: 83, svip: 59 },
  veo31_high_1080p_8s: { normal: 123, vip: 81, svip: 74 },
  veo31_omni_flash_10s: { normal: 263, vip: 224, svip: 158 },
  sora2_12s: { normal: 350, vip: 298, svip: 210 },
};

const IMAGE_PRICE_POINTS: Record<string, TierPricePoints> = {
  gpt_image2: { normal: 18, vip: 15, svip: 11 },
  gpt_image2_2k4k: { normal: 35, vip: 30, svip: 21 },
  nanobanana: { normal: 63, vip: 53, svip: 35 },
  nanobanana_pro_2k: { normal: 81, vip: 69, svip: 48 },
  nanobanana_pro_4k: { normal: 88, vip: 74, svip: 53 },
};

function normalizeText(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function normalizeCompactText(value: unknown): string {
  return normalizeText(value)
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeImageSize(value: unknown): string {
  const raw = String(value || '').trim().toUpperCase();
  if (!raw) return '';
  if (raw.includes('4K')) return '4K';
  if (raw.includes('2K')) return '2K';
  if (raw.includes('1K')) return '1K';
  return raw;
}

function normalizeAspectRatio(value: unknown): string {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  if (raw === 'landscape') return '16:9';
  if (raw === 'portrait') return '9:16';
  if (raw === 'square') return '1:1';
  return raw;
}

function normalizeVideoResolution(value: unknown): string {
  const raw = String(value || '').trim().toUpperCase();
  if (!raw) return '';
  if (raw === 'HD') return '720P';
  if (raw === 'FHD') return '1080P';
  if (raw.includes('1080')) return '1080P';
  if (raw.includes('720')) return '720P';
  if (raw.includes('4K')) return '4K';
  if (raw.includes('2K')) return '2K';
  return raw;
}

function parseDurationSeconds(value: unknown, fallback = 8): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(1, Math.floor(value));
  }
  const matched = String(value || '').match(/(\d+)/);
  return matched ? Math.max(1, Number.parseInt(matched[1], 10) || fallback) : fallback;
}

function buildVideoRawName(model: Pick<VideoLike, 'name' | 'apiModel'>, config?: VideoConfigObject): string {
  return [
    model.name,
    model.apiModel,
    config?.quality_version,
    config?.model_version,
    config?.version,
    config?.generation_mode,
  ]
    .map((item) => normalizeCompactText(item))
    .filter(Boolean)
    .join(' ');
}

function resolveImagePricingKey(model: Pick<ImageLike, 'name' | 'apiModel' | 'defaultImageSize'>, imageSize?: string): string | null {
  const raw = `${normalizeCompactText(model.name)} ${normalizeCompactText(model.apiModel)}`;
  const resolvedSize = normalizeImageSize(imageSize || model.defaultImageSize);

  if (/gpt.?image.?2|gpt image 2/.test(raw)) {
    return resolvedSize === '2K' || resolvedSize === '4K' ? 'gpt_image2_2k4k' : 'gpt_image2';
  }

  if (/nano banana|nanobanana/.test(raw)) {
    if (resolvedSize === '4K') return 'nanobanana_pro_4k';
    if (resolvedSize === '2K') return 'nanobanana_pro_2k';
    return 'nanobanana';
  }

  return null;
}

function resolveVideoPricingKey(
  model: Pick<VideoLike, 'name' | 'apiModel'>,
  duration?: string | number,
  videoConfigObject?: VideoConfigObject
): string | null {
  const seconds = parseDurationSeconds(duration ?? videoConfigObject?.video_length, 8);
  const resolution = normalizeVideoResolution(videoConfigObject?.resolution);
  const raw = buildVideoRawName(model, videoConfigObject);

  if (/sora.?2|sora 2/.test(raw)) {
    return 'sora2_12s';
  }

  if (!/veo/.test(raw)) {
    return null;
  }

  if ((/omni/.test(raw) && /flash/.test(raw)) || (/omni/.test(raw) && seconds >= 10)) {
    return 'veo31_omni_flash_10s';
  }

  const isHighQuality =
    /高质量|high quality|quality|hq|pro/.test(raw)
    && !/lite|flash|fast|quick|快速/.test(raw);

  const normalizedResolution = resolution === '1080P' ? '1080P' : '720P';

  if (isHighQuality) {
    return normalizedResolution === '1080P' ? 'veo31_high_1080p_8s' : 'veo31_high_720p_8s';
  }

  return normalizedResolution === '1080P' ? 'veo31_fast_1080p_8s' : 'veo31_fast_720p_8s';
}

function getTierPrice(table: Record<string, TierPricePoints>, key: string | null, level: MembershipLevel): number | null {
  if (!key) return null;
  const row = table[key];
  if (!row) return null;
  return row[level] ?? null;
}

function normalizeTierPrice(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed);
}

function getModelTierPrice(
  model: Pick<ImageLike | VideoLike, 'normalPrice' | 'vipPrice' | 'svipPrice'>,
  level: MembershipLevel
): number | null {
  const direct =
    level === 'svip'
      ? model.svipPrice
      : level === 'vip'
        ? model.vipPrice
        : model.normalPrice;
  return normalizeTierPrice(direct);
}

function getRuleTierPrice(
  rule: Pick<ImagePricingRule | VideoPricingRule, 'normalPrice' | 'vipPrice' | 'svipPrice'>,
  level: MembershipLevel
): number | null {
  const direct =
    level === 'svip'
      ? rule.svipPrice
      : level === 'vip'
        ? rule.vipPrice
        : rule.normalPrice;
  return normalizeTierPrice(direct);
}

function isRuleEnabled(enabled?: boolean): boolean {
  return enabled !== false;
}

function normalizeGenerationMode(value: unknown): string {
  return normalizeCompactText(value);
}

function normalizeQualityVersion(value: unknown): string {
  return normalizeCompactText(value);
}

function normalizeModelVersion(value: unknown): string {
  return normalizeCompactText(value);
}

function normalizeVersion(value: unknown): string {
  return normalizeCompactText(value);
}

function findImagePricingRule(
  model: Pick<ImageLike, 'pricingRules' | 'defaultAspectRatio' | 'defaultImageSize'>,
  options: { imageSize?: string; aspectRatio?: string; quality?: string }
): ImagePricingRule | null {
  const rules = Array.isArray(model.pricingRules) ? model.pricingRules : [];
  if (rules.length === 0) return null;

  const requestedSize = normalizeImageSize(options.imageSize || model.defaultImageSize);
  const requestedAspectRatio = normalizeAspectRatio(options.aspectRatio || model.defaultAspectRatio);
  const requestedQuality = normalizeCompactText(options.quality);

  let bestRule: ImagePricingRule | null = null;
  let bestScore = -1;

  for (const rule of rules) {
    if (!isRuleEnabled(rule.enabled)) continue;

    const checks: Array<[string | undefined, string]> = [
      [rule.imageSize, requestedSize],
      [rule.aspectRatio, requestedAspectRatio],
      [rule.quality, requestedQuality],
    ];

    let score = 0;
    let matched = true;

    for (const [ruleValue, requestValue] of checks) {
      const normalizedRuleValue = normalizeCompactText(ruleValue);
      if (!normalizedRuleValue) continue;
      if (!requestValue || normalizedRuleValue !== requestValue) {
        matched = false;
        break;
      }
      score += 1;
    }

    if (matched && score > bestScore) {
      bestRule = rule;
      bestScore = score;
    }
  }

  return bestRule;
}

function findVideoPricingRule(
  model: Pick<VideoLike, 'pricingRules' | 'defaultDuration' | 'defaultAspectRatio' | 'videoConfigObject'>,
  options: { duration?: string | number; videoConfigObject?: VideoConfigObject; aspectRatio?: string }
): VideoPricingRule | null {
  const rules = Array.isArray(model.pricingRules) ? model.pricingRules : [];
  if (rules.length === 0) return null;

  const config = options.videoConfigObject || model.videoConfigObject;
  const requestedDuration = `${parseDurationSeconds(options.duration ?? config?.video_length ?? model.defaultDuration, 8)}s`;
  const requestedAspectRatio = normalizeAspectRatio(
    options.aspectRatio || config?.aspect_ratio || model.defaultAspectRatio
  );
  const requestedResolution = normalizeVideoResolution(config?.resolution);
  const requestedQualityVersion = normalizeQualityVersion(config?.quality_version);
  const requestedModelVersion = normalizeModelVersion(config?.model_version);
  const requestedVersion = normalizeVersion(config?.version);
  const requestedGenerationMode = normalizeGenerationMode(config?.generation_mode);
  const requestedOffPeak = typeof config?.off_peak === 'boolean' ? config.off_peak : undefined;

  let bestRule: VideoPricingRule | null = null;
  let bestScore = -1;

  for (const rule of rules) {
    if (!isRuleEnabled(rule.enabled)) continue;

    const checks: Array<[string | undefined, string]> = [
      [rule.duration, normalizeCompactText(requestedDuration)],
      [rule.aspectRatio, requestedAspectRatio],
      [rule.resolution, normalizeCompactText(requestedResolution)],
      [rule.qualityVersion, requestedQualityVersion],
      [rule.modelVersion, requestedModelVersion],
      [rule.version, requestedVersion],
      [rule.generationMode, requestedGenerationMode],
    ];

    let score = 0;
    let matched = true;

    for (const [ruleValue, requestValue] of checks) {
      const normalizedRuleValue = normalizeCompactText(ruleValue);
      if (!normalizedRuleValue) continue;
      if (!requestValue || normalizedRuleValue !== requestValue) {
        matched = false;
        break;
      }
      score += 1;
    }

    if (matched && typeof rule.offPeak === 'boolean') {
      if (requestedOffPeak === undefined || requestedOffPeak !== rule.offPeak) {
        matched = false;
      } else {
        score += 1;
      }
    }

    if (matched && score > bestScore) {
      bestRule = rule;
      bestScore = score;
    }
  }

  return bestRule;
}

function resolveLegacyVideoCost(model: VideoLike, duration?: string | number): number {
  const seconds = parseDurationSeconds(duration || model.defaultDuration, 8);
  const durationValue = typeof duration === 'string' ? duration.trim() : '';
  const legacyCost =
    (durationValue
      ? model.durations?.find((item) => item.value.trim().toLowerCase() === durationValue.toLowerCase())?.cost
      : undefined)
    ?? model.durations?.find((item) => item.value === model.defaultDuration)?.cost
    ?? model.durations?.find((item) => parseDurationSeconds(item.value, seconds) === seconds)?.cost
    ?? model.durations?.[0]?.cost
    ?? 0;

  return calculateBillingCost({
    billingMode: model.billingMode,
    billingPrice: model.billingPrice,
    billingUnit: model.billingUnit,
    legacyCost,
    seconds,
  });
}

function resolveLegacyImageCost(model: ImageLike): number {
  return calculateBillingCost({
    billingMode: model.billingMode,
    billingPrice: model.billingPrice,
    billingUnit: model.billingUnit,
    legacyCost: model.costPerGeneration,
  });
}

export function normalizeMembershipLevel(value: unknown): MembershipLevel {
  if (value === 'vip' || value === 'svip') return value;
  return 'normal';
}

export function compareMembershipLevel(a: MembershipLevel, b: MembershipLevel): number {
  return MEMBERSHIP_PRIORITY[a] - MEMBERSHIP_PRIORITY[b];
}

export function getEffectiveMembershipLevel(context?: MembershipContext, now = Date.now()): MembershipLevel {
  const level = normalizeMembershipLevel(context?.membershipLevel);
  if (level === 'normal') return 'normal';

  const expiresAt = Number(context?.membershipExpiresAt || 0);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) {
    return 'normal';
  }

  return level;
}

export function getRechargeTierByAmount(amount: number): { level: MembershipLevel; days: number } | null {
  const safeAmount = Number(amount);
  if (!Number.isFinite(safeAmount) || safeAmount <= 0) return null;

  if (safeAmount >= 4000) return { level: 'svip', days: 180 };
  if (safeAmount >= 798) return { level: 'vip', days: 90 };
  if (safeAmount >= 200) return { level: 'normal', days: 90 };
  return null;
}

export function resolveMembershipUpdate(
  current: MembershipContext,
  amount: number,
  now = Date.now()
): { membershipLevel: MembershipLevel; membershipExpiresAt: number } | null {
  const tier = getRechargeTierByAmount(amount);
  if (!tier) return null;

  const currentLevel = getEffectiveMembershipLevel(current, now);
  const activeExpiresAt = Number(current?.membershipExpiresAt || 0);
  const baseExpiry = Number.isFinite(activeExpiresAt) && activeExpiresAt > now ? activeExpiresAt : now;
  const nextLevel =
    compareMembershipLevel(currentLevel, tier.level) >= 0 ? currentLevel : tier.level;

  return {
    membershipLevel: nextLevel,
    membershipExpiresAt: baseExpiry + tier.days * DAY_MS,
  };
}

export function resolveImageGenerationCost(options: {
  user?: MembershipContext;
  model: ImageLike;
  imageSize?: string;
  aspectRatio?: string;
  quality?: string;
}): number {
  const level = getEffectiveMembershipLevel(options.user);
  const matchedRule = findImagePricingRule(options.model, options);
  const rulePrice = matchedRule ? getRuleTierPrice(matchedRule, level) : null;
  if (rulePrice !== null) return rulePrice;

  const modelPrice = getModelTierPrice(options.model, level);
  if (modelPrice !== null) return modelPrice;

  const key = resolveImagePricingKey(options.model, options.imageSize);
  const explicitPrice = getTierPrice(IMAGE_PRICE_POINTS, key, level);
  if (explicitPrice !== null) return explicitPrice;

  return resolveLegacyImageCost(options.model);
}

export function resolveVideoGenerationCost(options: {
  user?: MembershipContext;
  model: VideoLike;
  duration?: string | number;
  videoConfigObject?: VideoConfigObject;
  aspectRatio?: string;
}): number {
  const level = getEffectiveMembershipLevel(options.user);
  const matchedRule = findVideoPricingRule(options.model, options);
  const rulePrice = matchedRule ? getRuleTierPrice(matchedRule, level) : null;
  if (rulePrice !== null) return rulePrice;

  const modelPrice = getModelTierPrice(options.model, level);
  if (modelPrice !== null) return modelPrice;

  const key = resolveVideoPricingKey(options.model, options.duration, options.videoConfigObject);
  const explicitPrice = getTierPrice(VIDEO_PRICE_POINTS, key, level);
  if (explicitPrice !== null) return explicitPrice;

  return resolveLegacyVideoCost(options.model, options.duration);
}

export function getImagePricingPreviewLabel(model: ImageLike, imageSize?: string): string | null {
  const rule = findImagePricingRule(model, { imageSize });
  const rulePrice = rule ? getRuleTierPrice(rule, 'normal') : null;
  if (rulePrice !== null) return `${rulePrice} 积分 / 张`;

  const modelPrice = getModelTierPrice(model, 'normal');
  if (modelPrice !== null) return `${modelPrice} 积分 / 张`;

  const key = resolveImagePricingKey(model, imageSize);
  const price = getTierPrice(IMAGE_PRICE_POINTS, key, 'normal');
  return price === null ? null : `${price} 积分 / 张`;
}

export function getVideoPricingPreviewLabel(
  model: VideoLike,
  duration?: string | number,
  videoConfigObject?: VideoConfigObject
): string | null {
  const matchedRule = findVideoPricingRule(model, { duration, videoConfigObject });
  const rulePrice = matchedRule ? getRuleTierPrice(matchedRule, 'normal') : null;
  if (rulePrice !== null) {
    return `${rulePrice} 积分 / 条`;
  }

  const modelPrice = getModelTierPrice(model, 'normal');
  if (modelPrice !== null) {
    return model.billingMode === 'per_call'
      ? `${modelPrice} 积分 / 条`
      : formatBillingSummary({
          billingMode: model.billingMode,
          billingPrice: modelPrice,
          billingUnit: model.billingUnit,
        });
  }

  const key = resolveVideoPricingKey(model, duration, videoConfigObject);
  const explicitPrice = getTierPrice(VIDEO_PRICE_POINTS, key, 'normal');
  if (explicitPrice !== null) {
    return `${explicitPrice} 积分 / 条`;
  }

  const fallback = resolveLegacyVideoCost(model, duration);
  if (fallback <= 0) return null;

  return formatBillingSummary({
    billingMode: model.billingMode,
    billingPrice: model.billingPrice,
    billingUnit: model.billingUnit,
    legacyCost: fallback,
    seconds: parseDurationSeconds(duration ?? videoConfigObject?.video_length ?? model.defaultDuration, 8),
  });
}
