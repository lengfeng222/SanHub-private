type UploadKind = 'image' | 'video' | 'audio';

const CHINESE_TEXT_PATTERN = /[\u4e00-\u9fff]/;

function normalizeToken(value?: string): string {
  return String(value || '').trim().toLowerCase();
}

function includesAny(source: string, patterns: string[]): boolean {
  return patterns.some((pattern) => source.includes(pattern));
}

function resolveBooleanLikeLabel(value?: string): string | null {
  const normalized = normalizeToken(value);
  if (!normalized) return null;

  if (['true', 'on', 'enable', 'enabled', 'open', 'yes', '1'].includes(normalized)) {
    return '开启';
  }
  if (['false', 'off', 'disable', 'disabled', 'close', 'closed', 'no', '0'].includes(normalized)) {
    return '关闭';
  }

  return null;
}

function localizeSecondsLabel(value: string): string | null {
  const match = value.match(/^(\d+(?:\.\d+)?)\s*sec$/i);
  if (match) return `${match[1]} 秒`;
  return null;
}

function localizeAspectRatioLabel(value: string): string | null {
  const normalized = normalizeToken(value);
  if (!normalized) return null;
  if (normalized === 'adaptive') return '自适应';
  const ratioMatch = value.match(/(\d+:\d+)/);
  const ratio = ratioMatch?.[1];
  if (!ratio) return null;
  if (normalized.includes('landscape')) return `${ratio} 横屏`;
  if (normalized.includes('portrait')) return `${ratio} 竖屏`;
  if (normalized.includes('square')) return `${ratio} 方图`;
  if (normalized.includes('ultrawide')) return `${ratio} 超宽屏`;
  if (normalized.includes('traditional')) return `${ratio} 传统`;
  return null;
}

export function localizeVideoUploadLabel(
  rawLabel?: string,
  paramName?: string,
  kind?: UploadKind,
): string {
  const label = String(rawLabel || '').trim();
  const param = String(paramName || '').trim();
  const source = `${normalizeToken(label)} ${normalizeToken(param)}`.trim();

  if (!source) {
    if (kind === 'video') return '参考视频';
    if (kind === 'audio') return '音频素材';
    return '参考图';
  }

  if (param === 'assets' || source.includes('asset')) return '角色 / 场景素材图';
  if (includesAny(source, ['lip_ref_url', 'lip-sync face reference', 'face reference'])) return '口型参考图';
  if (includesAny(source, ['motion-reference', 'subject image', 'character image'])) return '主体参考图';
  if (includesAny(source, ['action video', 'motion video'])) return '动作参考视频';
  if (includesAny(source, ['continue', 'continuation', 'extension', '续写', 'clip'])) return '续写视频';
  if (includesAny(source, ['edit video', 'video edit', '待编辑'])) return '待编辑视频';
  if (includesAny(source, ['first frame', 'first_frame', '首帧'])) return '首帧参考';
  if (includesAny(source, ['last frame', 'last_frame', '尾帧'])) return '尾帧参考';
  if (includesAny(source, ['reference video', 'video reference', 'reference-video', 'video_url'])) return '参考视频';
  if (includesAny(source, ['reference image', 'reference images', 'reference-image', 'image_url', 'input image'])) return '参考图';
  if (includesAny(source, ['audio', 'sound', 'music', 'lip_ref'])) return '音频素材';

  if (kind === 'audio') return '音频素材';
  if (kind === 'video') return '参考视频';
  if (kind === 'image') return '参考图';

  return label || param || '参考素材';
}

export function localizeVideoUploadDescription(
  rawDescription: string | undefined,
  fallbackHint: string,
  paramName?: string,
  label?: string,
  kind?: UploadKind,
): string {
  const description = String(rawDescription || '').trim();
  if (!description) return fallbackHint;
  const cleanedDescription = description
    .replace(/（?仅接受可公开访问的\s*URL；多文件可传\s*URL\s*数组。平台不提供文件托管，请自行将文件上传至\s*COS\/CDN\s*等对象存储服务后传入\s*URL）?/gi, '')
    .replace(/\(?only accepts publicly accessible urls?;?.*?platform does not provide file hosting.*?url\)?/gi, '')
    .trim();
  if (!cleanedDescription) return fallbackHint;
  if (CHINESE_TEXT_PATTERN.test(cleanedDescription)) return cleanedDescription;

  const normalized = normalizeToken(cleanedDescription);
  if (!normalized) return fallbackHint;

  const localizedLabel = localizeVideoUploadLabel(label, paramName, kind);
  if (
    localizedLabel
    && (
      includesAny(normalized, ['upload', 'reference', 'image', 'video', 'audio', 'sound', 'clip', 'frame', 'file'])
      || !CHINESE_TEXT_PATTERN.test(cleanedDescription)
    )
  ) {
    if (localizedLabel === '角色 / 场景素材图') return '上传角色、场景或道具图片，系统会自动转成上游所需素材格式。';
    if (localizedLabel === '主体参考图') return '上传人物/主体图，用于动作控制与外观锁定。';
    if (localizedLabel === '动作参考视频') return '上传动作参考视频，让生成结果跟随动作轨迹。';
    if (localizedLabel === '续写视频') return '上传续写视频，延续原视频内容继续生成。';
    if (localizedLabel === '待编辑视频') return '上传待编辑视频，基于原片继续编辑生成。';
    if (localizedLabel === '口型参考图') return '上传演唱者正脸参考图，可显著提升口型同步成功率。';
    if (localizedLabel === '首帧参考') return '上传单张首帧作为镜头起始。';
    if (localizedLabel === '尾帧参考') return '上传单张尾帧作为镜头结束。';
    if (localizedLabel === '参考视频') return '上传参考视频，跟随上游能力继续生成。';
    if (localizedLabel === '音频素材') return '上传音频素材，用于驱动口型或节奏。';
    return '上传参考图片，控制主体、风格或构图。';
  }

  return cleanedDescription;
}

export function localizeVideoDynamicOptionLabel(
  key: string,
  rawLabel?: string,
  rawValue?: unknown,
): string {
  const value = typeof rawValue === 'string' ? rawValue : String(rawValue ?? '').trim();
  const label = String(rawLabel || '').trim() || value;

  const boolLabel = resolveBooleanLikeLabel(label) || resolveBooleanLikeLabel(value);
  if (boolLabel && ['off_peak', 'watermark', 'enhance_prompt', 'prompt_extend', 'keep_original_sound', 'enable_upsample'].includes(key)) {
    return boolLabel;
  }

  const normalizedLabel = normalizeToken(label);
  const normalizedValue = normalizeToken(value);
  const normalized = normalizedLabel || normalizedValue;

  const secondsLabel = localizeSecondsLabel(label) || localizeSecondsLabel(value);
  if (secondsLabel && ['duration', 'audio_duration'].includes(key)) {
    return secondsLabel;
  }

  const ratioLabel = localizeAspectRatioLabel(label) || localizeAspectRatioLabel(value);
  if (ratioLabel && ['aspect_ratio', 'ratio'].includes(key)) {
    return ratioLabel;
  }

  if (['duration', 'audio_duration'].includes(key) && normalized === 'auto') {
    return '自动';
  }

  if (key === 'off_peak') {
    return resolveBooleanLikeLabel(label) || resolveBooleanLikeLabel(value) || (normalized.includes('on') ? '开启' : normalized.includes('off') ? '关闭' : label);
  }

  if (key === 'generation_mode') {
    if (['fast', 'flash', 'quick'].includes(normalizedValue) || normalizedLabel === 'fast') return '快速';
    if (['null', 'normal', 'standard', 'std'].includes(normalizedValue) || normalizedLabel === 'standard') return '标准';
    if (['pro', 'professional', 'high', 'high_quality'].includes(normalizedValue) || normalizedLabel === 'pro') return '高质量';
    if (normalized.includes('component')) return '多图参考';
  }

  if (key === 'mode') {
    if (['std', 'standard'].includes(normalizedValue) || normalizedLabel.includes('standard')) return '标准';
    if (['pro', 'expert'].includes(normalizedValue) || normalizedLabel.includes('premium') || normalizedLabel.includes('expert')) {
      return '高质量';
    }
  }

  if (key === 'audio_setting') {
    if (normalizedValue === 'auto' || normalizedLabel.includes('smart')) return '智能处理';
    if (normalizedValue === 'origin' || normalizedLabel.includes('keep original audio')) return '保留原声';
  }

  if (key === 'sound') {
    if (normalizedValue === 'on' || normalizedLabel.includes('with audio')) return '有声';
    if (normalizedValue === 'off' || normalizedLabel.includes('silent')) return '静音';
  }

  if (key === '_quan_neng_mode') {
    if (normalizedValue === 'quan_neng' || normalizedLabel.includes('all-purpose reference')) return '全能参考';
    if (normalizedValue === 'edit' || normalizedLabel.includes('edit video')) return '视频编辑';
    if (normalizedValue === 'extend' || normalizedLabel.includes('extend video')) return '视频续写';
  }

  if (key === 'model_version') {
    if (normalizedLabel === 'option' && value) return String(rawValue ?? '').trim() || label;
    if (normalizedLabel.includes('fast version') || normalizedValue === '2.3-fast') return '极速版（仅图生视频）';
  }

  if (key === 'refer_type') {
    if (normalizedValue === 'feature' || normalizedLabel.includes('video reference')) return '视频参考';
    if (normalizedValue === 'base' || normalizedLabel.includes('edit video')) return '视频编辑';
  }

  if (key === 'character_orientation') {
    if (normalizedValue === 'video') return '跟随动作视频';
    if (normalizedValue === 'image') return '跟随主体参考图';
  }

  if (key === 'lip_sync') {
    if (normalizedValue === 'false' || normalizedLabel.includes('no lip sync')) return '关闭';
    if (normalizedValue === 'true' || normalizedLabel === 'lip sync' || normalizedLabel.includes('enable lip sync')) return '开启';
  }

  if (key === 'quality_version' || key === 'version') {
    if (normalized === 'fast') return '快速';
    if (normalized === 'standard' || normalized === 'std') return '标准';
    if (normalized === 'pro' || normalized === 'professional') return '高质量';
  }

  return label;
}
