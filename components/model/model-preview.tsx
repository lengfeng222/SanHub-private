'use client';

import { formatBillingSummary } from '@/lib/billing';
import { cn } from '@/lib/utils';
import { resolveImageModelImage, resolveVideoModelImage } from '@/lib/model-images';

type PreviewTheme = {
  label: string;
  icon: string;
  subtitle: string;
  colors: [string, string, string];
  accent: string;
};

type PreviewMeta = {
  title: string;
  subtitle: string;
  badge: string;
  metric: string;
  colors: [string, string, string];
  icon: string;
  accent: string;
  imageUrl?: string;
};

type PreviewBoxProps = {
  title: string;
  subtitle: string;
  badge: string;
  metric: string;
  colors: [string, string, string];
  icon: string;
  accent: string;
  imageUrl?: string;
  className?: string;
};

function resolveText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

const VIDEO_THEMES: Record<string, PreviewTheme> = {
  vidu: {
    label: 'Vidu',
    icon: 'V',
    subtitle: '视频生成',
    colors: ['#09101d', '#293caa', '#11c5f4'],
    accent: '#8ef3ff',
  },
  jimeng: {
    label: '即梦',
    icon: '梦',
    subtitle: '视频生成',
    colors: ['#120f20', '#7c3aed', '#ff4cc9'],
    accent: '#ffd0f3',
  },
  veo: {
    label: 'Veo 3.1',
    icon: '3.1',
    subtitle: '视频生成',
    colors: ['#09111f', '#1d4ed8', '#a855f7'],
    accent: '#dbeafe',
  },
  kling: {
    label: '可灵',
    icon: '灵',
    subtitle: '视频生成',
    colors: ['#07131d', '#0f9d8a', '#22c55e'],
    accent: '#d8fff7',
  },
  grok: {
    label: 'Grok',
    icon: 'G',
    subtitle: '视频生成',
    colors: ['#0b0d15', '#6d28d9', '#f97316'],
    accent: '#ffe7c7',
  },
  sora: {
    label: 'Sora',
    icon: 'S',
    subtitle: '视频生成',
    colors: ['#09111f', '#0ea5e9', '#7dd3fc'],
    accent: '#d7f8ff',
  },
  hailuo: {
    label: '海螺',
    icon: '螺',
    subtitle: '视频生成',
    colors: ['#071715', '#0f766e', '#38bdf8'],
    accent: '#d6fff4',
  },
  wanxiang: {
    label: '万相',
    icon: '万',
    subtitle: '视频生成',
    colors: ['#130f2d', '#5b21b6', '#38bdf8'],
    accent: '#e0ddff',
  },
  runway: {
    label: 'Runway',
    icon: 'R',
    subtitle: '视频生成',
    colors: ['#0b0f18', '#f59e0b', '#8b5cf6'],
    accent: '#fff1cf',
  },
  pixverse: {
    label: 'PixVerse',
    icon: 'P',
    subtitle: '视频生成',
    colors: ['#130f20', '#db2777', '#fb923c'],
    accent: '#ffd9ef',
  },
  happyhorse: {
    label: '快乐马',
    icon: '马',
    subtitle: '视频生成',
    colors: ['#07111a', '#ea580c', '#facc15'],
    accent: '#fff1c7',
  },
  default: {
    label: '视频',
    icon: 'V',
    subtitle: '视频生成',
    colors: ['#111827', '#334155', '#0ea5e9'],
    accent: '#dbeafe',
  },
};

const IMAGE_THEMES: Record<string, PreviewTheme> = {
  gpt: {
    label: 'GPT Image',
    icon: 'GPT',
    subtitle: '图像生成',
    colors: ['#111827', '#334155', '#0ea5e9'],
    accent: '#dbeafe',
  },
  banana: {
    label: 'Nano Banana',
    icon: 'B',
    subtitle: '图像编辑',
    colors: ['#2a1f07', '#d97706', '#facc15'],
    accent: '#fff2c4',
  },
  vidu: {
    label: 'Vidu',
    icon: 'V',
    subtitle: '图像生成',
    colors: ['#0f172a', '#2563eb', '#22c55e'],
    accent: '#dbeafe',
  },
  wanxiang: {
    label: '万相',
    icon: '万',
    subtitle: '图像生成',
    colors: ['#16122b', '#4f46e5', '#22d3ee'],
    accent: '#e0ddff',
  },
  sd: {
    label: 'SD',
    icon: 'SD',
    subtitle: '图像生成',
    colors: ['#111827', '#374151', '#9ca3af'],
    accent: '#e5e7eb',
  },
  default: {
    label: '图像',
    icon: 'IMG',
    subtitle: '图像生成',
    colors: ['#0f172a', '#475569', '#38bdf8'],
    accent: '#dbeafe',
  },
};

function buildThemeBox(theme: PreviewTheme, fallbackBadge: string, fallbackMetric: string): PreviewMeta {
  return {
    title: theme.label,
    subtitle: theme.subtitle,
    badge: fallbackBadge,
    metric: fallbackMetric,
    colors: theme.colors,
    icon: theme.icon,
    accent: theme.accent,
  };
}

function getVideoFamily(model: { name: string; apiModel?: string }): keyof typeof VIDEO_THEMES {
  const raw = `${model.name} ${model.apiModel || ''}`.toLowerCase();
  if (/vidu|解说漫/.test(raw)) return 'vidu';
  if (/即梦|jimeng/.test(raw)) return 'jimeng';
  if (/veo|veo3|veo 3/.test(raw)) return 'veo';
  if (/可灵|kling/.test(raw)) return 'kling';
  if (/grok/.test(raw)) return 'grok';
  if (/sora/.test(raw)) return 'sora';
  if (/海螺|minimax/.test(raw)) return 'hailuo';
  if (/万相|qwen/.test(raw)) return 'wanxiang';
  if (/runway/.test(raw)) return 'runway';
  if (/pix/.test(raw)) return 'pixverse';
  if (/快乐马|happyhorse/.test(raw)) return 'happyhorse';
  return 'default';
}

function getVideoFamilyFallbackImage(family: keyof typeof VIDEO_THEMES): string | undefined {
  switch (family) {
    case 'vidu':
      return 'https://cos.lingkeai.vip/vidu-icon.svg';
    case 'veo':
      return 'https://cos.lingkeai.vip/gemini.svg';
    case 'kling':
      return 'https://cos.lingkeai.vip/kling.svg';
    case 'grok':
      return 'https://cos.lingkeai.vip/Grok_bai.svg';
    case 'sora':
      return '/huantu-logo.jpg';
    case 'hailuo':
      return 'https://cos.lingkeai.vip/minimax.svg';
    case 'wanxiang':
      return 'https://cos.lingkeai.vip/qwen.svg';
    case 'pixverse':
      return 'https://cos.lingkeai.vip/PixVerse.svg';
    case 'happyhorse':
      return 'https://cos.lingkeai.vip/happyhorse.svg';
    default:
      return undefined;
  }
}

function getImageFamily(model: { name: string; apiModel?: string }): keyof typeof IMAGE_THEMES {
  const raw = `${model.name} ${model.apiModel || ''}`.toLowerCase();
  if (/gpt/.test(raw)) return 'gpt';
  if (/banana|nanobanana/.test(raw)) return 'banana';
  if (/vidu/.test(raw)) return 'vidu';
  if (/万相|qwen/.test(raw)) return 'wanxiang';
  if (/sd|stable diffusion|stable-diffusion/.test(raw)) return 'sd';
  return 'default';
}

function getImageFamilyFallbackImage(family: keyof typeof IMAGE_THEMES): string | undefined {
  switch (family) {
    case 'gpt':
      return 'https://cos.lingkeai.vip/openai_bai.svg';
    case 'banana':
      return '/huantu-logo.jpg';
    case 'vidu':
      return 'https://cos.lingkeai.vip/vidu-icon.svg';
    case 'wanxiang':
      return 'https://cos.lingkeai.vip/qwen.svg';
    case 'sd':
      return 'https://cos.lingkeai.vip/doubao.svg';
    default:
      return undefined;
  }
}

function getModelBadge(model: { highlight?: boolean; name: string; apiModel?: string; features?: { imageToVideo?: boolean; videoToVideo?: boolean; imageToImage?: boolean; upscale?: boolean; matting?: boolean } }): string {
  if (model.highlight) return '推荐';
  const raw = `${model.name} ${model.apiModel || ''}`.toLowerCase();
  if (raw.includes('首尾帧')) return '首尾帧';
  if (raw.includes('参考生') || raw.includes('参考')) return '参考生';
  if (raw.includes('视频编辑') || raw.includes('编辑')) return '编辑';
  if (raw.includes('续写')) return '续写';
  if (raw.includes('动作控制')) return '动作';
  if (raw.includes('超分') || model.features?.upscale) return '超分';
  if (raw.includes('抠图') || model.features?.matting) return '抠图';
  if (raw.includes('图生')) return '图生';
  if (raw.includes('文生')) return '文生';
  return model.features?.imageToVideo ? '图生' : '文生';
}

function getVideoMetric(model: {
  billingMode?: 'per_call' | 'per_second' | 'per_1k_tokens';
  billingPrice?: number;
  billingUnit?: number;
  durations?: Array<{ value: string; cost: number }>;
}) {
  return formatBillingSummary({
    billingMode: model.billingMode,
    billingPrice: model.billingPrice,
    billingUnit: model.billingUnit,
    legacyCost: model.durations?.[0]?.cost,
  });
}

function getImageMetric(model: {
  billingMode?: 'per_call' | 'per_second' | 'per_1k_tokens';
  billingPrice?: number;
  billingUnit?: number;
  costPerGeneration?: number;
}) {
  return formatBillingSummary({
    billingMode: model.billingMode,
    billingPrice: model.billingPrice,
    billingUnit: model.billingUnit,
    legacyCost: model.costPerGeneration,
  });
}

export function getVideoModelPreviewMeta(model: {
  name: string;
  apiModel?: string;
  highlight?: boolean;
  billingMode?: 'per_call' | 'per_second' | 'per_1k_tokens';
  billingPrice?: number;
  billingUnit?: number;
  durations?: Array<{ value: string; cost: number }>;
  features?: { imageToVideo?: boolean; videoToVideo?: boolean };
  imageUrl?: string;
}): PreviewMeta {
  const familyKey = getVideoFamily(model);
  const family = VIDEO_THEMES[familyKey];
  const badge = getModelBadge(model);
  const raw = `${model.name} ${model.apiModel || ''}`.toLowerCase();
  const subtitle =
    raw.includes('编辑') || model.features?.videoToVideo
      ? '视频编辑'
      : raw.includes('首尾帧')
        ? '首尾帧'
        : raw.includes('参考')
          ? '图生视频'
          : '视频生成';

  return {
    title: family.label,
    subtitle,
    badge,
    metric: getVideoMetric(model),
    colors: family.colors,
    icon: family.icon,
    accent: family.accent,
    imageUrl: resolveVideoModelImage({
      name: model.name,
      apiModel: model.apiModel,
      imageUrl: model.imageUrl || getVideoFamilyFallbackImage(familyKey),
    }),
  };
}

export function getImageModelPreviewMeta(model: {
  name: string;
  apiModel?: string;
  highlight?: boolean;
  billingMode?: 'per_call' | 'per_second' | 'per_1k_tokens';
  billingPrice?: number;
  billingUnit?: number;
  costPerGeneration?: number;
  features?: { imageToImage?: boolean; upscale?: boolean; matting?: boolean };
  imageUrl?: string;
}): PreviewMeta {
  const familyKey = getImageFamily(model);
  const family = IMAGE_THEMES[familyKey];
  const badge = getModelBadge({
    ...model,
    features: {
      imageToVideo: false,
      videoToVideo: false,
      imageToImage: model.features?.imageToImage,
      upscale: model.features?.upscale,
      matting: model.features?.matting,
    },
  });
  const raw = `${model.name} ${model.apiModel || ''}`.toLowerCase();
  const subtitle =
    raw.includes('编辑') || model.features?.imageToImage
      ? '图像编辑'
      : model.features?.upscale
        ? '超分增强'
        : model.features?.matting
          ? '智能抠图'
          : '图像生成';

  return {
    ...buildThemeBox(
      {
        ...family,
        subtitle,
      },
      badge,
      getImageMetric(model)
    ),
    imageUrl: resolveImageModelImage({
      name: model.name,
      apiModel: model.apiModel,
      imageUrl: model.imageUrl || getImageFamilyFallbackImage(familyKey),
    }),
  };
}

export function ModelPreview({
  title,
  subtitle,
  badge,
  metric,
  colors,
  icon,
  accent,
  imageUrl,
  className,
}: PreviewBoxProps) {
  return (
    <div
      className={cn('relative h-full w-full overflow-hidden rounded-[inherit] text-white', className)}
      style={{ backgroundImage: `linear-gradient(135deg, ${colors[0]}, ${colors[1]} 54%, ${colors[2]})` }}
    >
      {imageUrl ? (
        <>
          <img src={imageUrl} alt={title} className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.10),rgba(0,0,0,0.68))]" />
        </>
      ) : (
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_22%,rgba(255,255,255,0.22),transparent_28%),radial-gradient(circle_at_84%_18%,rgba(255,255,255,0.18),transparent_25%),radial-gradient(circle_at_72%_84%,rgba(255,255,255,0.14),transparent_30%)]" />
      )}
      <div className="absolute -right-5 -top-5 h-16 w-16 rounded-full bg-white/20 blur-2xl" />
      <div className="absolute -left-4 bottom-0 h-14 w-14 rounded-full bg-black/15 blur-2xl" />
      <div className="relative flex h-full w-full flex-col justify-between p-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-[11px] font-semibold leading-none text-white">{title}</div>
            <div className="mt-0.5 truncate text-[9px] text-white/72">{subtitle}</div>
          </div>
          {badge ? (
            <span className="shrink-0 rounded-full border border-white/15 bg-white/18 px-1.5 py-0.5 text-[8px] font-medium text-white backdrop-blur">
              {badge}
            </span>
          ) : null}
        </div>
        <div className="flex items-end justify-between gap-2">
          <div className="min-w-0 flex items-center gap-1.5">
            <div
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-white/15 bg-black/18 text-[9px] font-semibold text-white shadow-[0_0_0_1px_rgba(255,255,255,0.04)]"
              style={{ color: accent }}
            >
              {icon}
            </div>
            <div className="min-w-0 truncate text-[9px] text-white/68">{metric}</div>
          </div>
          <div className="rounded-full border border-white/12 bg-black/16 px-1.5 py-0.5 text-[8px] tracking-[0.18em] text-white/38">
            MODEL
          </div>
        </div>
      </div>
    </div>
  );
}
