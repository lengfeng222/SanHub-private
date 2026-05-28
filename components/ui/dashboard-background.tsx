'use client';

export function DashboardBackground() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-background via-background/85 to-background" />

      <div
        className="absolute -left-[8%] -top-[12%] h-[420px] w-[420px] rounded-full opacity-[0.18] blur-[90px]"
        style={{
          background: 'radial-gradient(circle, hsl(var(--glow-a) / 0.38) 0%, transparent 72%)',
        }}
      />
      <div
        className="absolute right-[-8%] top-[22%] h-[360px] w-[360px] rounded-full opacity-[0.14] blur-[82px]"
        style={{
          background: 'radial-gradient(circle, hsl(var(--glow-b) / 0.3) 0%, transparent 72%)',
        }}
      />
      <div
        className="absolute bottom-[4%] left-[28%] h-[320px] w-[320px] rounded-full opacity-[0.1] blur-[72px]"
        style={{
          background: 'radial-gradient(circle, rgba(255,255,255,0.16) 0%, transparent 72%)',
        }}
      />

      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.10),transparent_42%)] opacity-40" />
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.025)_1px,transparent_1px)] bg-[size:120px_120px] [mask-image:radial-gradient(circle_at_center,black,transparent_85%)] opacity-25" />
      <div className="absolute bottom-0 left-0 right-0 h-28 bg-gradient-to-t from-background to-transparent" />
    </div>
  );
}
