import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
  getVideoModels,
  getVideoModel,
  getVideoChannel,
  createVideoModel,
  updateVideoModel,
  deleteVideoModel,
} from '@/lib/db';
import { estimateVideoDurationCost, inferVideoBillingProfile } from '@/lib/video-model-normalizer';
import type { VideoConfigObject, VideoPricingRule } from '@/types';

function normalizeExtraParams(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;

  try {
    const cloned = JSON.parse(JSON.stringify(raw)) as unknown;
    if (!cloned || typeof cloned !== 'object' || Array.isArray(cloned)) return undefined;
    return Object.keys(cloned).length > 0 ? (cloned as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function normalizeVideoConfigObject(raw: unknown): VideoConfigObject | undefined {
  if (!raw || typeof raw !== 'object') return undefined;

  const source = raw as Record<string, unknown>;
  const config: VideoConfigObject = {};

  const aspectRatioRaw = source.aspect_ratio;
  if (typeof aspectRatioRaw === 'string') {
    const aspectRatio = aspectRatioRaw.trim();
    if (['16:9', '9:16', '1:1', '2:3', '3:2'].includes(aspectRatio)) {
      config.aspect_ratio = aspectRatio as VideoConfigObject['aspect_ratio'];
    }
  }

  const videoLengthRaw = source.video_length;
  if (typeof videoLengthRaw === 'number' && Number.isFinite(videoLengthRaw)) {
    const seconds = Math.max(1, Math.min(30, Math.floor(videoLengthRaw)));
    config.video_length = seconds;
  }

  const resolutionRaw = source.resolution;
  if (typeof resolutionRaw === 'string') {
    const resolution = resolutionRaw.trim().toUpperCase();
    if (resolution) {
      config.resolution = resolution;
    }
  }

  const presetRaw = source.preset;
  if (typeof presetRaw === 'string') {
    const preset = presetRaw.trim().toLowerCase();
    if (preset === 'fun' || preset === 'normal' || preset === 'spicy') {
      config.preset = preset;
    }
  }

  const generationModeRaw = source.generation_mode;
  if (typeof generationModeRaw === 'string' && generationModeRaw.trim()) {
    config.generation_mode = generationModeRaw.trim();
  }

  if (typeof source.off_peak === 'boolean') {
    config.off_peak = source.off_peak;
  }

  const qualityVersionRaw = source.quality_version;
  if (typeof qualityVersionRaw === 'string' && qualityVersionRaw.trim()) {
    config.quality_version = qualityVersionRaw.trim();
  }

  const modelVersionRaw = source.model_version;
  if (typeof modelVersionRaw === 'string' && modelVersionRaw.trim()) {
    config.model_version = modelVersionRaw.trim();
  }

  const versionRaw = source.version;
  if (typeof versionRaw === 'string' && versionRaw.trim()) {
    config.version = versionRaw.trim();
  }

  const extraParams = normalizeExtraParams(source.extra_params);
  if (extraParams) {
    config.extra_params = extraParams;
  }

  return Object.keys(config).length > 0 ? config : undefined;
}

function normalizeVideoPricingRules(raw: unknown): VideoPricingRule[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .map((item, index) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
      const source = item as Record<string, unknown>;
      const toStringOrUndefined = (value: unknown) => {
        if (typeof value !== 'string') return undefined;
        const normalized = value.trim();
        return normalized || undefined;
      };
      const toPrice = (value: unknown) => {
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
        return Math.round(parsed);
      };

      const rule: VideoPricingRule = {
        id: toStringOrUndefined(source.id) || `video_rule_${Date.now()}_${index}`,
        label: toStringOrUndefined(source.label),
        duration: toStringOrUndefined(source.duration),
        aspectRatio: toStringOrUndefined(source.aspectRatio),
        resolution: toStringOrUndefined(source.resolution),
        qualityVersion: toStringOrUndefined(source.qualityVersion),
        modelVersion: toStringOrUndefined(source.modelVersion),
        version: toStringOrUndefined(source.version),
        generationMode: toStringOrUndefined(source.generationMode),
        offPeak: typeof source.offPeak === 'boolean' ? source.offPeak : undefined,
        normalPrice: toPrice(source.normalPrice),
        vipPrice: toPrice(source.vipPrice),
        svipPrice: toPrice(source.svipPrice),
        enabled: source.enabled !== false,
      };

      const hasCondition = Boolean(
        rule.duration
        || rule.aspectRatio
        || rule.resolution
        || rule.qualityVersion
        || rule.modelVersion
        || rule.version
        || rule.generationMode
        || typeof rule.offPeak === 'boolean'
      );
      const hasPrice = Boolean(rule.normalPrice || rule.vipPrice || rule.svipPrice);

      return hasCondition && hasPrice ? rule : null;
    })
    .filter((item): item is VideoPricingRule => Boolean(item));
}

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user || session.user.role !== 'admin') {
      return NextResponse.json({ error: '无权限' }, { status: 403 });
    }

    const models = await getVideoModels();
    return NextResponse.json({ success: true, data: models });
  } catch (error) {
    console.error('[API] Get video models error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '获取失败' },
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

    const body = await request.json();
    const {
      channelId, name, description, apiModel, baseUrl, apiKey,
      features, aspectRatios, durations,
      defaultAspectRatio, defaultDuration, videoConfigObject, highlight, enabled, billingMode, billingPrice, billingUnit,
      normalPrice, vipPrice, svipPrice, pricingRules, imageUrl, sortOrder,
    } = body;

    if (!channelId || !name || !apiModel) {
      return NextResponse.json({ error: '渠道、名称和模型 ID 必填' }, { status: 400 });
    }

    const channel = await getVideoChannel(channelId);
    if (!channel) {
      return NextResponse.json({ error: '渠道不存在' }, { status: 404 });
    }

    const inferredBilling = inferVideoBillingProfile({
      channelType: channel.type,
      apiModel,
      fallbackMode: 'per_second',
      fallbackPrice: 12,
      fallbackUnit: 1,
    });
    const resolvedBillingMode = billingMode ?? inferredBilling.billingMode;
    const resolvedBillingPrice = billingPrice ?? inferredBilling.billingPrice;
    const resolvedBillingUnit = billingUnit ?? inferredBilling.billingUnit;
    const resolvedDefaultDuration = defaultDuration || '8s';
    const resolvedDurations = durations || [
      {
        value: resolvedDefaultDuration,
        label: resolvedDefaultDuration.replace(/^(\d+)s$/i, '$1 秒'),
        cost: estimateVideoDurationCost(
          resolvedDefaultDuration,
          {
            billingMode: resolvedBillingMode,
            billingPrice: resolvedBillingPrice,
            billingUnit: resolvedBillingUnit,
          },
          100
        ),
      },
    ];

    const model = await createVideoModel({
      channelId,
      name,
      description: description || '',
      apiModel,
      baseUrl: baseUrl || undefined,
      apiKey: apiKey || undefined,
      features: features || {
        textToVideo: true,
        imageToVideo: false,
        videoToVideo: false,
        supportStyles: false,
      },
      aspectRatios: aspectRatios || [
        { value: 'landscape', label: '16:9' },
        { value: 'portrait', label: '9:16' },
      ],
      durations: resolvedDurations,
      defaultAspectRatio: defaultAspectRatio || 'landscape',
      defaultDuration: resolvedDefaultDuration,
      videoConfigObject: normalizeVideoConfigObject(videoConfigObject),
      highlight: highlight || false,
      enabled: enabled !== false,
      billingMode: resolvedBillingMode,
      billingPrice: resolvedBillingPrice,
      billingUnit: resolvedBillingUnit,
      normalPrice: normalPrice ?? undefined,
      vipPrice: vipPrice ?? undefined,
      svipPrice: svipPrice ?? undefined,
      pricingRules: normalizeVideoPricingRules(pricingRules),
      imageUrl: imageUrl || undefined,
      sortOrder: sortOrder || 0,
    });

    return NextResponse.json({ success: true, data: model });
  } catch (error) {
    console.error('[API] Create video model error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '创建失败' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user || session.user.role !== 'admin') {
      return NextResponse.json({ error: '无权限' }, { status: 403 });
    }

    const body = await request.json();
    const { id, ...updates } = body;

    if (!id) {
      return NextResponse.json({ error: '缺少 ID' }, { status: 400 });
    }

    const normalizedUpdates: Record<string, unknown> = { ...updates };

    if (Object.prototype.hasOwnProperty.call(updates, 'baseUrl')) {
      const value = (updates as { baseUrl?: unknown }).baseUrl;
      normalizedUpdates.baseUrl = typeof value === 'string' ? value.trim() : '';
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'apiKey')) {
      const value = (updates as { apiKey?: unknown }).apiKey;
      normalizedUpdates.apiKey = typeof value === 'string' ? value.trim() : '';
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'videoConfigObject')) {
      normalizedUpdates.videoConfigObject = normalizeVideoConfigObject(
        (updates as { videoConfigObject?: unknown }).videoConfigObject
      );
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'pricingRules')) {
      normalizedUpdates.pricingRules = normalizeVideoPricingRules(
        (updates as { pricingRules?: unknown }).pricingRules
      );
    }

    const model = await updateVideoModel(id, normalizedUpdates);
    if (!model) {
      return NextResponse.json({ error: '模型不存在' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: model });
  } catch (error) {
    console.error('[API] Update video model error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '更新失败' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user || session.user.role !== 'admin') {
      return NextResponse.json({ error: '无权限' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: '缺少 ID' }, { status: 400 });
    }

    const success = await deleteVideoModel(id);
    if (!success) {
      return NextResponse.json({ error: '删除失败' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[API] Delete video model error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '删除失败' },
      { status: 500 }
    );
  }
}
