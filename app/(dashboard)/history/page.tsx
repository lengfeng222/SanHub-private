'use client';

/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CircleAlert,
  Clock3,
  ExternalLink,
  Headphones,
  Image as ImageIcon,
  Loader2,
  Play,
  Trash2,
  User,
  Video,
} from 'lucide-react';
import type { Generation, SafeVideoModel } from '@/types';
import { resolveVideoModelLabel } from '@/lib/video-model-label';
import { cn } from '@/lib/utils';

const tabs = [
  { key: 'all', label: '全部' },
  { key: 'video', label: '视频' },
  { key: 'image', label: '图像' },
  { key: 'audio', label: '音频' },
  { key: 'character', label: '角色卡' },
] as const;

const statusLabelMap: Record<Generation['status'], string> = {
  pending: '排队中',
  processing: '生成中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

function isVideoItem(item: Generation) {
  return item.type.includes('video');
}

function isImageItem(item: Generation) {
  return item.type.includes('image');
}

function isAudioItem(item: Generation) {
  return item.type === 'music' || item.type === 'voice';
}

function isCharacterItem(item: Generation) {
  return item.type === 'character-card';
}

function getTypeLabel(item: Generation) {
  if (isVideoItem(item)) return '视频';
  if (isImageItem(item)) return '图像';
  if (isAudioItem(item)) return '音频';
  if (isCharacterItem(item)) return '角色卡';
  return item.type;
}

function getStatusBadgeClass(status: Generation['status']) {
  switch (status) {
    case 'completed':
      return 'border-emerald-400/30 bg-emerald-500/12 text-emerald-200';
    case 'failed':
    case 'cancelled':
      return 'border-red-400/30 bg-red-500/12 text-red-200';
    case 'processing':
      return 'border-sky-400/30 bg-sky-500/12 text-sky-200';
    case 'pending':
    default:
      return 'border-amber-300/25 bg-amber-400/10 text-amber-100';
  }
}

export default function HistoryPage() {
  const [items, setItems] = useState<Generation[]>([]);
  const [videoModels, setVideoModels] = useState<Pick<SafeVideoModel, 'id' | 'name'>[]>([]);
  const [filter, setFilter] = useState<(typeof tabs)[number]['key']>('all');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [historyRes, videoModelsRes] = await Promise.allSettled([
        fetch('/api/user/history?limit=50', { cache: 'no-store' }),
        fetch('/api/video-models', { cache: 'no-store' }),
      ]);

      if (historyRes.status === 'fulfilled') {
        const historyData = await historyRes.value.json().catch(() => ({}));
        if (historyRes.value.ok) {
          setItems(historyData.data || []);
        }
      }

      if (videoModelsRes.status === 'fulfilled') {
        const modelsData = await videoModelsRes.value.json().catch(() => ({}));
        if (videoModelsRes.value.ok) {
          setVideoModels(
            (modelsData.data?.models || []).map((item: SafeVideoModel) => ({
              id: item.id,
              name: item.name,
            }))
          );
        }
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();

    const intervalId = window.setInterval(() => {
      void load();
    }, 15000);
    const handleFocus = () => {
      void load();
    };

    window.addEventListener('focus', handleFocus);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', handleFocus);
    };
  }, [load]);

  const stats = useMemo(() => {
    const total = items.length;
    const video = items.filter((item) => isVideoItem(item)).length;
    const image = items.filter((item) => isImageItem(item)).length;
    const audio = items.filter((item) => isAudioItem(item)).length;
    const character = items.filter((item) => isCharacterItem(item)).length;
    return { total, video, image, audio, character };
  }, [items]);

  const filtered = useMemo(() => {
    switch (filter) {
      case 'video':
        return items.filter((item) => isVideoItem(item));
      case 'image':
        return items.filter((item) => isImageItem(item));
      case 'audio':
        return items.filter((item) => isAudioItem(item));
      case 'character':
        return items.filter((item) => isCharacterItem(item));
      default:
        return items;
    }
  }, [filter, items]);

  const videoModelMap = useMemo(
    () => new Map(videoModels.map((item) => [item.id, item.name])),
    [videoModels]
  );

  const getModelLabel = (item: Generation) => {
    if (isVideoItem(item)) {
      return resolveVideoModelLabel({
        modelId: typeof item.params?.modelId === 'string' ? item.params.modelId : undefined,
        model: typeof item.params?.model === 'string' ? item.params.model : undefined,
        modelNameMap: videoModelMap,
      });
    }

    if (isImageItem(item)) {
      return (item.params?.model as string) || '图像生成';
    }

    if (item.type === 'music') return 'AI 音乐';
    if (item.type === 'voice') return 'TTS 语音';
    if (item.type === 'character-card') return '角色卡';
    return item.type;
  };

  const getUpstreamStatusLabel = (item: Generation) => {
    if (typeof item.params?.upstreamStatus === 'string' && item.params.upstreamStatus.trim()) {
      return item.params.upstreamStatus.trim();
    }
    if (typeof item.params?.upstreamState === 'string' && item.params.upstreamState.trim()) {
      return item.params.upstreamState.trim();
    }
    return '';
  };

  const renderPreview = (item: Generation) => {
    if (item.status === 'pending' || item.status === 'processing') {
      const upstreamLabel = getUpstreamStatusLabel(item);
      return (
        <div className="flex h-full flex-col items-center justify-center bg-gradient-to-br from-sky-500/10 via-sky-500/6 to-emerald-500/10 text-white/70">
          {item.status === 'processing' ? (
            <Loader2 className="mb-3 h-8 w-8 animate-spin" />
          ) : (
            <Clock3 className="mb-3 h-8 w-8" />
          )}
          <p className="text-sm font-medium">{statusLabelMap[item.status]}</p>
          <p className="mt-1 px-4 text-center text-xs text-white/40">
            {upstreamLabel ? `上游：${upstreamLabel}` : '任务正在处理中，请稍后刷新'}
          </p>
        </div>
      );
    }

    if (item.status === 'failed' || item.status === 'cancelled') {
      const upstreamLabel = getUpstreamStatusLabel(item);
      return (
        <div className="flex h-full flex-col items-center justify-center bg-red-500/10 px-4 text-red-200">
          <CircleAlert className="mb-3 h-8 w-8" />
          <p className="text-sm font-medium">{statusLabelMap[item.status]}</p>
          <p className="mt-1 max-w-[92%] truncate text-xs text-red-200/65">
            {item.errorMessage || (upstreamLabel ? `上游：${upstreamLabel}` : '生成未成功完成')}
          </p>
        </div>
      );
    }

    if (!item.resultUrl) {
      return (
        <div className="flex h-full items-center justify-center bg-black/20 text-white/35">
          <div className="text-center">
            <ImageIcon className="mx-auto h-8 w-8" />
            <p className="mt-2 text-xs text-white/35">媒体同步中</p>
          </div>
        </div>
      );
    }

    if (isVideoItem(item)) {
      return (
        <video
          src={item.resultUrl}
          className="h-full w-full object-cover"
          muted
          loop
          playsInline
          preload="metadata"
          onMouseEnter={(event) => void event.currentTarget.play().catch(() => {})}
          onMouseLeave={(event) => {
            event.currentTarget.pause();
            event.currentTarget.currentTime = 0;
          }}
        />
      );
    }

    if (isImageItem(item) || isCharacterItem(item)) {
      return (
        <img
          src={item.resultUrl}
          alt={item.prompt || getModelLabel(item)}
          className="h-full w-full object-cover"
          loading="lazy"
          decoding="async"
        />
      );
    }

    if (isAudioItem(item)) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 bg-gradient-to-br from-violet-500/10 to-fuchsia-500/10 px-4 text-white/75">
          <Headphones className="h-8 w-8" />
          <audio controls src={item.resultUrl} className="w-full max-w-[90%]" />
        </div>
      );
    }

    return (
      <div className="flex h-full items-center justify-center bg-black/20 text-white/35">
        <ImageIcon className="h-8 w-8" />
      </div>
    );
  };

  return (
    <div className="space-y-6 pb-8">
      <div className="space-y-3">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-xs text-white/62 backdrop-blur-xl">
          <Clock3 className="h-3.5 w-3.5 text-emerald-300" />
          自动同步最近 50 条作品与上游状态
        </div>
        <div>
          <h1 className="text-[2.35rem] font-semibold tracking-[-0.05em] text-white sm:text-5xl">
            作品库
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-white/48 sm:text-base">
            统一查看视频、图像、音频与角色卡作品，支持快速预览、状态追踪和结果下载。
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {[
          ['总作品', stats.total, null],
          ['视频', stats.video, 'video'],
          ['图像', stats.image, 'image'],
          ['音频', stats.audio, 'audio'],
          ['角色卡', stats.character, 'character'],
        ].map(([label, value, iconKey]) => {
          const icon =
            iconKey === 'video' ? <Video className="h-4 w-4" /> :
            iconKey === 'image' ? <ImageIcon className="h-4 w-4" /> :
            iconKey === 'audio' ? <Headphones className="h-4 w-4" /> :
            iconKey === 'character' ? <User className="h-4 w-4" /> : null;

          return (
            <div
              key={String(label)}
              className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(16,22,32,0.94),rgba(11,16,24,0.92))] p-4 shadow-[0_20px_60px_rgba(0,0,0,0.22)] backdrop-blur-2xl"
            >
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-white/65">
                {icon}
              </div>
              <div className="text-3xl font-semibold tracking-[-0.05em] text-white">
                {Number(value).toLocaleString('zh-CN')}
              </div>
              <div className="mt-1 text-sm text-white/45">{String(label)}</div>
            </div>
          );
        })}
      </div>

      <section className="overflow-hidden rounded-[32px] border border-white/10 bg-[#0d131c]/86 shadow-[0_24px_80px_rgba(0,0,0,0.28)] backdrop-blur-2xl">
        <div className="border-b border-white/8 px-4 py-4 sm:px-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap gap-2">
              {tabs.map((tab) => {
                const active = filter === tab.key;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setFilter(tab.key)}
                    className={cn(
                      'rounded-full border px-4 py-2 text-sm font-medium transition',
                      active
                        ? 'border-emerald-400/30 bg-emerald-400/12 text-emerald-200 shadow-[0_0_0_1px_rgba(52,211,153,0.08)]'
                        : 'border-white/10 bg-white/[0.03] text-white/55 hover:bg-white/[0.06] hover:text-white'
                    )}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.02] px-4 py-2 text-sm text-white/28"
              >
                批量选择
              </button>
              <button
                type="button"
                disabled
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.02] px-4 py-2 text-sm text-white/28"
              >
                <Trash2 className="h-4 w-4" />
                清空媒体
              </button>
              <button
                type="button"
                disabled
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.02] px-4 py-2 text-sm text-white/28"
              >
                <Trash2 className="h-4 w-4" />
                清空角色卡
              </button>
            </div>
          </div>
        </div>

        <div className="px-4 py-5 sm:px-6">
          <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-2xl font-semibold tracking-[-0.04em] text-white">作品库</h2>
              <p className="mt-1 text-sm text-white/42">
                当前筛选下共 {filtered.length.toLocaleString('zh-CN')} 个作品
              </p>
            </div>
            <p className="text-xs text-white/32">最近状态每 15 秒自动同步一次</p>
          </div>

          {loading ? (
            <div className="rounded-[26px] border border-dashed border-white/10 bg-[#0f141d] px-6 py-16 text-center text-sm text-white/35">
              加载中...
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex min-h-[360px] flex-col items-center justify-center rounded-[26px] border border-dashed border-white/10 bg-[#0f141d] px-6 py-16 text-center">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] text-white/35">
                <ImageIcon className="h-6 w-6" />
              </div>
              <p className="text-xl font-medium text-white/72">暂无作品</p>
              <p className="mt-2 max-w-md text-sm text-white/35">
                生成完成的视频、图像、音频与角色卡会显示在这里
              </p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {filtered.map((item) => {
                const card = (
                  <div className="group overflow-hidden rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,rgba(17,23,33,0.96),rgba(12,17,24,0.92))] p-3 transition hover:-translate-y-0.5 hover:border-white/16 hover:bg-white/[0.04]">
                    <div className="relative aspect-video overflow-hidden rounded-[20px] border border-white/8 bg-black/20">
                      {renderPreview(item)}

                      <div className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full border border-white/10 bg-black/35 px-2.5 py-1 text-[11px] text-white/88 backdrop-blur-md">
                        {isVideoItem(item) ? (
                          <Play className="h-3 w-3" />
                        ) : isImageItem(item) ? (
                          <ImageIcon className="h-3 w-3" />
                        ) : isAudioItem(item) ? (
                          <Headphones className="h-3 w-3" />
                        ) : (
                          <User className="h-3 w-3" />
                        )}
                        {getTypeLabel(item)}
                      </div>

                      <div
                        className={cn(
                          'absolute right-2 top-2 rounded-full border px-2.5 py-1 text-[11px] backdrop-blur-md',
                          getStatusBadgeClass(item.status)
                        )}
                      >
                        {statusLabelMap[item.status]}
                      </div>
                    </div>

                    <div className="mt-3 line-clamp-2 min-h-[2.75rem] text-sm leading-6 text-white/82">
                      {item.prompt || '无提示词'}
                    </div>

                    <div className="mt-3 flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium text-white/62">
                          {getModelLabel(item)}
                        </div>
                        <div className="mt-1 text-[11px] text-white/35">
                          {new Date(item.createdAt).toLocaleString('zh-CN')}
                        </div>
                        {getUpstreamStatusLabel(item) ? (
                          <div className="mt-1 truncate text-[10px] text-white/28">
                            上游：{getUpstreamStatusLabel(item)}
                          </div>
                        ) : null}
                      </div>

                      {item.resultUrl && item.status === 'completed' ? (
                        <div className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-white/38 transition group-hover:text-white/78">
                          <ExternalLink className="h-4 w-4" />
                        </div>
                      ) : null}
                    </div>
                  </div>
                );

                if (item.resultUrl && item.status === 'completed') {
                  return (
                    <a key={item.id} href={item.resultUrl} target="_blank" rel="noreferrer">
                      {card}
                    </a>
                  );
                }

                return <div key={item.id}>{card}</div>;
              })}
            </div>
          )}

          <div className="mt-5">
            <button
              type="button"
              className="rounded-full border border-white/10 bg-white/[0.03] px-5 py-2 text-sm text-white/72 transition hover:bg-white/[0.06] hover:text-white"
            >
              加载更多
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
