import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { createVideoModel, getVideoChannel, getVideoModels, updateVideoModel } from '@/lib/db';
import {
  buildVideoModelDescription,
  estimateVideoDurationCost,
  getVeoDisplayName,
  getVeoGroupKey,
  inferVideoBillingProfile,
  isVeoApiModel,
} from '@/lib/video-model-normalizer';
import type { BillingMode, VideoChannel, VideoConfigObject, VideoDuration, VideoModelFeatures, VideoPricingRule } from '@/types';
import type { LingkeSyncedVideoModel } from '@/lib/lingke-video-pricing';
import { fetchLingkeSyncedVideoModelsForChannel, getLingkeVideoAliases } from '@/lib/lingke-video-sync';

export const dynamic = 'force-dynamic';

type RemoteModel = {
  id: string;
  owned_by?: string;
  type?: string;
  modality?: string;
  description?: string;
  pricing?: unknown;
  billing?: unknown;
  price?: unknown;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
};

type VideoCategory = 't2v' | 'i2v' | 'r2v' | 'interpolation' | 'upsample';

type ClassifiedVideoModel = {
  apiModel: string;
  matchKeys?: string[];
  name: string;
  description: string;
  category: VideoCategory;
  categoryLabel: string;
  features: VideoModelFeatures;
  aspectRatios: Array<{ value: string; label: string }>;
  defaultAspectRatio: string;
  durations: VideoDuration[];
  defaultDuration: string;
  billingMode: BillingMode;
  billingPrice: number;
  billingUnit: number;
  normalPrice?: number;
  vipPrice?: number;
  svipPrice?: number;
  pricingRules?: VideoPricingRule[];
  videoConfigObject?: VideoConfigObject;
  imageUrl?: string;
  highlight?: boolean;
  sourceModelIds?: string[];
};

type ImportRequestBody = {
  channelId?: string;
  modelIds?: string[];
  overwrite?: boolean;
};

const CATEGORY_ORDER: Record<VideoCategory, number> = {
  t2v: 1,
  i2v: 2,
  r2v: 3,
  interpolation: 4,
  upsample: 5,
};

const CATEGORY_LABELS: Record<VideoCategory, string> = {
  t2v: '文生视频',
  i2v: '图生视频',
  r2v: '多图视频',
  interpolation: '首尾帧视频',
  upsample: '视频放大',
};

const CATEGORY_DESCRIPTION: Record<VideoCategory, string> = {
  t2v: '不支持上传图片',
  i2v: '支持 1-2 张图片（首帧/首尾帧）',
  r2v: '支持多张参考图片',
  interpolation: '支持首尾帧插帧生成',
  upsample: '用于视频放大输出',
};

function inferDurationSeconds(_modelId: string): 8 {
  return 8;
}

function inferDurationCost(modelId: string, category: VideoCategory, seconds: 8): number {
  const lower = modelId.toLowerCase();
  if (category === 'upsample') {
    if (/_4k$/.test(lower)) return 200;
    if (/_1080p$/.test(lower)) return 150;
    return 150;
  }
  return 100;
}

function inferAspectRatio(modelId: string): { value: string; label: string; zhLabel: string } {
  const lower = modelId.toLowerCase();
  if (lower.includes('portrait')) {
    return { value: 'portrait', label: '9:16', zhLabel: '竖屏' };
  }
  if (lower.includes('square')) {
    return { value: 'square', label: '1:1', zhLabel: '方屏' };
  }
  return { value: 'landscape', label: '16:9', zhLabel: '横屏' };
}

function inferOutputResolution(modelId: string): string | null {
  const lower = modelId.toLowerCase();
  if (/_4k$/.test(lower)) return '4K';
  if (/_1080p$/.test(lower)) return '1080P';
  return null;
}

function inferVeoVersionLabel(modelId: string): string {
  const lower = modelId.toLowerCase();
  const match = lower.match(/^veo_(\d+)_(\d+)/);
  if (match) return `Veo ${match[1]}.${match[2]}`;
  const fallback = lower.match(/^veo_(\d+)/);
  if (fallback) return `Veo ${fallback[1]}`;
  return 'Veo';
}

function inferModelTierLabel(modelId: string): string {
  const lower = modelId.toLowerCase();
  if (lower.includes('ultra_relaxed')) return 'Ultra Relaxed';
  if (lower.includes('ultra')) return 'Ultra';
  if (lower.includes('fast')) return 'Fast';
  return 'Standard';
}

function buildLocalizedName(params: {
  category: VideoCategory;
  orientationZh: string;
  seconds: 8;
  outputResolution: string | null;
  versionLabel: string;
  tierLabel: string;
}): string {
  const categoryLabel = CATEGORY_LABELS[params.category];
  if (params.category === 'upsample') {
    const output = params.outputResolution || '高清';
    return `${categoryLabel}（${output}）${params.versionLabel} ${params.tierLabel}`;
  }
  return `${categoryLabel}（${params.orientationZh} ${params.seconds}秒）${params.versionLabel} ${params.tierLabel}`;
}

function classifyFlow2ApiModel(model: RemoteModel): ClassifiedVideoModel | null {
  const modelId = model.id;
  const lower = modelId.toLowerCase();
  if (!lower.startsWith('veo_')) return null;

  const isUpsample = /_(4k|1080p)$/.test(lower);
  const isT2V = lower.includes('_t2v_');
  const isI2V = lower.includes('_i2v_');
  const isR2V = lower.includes('_r2v_');
  const isInterpolation = lower.includes('_interpolation_');
  if (!isT2V && !isI2V && !isR2V && !isInterpolation) return null;

  let category: VideoCategory;
  if (isUpsample) category = 'upsample';
  else if (isInterpolation) category = 'interpolation';
  else if (isI2V) category = 'i2v';
  else if (isR2V) category = 'r2v';
  else category = 't2v';

  const seconds = inferDurationSeconds(modelId);
  const duration = `${seconds}s`;
  const aspectRatio = inferAspectRatio(modelId);
  const outputResolution = inferOutputResolution(modelId);
  const versionLabel = inferVeoVersionLabel(modelId);
  const tierLabel = inferModelTierLabel(modelId);
  const legacyCost = inferDurationCost(modelId, category, seconds);
  let billing = inferVideoBillingProfile({
    channelType: 'flow2api',
    apiModel: modelId,
    remoteModel: model,
    fallbackMode: 'per_second',
    fallbackPrice: 12,
    fallbackUnit: 1,
  });

  if (category === 'upsample' && billing.inferredFrom !== 'remote') {
    billing = {
      billingMode: 'per_call',
      billingPrice: legacyCost,
      billingUnit: 1,
      inferredFrom: 'heuristic',
    };
  }

  const cost = estimateVideoDurationCost(duration, billing, legacyCost);

  const features: VideoModelFeatures = {
    textToVideo: true,
    imageToVideo: isI2V || isR2V || isInterpolation,
    videoToVideo: false,
    supportStyles: false,
  };

  const categoryLabel = CATEGORY_LABELS[category];
  const usage = CATEGORY_DESCRIPTION[category];
  const readableName = buildLocalizedName({
    category,
    orientationZh: aspectRatio.zhLabel,
    seconds,
    outputResolution,
    versionLabel,
    tierLabel,
  });
  const readableDescription = [
    usage,
    `方向: ${aspectRatio.zhLabel}`,
    category === 'upsample' ? `输出: ${outputResolution || '高清'}` : `时长: ${seconds}秒`,
    `版本: ${versionLabel}`,
    `等级: ${tierLabel}`,
  ].join(' | ');

  return {
    apiModel: modelId,
    name: readableName,
    description: readableDescription,
    category,
    categoryLabel,
    features,
    aspectRatios: [{ value: aspectRatio.value, label: aspectRatio.label }],
    defaultAspectRatio: aspectRatio.value,
    durations: [{ value: duration, label: `${seconds} 秒`, cost }],
    defaultDuration: duration,
    billingMode: billing.billingMode,
    billingPrice: billing.billingPrice,
    billingUnit: billing.billingUnit,
  };
}

function isApexerVideoRemoteModel(model: RemoteModel): boolean {
  const type = String(model.type || model.modality || '').toLowerCase();
  if (type) return type === 'video';

  const id = model.id.toLowerCase();
  if (id.includes('gpt-image') || id.includes('gemini') || id.includes('banana') || id.includes('image')) {
    return false;
  }
  return id === 'sora-2' || id === 'sora' || id.includes('sora') || id.includes('video');
}

function classifyApexerApiModel(model: RemoteModel): ClassifiedVideoModel | null {
  if (!isApexerVideoRemoteModel(model)) return null;

  const apiModel = model.id === 'sora' ? 'sora-2' : model.id;
  const billing = inferVideoBillingProfile({
    channelType: 'apexerapi',
    apiModel,
    remoteModel: model,
    fallbackMode: 'per_call',
    fallbackPrice: 96,
    fallbackUnit: 1,
  });

  return {
    apiModel,
    name: apiModel === 'sora-2' ? 'Sora 2' : `Sora (${apiModel})`,
    description: 'ApexerAPI /v1/videos 视频生成模型，SanHub 会统一按 sora-2 请求格式发送。',
    category: 't2v',
    categoryLabel: '视频生成',
    features: {
      textToVideo: true,
      imageToVideo: true,
      videoToVideo: false,
      supportStyles: false,
    },
    aspectRatios: [
      { value: 'landscape', label: '16:9' },
      { value: 'portrait', label: '9:16' },
    ],
    defaultAspectRatio: 'landscape',
    durations: [
      {
        value: '8s',
        label: '8 秒',
        cost: estimateVideoDurationCost('8s', billing, billing.billingPrice),
      },
      {
        value: '12s',
        label: '12 秒',
        cost: estimateVideoDurationCost('12s', billing, billing.billingPrice),
      },
      {
        value: '20s',
        label: '20 秒',
        cost: estimateVideoDurationCost('20s', billing, billing.billingPrice),
      },
    ],
    defaultDuration: '8s',
    billingMode: billing.billingMode,
    billingPrice: billing.billingPrice,
    billingUnit: billing.billingUnit,
  };
}


function mapLingkeModelToClassified(model: LingkeSyncedVideoModel): ClassifiedVideoModel {
  return {
    apiModel: model.apiModel,
    matchKeys: model.matchKeys,
    name: model.name,
    description: model.description,
    category: model.features.videoToVideo
      ? 'upsample'
      : model.videoConfigObject?.extra_params?.upload_mode === 'first_last_frame'
        ? 'interpolation'
        : model.features.imageToVideo
          ? 'i2v'
          : 't2v',
    categoryLabel: model.features.videoToVideo
      ? '视频编辑'
      : model.videoConfigObject?.extra_params?.upload_mode === 'first_last_frame'
        ? '首尾帧视频'
        : model.features.imageToVideo
          ? '图生视频'
          : '文生视频',
    features: model.features,
    aspectRatios: model.aspectRatios,
    defaultAspectRatio: model.defaultAspectRatio,
    durations: model.durations,
    defaultDuration: model.defaultDuration,
    billingMode: model.billingMode,
    billingPrice: model.billingPrice,
    billingUnit: model.billingUnit,
    normalPrice: model.normalPrice,
    vipPrice: model.vipPrice,
    svipPrice: model.svipPrice,
    pricingRules: model.pricingRules,
    videoConfigObject: model.videoConfigObject,
    imageUrl: model.imageUrl,
    highlight: model.highlight,
  };
}

function classifyRemoteVideoModels(
  channelType: VideoChannel['type'],
  remoteModels: RemoteModel[],
  lingkeModels: LingkeSyncedVideoModel[] = [],
): ClassifiedVideoModel[] {
  if (channelType === 'apexerapi') {
    return sortClassifiedModels(
      remoteModels
        .map((model) => classifyApexerApiModel(model))
        .filter((model): model is ClassifiedVideoModel => Boolean(model))
    );
  }

  if (channelType === 'lingke-media') {
    return sortClassifiedModels(lingkeModels.map(mapLingkeModelToClassified));
  }

  return sortClassifiedModels(
      remoteModels
        .map((model) => classifyFlow2ApiModel(model))
        .filter((model): model is ClassifiedVideoModel => Boolean(model))
  );
}

function sortClassifiedModels(models: ClassifiedVideoModel[]): ClassifiedVideoModel[] {
  return [...models].sort((left, right) => {
    const categoryOrder = CATEGORY_ORDER[left.category] - CATEGORY_ORDER[right.category];
    if (categoryOrder !== 0) return categoryOrder;
    return left.apiModel.localeCompare(right.apiModel);
  });
}

function uniqueAspectRatios(models: ClassifiedVideoModel[]): Array<{ value: string; label: string }> {
  const ratioMap = new Map<string, { value: string; label: string }>();
  for (const model of models) {
    for (const ratio of model.aspectRatios) {
      if (!ratioMap.has(ratio.value)) {
        ratioMap.set(ratio.value, ratio);
      }
    }
  }

  const order = ['landscape', 'portrait', 'square'];
  return Array.from(ratioMap.values()).sort((left, right) => {
    const leftIndex = order.indexOf(left.value);
    const rightIndex = order.indexOf(right.value);
    return (leftIndex === -1 ? 99 : leftIndex) - (rightIndex === -1 ? 99 : rightIndex);
  });
}

function mergeGroupedFeatures(models: ClassifiedVideoModel[]): VideoModelFeatures {
  return {
    textToVideo: models.some((model) => model.features.textToVideo),
    imageToVideo: models.some((model) => model.features.imageToVideo),
    videoToVideo: models.some((model) => model.features.videoToVideo),
    supportStyles: models.some((model) => model.features.supportStyles),
  };
}

function pickRepresentativeModelId(models: ClassifiedVideoModel[]): string {
  const preferred =
    models.find(
      (model) =>
        model.category === 't2v' &&
        model.defaultAspectRatio === 'landscape' &&
        !/_(4k|1080p)$/i.test(model.apiModel)
    ) ||
    models.find((model) => model.category === 't2v' && !/_(4k|1080p)$/i.test(model.apiModel)) ||
    models.find((model) => !/_(4k|1080p)$/i.test(model.apiModel)) ||
    models[0];

  return preferred.apiModel;
}

function mergeClassifiedModels(models: ClassifiedVideoModel[]): ClassifiedVideoModel[] {
  const groups = new Map<string, ClassifiedVideoModel[]>();
  const order: string[] = [];

  for (const model of models) {
    const groupKey = isVeoApiModel(model.apiModel)
      ? getVeoGroupKey(model.apiModel)
      : model.apiModel;

    if (!groups.has(groupKey)) {
      groups.set(groupKey, []);
      order.push(groupKey);
    }
    groups.get(groupKey)!.push(model);
  }

  return order.map((groupKey) => {
    const groupModels = groups.get(groupKey)!;
    if (groupModels.length === 1) {
      return {
        ...groupModels[0],
        sourceModelIds: [groupModels[0].apiModel],
      };
    }

    const representativeApiModel = pickRepresentativeModelId(groupModels);
    const representative =
      groupModels.find((model) => model.apiModel === representativeApiModel) || groupModels[0];
    const aspectRatios = uniqueAspectRatios(groupModels);
    const features = mergeGroupedFeatures(groupModels);
    const defaultAspectRatio = aspectRatios.some((ratio) => ratio.value === 'landscape')
      ? 'landscape'
      : aspectRatios[0]?.value || 'landscape';

    return {
      apiModel: representativeApiModel,
      name: getVeoDisplayName(representativeApiModel),
      description: buildVideoModelDescription({
        features,
        aspectRatios,
        sourceCount: groupModels.length,
      }),
      category: 't2v',
      categoryLabel: '视频生成',
      features,
      aspectRatios,
      defaultAspectRatio,
      durations: [
        {
          value: '8s',
          label: '8 秒',
          cost: estimateVideoDurationCost(
            '8s',
            representative.billingMode === 'per_1k_tokens'
              ? { billingMode: 'per_call', billingPrice: representative.billingPrice, billingUnit: 1 }
              : {
                  billingMode: representative.billingMode,
                  billingPrice: representative.billingPrice,
                  billingUnit: representative.billingUnit,
                },
            representative.durations[0]?.cost || 100,
          ),
        },
      ],
      defaultDuration: '8s',
      billingMode: representative.billingMode,
      billingPrice: representative.billingPrice,
      billingUnit: representative.billingUnit,
      sourceModelIds: groupModels.map((model) => model.apiModel),
    };
  });
}

function getClassifiedModelSelectionId(model: ClassifiedVideoModel): string {
  if (isVeoApiModel(model.apiModel) && (model.sourceModelIds?.length || 0) > 1) {
    return getVeoGroupKey(model.apiModel);
  }
  return model.apiModel;
}

async function fetchChannelRemoteModels(channelId: string): Promise<{
  channelType: VideoChannel['type'];
  models: RemoteModel[];
  lingkeModels?: LingkeSyncedVideoModel[];
}> {
  const channel = await getVideoChannel(channelId);
  if (!channel) {
    throw new Error('渠道不存在');
  }
  if (channel.type !== 'flow2api' && channel.type !== 'apexerapi' && channel.type !== 'lingke-media') {
    throw new Error('仅支持 Flow2API / ApexerAPI / 灵刻媒体 渠道一键导入');
  }
  if (channel.type === 'lingke-media') {
    const lingkeModels = await fetchLingkeSyncedVideoModelsForChannel({
      baseUrl: channel.baseUrl,
      apiKey: channel.apiKey,
    });
    return {
      channelType: channel.type,
      models: lingkeModels.map((item) => ({
        id: item.apiModel,
        name: item.name,
        imageUrl: item.imageUrl,
      } as RemoteModel)),
      lingkeModels,
    };
  }

  if (!channel.baseUrl) {
    throw new Error('该渠道未配置 Base URL');
  }

  const baseUrl = channel.baseUrl.replace(/\/$/, '');
  const modelsUrl = `${baseUrl}/v1/models`;
  const apiKey = channel.apiKey?.split(',')[0]?.trim();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const response = await fetch(modelsUrl, {
    method: 'GET',
    headers,
  });

  if (!response.ok) {
    const details = await response.text().catch(() => '');
    throw new Error(`拉取 /v1/models 失败 (${response.status})${details ? `: ${details}` : ''}`);
  }

  const data = await response.json();
  const models = (data?.data || data?.models || []) as RemoteModel[];
  return {
    channelType: channel.type,
    models: Array.isArray(models) ? models : [],
    lingkeModels: [],
  };
}

function parseSelectedModelIds(body: ImportRequestBody): Set<string> {
  const modelIds = Array.isArray(body.modelIds)
    ? body.modelIds.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
  return new Set(modelIds);
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user || session.user.role !== 'admin') {
      return NextResponse.json({ error: '无权限' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const channelId = searchParams.get('channelId');
    if (!channelId) {
      return NextResponse.json({ error: '缺少 channelId' }, { status: 400 });
    }

    const { channelType, models: remoteModels, lingkeModels = [] } = await fetchChannelRemoteModels(channelId);
    const classified = mergeClassifiedModels(classifyRemoteVideoModels(channelType, remoteModels, lingkeModels));

    const existingModels = await getVideoModels();
    const existingApiModelSet = new Set(
      existingModels
        .filter((model) => model.channelId === channelId)
        .flatMap((model) => getLingkeVideoAliases(model.apiModel, model.name))
        .map((value) => value.toLowerCase())
    );

    return NextResponse.json({
      success: true,
      data: {
        total: remoteModels.length,
        matched: classified.length,
        models: classified.map((model) => ({
          id: getClassifiedModelSelectionId(model),
          displayName: model.name,
          description: model.description,
          category: model.category,
          categoryLabel: model.categoryLabel,
          defaultAspectRatio: model.defaultAspectRatio,
          defaultDuration: model.defaultDuration,
          billingMode: model.billingMode,
          billingPrice: model.billingPrice,
          billingUnit: model.billingUnit,
          normalPrice: model.normalPrice,
          vipPrice: model.vipPrice,
          svipPrice: model.svipPrice,
          pricingRules: model.pricingRules || [],
          imageUrl: model.imageUrl,
          alreadyImported:
            getLingkeVideoAliases(model.apiModel, model.name, ...(model.matchKeys || []))
              .some((key) => existingApiModelSet.has(key.toLowerCase())) ||
            (model.sourceModelIds || []).some((sourceModelId) => existingApiModelSet.has(sourceModelId.toLowerCase())),
        })),
      },
    });
  } catch (error) {
    console.error('[API] Fetch remote video models error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '拉取模型失败' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user || session.user.role !== 'admin') {
      return NextResponse.json({ error: '无权限' }, { status: 403 });
    }

    const body = (await request.json().catch(() => ({}))) as ImportRequestBody;
    const channelId = typeof body.channelId === 'string' ? body.channelId : '';
    if (!channelId) {
      return NextResponse.json({ error: '缺少 channelId' }, { status: 400 });
    }

    const selectedModelIds = parseSelectedModelIds(body);
    const overwrite = body.overwrite === true;
    const { channelType, models: remoteModels, lingkeModels = [] } = await fetchChannelRemoteModels(channelId);
    let classified = classifyRemoteVideoModels(channelType, remoteModels, lingkeModels);

    if (selectedModelIds.size > 0) {
      classified = classified.filter(
        (model) =>
          selectedModelIds.has(model.apiModel) ||
          selectedModelIds.has(getVeoGroupKey(model.apiModel))
      );
    }

    classified = mergeClassifiedModels(classified);

    if (classified.length === 0) {
      return NextResponse.json(
        { error: selectedModelIds.size > 0 ? '未匹配到可导入的已选模型' : '远程 /v1/models 未发现可导入的视频模型' },
        { status: 400 }
      );
    }

    const existing = await getVideoModels();
    const existingForChannel = existing.filter((model) => model.channelId === channelId);
    const existingApiModels = new Set(existingForChannel.map((model) => model.apiModel));
    const existingCount = existingForChannel.length;

    let created = 0;
    let updated = 0;
    let skipped = 0;
    const failed: string[] = [];

    for (const model of classified) {
      const sourceModelIds = model.sourceModelIds || [model.apiModel];
      const matchKeys = getLingkeVideoAliases(
        model.apiModel,
        model.name,
        ...(model.matchKeys || []),
        ...sourceModelIds,
      ).map((value) => value.toLowerCase());
      const matchedExisting = existingForChannel.find((item) =>
        getLingkeVideoAliases(item.apiModel, item.name)
          .some((candidate) => matchKeys.includes(candidate.toLowerCase()))
      );

      try {
        if (matchedExisting) {
          if (!overwrite && channelType !== 'lingke-media') {
            skipped += 1;
            continue;
          }

          await updateVideoModel(matchedExisting.id, {
            name: model.name,
            description: model.description,
            apiModel: model.apiModel,
            features: model.features,
            aspectRatios: model.aspectRatios,
            durations: model.durations,
            defaultAspectRatio: model.defaultAspectRatio,
            defaultDuration: model.defaultDuration,
            billingMode: model.billingMode,
            billingPrice: model.billingPrice,
            billingUnit: model.billingUnit,
            normalPrice: model.normalPrice,
            vipPrice: model.vipPrice,
            svipPrice: model.svipPrice,
            pricingRules: model.pricingRules || [],
            videoConfigObject: model.videoConfigObject,
            imageUrl: model.imageUrl,
            highlight: model.highlight ?? matchedExisting.highlight,
            enabled: true,
          });
          existingApiModels.add(model.apiModel);
          sourceModelIds.forEach((sourceModelId) => existingApiModels.add(sourceModelId));
          updated += 1;
          continue;
        }

        await createVideoModel({
          channelId,
          name: model.name,
          description: model.description,
          apiModel: model.apiModel,
          features: model.features,
          aspectRatios: model.aspectRatios,
          durations: model.durations,
          defaultAspectRatio: model.defaultAspectRatio,
          defaultDuration: model.defaultDuration,
          billingMode: model.billingMode,
          billingPrice: model.billingPrice,
          billingUnit: model.billingUnit,
          normalPrice: model.normalPrice,
          vipPrice: model.vipPrice,
          svipPrice: model.svipPrice,
          pricingRules: model.pricingRules || [],
          videoConfigObject: model.videoConfigObject,
          imageUrl: model.imageUrl,
          highlight: model.highlight ?? false,
          enabled: true,
          sortOrder: existingCount + created,
        });
        existingApiModels.add(model.apiModel);
        sourceModelIds.forEach((sourceModelId) => existingApiModels.add(sourceModelId));
        created += 1;
      } catch {
        failed.push(model.apiModel);
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        total: classified.length,
        created,
        updated,
        skipped,
        failed,
      },
    });
  } catch (error) {
    console.error('[API] Import remote video models error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '导入失败' },
      { status: 500 }
    );
  }
}
