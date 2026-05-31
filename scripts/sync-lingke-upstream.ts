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
import {
  fetchLingkeSyncedImageModelsForChannel,
  getLingkeImageAliases,
} from '@/lib/lingke-image-sync';
import {
  fetchLingkeRemoteChatModels,
  getLingkeFallbackChatModels,
} from '@/lib/lingke-chat-sync';
import {
  fetchLingkeSyncedVideoModelsForChannel,
  getLingkeVideoAliases,
  isRetiredLingkeVideoModel,
} from '@/lib/lingke-video-sync';
import { sanitizeLingkeVideoConfigObject } from '@/lib/lingke-video-config';
import type { ChannelType, VideoChannelType } from '@/types';

const DEFAULT_BASE_URL = 'https://api.lingkeai.ai';
const IMAGE_CHANNEL_NAME = '灵刻媒体图像';
const VIDEO_CHANNEL_NAME = '灵刻媒体视频';

function getArgValue(flag: string): string {
  const index = process.argv.indexOf(flag);
  if (index === -1) return '';
  return String(process.argv[index + 1] || '').trim();
}

function uniqueLower(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

async function ensureLingkeImageChannel(baseUrl: string, apiKey: string) {
  const channels = await getImageChannels();
  let channel = channels.find((item) => item.name === IMAGE_CHANNEL_NAME && item.type === 'lingke-media');

  if (!channel) {
    channel = await createImageChannel({
      name: IMAGE_CHANNEL_NAME,
      type: 'lingke-media' as ChannelType,
      baseUrl,
      apiKey,
      enabled: true,
    });
    return { channel, created: true, updated: false };
  }

  const updates: Partial<{ baseUrl: string; apiKey: string; enabled: boolean }> = {};
  if (channel.baseUrl !== baseUrl) updates.baseUrl = baseUrl;
  if (channel.apiKey !== apiKey) updates.apiKey = apiKey;
  if (!channel.enabled) updates.enabled = true;

  if (Object.keys(updates).length > 0) {
    channel = (await updateImageChannel(channel.id, updates)) || channel;
    return { channel, created: false, updated: true };
  }

  return { channel, created: false, updated: false };
}

async function ensureLingkeVideoChannel(baseUrl: string, apiKey: string) {
  const channels = await getVideoChannels();
  let channel = channels.find((item) => item.name === VIDEO_CHANNEL_NAME && item.type === 'lingke-media');

  if (!channel) {
    channel = await createVideoChannel({
      name: VIDEO_CHANNEL_NAME,
      type: 'lingke-media' as VideoChannelType,
      baseUrl,
      apiKey,
      enabled: true,
    });
    return { channel, created: true, updated: false };
  }

  const updates: Partial<{ baseUrl: string; apiKey: string; enabled: boolean }> = {};
  if (channel.baseUrl !== baseUrl) updates.baseUrl = baseUrl;
  if (channel.apiKey !== apiKey) updates.apiKey = apiKey;
  if (!channel.enabled) updates.enabled = true;

  if (Object.keys(updates).length > 0) {
    channel = (await updateVideoChannel(channel.id, updates)) || channel;
    return { channel, created: false, updated: true };
  }

  return { channel, created: false, updated: false };
}

async function syncLingkeImageModels(baseUrl: string, apiKey: string) {
  const { channel } = await ensureLingkeImageChannel(baseUrl, apiKey);
  const synced = await fetchLingkeSyncedImageModelsForChannel({ baseUrl, apiKey });
  const currentModels = (await getImageModels()).filter((item) => item.channelId === channel.id);

  let created = 0;
  let updated = 0;
  let disabled = 0;

  for (const preset of synced) {
    const presetKeys = uniqueLower(
      getLingkeImageAliases(preset.apiModel, preset.name, ...(preset.matchKeys || []))
    );

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
      updated += 1;
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
    created += 1;
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
    disabled += 1;
  }

  return {
    channelId: channel.id,
    remoteCount: synced.length,
    created,
    updated,
    disabled,
  };
}

async function syncLingkeVideoModels(baseUrl: string, apiKey: string) {
  const { channel } = await ensureLingkeVideoChannel(baseUrl, apiKey);
  const synced = await fetchLingkeSyncedVideoModelsForChannel({ baseUrl, apiKey });
  const currentModels = (await getVideoModels()).filter((item) => item.channelId === channel.id);

  let created = 0;
  let updated = 0;
  let disabled = 0;
  let deleted = 0;

  for (const preset of synced) {
    if (isRetiredLingkeVideoModel(preset.apiModel, preset.name, ...(preset.matchKeys || []))) {
      continue;
    }
    const presetKeys = uniqueLower(
      getLingkeVideoAliases(preset.apiModel, preset.name, ...(preset.matchKeys || []))
    );

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
        videoConfigObject: sanitizeLingkeVideoConfigObject(preset.videoConfigObject),
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
      updated += 1;
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
      videoConfigObject: sanitizeLingkeVideoConfigObject(preset.videoConfigObject),
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
    created += 1;
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
      deleted += 1;
      continue;
    }
    const matched = getLingkeVideoAliases(model.apiModel, model.name)
      .some((candidate) => syncedAliasSet.has(candidate.toLowerCase()));
    if (matched) continue;
    if (!model.enabled) continue;
    await updateVideoModel(model.id, { enabled: false });
    disabled += 1;
  }

  return {
    channelId: channel.id,
    remoteCount: synced.length,
    created,
    updated,
    disabled,
    deleted,
  };
}

async function syncLingkeChatAndAudio(baseUrl: string, apiKey: string) {
  const chatModels = await getChatModels(false);
  const synced = await fetchLingkeRemoteChatModels(baseUrl, apiKey).catch(() => getLingkeFallbackChatModels());
  const syncedModelIds = new Set(synced.map((item) => item.modelId));
  let chatCreated = 0;
  let chatUpdated = 0;
  let chatDisabled = 0;

  for (const preset of synced) {
    const exists = chatModels.find((item) => item.modelId === preset.modelId || item.name === preset.name);

    if (!exists) {
      const createdModel = await createChatModel({
        name: preset.name,
        apiUrl: `${baseUrl}/v1/chat/completions`,
        apiKey,
        modelId: preset.modelId,
        supportsVision: preset.supportsVision,
        maxTokens: preset.maxTokens,
        costPerMessage: preset.costPerMessage,
        billingMode: preset.billingMode,
        billingPrice: preset.billingPrice,
        billingUnit: preset.billingUnit,
        imageUrl: resolveChatModelImage({
          name: preset.name,
          modelId: preset.modelId,
          imageUrl: preset.imageUrl,
        }),
        enabled: true,
      });
      chatModels.push(createdModel);
      chatCreated += 1;
      continue;
    }

    const apiUrl = String(exists.apiUrl || '').trim();
    const isLingkeModel =
      !apiUrl ||
      apiUrl.includes('api.lingkeai.ai') ||
      apiUrl.endsWith('/v1/chat/completions');

    if (!isLingkeModel) continue;

    const updates: Parameters<typeof updateChatModel>[1] = {};
    if (exists.name !== preset.name) {
      updates.name = preset.name;
    }
    if (apiUrl !== `${baseUrl}/v1/chat/completions`) {
      updates.apiUrl = `${baseUrl}/v1/chat/completions`;
    }
    if (exists.apiKey !== apiKey) {
      updates.apiKey = apiKey;
    }
    if (!exists.enabled) {
      updates.enabled = true;
    }

    const nextImageUrl = resolveChatModelImage({
      name: preset.name,
      modelId: preset.modelId,
      imageUrl: exists.imageUrl,
    });
    if (
      (!exists.imageUrl ||
        isPlaceholderModelImageUrl(exists.imageUrl) ||
        exists.imageUrl === '/huantu-logo.jpg') &&
      nextImageUrl
    ) {
      updates.imageUrl = nextImageUrl;
    }

    if (Object.keys(updates).length === 0) continue;
    await updateChatModel(exists.id, updates);
    chatUpdated += 1;
  }

  for (const model of chatModels) {
    const apiUrl = String(model.apiUrl || '').trim();
    const isLingkeModel =
      !apiUrl ||
      apiUrl.includes('api.lingkeai.ai') ||
      apiUrl.endsWith('/v1/chat/completions');

    if (!isLingkeModel || syncedModelIds.has(model.modelId) || !model.enabled) continue;
    await updateChatModel(model.id, { enabled: false });
    chatDisabled += 1;
  }

  const { getSystemConfig } = await import('@/lib/db');
  const currentConfig = await getSystemConfig();
  await updateSystemConfig({
    audioProvider: {
      ...currentConfig.audioProvider,
      musicBaseUrl: baseUrl,
      musicApiKey: apiKey,
      voiceBaseUrl: baseUrl,
      voiceApiKey: apiKey,
    },
  });

  return { chatCreated, chatUpdated, chatDisabled, audioUpdated: true };
}

async function main() {
  const apiKey =
    getArgValue('--api-key') ||
    process.env.LINGKE_API_KEY ||
    process.env.LK_API_KEY ||
    '';
  const baseUrl =
    getArgValue('--base-url') ||
    process.env.LINGKE_BASE_URL ||
    DEFAULT_BASE_URL;

  if (!apiKey) {
    throw new Error('缺少 API Key，请通过 --api-key 或 LINGKE_API_KEY 提供。');
  }

  console.log(`[sync-lingke] 开始同步 baseUrl=${baseUrl}`);

  const imageSummary = await syncLingkeImageModels(baseUrl, apiKey);
  const videoSummary = await syncLingkeVideoModels(baseUrl, apiKey);
  const chatAudioSummary = await syncLingkeChatAndAudio(baseUrl, apiKey);

  console.log('[sync-lingke] 完成');
  console.log(
    JSON.stringify(
      {
        imageSummary,
        videoSummary,
        chatAudioSummary,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error('[sync-lingke] 失败:', error);
  process.exit(1);
});
