import type { ImageModelFeatures, ImagePricingRule } from '@/types';
import { resolveImageModelImage } from '@/lib/model-images';

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

export type LingkeRemoteApiImageModel = {
  name: string;
  display_name?: string;
  type?: string;
  description?: string;
  input_hint?: string;
  tags?: string[];
  params?: LingkeRemoteApiParam[];
};

export type LingkeSyncedImageModel = {
  apiModel: string;
  matchKeys?: string[];
  name: string;
  description: string;
  features: ImageModelFeatures;
  aspectRatios: string[];
  resolutions: Record<string, string | Record<string, string>>;
  imageSizes?: string[];
  defaultAspectRatio: string;
  defaultImageSize?: string;
  requiresReferenceImage: boolean;
  allowEmptyPrompt: boolean;
  costPerGeneration: number;
  billingMode: 'per_call';
  billingPrice: number;
  billingUnit: number;
  pricingRules: ImagePricingRule[];
  imageUrl?: string;
  highlight?: boolean;
};

const DEFAULT_COST = 20;
const COMMON_RATIO_ORDER = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '4:5', '5:4', '21:9', '4:1', '1:4', '8:1', '1:8'];
const COMMON_SIZE_ORDER = ['0.5K', '1K', '2K', '3K', '4K'];

const LINGKE_IMAGE_ALIAS_GROUPS: string[][] = [
  ['GPT Image 2 官转', 'GPT Image 2 Official'],
  ['VIDU Image 2', 'VIDU Iamge 2'],
  ['万相 2.7 图像', 'Wanxiang 2.7 Image'],
  ['万相 2.6 图像', 'Wanxiang 2.6 Image'],
  ['Qwen-image-max', 'Qwen-image'],
  ['Kling o1', 'Kling O1'],
];
const KNOWN_VIDEO_ONLY_IMAGE_ENDPOINT_MODELS = new Set([
  'kling-v3',
  'kling-v3-omni',
  'kling-v3-video',
]);
const KNOWN_IMAGE_ENDPOINT_ALLOWLIST = new Set([
  'kling-image-o1',
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

export function getLingkeImageAliases(...values: Array<string | null | undefined>): string[] {
  const direct = dedupeStrings(values);
  const lowered = new Set(direct.map((item) => item.toLowerCase()));
  const aliases = [...direct];

  for (const group of LINGKE_IMAGE_ALIAS_GROUPS) {
    if (group.some((item) => lowered.has(item.toLowerCase()))) {
      aliases.push(...group);
    }
  }

  return dedupeStrings(aliases);
}

function getRemoteParams(remote: LingkeRemoteApiImageModel): LingkeRemoteApiParam[] {
  return Array.isArray(remote.params) ? remote.params.filter(Boolean) : [];
}

function findRemoteParam(remote: LingkeRemoteApiImageModel, names: string[]): LingkeRemoteApiParam | undefined {
  const lowerNames = names.map((name) => name.toLowerCase());
  return getRemoteParams(remote).find((param) => lowerNames.includes(normalizeName(param.name).toLowerCase()));
}

function getParamOptions(param?: LingkeRemoteApiParam): LingkeRemoteApiParamOption[] {
  return Array.isArray(param?.options) ? param.options.filter(Boolean) : [];
}

function buildRemoteCapabilityText(remote: LingkeRemoteApiImageModel): string {
  return [
    remote.name,
    remote.display_name,
    remote.type,
    remote.description,
    remote.input_hint,
    ...(remote.tags || []),
    ...getRemoteParams(remote).flatMap((param) => [
      param.name,
      param.label,
      param.type,
      param.description,
      ...getParamOptions(param).flatMap((option) => [option.value, option.label, option.description]),
    ]),
  ]
    .map((item) => normalizeName(item).toLowerCase())
    .filter(Boolean)
    .join(' ');
}

function isLikelyImageOnlyModel(remote: LingkeRemoteApiImageModel): boolean {
  const apiModel = normalizeName(remote.name).toLowerCase();
  const displayName = normalizeName(remote.display_name).toLowerCase();
  if (!apiModel && !displayName) return false;

  if (
    KNOWN_IMAGE_ENDPOINT_ALLOWLIST.has(apiModel)
    || KNOWN_IMAGE_ENDPOINT_ALLOWLIST.has(displayName)
  ) {
    return true;
  }

  if (
    KNOWN_VIDEO_ONLY_IMAGE_ENDPOINT_MODELS.has(apiModel)
    || KNOWN_VIDEO_ONLY_IMAGE_ENDPOINT_MODELS.has(displayName)
  ) {
    return false;
  }

  const capabilityText = buildRemoteCapabilityText(remote);
  const explicitVideoSignals = [
    /\bvideo generation model\b/i,
    /\btext[-\s]?to[-\s]?video\b/i,
    /\bimage[-\s]?to[-\s]?video\b/i,
    /\breference[-\s]?based video\b/i,
    /\bmotion control\b/i,
    /\bvideo editing\b/i,
    /\bvideo duration\b/i,
    /\bfirst frame\b/i,
    /\bfirst\/last\b/i,
    /\bwith audio\b/i,
    /\bsilent visual-only\b/i,
    /视频生成/,
    /视频续写/,
    /视频参考/,
    /首尾帧/,
    /动作控制/,
  ].some((pattern) => pattern.test(capabilityText));

  if (explicitVideoSignals) {
    return false;
  }

  const remoteParamNames = new Set(
    getRemoteParams(remote).map((param) => normalizeName(param.name).toLowerCase())
  );
  const videoOnlyParamNames = [
    'duration',
    'sound',
    'audio_url',
    'video_url',
    'reference_video',
    'clips',
    'lip_ref_url',
  ];
  if (videoOnlyParamNames.some((name) => remoteParamNames.has(name))) {
    return false;
  }

  return true;
}

function normalizeAspectRatioValue(value: string): string | null {
  const raw = normalizeName(value).toLowerCase();
  if (!raw || raw === 'auto' || raw === 'adaptive') return null;
  if (raw === 'square') return '1:1';
  if (raw === 'portrait') return '9:16';
  if (raw === 'landscape') return '16:9';

  const matched = raw.match(/(\d+)\s*[:/x_]\s*(\d+)/);
  if (matched) {
    const left = Number.parseInt(matched[1], 10);
    const right = Number.parseInt(matched[2], 10);
    if (left > 50 || right > 50) {
      const known = [
        '1:1',
        '2:3',
        '3:2',
        '3:4',
        '4:3',
        '4:5',
        '5:4',
        '9:16',
        '16:9',
        '21:9',
        '1:4',
        '4:1',
        '1:8',
        '8:1',
      ];
      const actual = left / Math.max(right, 1);
      let best: string | null = null;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const ratio of known) {
        const [w, h] = ratio.split(':').map((item) => Number.parseInt(item, 10));
        const distance = Math.abs(actual - w / Math.max(h, 1));
        if (distance < bestDistance) {
          bestDistance = distance;
          best = ratio;
        }
      }
      return bestDistance <= 0.2 ? best : null;
    }
    return `${left}:${right}`;
  }

  if (raw.includes('ultrawide')) return '21:9';
  if (raw.includes('very portrait')) return '1:8';
  if (raw.includes('very landscape')) return '8:1';
  if (raw.includes('widescreen')) return '16:9';

  return null;
}

function extractAspectRatioFromOption(option: LingkeRemoteApiParamOption): string | null {
  return (
    normalizeAspectRatioValue(option.label || '') ||
    normalizeAspectRatioValue(option.description || '') ||
    normalizeAspectRatioValue(option.value || '')
  );
}

function parseResolutionPairs(text: string): string[] {
  return normalizeName(text).match(/\d{3,5}\s*[x×]\s*\d{3,5}/gi)?.map((item) => item.replace(/\s+/g, '')) || [];
}

function normalizeResolutionText(value: string): string {
  return value.replace(/×/g, 'x').replace(/\s+/g, '');
}

function inferImageSizeBucket(
  option: LingkeRemoteApiParamOption,
  resolutionText?: string,
): string | null {
  const joined = [option.value, option.label, option.description, resolutionText]
    .map((item) => normalizeName(item).toUpperCase())
    .join(' ');

  const explicit = joined.match(/(?:^|[^0-9])(0\.5K|1K|2K|3K|4K)(?:[^0-9]|$)/);
  if (explicit) return explicit[1];

  const matched = normalizeName(resolutionText).match(/(\d{3,5})\s*[x×]\s*(\d{3,5})/i);
  if (!matched) return null;
  const width = Number.parseInt(matched[1], 10);
  const height = Number.parseInt(matched[2], 10);
  const maxSide = Math.max(width, height);
  if (!Number.isFinite(maxSide)) return null;
  if (maxSide >= 3800) return '4K';
  if (maxSide >= 2500) return '2K';
  if (maxSide >= 1800) return '2K';
  if (maxSide >= 1000) return '1K';
  return null;
}

function buildSizeOrderMap(values: string[]): string[] {
  return [...values].sort((left, right) => {
    const leftIndex = COMMON_SIZE_ORDER.indexOf(left);
    const rightIndex = COMMON_SIZE_ORDER.indexOf(right);
    return (leftIndex === -1 ? 99 : leftIndex) - (rightIndex === -1 ? 99 : rightIndex);
  });
}

function buildRatioOrderMap(values: string[]): string[] {
  return [...values].sort((left, right) => {
    const leftIndex = COMMON_RATIO_ORDER.indexOf(left);
    const rightIndex = COMMON_RATIO_ORDER.indexOf(right);
    return (leftIndex === -1 ? 99 : leftIndex) - (rightIndex === -1 ? 99 : rightIndex);
  });
}

function extractAspectRatios(remote: LingkeRemoteApiImageModel): string[] {
  const params = [
    findRemoteParam(remote, ['aspect_ratio', 'aspectRatio']),
    findRemoteParam(remote, ['size']),
  ];

  const values = params.flatMap((param) =>
    getParamOptions(param)
      .map((option) => extractAspectRatioFromOption(option))
      .filter((value): value is string => Boolean(value))
  );

  const unique = buildRatioOrderMap(dedupeStrings(values));
  if (unique.length > 0) return unique;

  return ['1:1', '16:9', '9:16'];
}

function extractImageSizes(remote: LingkeRemoteApiImageModel): string[] {
  const params = [
    findRemoteParam(remote, ['imageSize', 'resolution']),
    findRemoteParam(remote, ['size']),
  ];

  const values = params.flatMap((param) =>
    getParamOptions(param)
      .map((option) => inferImageSizeBucket(option))
      .filter((value): value is string => Boolean(value))
  );

  return buildSizeOrderMap(dedupeStrings(values));
}

function buildDirectRatioResolutions(
  remote: LingkeRemoteApiImageModel,
  aspectRatios: string[],
): Record<string, string> {
  const ratioParam =
    findRemoteParam(remote, ['aspect_ratio', 'aspectRatio']) ||
    findRemoteParam(remote, ['size']);

  const options = getParamOptions(ratioParam);
  const ratioMap: Record<string, string> = {};

  for (const option of options) {
    const ratio = extractAspectRatioFromOption(option);
    if (!ratio || !aspectRatios.includes(ratio)) continue;
    const resolutions =
      parseResolutionPairs(option.description || '').map(normalizeResolutionText);
    ratioMap[ratio] = resolutions[0] || ratio;
  }

  for (const ratio of aspectRatios) {
    if (!ratioMap[ratio]) ratioMap[ratio] = ratio;
  }

  return ratioMap;
}

function buildCombinedSizeResolutions(
  remote: LingkeRemoteApiImageModel,
  aspectRatios: string[],
  imageSizes: string[],
): Record<string, Record<string, string>> {
  const ratioParam =
    findRemoteParam(remote, ['aspect_ratio', 'aspectRatio']) ||
    findRemoteParam(remote, ['size']);
  const sizeParam =
    findRemoteParam(remote, ['imageSize', 'resolution']) ||
    findRemoteParam(remote, ['size']);

  const sizeMap: Record<string, Record<string, string>> = {};
  imageSizes.forEach((size) => {
    sizeMap[size] = {};
  });

  const sizeOptions = getParamOptions(sizeParam);
  const ratioOptions = getParamOptions(ratioParam);

  const sizeModelEntries = sizeOptions
    .map((option) => {
      const ratio = extractAspectRatioFromOption(option);
      const resolutionValues = parseResolutionPairs(option.label || '')
        .concat(parseResolutionPairs(option.description || ''))
        .concat(parseResolutionPairs(option.value || ''))
        .map(normalizeResolutionText);
      const imageSize = inferImageSizeBucket(option, resolutionValues[0] || option.value || option.label || option.description || '');
      return { ratio, imageSize, resolutionValues };
    })
    .filter((item) => item.ratio && item.imageSize) as Array<{
      ratio: string;
      imageSize: string;
      resolutionValues: string[];
    }>;

  if (sizeModelEntries.length > 0) {
    for (const entry of sizeModelEntries) {
      if (!sizeMap[entry.imageSize]) sizeMap[entry.imageSize] = {};
      sizeMap[entry.imageSize][entry.ratio] = entry.resolutionValues[0] || entry.imageSize;
    }
  } else {
    for (const option of ratioOptions) {
      const ratio = extractAspectRatioFromOption(option);
      if (!ratio) continue;
      const resolutions = parseResolutionPairs(option.description || '').map(normalizeResolutionText);
      const matchesByCount = resolutions.length === imageSizes.length;
      imageSizes.forEach((size, index) => {
        sizeMap[size][ratio] = matchesByCount ? resolutions[index] || size : size;
      });
    }
  }

  for (const size of imageSizes) {
    if (!sizeMap[size]) sizeMap[size] = {};
    for (const ratio of aspectRatios) {
      if (!sizeMap[size][ratio]) {
        sizeMap[size][ratio] = size;
      }
    }
  }

  return sizeMap;
}

function buildResolutions(
  remote: LingkeRemoteApiImageModel,
  aspectRatios: string[],
  imageSizes: string[],
): Record<string, string | Record<string, string>> {
  if (imageSizes.length > 0) {
    return buildCombinedSizeResolutions(remote, aspectRatios, imageSizes);
  }
  return buildDirectRatioResolutions(remote, aspectRatios);
}

function extractQualityOptions(remote: LingkeRemoteApiImageModel): string[] {
  const qualityParam = findRemoteParam(remote, ['quality']);
  const values = getParamOptions(qualityParam)
    .map((option) => normalizeName(option.value || option.label).toLowerCase())
    .filter(Boolean)
    .map((value) => {
      if (value === 'auto' || value === 'adaptive') return 'auto';
      return value;
    });

  return dedupeStrings(values);
}

function inferReferenceImageSupport(remote: LingkeRemoteApiImageModel): {
  imageToImage: boolean;
  multipleImages: boolean;
  requiresReferenceImage: boolean;
} {
  const param = findRemoteParam(remote, ['images']);
  if (!param) {
    return {
      imageToImage: false,
      multipleImages: false,
      requiresReferenceImage: false,
    };
  }

  const joined = [param.label, param.description, remote.description]
    .map((item) => normalizeName(item).toLowerCase())
    .join(' ');

  const countMatch = joined.match(/(\d+)\s*-\s*(\d+)/);
  const maxCount = countMatch ? Number.parseInt(countMatch[2], 10) : 1;

  return {
    imageToImage: true,
    multipleImages: Number.isFinite(maxCount) ? maxCount > 1 : /multi|fusion|1-10|1-14|1-9|1-4/.test(joined),
    requiresReferenceImage: param.required === true,
  };
}

function resolveDisplayName(remote: LingkeRemoteApiImageModel): string {
  const apiModel = normalizeName(remote.name);
  const displayName = normalizeName(remote.display_name);
  const known = apiModel.toLowerCase();

  if (known === 'gpt-image-2-guan') return 'GPT Image 2 官转';
  if (known === 'wan2.7-image') return '万相 2.7 图像';
  if (known === 'wan2.6-image') return '万相 2.6 图像';
  if (known === 'vidu-image-2') return 'VIDU Image 2';
  if (known === 'qwen-image') return 'Qwen-image-max';

  return displayName || apiModel;
}

function buildDescription(remote: LingkeRemoteApiImageModel): string {
  const description = normalizeName(remote.description);
  if (description) return description;
  return '灵刻媒体图片模型';
}

export function mapLingkeRemoteImageModel(remote: LingkeRemoteApiImageModel): LingkeSyncedImageModel {
  const apiModel = normalizeName(remote.name);
  const name = resolveDisplayName(remote);
  const matchKeys = getLingkeImageAliases(apiModel, name, remote.display_name);
  const aspectRatios = extractAspectRatios(remote);
  const imageSizes = extractImageSizes(remote);
  const qualityOptions = extractQualityOptions(remote);
  const referenceSupport = inferReferenceImageSupport(remote);

  const features: ImageModelFeatures = {
    textToImage: true,
    imageToImage: referenceSupport.imageToImage,
    upscale: /upscale/i.test(apiModel),
    matting: /matting|rmbg/i.test(apiModel),
    multipleImages: referenceSupport.multipleImages,
    imageSize: imageSizes.length > 0,
    ...(qualityOptions.length > 0 ? { qualityOptions } : {}),
  };

  const resolutions = buildResolutions(remote, aspectRatios, imageSizes);
  const defaultAspectRatio =
    aspectRatios.find((ratio) => ratio === '1:1') ||
    aspectRatios.find((ratio) => ratio === '16:9') ||
    aspectRatios[0] ||
    '1:1';
  const defaultImageSize =
    imageSizes.find((size) => size === '1K') ||
    imageSizes.find((size) => size === '2K') ||
    imageSizes[0];

  return {
    apiModel,
    matchKeys,
    name,
    description: buildDescription(remote),
    features,
    aspectRatios,
    resolutions,
    imageSizes: imageSizes.length > 0 ? imageSizes : undefined,
    defaultAspectRatio,
    defaultImageSize,
    requiresReferenceImage: referenceSupport.requiresReferenceImage,
    allowEmptyPrompt: findRemoteParam(remote, ['prompt'])?.required === false,
    costPerGeneration: DEFAULT_COST,
    billingMode: 'per_call',
    billingPrice: DEFAULT_COST,
    billingUnit: 1,
    pricingRules: [],
    imageUrl: resolveImageModelImage({ name, apiModel }),
    highlight: true,
  };
}

export async function fetchLingkeRemoteImageModels(
  baseUrl: string,
  apiKey: string,
): Promise<LingkeRemoteApiImageModel[]> {
  const normalizedBaseUrl = normalizeName(baseUrl).replace(/\/$/, '');
  const normalizedApiKey = normalizeName(apiKey).split(',')[0]?.trim() || '';
  if (!normalizedBaseUrl || !normalizedApiKey) {
    throw new Error('灵刻媒体图像渠道缺少 Base URL 或 API Key');
  }

  const response = await fetch(`${normalizedBaseUrl}/v1/media/models?type=image`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${normalizedApiKey}`,
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    const details = await response.text().catch(() => '');
    throw new Error(`拉取灵刻图片模型失败 (${response.status})${details ? `: ${details}` : ''}`);
  }

  const data = await response.json().catch(() => ({}));
  const models = Array.isArray(data?.models) ? data.models : [];
  return models
    .filter((item: LingkeRemoteApiImageModel) => normalizeName(item?.name))
    .filter((item: LingkeRemoteApiImageModel) => {
      const allowed = isLikelyImageOnlyModel(item);
      if (!allowed) {
        console.warn(
          `[LingkeImageSync] Skip video-like model returned by image endpoint: ${normalizeName(item.display_name) || normalizeName(item.name)}`
        );
      }
      return allowed;
    });
}

export async function fetchLingkeSyncedImageModelsForChannel(options: {
  baseUrl?: string;
  apiKey?: string;
} = {}): Promise<LingkeSyncedImageModel[]> {
  const remoteModels = await fetchLingkeRemoteImageModels(
    options.baseUrl || 'https://api.lingkeai.ai',
    options.apiKey || '',
  );

  return remoteModels
    .map((item) => mapLingkeRemoteImageModel(item))
    .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
}
