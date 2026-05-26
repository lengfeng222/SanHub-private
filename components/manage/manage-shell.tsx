'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';
import {
  ArrowLeft,
  Bell,
  Coins,
  CreditCard,
  Image,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  Settings,
  Sparkles,
  Ticket,
  Users,
  Video,
  X,
} from 'lucide-react';
import type { SafeUser, UserRole } from '@/types';
import { cn } from '@/lib/utils';
import { useSiteConfig } from '@/components/providers/site-config-provider';
import { useState } from 'react';
import { BrandMark } from '@/components/brand/brand-mark';

const navItems: Array<{ href: string; label: string; icon: typeof LayoutDashboard; roles: UserRole[]; badge?: string }> = [
  { href: '/manage', label: '控制台', icon: LayoutDashboard, roles: ['admin', 'moderator'] },
  { href: '/manage/payment', label: '充值支付', icon: CreditCard, roles: ['admin'] },
  { href: '/manage/users', label: '用户积分', icon: Users, roles: ['admin', 'moderator'] },
  { href: '/manage/models', label: '模型配置', icon: Sparkles, roles: ['admin'] },
  { href: '/manage/image', label: '图像渠道', icon: Image, roles: ['admin'] },
  { href: '/manage/video', label: '视频渠道', icon: Video, roles: ['admin'] },
  { href: '/manage/chat', label: '聊天模型', icon: MessageSquare, roles: ['admin'] },
  { href: '/manage/cards', label: '卡密兑换', icon: Ticket, roles: ['admin', 'moderator'] },
  { href: '/manage/site', label: '站点设置', icon: Settings, roles: ['admin'] },
];

export function ManageShell({ user, children }: { user: SafeUser; children: React.ReactNode }) {
  const pathname = usePathname();
  const siteConfig = useSiteConfig();
  const [open, setOpen] = useState(false);
  const filtered = navItems.filter((item) => item.roles.includes(user.role));
  const initial = (user.name || user.email || 'A').charAt(0).toUpperCase();

  const nav = (
    <>
      <div className="border-b border-white/10 p-5">
        <Link href="/supervideo" className="inline-flex items-center gap-2 text-sm text-white/45 transition hover:text-white">
          <ArrowLeft className="h-4 w-4" /> 返回前台
        </Link>
        <div className="mt-5 flex items-center gap-3">
          <BrandMark size={44} />
          <div className="min-w-0">
            <div className="truncate text-lg font-semibold text-white">幻途管理台</div>
            <div className="truncate text-xs text-white/35">{siteConfig.siteName}</div>
          </div>
        </div>
      </div>

      <nav className="flex-1 space-y-1.5 p-3">
        {filtered.map((item) => {
          const active = item.href === '/manage' ? pathname === '/manage' : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className={cn(
                'flex items-center gap-3 rounded-2xl border px-4 py-3 text-sm transition',
                active
                  ? 'border-[#4f7cff]/45 bg-[#4f7cff]/16 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]'
                  : 'border-transparent text-white/55 hover:border-white/8 hover:bg-white/[0.04] hover:text-white'
              )}
            >
              <item.icon className="h-4 w-4" />
              <span className="font-medium">{item.label}</span>
              {item.badge ? <span className="ml-auto rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/55">{item.badge}</span> : null}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-white/10 p-4">
        <div className="mb-3 rounded-2xl border border-white/8 bg-white/[0.03] p-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-sm font-semibold text-white">{initial}</div>
            <div className="min-w-0">
              <div className="truncate text-sm text-white">{user.name || user.email}</div>
              <div className="flex items-center gap-1 text-xs text-[#8eedb2]"><Coins className="h-3 w-3" />{user.balance} 积分</div>
            </div>
          </div>
        </div>
        <button onClick={() => signOut({ callbackUrl: '/login' })} className="flex w-full items-center justify-center gap-2 rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3 text-sm text-white/65 transition hover:bg-white/[0.06] hover:text-white">
          <LogOut className="h-4 w-4" /> 退出登录
        </button>
      </div>
    </>
  );

  return (
    <div className="relative z-10 min-h-screen bg-[#090d13]/40">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="fixed left-4 top-4 z-50 inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-[#10141c]/90 text-white lg:hidden"
      >
        {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      {open ? <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden" onClick={() => setOpen(false)} /> : null}

      <aside className={cn('fixed bottom-0 left-0 top-0 z-40 flex w-72 flex-col border-r border-white/10 bg-[#0d1117]/96 backdrop-blur-xl transition lg:translate-x-0', open ? 'translate-x-0' : '-translate-x-full')}>
        {nav}
      </aside>

      <main className="min-h-screen px-4 pb-10 pt-20 lg:ml-72 lg:px-8 lg:pt-8">
        <div className="mb-6 flex items-center justify-between rounded-[26px] border border-white/10 bg-[#10141c]/86 px-5 py-4 shadow-[0_20px_60px_rgba(0,0,0,0.24)]">
          <div>
            <div className="text-sm text-white/40">Admin Console</div>
            <div className="text-xl font-semibold text-white">专用管理后台</div>
          </div>
          <div className="flex items-center gap-2">
            <button className="relative inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.03] text-white/70">
              <Bell className="h-4 w-4" />
              <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-[#ff5a5f]" />
            </button>
            <Link href="/admin" className="hidden rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-xs text-white/55 transition hover:text-white sm:inline-flex">旧后台</Link>
          </div>
        </div>
        {children}
      </main>
    </div>
  );
}
