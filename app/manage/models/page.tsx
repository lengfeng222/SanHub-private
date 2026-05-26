import Link from 'next/link';
import { Image, MessageSquare, Video } from 'lucide-react';

const items = [
  { href: '/manage/chat', title: '聊天模型', desc: '配置全能推理、提示词净化/翻译可用模型', icon: MessageSquare },
  { href: '/manage/image', title: '图像渠道', desc: 'GPT2 图像、大香蕉2 等图片渠道和 API Key', icon: Image },
  { href: '/manage/video', title: '视频渠道', desc: '视频模型、Sora2、Grok3 等视频渠道', icon: Video },
];

export default function ManageModelsPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-3xl font-semibold tracking-[-0.04em] text-white">模型配置</h1>
        <p className="mt-2 text-sm text-white/45">模型你最后确认，这里先保留统一入口。</p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {items.map((item) => (
          <Link key={item.href} href={item.href} className="rounded-[26px] border border-white/10 bg-[#10141c]/90 p-5 transition hover:bg-[#151b25]">
            <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-white"><item.icon className="h-5 w-5" /></div>
            <div className="text-xl font-semibold text-white">{item.title}</div>
            <div className="mt-2 text-sm leading-6 text-white/42">{item.desc}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
