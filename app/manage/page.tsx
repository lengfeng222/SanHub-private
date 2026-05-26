import Link from 'next/link';
import { BarChart3, CreditCard, Image, MessageSquare, Settings, Sparkles, Ticket, Users, Video } from 'lucide-react';
import { getSystemConfig, getAllUsers, getChatModels, getImageModels, getVideoModels } from '@/lib/db';
import { getRecentPaymentOrders } from '@/lib/db-payments';

const cards = [
  { href: '/manage/payment', title: '充值支付', desc: '配置易支付、查看前台充值入口', icon: CreditCard, color: 'from-emerald-500/25 to-cyan-500/15' },
  { href: '/manage/models', title: '模型配置', desc: '一键进入聊天/图像/视频渠道', icon: Sparkles, color: 'from-violet-500/25 to-sky-500/15' },
  { href: '/manage/users', title: '用户积分', desc: '管理用户账号、余额、封禁', icon: Users, color: 'from-blue-500/25 to-cyan-500/15' },
  { href: '/manage/site', title: '站点设置', desc: '网站名称、公告、音频API等', icon: Settings, color: 'from-orange-500/25 to-amber-500/15' },
];

export default async function ManageHomePage() {
  const [config, users, chatModels, imageModels, videoModels, recentOrders] = await Promise.all([
    getSystemConfig(),
    getAllUsers({ limit: 5 }).catch(() => []),
    getChatModels(true).catch(() => []),
    getImageModels(true).catch(() => []),
    getVideoModels(true).catch(() => []),
    getRecentPaymentOrders(5).catch(() => []),
  ]);

  return (
    <div className="space-y-6">
      <div className="rounded-[30px] border border-white/10 bg-[#10141c]/90 p-6 shadow-[0_20px_60px_rgba(0,0,0,0.24)]">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[#4f7cff]/30 bg-[#4f7cff]/12 px-3 py-1 text-xs text-[#9fc6ff]"><BarChart3 className="h-3.5 w-3.5" />专用控制台</div>
            <h1 className="text-4xl font-semibold tracking-[-0.04em] text-white">{config.siteConfig.siteName}</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/45">这里是单独做的新后台入口，不影响原来的 /admin。常用配置集中在这里，后面可以继续改成完全定制后台。</p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:min-w-[460px]">
            <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4"><div className="text-2xl font-semibold text-white">{users.length}</div><div className="text-xs text-white/40">最近用户</div></div>
            <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4"><div className="text-2xl font-semibold text-white">{config.paymentProvider.enabled ? '开' : '关'}</div><div className="text-xs text-white/40">在线充值</div></div>
            <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4"><div className="text-2xl font-semibold text-white">1:{config.paymentProvider.pointRate}</div><div className="text-xs text-white/40">积分比例</div></div>
            <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4"><div className="text-2xl font-semibold text-white">{config.defaultBalance}</div><div className="text-xs text-white/40">注册送分</div></div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {cards.map((item) => (
          <Link key={item.href} href={item.href} className="group overflow-hidden rounded-[26px] border border-white/10 bg-[#10141c]/90 p-5 shadow-[0_20px_60px_rgba(0,0,0,0.2)] transition hover:border-white/18 hover:bg-[#131923]">
            <div className={`mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br ${item.color} text-white`}><item.icon className="h-5 w-5" /></div>
            <div className="text-xl font-semibold text-white">{item.title}</div>
            <div className="mt-2 text-sm leading-6 text-white/42">{item.desc}</div>
          </Link>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
        <div className="rounded-[28px] border border-white/10 bg-[#10141c]/90 p-6">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <div className="text-lg font-semibold text-white">模型接入概览</div>
              <div className="mt-1 text-sm text-white/40">当前后台已可管理的启用模型数量</div>
            </div>
            <Link href="/manage/models" className="text-xs text-white/50 transition hover:text-white">进入模型配置</Link>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
              <div className="text-sm text-white/45">聊天模型</div>
              <div className="mt-2 text-3xl font-semibold text-white">{chatModels.length}</div>
            </div>
            <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
              <div className="text-sm text-white/45">图像模型</div>
              <div className="mt-2 text-3xl font-semibold text-white">{imageModels.length}</div>
            </div>
            <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
              <div className="text-sm text-white/45">视频模型</div>
              <div className="mt-2 text-3xl font-semibold text-white">{videoModels.length}</div>
            </div>
          </div>
        </div>

        <div className="rounded-[28px] border border-white/10 bg-[#10141c]/90 p-6">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <div className="text-lg font-semibold text-white">支付通道概览</div>
              <div className="mt-1 text-sm text-white/40">易支付是否开启、积分比例与支付方式</div>
            </div>
            <Link href="/manage/payment" className="text-xs text-white/50 transition hover:text-white">进入支付配置</Link>
          </div>
          <div className="space-y-3">
            <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
              <div className="text-sm text-white/45">通道状态</div>
              <div className="mt-2 text-xl font-semibold text-white">{config.paymentProvider.enabled ? '已开启' : '未开启'}</div>
            </div>
            <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
              <div className="text-sm text-white/45">支付方式</div>
              <div className="mt-2 text-sm text-white">{config.paymentProvider.payTypes.join(' / ') || 'alipay'}</div>
            </div>
            <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
              <div className="text-sm text-white/45">最近订单数据</div>
              <div className="mt-2 text-sm text-white/70">{recentOrders.length > 0 ? `${recentOrders.length} 条最近订单记录` : '暂未读取到最近订单摘要'}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {[
          ['/manage/chat', '聊天模型', MessageSquare],
          ['/manage/image', '图像渠道', Image],
          ['/manage/video', '视频渠道', Video],
          ['/manage/cards', '卡密兑换', Ticket],
        ].map(([href, label, Icon]: any) => (
          <Link key={href} href={href} className="flex items-center gap-3 rounded-[22px] border border-white/10 bg-white/[0.03] px-5 py-4 text-white/72 transition hover:bg-white/[0.06] hover:text-white">
            <Icon className="h-4 w-4" /> {label}
          </Link>
        ))}
      </div>
    </div>
  );
}
