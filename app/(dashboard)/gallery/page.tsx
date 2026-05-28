'use client';

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function GalleryPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/create");
  }, [router]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="rounded-3xl border border-white/10 bg-white/[0.03] px-6 py-8 text-center text-white/70 backdrop-blur-xl">
        <p className="text-lg font-medium text-white">正在跳转作品创作页</p>
        <p className="mt-2 text-sm text-white/45">如果没有自动跳转，请稍后重试。</p>
      </div>
    </div>
  );
}
