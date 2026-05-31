'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';
import {
  Bell,
  ChevronDown,
  CreditCard,
  History,
  Image,
  MessageSquare,
  Settings,
  Sparkles,
  UserCircle2,
  Wallet,
  X,
} from 'lucide-react';
import type { SafeUser } from '@/types';
import { cn } from '@/lib/utils';
import { useSiteConfig } from '@/components/providers/site-config-provider';
import { BrandMark } from '@/components/brand/brand-mark';

interface HeaderProps {
  user: SafeUser;
}

const topNavItems = [
  {
    href: '/supervideo',
    label: '视频',
    match: (pathname: string) =>
      pathname === '/supervideo'
      || pathname === '/happyvideo'
      || pathname === '/sora2'
      || pathname === '/grok'
      || pathname === '/video',
  },
  {
    href: '/gptimage',
    label: '图像',
    match: (pathname: string) =>
      pathname === '/gptimage'
      || pathname === '/nanobanana'
      || pathname === '/image',
  },
  {
    href: '/music',
    label: '音频',
    match: (pathname: string) =>
      pathname === '/music' || pathname === '/tts' || pathname === '/voice',
  },
  {
    href: '/history',
    label: '作品',
    match: (pathname: string) => pathname === '/history' || pathname.startsWith('/history/'),
  },
];

const bottomNavItems = [
  { href: '/supervideo', label: '视频', icon: Sparkles },
  { href: '/gptimage', label: '图像', icon: Image },
  { href: '/history', label: '作品', icon: History },
  { href: '/recharge', label: '钱包', icon: Wallet },
];

export function Header({ user }: HeaderProps) {
  const pathname = usePathname();
  const siteConfig = useSiteConfig();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [noticeOpen, setNoticeOpen] = useState(false);

  const initial = useMemo(() => {
    return (user.name || user.email || 'H').trim().charAt(0).toUpperCase() || 'H';
  }, [user.email, user.name]);

  const isAdmin = user.role === 'admin' || user.role === 'moderator';

  return (
    <>
      <header className="fixed left-0 right-0 top-0 z-50 border-b border-white/8 bg-[#091018]/74 backdrop-blur-2xl">
        <div className="mx-auto flex h-[72px] w-full max-w-[1600px] items-center justify-between gap-3 px-4 sm:px-6 lg:px-10">
          <div className="flex min-w-0 items-center gap-3 lg:gap-8">
            <Link
              href="/supervideo"
              className="flex min-w-0 items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-2 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] transition hover:bg-white/[0.06]"
            >
              <BrandMark size={38} rounded="rounded-2xl" />
              <div className="min-w-0">
                <div className="truncate text-base font-semibold tracking-[0.02em] text-white">
                  {siteConfig.siteName}
                </div>
                <div className="truncate text-[11px] text-white/40">
                  AI 内容生成平台
                </div>
              </div>
            </Link>

            <nav className="hidden items-center gap-2 xl:flex">
              {topNavItems.map((item) => {
                const active = item.match(pathname);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      'rounded-full px-4 py-2 text-sm font-medium transition',
                      active
                        ? 'bg-emerald-400/15 text-emerald-300 shadow-[0_0_0_1px_rgba(52,211,153,0.18)]'
                        : 'text-white/60 hover:bg-white/[0.05] hover:text-white'
                    )}
                  >
                    {item.label}
                  </Link>
                );
              })}
              {isAdmin ? (
                <Link
                  href="/admin"
                  className={cn(
                    'rounded-full px-4 py-2 text-sm font-medium transition',
                    pathname.startsWith('/admin')
                      ? 'bg-sky-400/15 text-sky-300 shadow-[0_0_0_1px_rgba(56,189,248,0.18)]'
                      : 'text-white/60 hover:bg-white/[0.05] hover:text-white'
                  )}
                >
                  后台
                </Link>
              ) : null}
            </nav>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <div className="hidden items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-white/72 sm:flex">
              <Wallet className="h-4 w-4 text-emerald-300" />
              <span>余额：{user.balance ?? 0} 积分</span>
            </div>

            <Link
              href="/recharge"
              className="hidden rounded-full bg-emerald-400 px-4 py-2 text-sm font-semibold text-[#032a1b] shadow-[0_12px_30px_rgba(16,185,129,0.28)] transition hover:opacity-95 active:scale-[0.98] sm:inline-flex"
            >
              充值升级
            </Link>

            <div className="relative hidden lg:block">
              <button
                type="button"
                onClick={() => {
                  setFeedbackOpen((prev) => !prev);
                  setNoticeOpen(false);
                  setUserMenuOpen(false);
                }}
                className="inline-flex h-10 items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 text-sm text-white/72 transition hover:bg-white/[0.06] hover:text-white"
                title="问题反馈"
              >
                <MessageSquare className="h-4 w-4" />
                反馈
              </button>
              {feedbackOpen ? (
                <div className="absolute right-0 top-14 z-50 w-80 rounded-[24px] border border-white/10 bg-[#0d131c]/96 p-4 shadow-2xl">
                  <div className="mb-3 text-base font-semibold text-white">问题反馈</div>
                  <textarea
                    className="min-h-28 w-full resize-none rounded-2xl border border-white/10 bg-[#171d27] p-3 text-sm text-white outline-none placeholder:text-white/25"
                    placeholder="请描述遇到的问题、丢失的 UI 或想补充的功能"
                  />
                  <div className="mt-3 flex items-center justify-between gap-3 text-xs text-white/40">
                    <span>也可联系站内管理员处理</span>
                    <button
                      type="button"
                      className="rounded-full bg-white px-4 py-2 text-xs font-medium text-black"
                    >
                      提交
                    </button>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setNoticeOpen((prev) => !prev);
                  setFeedbackOpen(false);
                  setUserMenuOpen(false);
                }}
                className="relative inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-white/75 transition hover:bg-white/[0.06] hover:text-white"
                title="通知"
              >
                <Bell className="h-4 w-4" />
                <span className="absolute -right-1 -top-1 inline-flex min-w-5 items-center justify-center rounded-full bg-[#ff5a5f] px-1 text-[10px] font-medium leading-5 text-white">
                  20
                </span>
              </button>
              {noticeOpen ? (
                <div className="absolute right-0 top-14 z-50 w-80 overflow-hidden rounded-[24px] border border-white/10 bg-[#0d131c]/96 shadow-2xl">
                  <div className="border-b border-white/8 px-4 py-3 text-base font-semibold text-white">
                    通知中心
                  </div>
                  <div className="max-h-80 overflow-y-auto p-2">
                    {[
                      '接口状态变更会在这里同步，请留意任务失败或恢复消息。',
                      '所有生成内容默认只保留 24 小时，请及时下载到本地。',
                      '如果页面异常或模型缺失，可通过右上角反馈快速提交。',
                    ].map((item, index) => (
                      <div
                        key={index}
                        className="rounded-2xl px-3 py-3 text-sm leading-6 text-white/72 hover:bg-white/[0.04]"
                      >
                        {item}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            <Link
              href="/settings"
              className="hidden h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-white/75 transition hover:bg-white/[0.06] hover:text-white sm:inline-flex"
              title="设置"
            >
              <Settings className="h-4 w-4" />
            </Link>

            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setUserMenuOpen((prev) => !prev);
                  setFeedbackOpen(false);
                  setNoticeOpen(false);
                }}
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] py-1 pl-1 pr-2 text-white transition hover:bg-white/[0.06]"
                title="用户菜单"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-[#4db6ff] to-[#6e56ff] text-sm font-semibold text-white">
                  {initial}
                </span>
                <ChevronDown className="h-4 w-4 text-white/55" />
              </button>

              {userMenuOpen ? (
                <div className="absolute right-0 top-14 z-50 w-48 overflow-hidden rounded-[24px] border border-white/10 bg-[#0d131c]/96 p-2 shadow-2xl">
                  <div className="px-3 py-2">
                    <div className="text-sm font-medium text-white">{user.name || user.email}</div>
                    <div className="mt-1 text-xs text-white/40">
                      {user.role === 'admin'
                        ? '超级管理员'
                        : user.role === 'moderator'
                          ? '管理员'
                          : '普通用户'}
                    </div>
                  </div>
                  <Link
                    href="/settings"
                    className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-white/80 transition hover:bg-white/[0.06] hover:text-white"
                    onClick={() => setUserMenuOpen(false)}
                  >
                    <UserCircle2 className="h-4 w-4" />
                    账号设置
                  </Link>
                  <Link
                    href="/recharge"
                    className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-white/80 transition hover:bg-white/[0.06] hover:text-white"
                    onClick={() => setUserMenuOpen(false)}
                  >
                    <CreditCard className="h-4 w-4" />
                    钱包中心
                  </Link>
                  {isAdmin ? (
                    <Link
                      href="/admin"
                      className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-white/80 transition hover:bg-white/[0.06] hover:text-white"
                      onClick={() => setUserMenuOpen(false)}
                    >
                      <Sparkles className="h-4 w-4" />
                      后台管理
                    </Link>
                  ) : null}
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-white/80 transition hover:bg-white/[0.06] hover:text-white"
                    onClick={() => signOut({ callbackUrl: '/login' })}
                  >
                    <X className="h-4 w-4" />
                    退出登录
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </header>

      <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-white/10 bg-[#091018]/94 pb-[env(safe-area-inset-bottom)] backdrop-blur-2xl lg:hidden">
        <div className="grid h-16 grid-cols-4">
          {bottomNavItems.map((item) => {
            const isActive =
              item.href === '/supervideo'
                ? pathname === '/supervideo'
                  || pathname === '/happyvideo'
                  || pathname === '/sora2'
                  || pathname === '/grok'
                  || pathname === '/video'
                : item.href === '/gptimage'
                  ? pathname === '/gptimage' || pathname === '/nanobanana' || pathname === '/image'
                  : pathname === item.href || pathname.startsWith(`${item.href}/`);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex flex-col items-center justify-center gap-1 text-[11px] transition',
                  isActive ? 'text-emerald-300' : 'text-white/42'
                )}
              >
                <item.icon className="h-4 w-4" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
