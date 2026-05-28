'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ArrowLeft,
  CreditCard,
  History,
  Image,
  Mic2,
  Settings2,
  Shield,
  Sparkles,
} from 'lucide-react';
import type { SafeUser } from '@/types';
import { cn } from '@/lib/utils';
import { Header } from '@/components/layout/header';
import { AnnouncementBanner } from '@/components/ui/announcement';

interface DashboardShellProps {
  user: SafeUser;
  children: React.ReactNode;
}

const studioLinks = [
  {
    href: '/supervideo',
    label: '视频生成',
    icon: Sparkles,
    match: (pathname: string) =>
      pathname === '/supervideo'
      || pathname === '/happyvideo'
      || pathname === '/sora2'
      || pathname === '/grok'
      || pathname === '/video',
  },
  {
    href: '/gptimage',
    label: '图像生成',
    icon: Image,
    match: (pathname: string) =>
      pathname === '/gptimage'
      || pathname === '/nanobanana'
      || pathname === '/image',
  },
  {
    href: '/music',
    label: '音频 / 配音',
    icon: Mic2,
    match: (pathname: string) =>
      pathname === '/music' || pathname === '/tts' || pathname === '/voice',
  },
];

const manageLinks = [
  {
    href: '/history',
    label: '作品库',
    icon: History,
    match: (pathname: string) => pathname === '/history' || pathname.startsWith('/history/'),
  },
  {
    href: '/recharge',
    label: '积分中心',
    icon: CreditCard,
    match: (pathname: string) => pathname === '/recharge' || pathname.startsWith('/recharge/'),
  },
  {
    href: '/settings',
    label: '账号设置',
    icon: Settings2,
    match: (pathname: string) => pathname === '/settings' || pathname.startsWith('/settings/'),
  },
];

export function DashboardShell({ user, children }: DashboardShellProps) {
  const pathname = usePathname();
  const isWorkspaceDetail = pathname.startsWith('/workspace/') && pathname !== '/workspace';
  const isAdmin = user.role === 'admin' || user.role === 'moderator';

  if (isWorkspaceDetail) {
    return (
      <>
        <div className="relative z-10 min-h-screen">
          <aside className="fixed bottom-0 left-0 top-0 z-30 w-12 border-r border-border/70 bg-card/70 backdrop-blur">
            <Link
              href="/workspace"
              className="ml-2 mt-4 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border/70 text-foreground/70 transition hover:border-border hover:text-foreground"
              title="返回工作空间"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </aside>

          <main className="ml-12 h-screen overflow-hidden p-0">
            <div>{children}</div>
          </main>
        </div>
      </>
    );
  }

  return (
    <>
      <Header user={user} />

      <div className="relative z-10 min-h-screen">
        <aside className="fixed bottom-0 left-0 top-0 z-40 hidden w-64 border-r border-white/8 bg-[#0b1017]/88 px-4 pb-6 pt-[92px] backdrop-blur-2xl lg:flex lg:flex-col">
          <div className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(18,24,34,0.96),rgba(12,16,24,0.92))] p-4 shadow-[0_20px_60px_rgba(0,0,0,0.28)]">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-400/15 text-emerald-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
                <Sparkles className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white">创作中心</p>
                <p className="text-xs text-white/42">Premium Studio UI</p>
              </div>
            </div>

            <Link
              href="/create"
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm font-semibold text-emerald-300 transition hover:bg-emerald-400/14"
            >
              <Sparkles className="h-4 w-4" />
              新建项目
            </Link>
          </div>

          <div className="mt-6 space-y-6">
            <div>
              <p className="mb-3 px-3 text-[11px] font-semibold uppercase tracking-[0.24em] text-white/32">
                创作
              </p>
              <nav className="space-y-1.5">
                {studioLinks.map((item) => {
                  const active = item.match(pathname);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        'flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-medium transition',
                        active
                          ? 'bg-emerald-400 text-[#062a1b] shadow-[0_14px_30px_rgba(16,185,129,0.28)]'
                          : 'text-white/58 hover:bg-white/[0.05] hover:text-white'
                      )}
                    >
                      <item.icon className="h-4 w-4" />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </nav>
            </div>

            <div>
              <p className="mb-3 px-3 text-[11px] font-semibold uppercase tracking-[0.24em] text-white/32">
                管理
              </p>
              <nav className="space-y-1.5">
                {manageLinks.map((item) => {
                  const active = item.match(pathname);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        'flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-medium transition',
                        active
                          ? 'bg-white/[0.08] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]'
                          : 'text-white/58 hover:bg-white/[0.05] hover:text-white'
                      )}
                    >
                      <item.icon className="h-4 w-4" />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </nav>
            </div>
          </div>

          {isAdmin ? (
            <div className="mt-auto">
              <Link
                href="/admin"
                className={cn(
                  'flex items-center gap-3 rounded-2xl border px-4 py-3 text-sm font-medium transition',
                  pathname.startsWith('/admin')
                    ? 'border-sky-400/30 bg-sky-400/12 text-sky-200'
                    : 'border-white/10 bg-white/[0.03] text-white/58 hover:bg-white/[0.05] hover:text-white'
                )}
              >
                <Shield className="h-4 w-4" />
                <span>后台管理</span>
              </Link>
            </div>
          ) : null}
        </aside>

        <main
          className={cn(
            'min-h-screen w-full',
            'pb-24 pt-[5.5rem] lg:pl-64 lg:pb-10'
          )}
        >
          <div className="mx-auto w-full max-w-[1440px] px-4 sm:px-6 lg:px-10">
            <AnnouncementBanner />
            <div>{children}</div>
          </div>
        </main>
      </div>
    </>
  );
}
