'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { 
  LayoutDashboard, 
  Users, 
  ArrowLeft,
  Menu,
  X,
  Megaphone,
  Globe,
  Image,
  Video,
  BarChart3,
  History,
  Ticket,
  UserPlus
} from 'lucide-react';
import { useState } from 'react';
import { BrandMark } from '@/components/brand/brand-mark';
import { cn } from '@/lib/utils';
import { useSiteConfig } from '@/components/providers/site-config-provider';
import type { UserRole } from '@/types';

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  exact?: boolean;
  roles: UserRole[]; // 哪些角色可以看到这个菜单
}

const navItems: NavItem[] = [
  { href: '/admin', label: '概览', icon: LayoutDashboard, exact: true, roles: ['admin', 'moderator'] },
  { href: '/admin/stats', label: '数据统计', icon: BarChart3, roles: ['admin', 'moderator'] },
  { href: '/admin/users', label: '用户管理', icon: Users, roles: ['admin', 'moderator'] },
  { href: '/admin/generations', label: '生成记录', icon: History, roles: ['admin'] },
  { href: '/admin/image-channels', label: '图像渠道', icon: Image, roles: ['admin'] },
  { href: '/admin/video-channels', label: '视频渠道', icon: Video, roles: ['admin'] },
  { href: '/admin/redemption', label: '卡密管理', icon: Ticket, roles: ['admin', 'moderator'] },
  { href: '/admin/invites', label: '邀请码', icon: UserPlus, roles: ['admin'] },
  { href: '/admin/announcement', label: '公告管理', icon: Megaphone, roles: ['admin'] },
  { href: '/admin/site', label: '网站配置', icon: Globe, roles: ['admin'] },
];

export function AdminSidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const [mobileOpen, setMobileOpen] = useState(false);
  const siteConfig = useSiteConfig();
  
  const userRole = session?.user?.role || 'user';
  const filteredNavItems = navItems.filter(item => item.roles.includes(userRole));

  const isActive = (href: string, exact?: boolean) => {
    if (exact) return pathname === href;
    return pathname.startsWith(href);
  };

  const NavContent = () => (
    <>
      {/* Logo */}
      <div className="p-5 border-b border-border/70">
        <Link href="/create" className="flex items-center gap-2 text-foreground/60 hover:text-foreground transition-colors text-sm">
          <ArrowLeft className="w-4 h-4" />
          <span>返回首页</span>
        </Link>
        <div className="flex items-center gap-3 mt-4">
          <BrandMark size={40} rounded="rounded-xl" className="border-white/12" />
          <div>
            <h1 className="text-lg font-semibold text-foreground">{siteConfig.siteName} 管理台</h1>
            <p className="text-xs text-foreground/40">Admin Console</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-1.5">
        {filteredNavItems.map((item) => {
          const active = isActive(item.href, item.exact);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMobileOpen(false)}
              className={cn(
                'flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 border border-transparent',
                active
                  ? 'bg-accent/80 text-foreground border-border/70'
                  : 'text-foreground/60 hover:bg-card/70 hover:text-foreground'
              )}
            >
              <item.icon className={cn('w-5 h-5', active && 'text-foreground')} />
              <span className="font-medium">{item.label}</span>
              {active && (
                <div className="ml-auto w-1.5 h-1.5 rounded-full bg-foreground/70" />
              )}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-border/70">
        <div className="px-4 py-3 rounded-xl bg-card/60 border border-border/70">
          <p className="text-xs text-foreground/50 text-center">v1.0.0</p>
        </div>
      </div>
    </>
  );

  return (
    <>
      {/* Mobile Toggle */}
      <button
        onClick={() => setMobileOpen(!mobileOpen)}
        className="lg:hidden fixed top-4 left-4 z-50 p-2.5 bg-card/70 backdrop-blur-sm rounded-xl text-foreground border border-border/70"
      >
        {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
      </button>

      {/* Mobile Overlay */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-background/80 backdrop-blur-sm z-40"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar - Mobile */}
      <aside
        className={cn(
          'lg:hidden fixed inset-y-0 left-0 z-40 w-72 bg-card/95 backdrop-blur-xl border-r border-border/70 flex flex-col transform transition-transform duration-300 ease-out',
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <NavContent />
      </aside>

      {/* Sidebar - Desktop */}
      <aside className="hidden lg:flex w-72 bg-card/70 backdrop-blur-xl border-r border-border/70 flex-col sticky top-0 h-screen">
        <NavContent />
      </aside>
    </>
  );
}
