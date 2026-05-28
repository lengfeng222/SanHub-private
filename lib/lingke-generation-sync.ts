import { fetchLingkeMediaImageTaskSnapshot } from '@/lib/image-generator';
import { fetchLingkeMediaVideoTaskSnapshot } from '@/lib/sora';
import { saveMediaAsync } from '@/lib/media-storage';
import {
  getGeneration,
  getImageModelWithChannel,
  getVideoModelWithChannel,
  refundGenerationBalance,
  updateGeneration,
} from '@/lib/db';
import type { Generation } from '@/types';

export const LINGKE_SYNC_MIN_INTERVAL_MS = 10_000;

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

  const syncGroup =
    typeof generationParams.upstreamStatusGroup === 'string'
      ? generationParams.upstreamStatusGroup.trim().toLowerCase()
      : '';
  const timeoutish =
    generation.status === 'failed' &&
    (syncGroup === 'timeout' || (generation.errorMessage || '').includes('超时'));

  return generation.status === 'pending' || generation.status === 'processing' || timeoutish;
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

  const syncGroup =
    typeof generationParams.upstreamStatusGroup === 'string'
      ? generationParams.upstreamStatusGroup.trim().toLowerCase()
      : '';
  const timeoutish =
    generation.status === 'failed' &&
    (syncGroup === 'timeout' || (generation.errorMessage || '').includes('超时'));

  return generation.status === 'pending' || generation.status === 'processing' || timeoutish;
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

  const modelConfig = await getVideoModelWithChannel(modelId);
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

  if (snapshot.final && snapshot.resultUrl) {
    const savedUrl = await saveMediaAsync(generation.id, snapshot.resultUrl, { publicBaseUrl });
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
      },
    });
    return updated || generation;
  }

  if (snapshot.state === 'failed') {
    const detailedMessage = snapshot.message || snapshot.status || generation.errorMessage || '上游任务失败';
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

  const modelConfig = await getImageModelWithChannel(modelId);
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
    const savedUrl = await saveMediaAsync(generation.id, snapshot.resultUrl, { publicBaseUrl });
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
