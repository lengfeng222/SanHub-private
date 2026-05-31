export type MediaDurationRange = {
  minSeconds?: number;
  maxSeconds?: number;
};

function toFinitePositiveNumber(value: string | number | undefined): number | undefined {
  const numeric = typeof value === 'number' ? value : Number(String(value || '').trim());
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
  return numeric;
}

function normalizeDurationRange(range: MediaDurationRange | null | undefined): MediaDurationRange | null {
  if (!range) return null;
  const minSeconds = toFinitePositiveNumber(range.minSeconds);
  const maxSeconds = toFinitePositiveNumber(range.maxSeconds);
  if (minSeconds === undefined && maxSeconds === undefined) return null;
  if (
    minSeconds !== undefined
    && maxSeconds !== undefined
    && minSeconds > maxSeconds
  ) {
    return null;
  }
  return {
    ...(minSeconds !== undefined ? { minSeconds } : {}),
    ...(maxSeconds !== undefined ? { maxSeconds } : {}),
  };
}

export function roundMediaDurationSeconds(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 10) / 10;
}

export function formatMediaDurationRange(range: MediaDurationRange | null | undefined): string {
  const normalized = normalizeDurationRange(range);
  if (!normalized) return '';

  const min = normalized.minSeconds;
  const max = normalized.maxSeconds;
  if (min !== undefined && max !== undefined) {
    return `${roundMediaDurationSeconds(min)}-${roundMediaDurationSeconds(max)} 秒`;
  }
  if (min !== undefined) {
    return `至少 ${roundMediaDurationSeconds(min)} 秒`;
  }
  if (max !== undefined) {
    return `不超过 ${roundMediaDurationSeconds(max)} 秒`;
  }
  return '';
}

export function validateMediaDurationAgainstRange(
  durationSeconds: number,
  range: MediaDurationRange | null | undefined
): MediaDurationRange | null {
  const normalized = normalizeDurationRange(range);
  if (!normalized) return null;

  const duration = toFinitePositiveNumber(durationSeconds);
  if (duration === undefined) return null;

  if (normalized.minSeconds !== undefined && duration + 0.05 < normalized.minSeconds) {
    return normalized;
  }
  if (normalized.maxSeconds !== undefined && duration - 0.05 > normalized.maxSeconds) {
    return normalized;
  }
  return null;
}

export function parseMediaDurationRangeFromText(text: string | undefined | null): MediaDurationRange | null {
  const source = String(text || '').trim();
  if (!source) return null;

  const rangePatterns = [
    /(?:duration|audio duration|video duration|supports?|support|about|approximately|approx\.?|时长|音频时长|视频时长)[^0-9]{0,24}(\d+(?:\.\d+)?)\s*(?:-|–|—|~|至|到|to)\s*(\d+(?:\.\d+)?)\s*(?:seconds?|secs?|秒)/i,
    /(\d+(?:\.\d+)?)\s*(?:-|–|—|~|至|到|to)\s*(\d+(?:\.\d+)?)\s*(?:seconds?|secs?|秒)/i,
  ];

  for (const pattern of rangePatterns) {
    const matched = source.match(pattern);
    if (!matched) continue;
    const minSeconds = toFinitePositiveNumber(matched[1]);
    const maxSeconds = toFinitePositiveNumber(matched[2]);
    return normalizeDurationRange({ minSeconds, maxSeconds });
  }

  const minimumPatterns = [
    /(?:at\s*least|minimum|min\.?|不少于|至少)\s*(\d+(?:\.\d+)?)\s*(?:seconds?|secs?|秒)/i,
  ];
  for (const pattern of minimumPatterns) {
    const matched = source.match(pattern);
    if (!matched) continue;
    const minSeconds = toFinitePositiveNumber(matched[1]);
    return normalizeDurationRange({ minSeconds });
  }

  const maximumPatterns = [
    /(?:up\s*to|maximum|max\.?|不超过|最多)\s*(\d+(?:\.\d+)?)\s*(?:seconds?|secs?|秒)/i,
  ];
  for (const pattern of maximumPatterns) {
    const matched = source.match(pattern);
    if (!matched) continue;
    const maxSeconds = toFinitePositiveNumber(matched[1]);
    return normalizeDurationRange({ maxSeconds });
  }

  return null;
}
