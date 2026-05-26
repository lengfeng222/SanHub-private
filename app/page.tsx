import Link from 'next/link';
import {
  ArrowRight,
  Compass,
  Image as ImageIcon,
  ShieldAlert,
  Mic,
  Music,
  Video,
} from 'lucide-react';
import { AnimatedBackground } from '@/components/ui/animated-background';
import { getPublicSiteConfig } from '@/lib/site-config';
import { BrandMark } from '@/components/brand/brand-mark';

const features = [
  {
    label: '图像',
    description: 'AI 图像创作',
    icon: ImageIcon,
    iconClass: 'text-emerald-300',
  },
  {
    label: '视频',
    description: 'AI 视频生成',
    icon: Video,
    iconClass: 'text-sky-300',
  },
  {
    label: '音乐',
    description: 'AI 音乐生成',
    icon: Music,
    iconClass: 'text-violet-300',
  },
  {
    label: '语音',
    description: 'AI 语音生成',
    icon: Mic,
    iconClass: 'text-yellow-300',
  },
];

export default async function LandingPage() {
  const siteConfig = await getPublicSiteConfig();
  const disclaimer = '本平台仅提供内容生成工具服务，不对产出内容真实性、合规性、版权归属承担相关责任。';

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden text-foreground">
      <AnimatedBackground variant="home" />

      <main className="relative z-10 flex flex-1 flex-col px-5 py-10 md:py-14">
        <section className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center">
          <div className="grid items-center gap-10 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="animate-rise">
              <div className="inline-flex items-center gap-3 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-white/70 backdrop-blur-xl">
                <BrandMark size={28} rounded="rounded-full" />
                <span>{siteConfig.siteTagline}</span>
              </div>

              <div className="mt-7 flex items-center gap-4">
                <BrandMark size={72} />
                <div>
                  <h1 className="text-[clamp(3.4rem,8vw,6.8rem)] font-extralight leading-none tracking-[-0.08em] text-white">
                    幻途
                  </h1>
                  <p className="mt-2 text-sm uppercase tracking-[0.35em] text-white/30">HUANTU AI STUDIO</p>
                </div>
              </div>

              <h2 className="mt-10 max-w-3xl text-balance text-[1.5rem] font-light leading-snug tracking-[-0.03em] text-white/88 md:text-[1.95rem]">
                把灵感，变成图像、视频、声音与叙事的完整作品。
              </h2>

              <p className="mt-5 max-w-2xl text-balance text-[1rem] font-light leading-relaxed text-white/52 md:text-[1.08rem]">
                {siteConfig.siteDescription} {siteConfig.siteSubDescription}
              </p>

              <div className="mt-8 flex flex-wrap gap-3">
                <Link
                  href="/login?callbackUrl=%2Fsupervideo"
                  className="inline-flex h-12 items-center justify-center gap-3 rounded-full bg-white px-8 text-[0.95rem] font-medium text-black shadow-[0_18px_55px_rgba(255,255,255,0.08)] transition-all hover:scale-[1.02] hover:bg-white/92 focus:outline-none focus:ring-2 focus:ring-foreground/30"
                >
                  进入幻途
                  <ArrowRight className="h-4 w-4" strokeWidth={2} />
                </Link>
                <Link
                  href="/register"
                  className="inline-flex h-12 items-center justify-center gap-3 rounded-full border border-white/12 bg-white/[0.03] px-8 text-[0.95rem] font-medium text-white/85 backdrop-blur-xl transition-all hover:bg-white/[0.07]"
                >
                  免费注册
                </Link>
              </div>

              <div className="mt-8 flex max-w-3xl items-start gap-3 rounded-3xl border border-amber-300/15 bg-amber-300/[0.05] px-4 py-4 text-left backdrop-blur-xl">
                <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
                <p className="text-sm leading-6 text-amber-50/78">{disclaimer}</p>
              </div>
            </div>

            <div className="animate-rise rounded-[32px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.07),rgba(255,255,255,0.03))] p-5 shadow-[0_30px_90px_rgba(0,0,0,0.28)] backdrop-blur-2xl">
              <div className="overflow-hidden rounded-[28px] border border-white/10 bg-[#0d1320]/65 p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-white/40">创作矩阵</p>
                    <h3 className="mt-1 text-2xl font-light text-white">独立品牌首页</h3>
                  </div>
                  <BrandMark size={52} rounded="rounded-2xl" />
                </div>

                <div className="mt-6 grid grid-cols-2 gap-3">
                  {features.map((feature) => (
                    <div
                      key={feature.label}
                      className="group rounded-2xl border border-white/[0.08] bg-white/[0.04] p-4 transition-all hover:-translate-y-0.5 hover:bg-white/[0.06]"
                    >
                      <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/[0.08] bg-[#0b0f14]">
                        <feature.icon className={`h-5 w-5 ${feature.iconClass}`} strokeWidth={1.8} />
                      </div>
                      <p className="mt-4 text-base font-medium text-white/85">{feature.label}</p>
                      <p className="mt-1 text-sm text-white/40">{feature.description}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-6 rounded-3xl border border-white/[0.08] bg-[radial-gradient(circle_at_top_left,rgba(106,170,255,0.24),transparent_45%),rgba(255,255,255,0.03)] p-5">
                  <div className="flex items-center gap-3">
                    <Compass className="h-5 w-5 text-cyan-300" />
                    <p className="text-sm font-medium text-white/82">品牌路线</p>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-white/50">
                    用更克制的暗色界面、更强识别度的 logo 和更统一的创作入口，让“幻途”从模板站切换成独立品牌。
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-10 grid w-full max-w-[980px] grid-cols-2 gap-3 md:grid-cols-4">
            {features.map((feature) => (
              <div
                key={feature.label}
                className="group flex items-center gap-3 rounded-2xl border border-white/[0.07] bg-[#101418]/60 px-4 py-3.5 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_10px_30px_rgba(0,0,0,0.18)] backdrop-blur-xl transition-all hover:-translate-y-0.5 hover:border-white/[0.12] hover:bg-[#131821]/80"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/[0.07] bg-[#0b0f14] transition-transform group-hover:scale-105">
                  <feature.icon className={`h-4 w-4 ${feature.iconClass}`} strokeWidth={1.8} />
                </div>
                <div className="min-w-0">
                  <p className="text-[0.95rem] font-medium leading-tight text-foreground/82">{feature.label}</p>
                  <p className="mt-1 truncate text-xs leading-tight text-foreground/34">{feature.description}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="relative z-10 pb-8 text-center">
        <p className="text-xs tracking-wide text-foreground/24">
          {siteConfig.poweredBy} · {siteConfig.copyright}
        </p>
      </footer>
    </div>
  );
}
