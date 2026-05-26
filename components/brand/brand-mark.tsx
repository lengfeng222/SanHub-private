'use client';

type BrandMarkProps = {
  size?: number;
  rounded?: string;
  className?: string;
};

export function BrandMark({ size = 40, rounded = 'rounded-2xl', className = '' }: BrandMarkProps) {
  return (
    <div
      className={`relative overflow-hidden border border-white/10 bg-white/5 shadow-[0_10px_30px_rgba(70,90,255,0.18)] ${rounded} ${className}`}
      style={{ width: size, height: size }}
    >
      <img
        src="/huantu-logo.jpg"
        alt="幻途 Logo"
        width={size}
        height={size}
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
      />
    </div>
  );
}
