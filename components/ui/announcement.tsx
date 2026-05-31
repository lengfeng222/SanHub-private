'use client';

import { useState, useEffect } from 'react';
import { Send, X } from 'lucide-react';

interface Announcement {
  title: string;
  content: string;
  updatedAt: number;
}

const defaultAnnouncement: Announcement = {
  title: '生成须知',
  updatedAt: 0,
  content:
    '本平台仅提供内容生成工具服务，不对产出内容真实性、合规性、版权归属承担相关责任。所有生成文件默认仅在本站缓存 24 小时，到期后自动删除，请及时下载保存。若遇到模型缺失、任务异常或支付问题，请优先通过站内反馈联系管理员。',
};

export function AnnouncementBanner() {
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const fetchAnnouncement = async () => {
      try {
        const res = await fetch('/api/announcement');
        if (!res.ok) return;
        const data = await res.json();
        if (!data.success || !data.data) return;
        const nextAnnouncement = {
          title: data.data.title || defaultAnnouncement.title,
          content: data.data.content || defaultAnnouncement.content,
          updatedAt: Number(data.data.updatedAt || 0),
        } satisfies Announcement;
        const dismissedAt = localStorage.getItem('announcement_dismissed_at');
        if (dismissedAt && Number(dismissedAt) >= nextAnnouncement.updatedAt) {
          setAnnouncement(null);
          return;
        }
        setAnnouncement(nextAnnouncement);
      } catch {
        setAnnouncement(defaultAnnouncement);
      }
    };

    void fetchAnnouncement();
  }, []);

  const handleDismiss = () => {
    if (announcement?.updatedAt) {
      localStorage.setItem('announcement_dismissed_at', String(announcement.updatedAt));
    }
    setDismissed(true);
  };

  if (!announcement || dismissed) return null;

  return (
    <div className="mb-4 overflow-hidden rounded-[26px] border border-[#203447] bg-[linear-gradient(180deg,rgba(17,35,54,0.96),rgba(17,31,43,0.92))] shadow-[0_16px_48px_rgba(0,0,0,0.25)]">
      <div className="flex items-start gap-3 p-4 sm:p-5">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-[#27415a] bg-[#102131] text-[#8ecaff]">
          <Send className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex items-start justify-between gap-3">
            <h3 className="text-lg font-semibold text-white">{announcement.title}</h3>
            <button
              type="button"
              onClick={handleDismiss}
              className="rounded-lg p-1 text-white/35 transition hover:bg-white/5 hover:text-white/70"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="whitespace-pre-wrap text-sm leading-7 text-white/72">{announcement.content}</p>
        </div>
      </div>
    </div>
  );
}
