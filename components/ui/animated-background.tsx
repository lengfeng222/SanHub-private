'use client';

interface AnimatedBackgroundProps {
  variant?: 'home' | 'auth';
}

export function AnimatedBackground({ variant = 'home' }: AnimatedBackgroundProps) {
  const isHome = variant === 'home';

  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-background/95 via-background/72 to-background/95" />

      <div
        className="absolute h-[500px] w-[500px] rounded-full opacity-20 blur-[110px]"
        style={{
          background: 'radial-gradient(circle, hsl(var(--glow-a) / 0.34) 0%, transparent 72%)',
          top: isHome ? '10%' : '18%',
          left: isHome ? '10%' : '-10%',
        }}
      />
      <div
        className="absolute h-[400px] w-[400px] rounded-full opacity-16 blur-[90px]"
        style={{
          background: 'radial-gradient(circle, hsl(var(--glow-b) / 0.3) 0%, transparent 72%)',
          top: isHome ? '50%' : '58%',
          right: isHome ? '5%' : '-6%',
        }}
      />
      <div
        className="absolute h-[340px] w-[340px] rounded-full opacity-12 blur-[76px]"
        style={{
          background: 'radial-gradient(circle, rgba(255,255,255,0.16) 0%, transparent 72%)',
          bottom: isHome ? '10%' : '4%',
          left: isHome ? '30%' : '58%',
        }}
      />

      <div
        className="absolute left-1/2 top-0 h-[400px] w-[800px] -translate-x-1/2 opacity-18"
        style={{
          background: 'radial-gradient(ellipse at center top, rgba(255,255,255,0.18) 0%, transparent 60%)',
        }}
      />

      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.04),transparent_70%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.018)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.018)_1px,transparent_1px)] bg-[size:140px_140px] [mask-image:radial-gradient(circle_at_center,black,transparent_85%)] opacity-20" />
      <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-background to-transparent" />
    </div>
  );
}
