'use client';

import { useId } from 'react';
import type { ReactNode } from 'react';
import { Coins, ImagePlus, Loader2, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

export function LcPageTitle({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-[2.2rem] font-semibold tracking-[-0.04em] text-white sm:text-5xl">{title}</h2>
      {description ? <p className="mt-2 text-sm text-white/55 sm:text-base">{description}</p> : null}
    </div>
  );
}

export function LcResultPanel({
  countLabel = '0 个作品',
  emptyTitle = '暂无生成结果',
  emptyDescription = '开始创作你的第一个作品',
}: {
  countLabel?: string;
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  return (
    <section className="overflow-hidden rounded-[26px] border border-white/10 bg-[#10141c]/90 shadow-[0_20px_60px_rgba(0,0,0,0.24)]">
      <div className="flex items-center gap-3 border-b border-white/8 px-5 py-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] text-white/90">
          <Sparkles className="h-4 w-4" />
        </div>
        <div>
          <p className="text-lg font-semibold text-white">生成结果</p>
          <p className="text-xs text-white/45">{countLabel}</p>
        </div>
      </div>
      <div className="p-5">
        <div className="flex min-h-[260px] flex-col items-center justify-center rounded-[24px] border border-dashed border-white/10 bg-[#0f1319] px-6 text-center">
          <Sparkles className="mb-3 h-8 w-8 text-white/35" />
          <p className="text-2xl font-medium text-white/75">{emptyTitle}</p>
          <p className="mt-2 text-sm text-white/35">{emptyDescription}</p>
        </div>
      </div>
    </section>
  );
}

export function LcCard({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <section className={cn('overflow-hidden rounded-[26px] border border-white/10 bg-[#10141c]/92 shadow-[0_20px_60px_rgba(0,0,0,0.24)]', className)}>
      {children}
    </section>
  );
}

export function LcSection({ title, children, subtitle }: { title?: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="space-y-3">
      {title ? (
        <div>
          <div className="text-sm font-medium text-white">{title}</div>
          {subtitle ? <div className="mt-1 text-xs text-white/45">{subtitle}</div> : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}

export function LcInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn('h-12 w-full rounded-2xl border border-white/8 bg-[#171b24] px-4 text-sm text-white outline-none placeholder:text-white/20 focus:border-white/15', props.className)} />;
}

export function LcTextarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn('min-h-[132px] w-full resize-none rounded-2xl border border-white/8 bg-[#171b24] p-4 text-sm leading-6 text-white outline-none placeholder:text-white/20 focus:border-white/15', props.className)} />;
}

export function LcSelect({ children, className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn('h-12 w-full rounded-2xl border border-white/8 bg-[#171b24] px-4 text-sm text-white outline-none focus:border-white/15', className)}>{children}</select>;
}

export function LcUploadBox({
  label = '上传图片',
  sublabel,
  accept,
  multiple = false,
  onChange,
}: {
  label?: string;
  sublabel?: string;
  accept?: string;
  multiple?: boolean;
  onChange?: React.ChangeEventHandler<HTMLInputElement>;
}) {
  const inputId = useId();
  return (
    <label htmlFor={inputId} className="flex min-h-[108px] cursor-pointer flex-col items-center justify-center rounded-[24px] border border-dashed border-white/10 bg-[#0f1319] text-center transition hover:border-white/20 hover:bg-white/[0.02]">
      <ImagePlus className="mb-2 h-6 w-6 text-white/35" />
      <span className="text-sm text-white/75">{label}</span>
      {sublabel ? <span className="mt-1 text-xs text-white/30">{sublabel}</span> : null}
      <input id={inputId} type="file" accept={accept} multiple={multiple} className="hidden" onChange={onChange} />
    </label>
  );
}

export function LcTabs({ tabs, value, onChange }: { tabs: Array<{ value: string; label: string; icon?: ReactNode }>; value: string; onChange: (value: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {tabs.map((tab) => {
        const active = tab.value === value;
        return (
          <button
            key={tab.value}
            type="button"
            onClick={() => onChange(tab.value)}
            className={cn(
              'inline-flex items-center gap-2 rounded-2xl border px-4 py-2 text-sm transition',
              active ? 'border-white/20 bg-white/[0.07] text-white' : 'border-white/10 bg-white/[0.02] text-white/60 hover:bg-white/[0.04] hover:text-white'
            )}
          >
            {tab.icon}
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

export function LcCostBar({
  cost,
  buttonLabel,
  disabled,
  loading,
  onClick,
  hint,
  quantityValue,
  quantityOptions,
  onQuantityChange,
}: {
  cost: string | number;
  buttonLabel: string;
  disabled?: boolean;
  loading?: boolean;
  onClick?: () => void;
  hint?: string;
  quantityValue?: string;
  quantityOptions?: string[];
  onQuantityChange?: (value: string) => void;
}) {
  return (
    <div className="mt-3 flex flex-col gap-3 border-t border-white/8 pt-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3 text-sm text-white/50">
        <span className="inline-flex items-center gap-2 rounded-full border border-[#274d38] bg-[#12271c] px-4 py-2 text-[#8eedb2]">
          <Coins className="h-4 w-4" />
          {cost}
        </span>
        {quantityOptions?.length ? (
          <select
            value={quantityValue}
            onChange={(event) => onQuantityChange?.(event.target.value)}
            className="h-10 rounded-full border border-white/10 bg-[#171b24] px-4 text-xs text-white/75 outline-none focus:border-white/20"
          >
            {quantityOptions.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        ) : null}
        {hint ? <span>{hint}</span> : null}
      </div>
      <button
        type="button"
        disabled={disabled || loading}
        onClick={onClick}
        className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-5 text-sm text-white transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-45"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        {buttonLabel}
      </button>
    </div>
  );
}
