import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
  createChatModel,
  createImageChannel,
  createImageModel,
  createVideoChannel,
  createVideoModel,
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

export const dynamic = 'force-dynamic';

type PresetKind = 'image' | 'video' | 'chat' | 'audio' | 'all' | 'lingke';

const LK_BASE_URL = 'https://api.lingkeai.ai';

const CHAT_VISIBLE_MODELS = [
  ['GPT-5.5 中推理', 'gpt-5.5-medium'],
  ['GPT-5.4 mini', 'gpt-5.4-mini'],
  ['GPT-5.5 低推理', 'gpt-5.5-low'],
  ['GPT-5.4 nano', 'gpt-5.4-nano'],
  ['GPT-5.4', 'gpt-5.4'],
  ['deepseek-v4-pro', 'deepseek-v4-pro'],
  ['GPT-5.3 对话', 'gpt-5.3-chat-latest'],
  ['GPT-5.5', 'gpt-5.5'],
  ['GPT-5.4 深度推理', 'gpt-5.4-xhigh'],
  ['MiniMax-M2.7', 'MiniMax-M2.7'],
  ['千问 3.6 Plus', 'qwen3.6-plus'],
  ['deepseek-v4-flash', 'deepseek-v4-flash'],
  ['grok-4.3', 'grok-4.3'],
  ['opus-4-7', 'claude-opus-4-7'],
  ['grok-4-20', 'grok-4-20-non-reasoning'],
  ['GPT-5.5 深度推理', 'gpt-5.5-xhigh'],
  ['GPT-5.5 高推理', 'gpt-5.5-high'],
  ['Claude Sonnet 4.6', 'claude-sonnet-4-6'],
  ['Claude Haiku 4.5', 'claude-haiku-4-5-20251001'],
  ['Claude Opus 4.6', 'claude-opus-4-6'],
  ['Claude Opus 4.5', 'claude-opus-4-5-20251101'],
  ['Gemini 3.1 Pro Preview', 'gemini-3.1-pro-preview'],
  ['Gemini 3 Pro Preview', 'gemini-3-pro-preview'],
  ['Gemini 3 Flash Preview', 'gemini-3-flash-preview'],
  ['Gemini 3.1 Flash Lite Preview', 'gemini-3.1-flash-lite-preview'],
  ['Grok 4.1', 'grok-4.1'],
  ['Grok 4.2', 'grok-4.2'],
  ['GPT-5.2', 'gpt-5.2'],
  ['GPT-5.2 Chat', 'gpt-5.2-chat-latest'],
  ['GPT-5.3 Codex', 'gpt-5.3-codex'],
  ['千问 3.5 Plus', 'qwen3.5-plus'],
  ['千问 3.5 Flash', 'qwen3.5-flash'],
  ['DeepSeek V3.2', 'deepseek-v3.2'],
  ['豆包 Seed 2.0 Pro', 'doubao-seed-2-0-pro-260215'],
  ['豆包 Seed 1.8', 'doubao-seed-1-8-251228'],
] as const;

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
  { name: 'GPT Image 2', apiModel: 'GPT Image 2', requiresReferenceImage: false },
  { name: 'GPT Image 2 官转', apiModel: 'GPT Image 2 官转', requiresReferenceImage: false },
  { name: 'Nano Banana Pro', apiModel: 'Nano Banana Pro', requiresReferenceImage: false },
  { name: 'Nano Banana Edit', apiModel: 'Nano Banana Edit', requiresReferenceImage: true },
  { name: '万相 2.7 图像', apiModel: '万相 2.7 图像', requiresReferenceImage: false },
  { name: 'VIDU Image 2', apiModel: 'VIDU Image 2', requiresReferenceImage: false },
  { name: 'SD 2.0 全能参考', apiModel: 'SD 2.0 全能参考', requiresReferenceImage: true },
] as const;

const VIDEO_VISIBLE_MODELS = [
  { name: '万相 2.7 视频续写', imageUrl: 'https://cos.lingkeai.vip/qwen.svg' },
  { name: 'Vidu Q3 参考生', imageUrl: 'https://cos.lingkeai.vip/vidu-icon.svg' },
  { name: '快乐马-视频编辑', imageUrl: 'https://cos.lingkeai.vip/happyhorse.svg' },
  { name: 'veo3.1-lite', imageUrl: 'https://cos.lingkeai.vip/gemini.svg' },
  { name: '快乐马-首帧', imageUrl: 'https://cos.lingkeai.vip/happyhorse.svg' },
  { name: 'Pix V5.6 首尾帧', imageUrl: 'https://cos.lingkeai.vip/PixVerse.svg' },
  { name: 'Pix C1 首尾帧', imageUrl: 'https://cos.lingkeai.vip/PixVerse.svg' },
  { name: 'VIDU-解说漫', imageUrl: 'https://cos.lingkeai.vip/vidu-icon.svg' },
  { name: 'Pix C1 参考生', imageUrl: 'https://cos.lingkeai.vip/PixVerse.svg' },
  { name: '可灵-Omni 首尾帧', imageUrl: 'https://cos.lingkeai.vip/kling.svg' },
  { name: '可灵-Omni 参考生', imageUrl: 'https://cos.lingkeai.vip/kling.svg' },
  { name: 'Pix V6 首尾帧', imageUrl: 'https://cos.lingkeai.vip/PixVerse.svg' },
  { name: '可灵-V3', imageUrl: 'https://cos.lingkeai.vip/kling.svg' },
  { name: '可灵-动作控制 V3', imageUrl: 'https://cos.lingkeai.vip/kling.svg' },
  { name: '可灵-Omni 视频参考', imageUrl: 'https://cos.lingkeai.vip/kling.svg' },
  { name: '可灵-V3-Omni', imageUrl: 'https://cos.lingkeai.vip/kling.svg' },
  { name: '可灵-V3-video', imageUrl: 'https://cos.lingkeai.vip/kling.svg' },
  { name: '快乐马-参考生', imageUrl: 'https://cos.lingkeai.vip/happyhorse.svg' },
  { name: '万相 2.7 参考生', imageUrl: 'https://cos.lingkeai.vip/qwen.svg' },
  { name: 'SD 2.0 首尾帧', imageUrl: 'https://cos.lingkeai.vip/doubao.svg' },
  { name: 'Pix V5.6 参考生', imageUrl: 'https://cos.lingkeai.vip/PixVerse.svg' },
  { name: '万相 2.7 首尾帧', imageUrl: 'https://cos.lingkeai.vip/qwen.svg' },
  { name: '快乐马-文生视频', imageUrl: 'https://cos.lingkeai.vip/happyhorse.svg' },
  { name: 'SD 2.0 参考生', imageUrl: 'https://cos.lingkeai.vip/doubao.svg' },
] as const;

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

  for (const preset of IMAGE_VISIBLE_MODELS) {
    const exists = models.find((item) => item.channelId === channel.id && item.name === preset.name);
    if (exists) {
      const nextImageUrl = resolveImageModelImage({
        name: exists.name,
        apiModel: exists.apiModel,
        imageUrl: exists.imageUrl,
      });
      if ((!exists.imageUrl || isPlaceholderModelImageUrl(exists.imageUrl)) && nextImageUrl) {
        await updateImageModel(exists.id, { imageUrl: nextImageUrl });
        created.push(`图像模型已补图: ${preset.name}`);
      }
      continue;
    }
    const model = await createImageModel({
      channelId: channel.id,
      name: preset.name,
      description: '灵刻站可见图片模型',
      apiModel: preset.apiModel,
      baseUrl: undefined,
      apiKey: undefined,
      features: IMAGE_FEATURES,
      aspectRatios: [...COMMON_RATIOS],
      resolutions: { ...COMMON_IMAGE_RESOLUTIONS },
      imageSizes: undefined,
      defaultAspectRatio: '1:1',
      defaultImageSize: undefined,
      requiresReferenceImage: preset.requiresReferenceImage,
      allowEmptyPrompt: false,
      highlight: true,
      enabled: true,
      costPerGeneration: 20,
      billingMode: 'per_call',
      billingPrice: 20,
      billingUnit: 1,
      imageUrl: resolveImageModelImage({ name: preset.name, apiModel: preset.apiModel }),
      sortOrder: models.filter((item) => item.channelId === channel.id).length,
    });
    models.push(model);
    created.push(`图像模型: ${preset.name}`);
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

  for (const preset of VIDEO_VISIBLE_MODELS) {
    const { name, imageUrl } = preset;
    const exists = models.find((item) => item.channelId === channel.id && item.name === name);
    if (exists) {
      const nextImageUrl = resolveVideoModelImage({
        name: exists.name,
        apiModel: exists.apiModel,
        imageUrl: exists.imageUrl || imageUrl,
      });
      if ((!exists.imageUrl || isPlaceholderModelImageUrl(exists.imageUrl)) && nextImageUrl) {
        await updateVideoModel(exists.id, { imageUrl: nextImageUrl });
        created.push(`视频模型已补图: ${name}`);
      }
      continue;
    }
    const model = await createVideoModel({
      channelId: channel.id,
      name,
      description: name === 'veo3.1-lite' ? '灵刻站可见视频模型，已验证可创建任务。' : '灵刻站可见视频模型',
      apiModel: name,
      baseUrl: undefined,
      apiKey: undefined,
      features: VIDEO_FEATURES,
      aspectRatios: [
        { value: '16:9', label: '16:9' },
        { value: '9:16', label: '9:16' },
        { value: '1:1', label: '1:1' },
      ],
      durations: [{ value: '8s', label: '8 秒', cost: 100 }],
      defaultAspectRatio: '16:9',
      defaultDuration: '8s',
      videoConfigObject: {
        aspect_ratio: '16:9',
        video_length: 8,
        resolution: '720P',
        preset: 'normal',
        generation_mode: 'normal',
        off_peak: false,
      },
      highlight: true,
      enabled: true,
      billingMode: 'per_second',
      billingPrice: 12,
      billingUnit: 1,
      imageUrl: resolveVideoModelImage({ name, apiModel: name, imageUrl }),
      sortOrder: models.filter((item) => item.channelId === channel.id).length,
    });
    models.push(model);
    created.push(`视频模型: ${name}`);
  }

  return created;
}

async function ensureLingkeChatPresets(apiKey?: string) {
  const models = await getChatModels(false);
  const created: string[] = [];

  for (const [name, modelId] of CHAT_VISIBLE_MODELS) {
    const exists = models.find((item) => item.name === name || item.modelId === modelId);
    if (!exists) {
      const createdModel = await createChatModel({
        name,
        apiUrl: `${LK_BASE_URL}/v1/chat/completions`,
        apiKey: apiKey || '',
        modelId,
        supportsVision: false,
        maxTokens: 128000,
        costPerMessage: 1,
        billingMode: 'per_call',
        billingPrice: 1,
        billingUnit: 1,
        imageUrl: resolveChatModelImage({ name, modelId }),
        enabled: true,
      });
      models.push(createdModel);
      created.push(`聊天模型: ${name}`);
      continue;
    }

    const updates: Parameters<typeof updateChatModel>[1] = {};
    if (!exists.apiUrl) updates.apiUrl = `${LK_BASE_URL}/v1/chat/completions`;
    if (apiKey && !exists.apiKey) updates.apiKey = apiKey;
    const nextImageUrl = resolveChatModelImage({
      name: exists.name,
      modelId: exists.modelId,
      imageUrl: exists.imageUrl,
    });
    if ((!exists.imageUrl || isPlaceholderModelImageUrl(exists.imageUrl) || exists.imageUrl === '/huantu-logo.jpg') && nextImageUrl) {
      updates.imageUrl = nextImageUrl;
    }
    if (Object.keys(updates).length > 0) {
      await updateChatModel(exists.id, updates);
      created.push(`聊天模型已补全: ${name}`);
    }
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
