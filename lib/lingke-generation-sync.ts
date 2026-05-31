import { fetchLingkeMediaImageTaskSnapshot } from '@/lib/image-generator';
import { fetchLingkeMediaVideoTaskSnapshot } from '@/lib/sora';
import { saveMediaAsset, saveMediaAsync } from '@/lib/media-storage';
import { extractRuntimeMediaFilenameFromUrl } from '@/lib/media-storage';
import {
  getGeneration,
  getImageModelWithChannel,
  getVideoModelWithChannel,
  refundGenerationBalance,
  updateVideoModel,
  updateGeneration,
} from '@/lib/db';
import {
  resolveImageModelWithChannelSelection,
  resolveVideoModelWithChannelSelection,
} from '@/lib/model-channel-resolver';
import type { Generation } from '@/types';
import { getMediaKindLabel } from '@/lib/media-kind';

export const LINGKE_SYNC_MIN_INTERVAL_MS = 10_000;
const UPSTREAM_DISABLE_MODEL_ERROR_SNIPPETS = [
  '当前分组下该模型暂未配置渠道',
];

function shouldDisableVideoModelForUpstreamError(message: string): boolean {
  const normalized = String(message || '').trim();
  if (!normalized) return false;
  return UPSTREAM_DISABLE_MODEL_ERROR_SNIPPETS.some((snippet) => normalized.includes(snippet));
}

function isRecoverableLingkeImageFailure(
  generation: Generation,
  generationParams?: Record<string, unknown>
): boolean {
  if (generation.status !== 'failed') return false;

  const syncGroup =
    typeof generationParams?.upstreamStatusGroup === 'string'
      ? generationParams.upstreamStatusGroup.trim().toLowerCase()
      : '';
  const errorMessage = String(generation.errorMessage || '').trim();

  return (
    syncGroup === 'timeout'
    || errorMessage.includes('超时')
    || errorMessage.includes('未返回图片')
  );
}

function isRecoverableLingkeVideoFailure(
  generation: Generation,
  generationParams?: Record<string, unknown>
): boolean {
  if (generation.status !== 'failed') return false;

  const syncGroup =
    typeof generationParams?.upstreamStatusGroup === 'string'
      ? generationParams.upstreamStatusGroup.trim().toLowerCase()
      : '';
  const errorMessage = String(generation.errorMessage || '').trim();

  return (
    syncGroup === 'timeout'
    || errorMessage.includes('超时')
    || errorMessage.includes('未返回可访问的视频地址')
    || errorMessage.includes('上游任务已完成，但未返回可访问的视频地址')
  );
}

export function parseGenerationParams(
  params: Generation['params'] | string | null | undefined
): Record<string, unknown> | undefined {
  if (!params) return undefined;
  if (typeof params === 'string') {
    try {
      return JSON.parse(params);
    } catch {
      return undefined;
    }
  }
  return params as Record<string, unknown>;
}

export function shouldSyncLingkeImageTask(
  generation: Generation,
  generationParams?: Record<string, unknown>
): boolean {
  if (!generation.type.endsWith('-image')) return false;
  if (!generationParams) return false;

  const taskId =
    typeof generationParams.upstreamTaskId === 'string'
      ? generationParams.upstreamTaskId.trim()
      : '';
  const modelId =
    typeof generationParams.modelId === 'string'
      ? generationParams.modelId.trim()
      : '';

  if (!taskId || !modelId) return false;
  if (generation.status === 'completed') return false;

  return (
    generation.status === 'pending'
    || generation.status === 'processing'
    || isRecoverableLingkeImageFailure(generation, generationParams)
  );
}

export function shouldSyncLingkeVideoTask(
  generation: Generation,
  generationParams?: Record<string, unknown>
): boolean {
  if (!generation.type.includes('video')) return false;
  if (!generationParams) return false;

  const taskId =
    typeof generationParams.upstreamTaskId === 'string'
      ? generationParams.upstreamTaskId.trim()
      : '';
  const modelId =
    typeof generationParams.modelId === 'string'
      ? generationParams.modelId.trim()
      : '';

  if (!taskId || !modelId) return false;
  if (generation.status === 'completed') return false;

  return (
    generation.status === 'pending'
    || generation.status === 'processing'
    || isRecoverableLingkeVideoFailure(generation, generationParams)
  );
}

export async function refreshLingkeVideoGenerationIfNeeded(
  generation: Generation,
  publicBaseUrl: string,
  force = false
): Promise<Generation> {
  const generationParams = parseGenerationParams(generation.params);
  if (!shouldSyncLingkeVideoTask(generation, generationParams)) {
    return generation;
  }

  const upstreamUpdatedAt = Number(generationParams?.upstreamUpdatedAt ?? 0);
  if (
    !force &&
    generation.status !== 'failed' &&
    Number.isFinite(upstreamUpdatedAt) &&
    upstreamUpdatedAt > 0 &&
    Date.now() - upstreamUpdatedAt < LINGKE_SYNC_MIN_INTERVAL_MS
  ) {
    return generation;
  }

  const modelId = String(generationParams?.modelId || '').trim();
  const upstreamTaskId = String(generationParams?.upstreamTaskId || '').trim();
  if (!modelId || !upstreamTaskId) {
    return generation;
  }

  const modelConfig =
    await getVideoModelWithChannel(modelId)
    || await resolveVideoModelWithChannelSelection({
      modelId,
      model:
        typeof generationParams?.model === 'string'
          ? generationParams.model
          : undefined,
    });
  if (!modelConfig || modelConfig.channel.type !== 'lingke-media') {
    return generation;
  }

  const { effectiveBaseUrl, effectiveApiKey } = modelConfig;
  if (!effectiveBaseUrl || !effectiveApiKey) {
    return generation;
  }

  const snapshot = await fetchLingkeMediaVideoTaskSnapshot(
    effectiveBaseUrl,
    effectiveApiKey,
    upstreamTaskId
  );

  const nextParams: Record<string, unknown> = {
    ...(generationParams || {}),
    progress: snapshot.final ? 100 : Math.max(Number(generationParams?.progress ?? 0), Math.min(Math.max(snapshot.progress, 10), 95)),
    upstreamTaskId: snapshot.taskId,
    upstreamStatus: snapshot.status || snapshot.message || undefined,
    upstreamState: snapshot.state || undefined,
    upstreamStatusGroup: snapshot.statusGroup,
    upstreamProgress: snapshot.final ? 100 : Math.min(Math.max(snapshot.progress, 10), 95),
    upstreamUpdatedAt: Date.now(),
  };

  if (snapshot.final && snapshot.resultUrl && (snapshot.resultKind === 'image' || snapshot.resultKind === 'audio')) {
    const detailedMessage = `上游返回的是${getMediaKindLabel(snapshot.resultKind)}而不是视频，请更换模型或分组后重试`;
    const updated = await updateGeneration(generation.id, {
      status: 'failed',
      errorMessage: detailedMessage,
      params: {
        ...nextParams,
        progress: 100,
        upstreamProgress: 100,
        upstreamResultUrl: snapshot.resultUrl,
        upstreamFinal: true,
      },
    });
    if (!generation.balanceRefunded && generation.balancePrecharged && generation.cost > 0) {
      await refundGenerationBalance(generation.id, generation.userId, generation.cost).catch(() => {});
      return (await getGeneration(generation.id)) || updated || generation;
    }
    return updated || generation;
  }

  if (snapshot.final && snapshot.resultUrl) {
    const savedAsset = await saveMediaAsset(generation.id, snapshot.resultUrl, {
      publicBaseUrl,
      storageMode: 'runtime',
    });
    if (savedAsset.kind === 'image' || savedAsset.kind === 'audio') {
      const detailedMessage = `上游返回的是${getMediaKindLabel(savedAsset.kind)}而不是视频，请更换模型或分组后重试`;
      const updated = await updateGeneration(generation.id, {
        status: 'failed',
        errorMessage: detailedMessage,
        params: {
          ...nextParams,
          progress: 100,
          upstreamProgress: 100,
          upstreamResultUrl: snapshot.resultUrl,
          upstreamFinal: true,
        },
      });
      if (!generation.balanceRefunded && generation.balancePrecharged && generation.cost > 0) {
        await refundGenerationBalance(generation.id, generation.userId, generation.cost).catch(() => {});
        return (await getGeneration(generation.id)) || updated || generation;
      }
      return updated || generation;
    }

    const runtimeMediaFilename = extractRuntimeMediaFilenameFromUrl(savedAsset.url, publicBaseUrl);
    const updated = await updateGeneration(generation.id, {
      status: 'completed',
      resultUrl: savedAsset.url,
      errorMessage: '',
      params: {
        ...nextParams,
        progress: 100,
        upstreamProgress: 100,
        upstreamResultUrl: snapshot.resultUrl,
        upstreamFinal: true,
        ...(runtimeMediaFilename
          ? {
              runtimeMediaCachedAt: Date.now(),
              runtimeMediaCachedFrom: snapshot.resultUrl,
              runtimeMediaOriginTimestamp: Date.now(),
            }
          : {}),
      },
    });
    return updated || generation;
  }

  if (snapshot.final && snapshot.state === 'completed' && !snapshot.resultUrl) {
    const detailedMessage = snapshot.message || snapshot.status || '上游任务已完成，但未返回可访问的视频地址';
    const updated = await updateGeneration(generation.id, {
      status: 'failed',
      errorMessage: detailedMessage,
      params: nextParams,
    });
    if (!generation.balanceRefunded && generation.balancePrecharged && generation.cost > 0) {
      await refundGenerationBalance(generation.id, generation.userId, generation.cost).catch(() => {});
      return (await getGeneration(generation.id)) || updated || generation;
    }
    return updated || generation;
  }

  if (snapshot.state === 'failed') {
    const detailedMessage = snapshot.message || snapshot.status || generation.errorMessage || '上游任务失败';
    if (modelId && shouldDisableVideoModelForUpstreamError(detailedMessage)) {
      await updateVideoModel(modelId, { enabled: false }).catch((error) => {
        console.error('[LingkeSync] 自动禁用无渠道视频模型失败:', error);
      });
    }
    const updated = await updateGeneration(generation.id, {
      status: 'failed',
      errorMessage: detailedMessage,
      params: nextParams,
    });
    if (!generation.balanceRefunded && generation.balancePrecharged && generation.cost > 0) {
      await refundGenerationBalance(generation.id, generation.userId, generation.cost).catch(() => {});
      return (await getGeneration(generation.id)) || updated || generation;
    }
    return updated || generation;
  }

  const updated = await updateGeneration(generation.id, {
    status: 'processing',
    errorMessage: '',
    params: nextParams,
  });
  return updated || generation;
}

export async function refreshLingkeImageGenerationIfNeeded(
  generation: Generation,
  publicBaseUrl: string,
  force = false
): Promise<Generation> {
  const generationParams = parseGenerationParams(generation.params);
  if (!shouldSyncLingkeImageTask(generation, generationParams)) {
    return generation;
  }

  const upstreamUpdatedAt = Number(generationParams?.upstreamUpdatedAt ?? 0);
  if (
    !force &&
    generation.status !== 'failed' &&
    Number.isFinite(upstreamUpdatedAt) &&
    upstreamUpdatedAt > 0 &&
    Date.now() - upstreamUpdatedAt < LINGKE_SYNC_MIN_INTERVAL_MS
  ) {
    return generation;
  }

  const modelId = String(generationParams?.modelId || '').trim();
  const upstreamTaskId = String(generationParams?.upstreamTaskId || '').trim();
  if (!modelId || !upstreamTaskId) {
    return generation;
  }

  const modelConfig =
    await getImageModelWithChannel(modelId)
    || await resolveImageModelWithChannelSelection({
      modelId,
      model:
        typeof generationParams?.model === 'string'
          ? generationParams.model
          : undefined,
    });
  if (!modelConfig || modelConfig.channel.type !== 'lingke-media') {
    return generation;
  }

  const { effectiveBaseUrl, effectiveApiKey, channel } = modelConfig;
  if (!effectiveBaseUrl || !effectiveApiKey) {
    return generation;
  }

  const snapshot = await fetchLingkeMediaImageTaskSnapshot(
    effectiveBaseUrl,
    effectiveApiKey,
    channel.id,
    upstreamTaskId
  );

  const nextParams: Record<string, unknown> = {
    ...(generationParams || {}),
    progress: snapshot.final ? 100 : Math.max(Number(generationParams?.progress ?? 0), Math.min(Math.max(snapshot.progress, 10), 95)),
    upstreamTaskId: snapshot.taskId,
    upstreamStatus: snapshot.status || snapshot.message || undefined,
    upstreamState: snapshot.state || undefined,
    upstreamStatusGroup: snapshot.statusGroup,
    upstreamProgress: snapshot.final ? 100 : Math.min(Math.max(snapshot.progress, 10), 95),
    upstreamUpdatedAt: Date.now(),
  };

  if (snapshot.final && snapshot.resultUrl) {
    const savedUrl = await saveMediaAsync(generation.id, snapshot.resultUrl, {
      publicBaseUrl,
      storageMode: 'runtime',
    });
    const runtimeMediaFilename = extractRuntimeMediaFilenameFromUrl(savedUrl, publicBaseUrl);
    const updated = await updateGeneration(generation.id, {
      status: 'completed',
      resultUrl: savedUrl,
      errorMessage: '',
      params: {
        ...nextParams,
        progress: 100,
        upstreamProgress: 100,
        upstreamResultUrl: snapshot.resultUrl,
        upstreamFinal: true,
        ...(runtimeMediaFilename
          ? {
              runtimeMediaCachedAt: Date.now(),
              runtimeMediaCachedFrom: snapshot.resultUrl,
              runtimeMediaOriginTimestamp: Date.now(),
            }
          : {}),
      },
    });
    return updated || generation;
  }

  if (snapshot.state === 'failed') {
    const updated = await updateGeneration(generation.id, {
      status: 'failed',
      errorMessage: snapshot.message || snapshot.status || '上游任务失败',
      params: nextParams,
    });
    if (!generation.balanceRefunded && generation.balancePrecharged && generation.cost > 0) {
      await refundGenerationBalance(generation.id, generation.userId, generation.cost).catch(() => {});
      return (await getGeneration(generation.id)) || updated || generation;
    }
    return updated || generation;
  }

  const updated = await updateGeneration(generation.id, {
    status: 'processing',
    errorMessage: '',
    params: nextParams,
  });
  return updated || generation;
}
