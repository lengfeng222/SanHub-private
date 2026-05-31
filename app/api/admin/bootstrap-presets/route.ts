import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
  createChatModel,
  createImageChannel,
  createImageModel,
  createVideoChannel,
  createVideoModel,
  deleteVideoModel,
  getChatModels,
  getImageChannels,
  getImageModels,
  getSystemConfig,
  getVideoChannels,
  getVideoModels,
  updateChatModel,
  updateImageChannel,
  updateImageModel,
  updateSystemConfig,
  updateVideoChannel,
  updateVideoModel,
} from '@/lib/db';
import {
  isPlaceholderModelImageUrl,
  resolveChatModelImage,
  resolveImageModelImage,
  resolveVideoModelImage,
} from '@/lib/model-images';
import type { ChannelType, ImageModelFeatures, VideoChannelType, VideoModelFeatures } from '@/types';
import { createLingkeSyncedVideoModelFromName } from '@/lib/lingke-video-pricing';
import { fetchLingkeSyncedVideoModelsForChannel, getLingkeVideoAliases, isRetiredLingkeVideoModel } from '@/lib/lingke-video-sync';
import { fetchLingkeSyncedImageModelsForChannel, getLingkeImageAliases, type LingkeSyncedImageModel } from '@/lib/lingke-image-sync';
import { fetchLingkeRemoteChatModels, getLingkeFallbackChatModels } from '@/lib/lingke-chat-sync';

export const dynamic = 'force-dynamic';

type PresetKind = 'image' | 'video' | 'chat' | 'audio' | 'all' | 'lingke';

const LK_BASE_URL = 'https://api.lingkeai.ai';

const IMAGE_FEATURES: ImageModelFeatures = {
  textToImage: true,
  imageToImage: true,
  upscale: false,
  matting: false,
  multipleImages: true,
  imageSize: false,
};

const VIDEO_FEATURES: VideoModelFeatures = {
  textToVideo: true,
  imageToVideo: true,
  videoToVideo: false,
  supportStyles: false,
};

const IMAGE_VISIBLE_MODELS = [
  { name: 'GPT Image 2', apiModel: 'gpt-image-2', requiresReferenceImage: false },
  { name: 'GPT Image 2 官转', apiModel: 'gpt-image-2-guan', requiresReferenceImage: false },
  { name: 'Nano Banana Pro', apiModel: 'gemini-3-pro-image-preview', requiresReferenceImage: false },
  { name: 'Nano Banana 2', apiModel: 'gemini-3.1-flash-image-preview', requiresReferenceImage: false },
  { name: 'Seedream 5.0', apiModel: 'doubao-seedream-5-0-260128', requiresReferenceImage: false },
  { name: 'Seedream 4.5', apiModel: 'doubao-seedream-4-5-251128', requiresReferenceImage: false },
  { name: 'Midjourney', apiModel: 'mj_imagine', requiresReferenceImage: false },
  { name: '万相 2.7 图像', apiModel: 'wan2.7-image', requiresReferenceImage: false },
  { name: '万相 2.6 图像', apiModel: 'wan2.6-image', requiresReferenceImage: false },
  { name: 'VIDU Image 2', apiModel: 'vidu-image-2', requiresReferenceImage: false },
  { name: 'Qwen-image-max', apiModel: 'qwen-image', requiresReferenceImage: false },
  { name: 'grok-4.2-image', apiModel: 'grok-4.2-image', requiresReferenceImage: false },
  { name: 'grok-4.1-image', apiModel: 'grok-4.1-image', requiresReferenceImage: false },
  { name: 'Kling-V3', apiModel: 'kling-v3', requiresReferenceImage: false },
  { name: 'Kling-V3-Omni', apiModel: 'kling-v3-omni', requiresReferenceImage: false },
  { name: 'Kling o1', apiModel: 'kling-image-o1', requiresReferenceImage: false },
] as const;

const VIDEO_VISIBLE_MODELS: Array<{ name: string; imageUrl?: string }> = [];

const COMMON_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4'];
const COMMON_IMAGE_RESOLUTIONS: Record<string, string> = {
  '1:1': '1:1',
  '16:9': '16:9',
  '9:16': '9:16',
  '4:3': '4:3',
  '3:4': '3:4',
};

async function resolveLingkeBootstrapApiKey(providedApiKey?: string): Promise<string> {
  const direct = providedApiKey?.trim();
  if (direct) return direct;

  const [imageChannels, videoChannels, config] = await Promise.all([
    getImageChannels(),
    getVideoChannels(),
    getSystemConfig(),
  ]);

  const candidates = [
    ...imageChannels
      .filter((item) => item.type === 'lingke-media')
      .map((item) => item.apiKey),
    ...videoChannels
      .filter((item) => item.type === 'lingke-media')
      .map((item) => item.apiKey),
    config.audioProvider.musicApiKey,
    config.audioProvider.voiceApiKey,
  ];

  for (const candidate of candidates) {
    const value = typeof candidate === 'string' ? candidate.trim() : '';
    if (value) return value;
  }

  return '';
}

function toFallbackLingkeImageModel(preset: (typeof IMAGE_VISIBLE_MODELS)[number]): LingkeSyncedImageModel {
  return {
    apiModel: preset.apiModel,
    matchKeys: getLingkeImageAliases(preset.apiModel, preset.name),
    name: preset.name,
    description: '灵刻站可见图片模型',
    features: IMAGE_FEATURES,
    aspectRatios: [...COMMON_RATIOS],
    resolutions: { ...COMMON_IMAGE_RESOLUTIONS },
    imageSizes: undefined,
    defaultAspectRatio: '1:1',
    defaultImageSize: undefined,
    requiresReferenceImage: preset.requiresReferenceImage,
    allowEmptyPrompt: false,
    costPerGeneration: 20,
    billingMode: 'per_call',
    billingPrice: 20,
    billingUnit: 1,
    pricingRules: [],
    imageUrl: resolveImageModelImage({ name: preset.name, apiModel: preset.apiModel }),
    highlight: true,
  };
}

async function ensureLingkeImagePresets(apiKey?: string) {
  const channels = await getImageChannels();
  const models = await getImageModels();
  const created: string[] = [];

  let channel = channels.find((item) => item.name === '灵刻媒体图像' && item.type === 'lingke-media');
  if (!channel) {
    channel = await createImageChannel({
      name: '灵刻媒体图像',
      type: 'lingke-media' as ChannelType,
      baseUrl: LK_BASE_URL,
      apiKey: apiKey || '',
      enabled: true,
    });
    channels.push(channel);
    created.push('渠道: 灵刻媒体图像');
  } else {
    const updates: Partial<{ baseUrl: string; apiKey: string }> = {};
    if (!channel.baseUrl) updates.baseUrl = LK_BASE_URL;
    if (apiKey && !channel.apiKey) updates.apiKey = apiKey;
    if (Object.keys(updates).length > 0) {
      channel = (await updateImageChannel(channel.id, updates)) || channel;
      created.push('渠道已补全: 灵刻媒体图像');
    }
  }

  let synced: LingkeSyncedImageModel[] = [];
  try {
    synced = await fetchLingkeSyncedImageModelsForChannel({
      baseUrl: channel.baseUrl,
      apiKey: channel.apiKey,
    });
  } catch {
    synced = IMAGE_VISIBLE_MODELS.map((item) => toFallbackLingkeImageModel(item));
  }

  const currentModels = models.filter((item) => item.channelId === channel.id);

  for (const preset of synced) {
    const presetKeys = getLingkeImageAliases(
      preset.apiModel,
      preset.name,
      ...(preset.matchKeys || [])
    ).map((value) => value.toLowerCase());
    const exists = currentModels.find((item) =>
      getLingkeImageAliases(item.apiModel, item.name)
        .some((candidate) => presetKeys.includes(candidate.toLowerCase()))
    );

    const nextImageUrl = resolveImageModelImage({
      name: preset.name,
      apiModel: preset.apiModel,
      imageUrl: preset.imageUrl,
    });

    if (exists) {
      await updateImageModel(exists.id, {
        name: preset.name,
        description: preset.description,
        apiModel: preset.apiModel,
        features: preset.features,
        aspectRatios: preset.aspectRatios,
        resolutions: preset.resolutions,
        imageSizes: preset.imageSizes,
        defaultAspectRatio: preset.defaultAspectRatio,
        defaultImageSize: preset.defaultImageSize,
        requiresReferenceImage: preset.requiresReferenceImage,
        allowEmptyPrompt: preset.allowEmptyPrompt,
        highlight: preset.highlight ?? exists.highlight,
        enabled: true,
        costPerGeneration: preset.costPerGeneration,
        billingMode: preset.billingMode,
        billingPrice: preset.billingPrice,
        billingUnit: preset.billingUnit,
        pricingRules: preset.pricingRules,
        imageUrl: nextImageUrl,
      });
      created.push(`图像模型已同步: ${preset.name}`);
      continue;
    }

    const model = await createImageModel({
      channelId: channel.id,
      name: preset.name,
      description: preset.description,
      apiModel: preset.apiModel,
      baseUrl: undefined,
      apiKey: undefined,
      features: preset.features,
      aspectRatios: preset.aspectRatios,
      resolutions: preset.resolutions,
      imageSizes: preset.imageSizes,
      defaultAspectRatio: preset.defaultAspectRatio,
      defaultImageSize: preset.defaultImageSize,
      requiresReferenceImage: preset.requiresReferenceImage,
      allowEmptyPrompt: preset.allowEmptyPrompt,
      highlight: preset.highlight ?? true,
      enabled: true,
      costPerGeneration: preset.costPerGeneration,
      billingMode: preset.billingMode,
      billingPrice: preset.billingPrice,
      billingUnit: preset.billingUnit,
      pricingRules: preset.pricingRules,
      imageUrl: nextImageUrl,
      sortOrder: currentModels.length,
    });
    currentModels.push(model);
    created.push(`图像模型: ${preset.name}`);
  }

  const syncedAliasSet = new Set(
    synced.flatMap((item) =>
      getLingkeImageAliases(item.apiModel, item.name, ...(item.matchKeys || []))
        .map((value) => value.toLowerCase())
    )
  );

  for (const model of currentModels) {
    const matched = getLingkeImageAliases(model.apiModel, model.name)
      .some((candidate) => syncedAliasSet.has(candidate.toLowerCase()));
    if (matched || !model.enabled) continue;
    await updateImageModel(model.id, { enabled: false });
    created.push(`图像模型已停用: ${model.name}`);
  }

  return created;
}

async function ensureLingkeVideoPresets(apiKey?: string) {
  const channels = await getVideoChannels();
  const models = await getVideoModels();
  const created: string[] = [];

  let channel = channels.find((item) => item.name === '灵刻媒体视频' && item.type === 'lingke-media');
  if (!channel) {
    channel = await createVideoChannel({
      name: '灵刻媒体视频',
      type: 'lingke-media' as VideoChannelType,
      baseUrl: LK_BASE_URL,
      apiKey: apiKey || '',
      enabled: true,
    });
    channels.push(channel);
    created.push('渠道: 灵刻媒体视频');
  } else {
    const updates: Partial<{ baseUrl: string; apiKey: string }> = {};
    if (!channel.baseUrl) updates.baseUrl = LK_BASE_URL;
    if (apiKey && !channel.apiKey) updates.apiKey = apiKey;
    if (Object.keys(updates).length > 0) {
      channel = (await updateVideoChannel(channel.id, updates)) || channel;
      created.push('渠道已补全: 灵刻媒体视频');
    }
  }

  let synced = [];
  try {
    synced = await fetchLingkeSyncedVideoModelsForChannel({
      baseUrl: channel.baseUrl,
      apiKey: channel.apiKey,
    });
  } catch {
    synced = VIDEO_VISIBLE_MODELS.map((item) => createLingkeSyncedVideoModelFromName(item.name, item.imageUrl));
  }

  const currentModels = models.filter((item) => item.channelId === channel.id);

  for (const preset of synced) {
    if (isRetiredLingkeVideoModel(preset.apiModel, preset.name, ...(preset.matchKeys || []))) {
      continue;
    }
    const presetKeys = getLingkeVideoAliases(
      preset.apiModel,
      preset.name,
      ...(preset.matchKeys || [])
    ).map((value) => value.toLowerCase());
    const exists = currentModels.find((item) =>
      getLingkeVideoAliases(item.apiModel, item.name)
        .some((candidate) => presetKeys.includes(candidate.toLowerCase()))
    );
    const nextImageUrl = resolveVideoModelImage({
      name: preset.name,
      apiModel: preset.apiModel,
      imageUrl: preset.imageUrl,
    });

    if (exists) {
      await updateVideoModel(exists.id, {
        name: preset.name,
        description: preset.description,
        apiModel: preset.apiModel,
        features: preset.features,
        aspectRatios: preset.aspectRatios,
        durations: preset.durations,
        defaultAspectRatio: preset.defaultAspectRatio,
        defaultDuration: preset.defaultDuration,
        videoConfigObject: preset.videoConfigObject,
        highlight: preset.highlight ?? exists.highlight,
        enabled: true,
        billingMode: preset.billingMode,
        billingPrice: preset.billingPrice,
        billingUnit: preset.billingUnit,
        normalPrice: preset.normalPrice,
        vipPrice: preset.vipPrice,
        svipPrice: preset.svipPrice,
        pricingRules: preset.pricingRules || [],
        imageUrl: nextImageUrl,
      });
      created.push(`视频模型已同步: ${preset.name}`);
      continue;
    }

    const model = await createVideoModel({
      channelId: channel.id,
      name: preset.name,
      description: preset.description,
      apiModel: preset.apiModel,
      baseUrl: undefined,
      apiKey: undefined,
      features: preset.features,
      aspectRatios: preset.aspectRatios,
      durations: preset.durations,
      defaultAspectRatio: preset.defaultAspectRatio,
      defaultDuration: preset.defaultDuration,
      videoConfigObject: preset.videoConfigObject,
      highlight: preset.highlight ?? true,
      enabled: true,
      billingMode: preset.billingMode,
      billingPrice: preset.billingPrice,
      billingUnit: preset.billingUnit,
      normalPrice: preset.normalPrice,
      vipPrice: preset.vipPrice,
      svipPrice: preset.svipPrice,
      pricingRules: preset.pricingRules || [],
      imageUrl: nextImageUrl,
      sortOrder: currentModels.length,
    });
    currentModels.push(model);
    created.push(`视频模型: ${preset.name}`);
  }

  const syncedAliasSet = new Set(
    synced.flatMap((item) =>
      getLingkeVideoAliases(item.apiModel, item.name, ...(item.matchKeys || []))
        .map((value) => value.toLowerCase())
    )
  );

  for (const model of currentModels) {
    if (isRetiredLingkeVideoModel(model.apiModel, model.name)) {
      await deleteVideoModel(model.id);
      created.push(`视频模型已删除: ${model.name}`);
      continue;
    }
    const matched = getLingkeVideoAliases(model.apiModel, model.name)
      .some((candidate) => syncedAliasSet.has(candidate.toLowerCase()));
    if (matched) continue;
    if (!model.enabled) continue;
    await updateVideoModel(model.id, { enabled: false });
    created.push(`视频模型已停用: ${model.name}`);
  }

  return created;
}

async function ensureLingkeChatPresets(apiKey?: string) {
  const models = await getChatModels(false);
  const created: string[] = [];

  const normalizedApiKey = apiKey?.trim() || '';
  const synced =
    normalizedApiKey
      ? await fetchLingkeRemoteChatModels(LK_BASE_URL, normalizedApiKey).catch(() => getLingkeFallbackChatModels())
      : getLingkeFallbackChatModels();

  const syncedModelIds = new Set(synced.map((item) => item.modelId));

  for (const preset of synced) {
    const exists = models.find((item) => item.modelId === preset.modelId || item.name === preset.name);
    if (!exists) {
      const createdModel = await createChatModel({
        name: preset.name,
        apiUrl: `${LK_BASE_URL}/v1/chat/completions`,
        apiKey: normalizedApiKey,
        modelId: preset.modelId,
        supportsVision: preset.supportsVision,
        maxTokens: preset.maxTokens,
        costPerMessage: preset.costPerMessage,
        billingMode: preset.billingMode,
        billingPrice: preset.billingPrice,
        billingUnit: preset.billingUnit,
        imageUrl: resolveChatModelImage({ name: preset.name, modelId: preset.modelId, imageUrl: preset.imageUrl }),
        enabled: true,
      });
      models.push(createdModel);
      created.push(`聊天模型: ${preset.name}`);
      continue;
    }

    const updates: Parameters<typeof updateChatModel>[1] = {};
    if (exists.name !== preset.name) updates.name = preset.name;
    if (exists.apiUrl !== `${LK_BASE_URL}/v1/chat/completions`) updates.apiUrl = `${LK_BASE_URL}/v1/chat/completions`;
    if (normalizedApiKey && exists.apiKey !== normalizedApiKey) updates.apiKey = normalizedApiKey;
    if (!exists.enabled) updates.enabled = true;
    const nextImageUrl = resolveChatModelImage({
      name: preset.name,
      modelId: preset.modelId,
      imageUrl: exists.imageUrl,
    });
    if ((!exists.imageUrl || isPlaceholderModelImageUrl(exists.imageUrl) || exists.imageUrl === '/huantu-logo.jpg') && nextImageUrl) {
      updates.imageUrl = nextImageUrl;
    }
    if (Object.keys(updates).length > 0) {
      await updateChatModel(exists.id, updates);
      created.push(`聊天模型已同步: ${preset.name}`);
    }
  }

  for (const model of models) {
    const apiUrl = String(model.apiUrl || '').trim();
    const isLingkeModel =
      !apiUrl ||
      apiUrl.includes('api.lingkeai.ai') ||
      apiUrl.endsWith('/v1/chat/completions');
    if (!isLingkeModel || syncedModelIds.has(model.modelId) || !model.enabled) continue;
    await updateChatModel(model.id, { enabled: false });
    created.push(`聊天模型已停用: ${model.name}`);
  }

  return created;
}

async function ensureLingkeAudioDefaults(apiKey?: string) {
  await updateSystemConfig({
    audioProvider: {
      musicBaseUrl: LK_BASE_URL,
      musicApiKey: apiKey || '',
      musicModel: '海螺 音乐生成 2.5+',
      musicEndpointPath: '/v1/media/generate',
      musicCost: 10,
      musicBillingMode: 'per_call',
      musicBillingPrice: 10,
      musicBillingUnit: 1,
      voiceBaseUrl: LK_BASE_URL,
      voiceApiKey: apiKey || '',
      voiceModel: '豆包 语音合成 2.0',
      voiceVoice: 'zh_female_vv_uranus_bigtts',
      voiceFormat: 'mp3',
      voiceEndpointPath: '/v1/media/generate',
      voiceCost: 5,
      voiceBillingMode: 'per_call',
      voiceBillingPrice: 5,
      voiceBillingUnit: 1,
    },
  });

  return [
    '音频默认配置: 海螺 音乐生成 2.5+',
    '语音默认配置: 豆包 语音合成 2.0',
    '可选语音模型: Gemini-3.1-TTS',
    '可选音乐模型: VIDU-音乐MV',
  ];
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user || session.user.role !== 'admin') {
      return NextResponse.json({ error: '无权限' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const kind = (body.kind as PresetKind) || 'all';
    const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
    const resolvedApiKey = await resolveLingkeBootstrapApiKey(apiKey);
    const created: string[] = [];

    if (kind === 'all' || kind === 'lingke' || kind === 'image') created.push(...await ensureLingkeImagePresets(resolvedApiKey));
    if (kind === 'all' || kind === 'lingke' || kind === 'video') created.push(...await ensureLingkeVideoPresets(resolvedApiKey));
    if (kind === 'all' || kind === 'lingke' || kind === 'chat') created.push(...await ensureLingkeChatPresets(resolvedApiKey));
    if (kind === 'all' || kind === 'lingke' || kind === 'audio') created.push(...await ensureLingkeAudioDefaults(resolvedApiKey));

    return NextResponse.json({ success: true, data: { created, count: created.length } });
  } catch (error) {
    console.error('[API] Bootstrap presets error:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : '预置生成失败' }, { status: 500 });
  }
}
