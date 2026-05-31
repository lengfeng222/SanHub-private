export function isGenericVideoModelLabel(value?: string): boolean {
  const raw = String(value || '').trim().toLowerCase();
  return (
    !raw ||
    raw === 'sora-video' ||
    raw === 'video' ||
    raw.startsWith('sora2-') ||
    raw.startsWith('sora-')
  );
}

export function formatLegacyVideoModelLabel(value?: string): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const lower = raw.toLowerCase();

  if (lower.includes('veo3.1')) return 'veo3.1';
  if (lower.includes('veo')) return 'Veo';
  if (lower.includes('wan') || lower.includes('万相')) return '万相';
  if (lower.includes('kling') || lower.includes('可灵')) return '可灵';
  if (lower.includes('vidu')) return 'Vidu';
  if (lower.includes('pix')) return 'PixVerse';
  if (lower.includes('grok')) return 'Grok';
  if (lower.includes('happyhorse') || lower.includes('快乐马')) return '快乐马';
  if (lower.startsWith('sora2-') || lower.startsWith('sora-') || lower === 'sora-video') {
    return '视频生成';
  }

  return raw;
}

export function resolveVideoModelLabel({
  modelId,
  model,
  modelNameMap,
}: {
  modelId?: string;
  model?: string;
  modelNameMap?: Map<string, string>;
}): string {
  const mapped = modelId ? modelNameMap?.get(modelId) : undefined;
  if (mapped) return mapped;

  if (!isGenericVideoModelLabel(model)) {
    return formatLegacyVideoModelLabel(model);
  }

  return formatLegacyVideoModelLabel(model) || '视频生成';
}
