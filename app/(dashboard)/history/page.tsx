'use client';

/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckSquare,
  CircleAlert,
  Clock3,
  Download,
  ExternalLink,
  Headphones,
  Image as ImageIcon,
  Loader2,
  Play,
  Square,
  Trash2,
  User,
  Video,
  X,
} from 'lucide-react';
import type { CharacterCard, Generation, SafeVideoModel } from '@/types';
import { resolveVideoModelLabel } from '@/lib/video-model-label';
import { cn } from '@/lib/utils';
import { downloadAsset } from '@/lib/download';
import { deleteGenerationRecords } from '@/lib/generation-client';

type HistoryTabKey = 'all' | 'video' | 'image' | 'audio' | 'character';
type HistoryEntry = Generation & { source: 'generation' | 'character-card' };

const tabs: Array<{ key: HistoryTabKey; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'video', label: '视频' },
  { key: 'image', label: '图像' },
  { key: 'audio', label: '音频' },
  { key: 'character', label: '角色卡' },
];

const statusLabelMap: Record<Generation['status'], string> = {
  pending: '排队中',
  processing: '生成中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

function isVideoItem(item: HistoryEntry) {
  return item.type.includes('video');
}

function isImageItem(item: HistoryEntry) {
  return item.type.includes('image');
}

function isAudioItem(item: HistoryEntry) {
  return item.type === 'music' || item.type === 'voice';
}

function isCharacterItem(item: HistoryEntry) {
  return item.type === 'character-card';
}

function getTypeLabel(item: HistoryEntry) {
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

function characterCardToEntry(card: CharacterCard): HistoryEntry {
  return {
    id: card.id,
    userId: card.userId,
    type: 'character-card',
    prompt: card.characterName || '角色卡',
    params: {
      model: '角色卡',
      sourceVideoUrl: card.sourceVideoUrl,
    } as Generation['params'],
    resultUrl: card.avatarUrl || '',
    cost: 0,
    status: card.status,
    errorMessage: card.errorMessage,
    createdAt: card.createdAt,
    updatedAt: card.updatedAt,
    source: 'character-card',
  };
}

function getDownloadExtension(item: HistoryEntry) {
  if (isAudioItem(item)) {
    if (typeof item.params?.format === 'string' && item.params.format.trim()) {
      return item.params.format.trim().toLowerCase();
    }
    return 'mp3';
  }
  if (isVideoItem(item)) return 'mp4';
  return 'png';
}

export default function HistoryPage() {
  const [items, setItems] = useState<HistoryEntry[]>([]);
  const [videoModels, setVideoModels] = useState<Pick<SafeVideoModel, 'id' | 'name'>[]>([]);
  const [filter, setFilter] = useState<HistoryTabKey>('all');
  const [loading, setLoading] = useState(true);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [previewItem, setPreviewItem] = useState<HistoryEntry | null>(null);

  const load = useCallback(async () => {
    try {
      const [historyRes, videoModelsRes, characterCardsRes] = await Promise.allSettled([
        fetch('/api/user/history?limit=50', { cache: 'no-store' }),
        fetch('/api/video-models', { cache: 'no-store' }),
        fetch('/api/user/character-cards?limit=50', { cache: 'no-store' }),
      ]);

      const nextItems: HistoryEntry[] = [];

      if (historyRes.status === 'fulfilled') {
        const historyData = await historyRes.value.json().catch(() => ({}));
        if (historyRes.value.ok) {
          nextItems.push(...((historyData.data || []) as Generation[]).map((item) => ({
            ...item,
            source: 'generation' as const,
          })));
        }
      }

      if (characterCardsRes.status === 'fulfilled') {
        const cardsData = await characterCardsRes.value.json().catch(() => ({}));
        if (characterCardsRes.value.ok) {
          nextItems.push(...((cardsData.data || []) as CharacterCard[]).map(characterCardToEntry));
        }
      }

      nextItems.sort((a, b) => b.createdAt - a.createdAt);
      setItems(nextItems);

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

  useEffect(() => {
    setSelectedIds((prev) => prev.filter((id) => items.some((item) => item.id === id)));
    if (selectionMode && items.length === 0) {
      setSelectionMode(false);
    }
    if (previewItem && !items.some((item) => item.id === previewItem.id)) {
      setPreviewItem(null);
    }
  }, [items, previewItem, selectionMode]);

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

  const selectedItems = useMemo(
    () => items.filter((item) => selectedIds.includes(item.id)),
    [items, selectedIds]
  );

  const selectedMediaIds = useMemo(
    () => selectedItems.filter((item) => item.source === 'generation').map((item) => item.id),
    [selectedItems]
  );

  const selectedCharacterIds = useMemo(
    () => selectedItems.filter((item) => item.source === 'character-card').map((item) => item.id),
    [selectedItems]
  );

  const getModelLabel = (item: HistoryEntry) => {
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

  const getUpstreamStatusLabel = (item: HistoryEntry) => {
    if (typeof item.params?.upstreamStatus === 'string' && item.params.upstreamStatus.trim()) {
      return item.params.upstreamStatus.trim();
    }
    if (typeof item.params?.upstreamState === 'string' && item.params.upstreamState.trim()) {
      return item.params.upstreamState.trim();
    }
    return '';
  };

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  }, []);

  const handleToggleSelectionMode = useCallback(() => {
    setSelectionMode((prev) => {
      if (prev) {
        setSelectedIds([]);
      }
      return !prev;
    });
  }, []);

  const handleSelectAllFiltered = useCallback(() => {
    setSelectedIds((prev) => {
      const filteredIds = filtered.map((item) => item.id);
      const allSelected = filteredIds.length > 0 && filteredIds.every((id) => prev.includes(id));
      if (allSelected) {
        return prev.filter((id) => !filteredIds.includes(id));
      }
      return Array.from(new Set([...prev, ...filteredIds]));
    });
  }, [filtered]);

  const deleteCharacterCards = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;
    await Promise.all(
      ids.map(async (id) => {
        const response = await fetch('/api/user/character-cards', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cardId: id }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.error || '删除角色卡失败');
        }
      })
    );
  }, []);

  const handleDeleteSelected = useCallback(async () => {
    if (busy || selectedIds.length === 0) return;
    const confirmed = window.confirm(`确认删除选中的 ${selectedIds.length} 项作品吗？`);
    if (!confirmed) return;

    const snapshot = items;
    setBusy(true);
    setItems((prev) => prev.filter((item) => !selectedIds.includes(item.id)));
    setSelectedIds([]);
    setPreviewItem((prev) => (prev && selectedIds.includes(prev.id) ? null : prev));

    try {
      if (selectedMediaIds.length > 0) {
        await deleteGenerationRecords(selectedMediaIds);
      }
      if (selectedCharacterIds.length > 0) {
        await deleteCharacterCards(selectedCharacterIds);
      }
    } catch (error) {
      console.error('[HistoryPage] 批量删除失败:', error);
      setItems(snapshot);
      await load();
    } finally {
      setBusy(false);
    }
  }, [busy, deleteCharacterCards, items, load, selectedCharacterIds, selectedIds, selectedMediaIds]);

  const handleClearMedia = useCallback(async () => {
    if (busy) return;
    const confirmed = window.confirm('确认清空全部媒体作品吗？这会删除视频、图像和音频记录，包含进行中的任务。');
    if (!confirmed) return;

    const snapshot = items;
    setBusy(true);
    setItems((prev) => prev.filter((item) => item.source === 'character-card'));
    setSelectedIds([]);
    setPreviewItem((prev) => (prev && prev.source === 'generation' ? null : prev));

    try {
      const response = await fetch('/api/user/history/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'all' }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || '清空媒体失败');
      }
      setSelectionMode(false);
    } catch (error) {
      console.error('[HistoryPage] 清空媒体失败:', error);
      setItems(snapshot);
      await load();
    } finally {
      setBusy(false);
    }
  }, [busy, items, load]);

  const handleClearCharacterCards = useCallback(async () => {
    if (busy) return;
    const confirmed = window.confirm('确认清空全部角色卡吗？');
    if (!confirmed) return;

    const snapshot = items;
    setBusy(true);
    setItems((prev) => prev.filter((item) => item.source !== 'character-card'));
    setSelectedIds((prev) => prev.filter((id) => !selectedCharacterIds.includes(id)));
    setPreviewItem((prev) => (prev && prev.source === 'character-card' ? null : prev));

    try {
      const response = await fetch('/api/user/character-cards/delete-all', {
        method: 'POST',
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || '清空角色卡失败');
      }
      setSelectionMode(false);
    } catch (error) {
      console.error('[HistoryPage] 清空角色卡失败:', error);
      setItems(snapshot);
      await load();
    } finally {
      setBusy(false);
    }
  }, [busy, items, load, selectedCharacterIds]);

  const handleDownload = useCallback(async (item: HistoryEntry) => {
    if (!item.resultUrl) return;
    try {
      await downloadAsset(item.resultUrl, `sanhub-${item.id}.${getDownloadExtension(item)}`);
    } catch (error) {
      console.error('[HistoryPage] 下载失败:', error);
    }
  }, []);

  const renderPreview = (item: HistoryEntry) => {
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
          <audio controls src={item.resultUrl} className="w-full max-w-[90%]" onClick={(e) => e.stopPropagation()} />
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
                onClick={handleToggleSelectionMode}
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-white/75 transition hover:bg-white/[0.08]"
              >
                {selectionMode ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                {selectionMode ? '退出批量选择' : '批量选择'}
              </button>
              {selectionMode ? (
                <button
                  type="button"
                  onClick={handleSelectAllFiltered}
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-white/75 transition hover:bg-white/[0.08]"
                >
                  <CheckSquare className="h-4 w-4" />
                  {filtered.length > 0 && filtered.every((item) => selectedIds.includes(item.id)) ? '取消全选' : `全选当前筛选 (${filtered.length})`}
                </button>
              ) : null}
              {selectionMode && selectedIds.length > 0 ? (
                <button
                  type="button"
                  onClick={() => void handleDeleteSelected()}
                  disabled={busy}
                  className="inline-flex items-center gap-2 rounded-full border border-red-400/20 bg-red-500/10 px-4 py-2 text-sm text-red-200 transition hover:bg-red-500/16 disabled:opacity-60"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  删除已选 {selectedIds.length} 项
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => void handleClearMedia()}
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-white/75 transition hover:bg-white/[0.08] disabled:opacity-60"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                清空媒体
              </button>
              <button
                type="button"
                onClick={() => void handleClearCharacterCards()}
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-white/75 transition hover:bg-white/[0.08] disabled:opacity-60"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
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
                {selectionMode ? ` · 已选 ${selectedIds.length} 项` : ''}
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
                const selected = selectedIds.includes(item.id);
                return (
                  <div
                    key={item.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      if (selectionMode) {
                        toggleSelected(item.id);
                        return;
                      }
                      if (item.resultUrl && item.status === 'completed') {
                        setPreviewItem(item);
                      }
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return;
                      event.preventDefault();
                      if (selectionMode) {
                        toggleSelected(item.id);
                        return;
                      }
                      if (item.resultUrl && item.status === 'completed') {
                        setPreviewItem(item);
                      }
                    }}
                    className={cn(
                      'group overflow-hidden rounded-[24px] border bg-[linear-gradient(180deg,rgba(17,23,33,0.96),rgba(12,17,24,0.92))] p-3 transition',
                      selectionMode
                        ? selected
                          ? 'border-emerald-400/45 bg-emerald-400/[0.08]'
                          : 'border-white/10 hover:border-white/16 hover:bg-white/[0.04]'
                        : 'border-white/10 hover:-translate-y-0.5 hover:border-white/16 hover:bg-white/[0.04]'
                    )}
                  >
                    <div className="relative aspect-video overflow-hidden rounded-[20px] border border-white/8 bg-black/20">
                      {renderPreview(item)}

                      {selectionMode ? (
                        <div className="absolute left-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-black/35 backdrop-blur-md">
                          {selected ? <CheckSquare className="h-4 w-4 text-emerald-300" /> : <Square className="h-4 w-4 text-white/78" />}
                        </div>
                      ) : null}

                      <div className="absolute left-2 bottom-2 inline-flex items-center gap-1 rounded-full border border-white/10 bg-black/35 px-2.5 py-1 text-[11px] text-white/88 backdrop-blur-md">
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

                      {item.resultUrl && item.status === 'completed' && !selectionMode ? (
                        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            onClick={() => void handleDownload(item)}
                            className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-white/45 transition hover:text-white"
                            title="下载"
                          >
                            <Download className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setPreviewItem(item)}
                            className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-white/45 transition hover:text-white"
                            title="预览"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {previewItem ? (
        <div className="fixed inset-0 z-50 bg-black/78 p-3 backdrop-blur-xl md:p-6" onClick={() => setPreviewItem(null)}>
          <div
            className="mx-auto flex h-full max-h-[calc(100vh-1.5rem)] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0f131a] shadow-2xl md:max-h-[calc(100vh-3rem)] md:flex-row"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <div className="flex items-start justify-between gap-3 border-b border-white/8 px-4 py-3 md:px-5">
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-medium text-white md:text-base">
                    {previewItem.prompt || '无提示词'}
                  </h2>
                  <p className="mt-1 text-xs text-white/40">
                    {new Date(previewItem.createdAt).toLocaleString('zh-CN')} · {getModelLabel(previewItem)}
                  </p>
                </div>
                <button
                  onClick={() => setPreviewItem(null)}
                  className="shrink-0 rounded-xl border border-white/10 bg-white/[0.03] p-2 text-white/60 transition-colors hover:bg-white/[0.07] hover:text-white"
                  title="关闭"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="flex flex-1 min-h-0 items-center justify-center bg-black/20 p-3 md:p-6">
                {isVideoItem(previewItem) ? (
                  <video
                    src={previewItem.resultUrl}
                    className="max-h-full max-w-full rounded-xl border border-white/10 object-contain"
                    controls
                    autoPlay
                    loop
                  />
                ) : isAudioItem(previewItem) ? (
                  <div className="flex h-full w-full items-center justify-center rounded-xl border border-white/10 bg-gradient-to-br from-violet-500/12 to-fuchsia-500/10 p-6">
                    <div className="w-full max-w-xl">
                      <div className="mb-4 flex items-center justify-center">
                        <Headphones className="h-10 w-10 text-white/60" />
                      </div>
                      <audio src={previewItem.resultUrl} className="w-full" controls autoPlay />
                    </div>
                  </div>
                ) : (
                  <img
                    src={previewItem.resultUrl}
                    alt={previewItem.prompt}
                    className="max-h-full max-w-full rounded-xl border border-white/10 object-contain"
                    decoding="async"
                  />
                )}
              </div>
            </div>

            <aside className="flex w-full shrink-0 flex-col border-t border-white/8 md:max-w-[360px] md:border-l md:border-t-0">
              <div className="flex-1 min-h-0 space-y-4 overflow-y-auto p-4 md:p-5">
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => void handleDownload(previewItem)}
                    className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-medium text-black transition hover:opacity-90"
                  >
                    <Download className="w-4 h-4" />
                    下载
                  </button>
                  <a
                    href={previewItem.resultUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-white/[0.08]"
                  >
                    <ExternalLink className="w-4 h-4" />
                    打开原始资源
                  </a>
                </div>

                <div className="space-y-1">
                  <p className="text-xs font-medium text-white/40">提示词 / 名称</p>
                  <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                    <p className="text-sm leading-relaxed text-white/82 whitespace-pre-wrap break-words">
                      {previewItem.prompt || '无提示词'}
                    </p>
                  </div>
                </div>

                <div className="space-y-1">
                  <p className="text-xs font-medium text-white/40">资源地址</p>
                  <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                    <p className="break-all text-xs leading-5 text-white/68">
                      {previewItem.resultUrl || '-'}
                    </p>
                  </div>
                </div>
              </div>
            </aside>
          </div>
        </div>
      ) : null}
    </div>
  );
}
