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
    '为保持真正的“实惠”，也为了减少带宽储存费用对成本的不必要增加，所有任务生成完毕后网站只保存24小时，生成完毕后请尽快下载到本地。本站禁止生成违规内容，色情擦边内容，如因生成违规内容失败积分不退回，请合理善用AI。网站后台有监管系统，如恶意生成违规内容账号直接封禁。本站配备了国内加速，无需魔法，如遇卡顿下载速度缓慢请关闭魔法软件。在图片和提示词没有违规的情况下生成失败，多跑几条就可以了，有时候快有时候慢，这个问题就希望大家能理解了~如果接口被ban 网页右上角会发通知 勤盯着点 有问题也可以点击反馈进行问题提交~或者向微信：yinpinkaifa 进行反馈',
};

export function AnnouncementBanner() {
  const [announcement, setAnnouncement] = useState<Announcement | null>(defaultAnnouncement);
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
