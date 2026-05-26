import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
  getVideoModels,
  getVideoModel,
  createVideoModel,
  updateVideoModel,
  deleteVideoModel,
} from '@/lib/db';
import type { VideoConfigObject } from '@/types';

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
      defaultAspectRatio, defaultDuration, videoConfigObject, highlight, enabled, billingMode, billingPrice, billingUnit, imageUrl, sortOrder,
    } = body;

    if (!channelId || !name || !apiModel) {
      return NextResponse.json({ error: '渠道、名称和模型 ID 必填' }, { status: 400 });
    }

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
      durations: durations || [
        { value: '8s', label: '8 秒', cost: 100 },
      ],
      defaultAspectRatio: defaultAspectRatio || 'landscape',
      defaultDuration: defaultDuration || '8s',
      videoConfigObject: normalizeVideoConfigObject(videoConfigObject),
      highlight: highlight || false,
      enabled: enabled !== false,
      billingMode: billingMode || 'per_second',
      billingPrice: billingPrice ?? 12,
      billingUnit: billingUnit || 1,
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
