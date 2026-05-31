import type { VideoConfigObject, VideoModel } from '@/types';

type LingkeParamOptionEntry = {
  value: string;
  label: string;
  description?: string;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeString(value: unknown): string {
  return String(value || '').trim();
}

function normalizeLower(value: unknown): string {
  return normalizeString(value).toLowerCase();
}

function cloneExtraParams(extraParams: unknown): Record<string, unknown> {
  if (!isPlainObject(extraParams)) return {};
  try {
    return JSON.parse(JSON.stringify(extraParams)) as Record<string, unknown>;
  } catch {
    return { ...extraParams };
  }
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizeString(item))
    .filter(Boolean);
}

function collectParamOptionEntries(value: unknown): LingkeParamOptionEntry[] {
  if (!Array.isArray(value)) return [];

  const entries: LingkeParamOptionEntry[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
      const optionValue = normalizeString(item);
      const key = optionValue.toLowerCase();
      if (!optionValue || seen.has(key)) continue;
      seen.add(key);
      entries.push({ value: optionValue, label: optionValue });
      continue;
    }

    if (!isPlainObject(item)) continue;

    const optionValue = normalizeString(item.value ?? item.label);
    const optionLabel = normalizeString(item.label ?? item.value);
    const key = optionValue.toLowerCase();
    if (!optionValue || seen.has(key)) continue;
    seen.add(key);

    entries.push({
      value: optionValue,
      label: optionLabel || optionValue,
      description: normalizeString(item.description) || undefined,
    });
  }

  return entries;
}

function getLingkeDynamicParamEntries(
  extraParams: Record<string, unknown>,
  paramName: string,
): LingkeParamOptionEntry[] {
  const dynamic = extraParams.dynamic_param_options;
  if (!dynamic) return [];

  if (isPlainObject(dynamic)) {
    return collectParamOptionEntries(dynamic[paramName]);
  }

  if (Array.isArray(dynamic)) {
    const matched = dynamic.find((item) => isPlainObject(item) && normalizeString(item.name) === paramName);
    if (isPlainObject(matched)) {
      return collectParamOptionEntries(matched.options);
    }
  }

  return [];
}

function getLingkeUpstreamParamEntries(
  extraParams: Record<string, unknown>,
  paramName: string,
): LingkeParamOptionEntry[] {
  const upstreamParams = extraParams.upstream_params;
  if (!Array.isArray(upstreamParams)) return [];

  const matched = upstreamParams.find((item) => isPlainObject(item) && normalizeString(item.name) === paramName);
  if (!isPlainObject(matched)) return [];
  return collectParamOptionEntries(matched.options);
}

function getLingkeParamEntries(
  extraParams: Record<string, unknown>,
  paramName: string,
): LingkeParamOptionEntry[] {
  const dynamicEntries = getLingkeDynamicParamEntries(extraParams, paramName);
  if (dynamicEntries.length > 0) return dynamicEntries;
  return getLingkeUpstreamParamEntries(extraParams, paramName);
}

function getLingkeDefaultDynamicValue(
  extraParams: Record<string, unknown>,
  paramName: string,
): unknown {
  const defaults = extraParams.default_dynamic_param_values;
  if (!isPlainObject(defaults)) return undefined;
  return defaults[paramName];
}

function hasLingkeRuntimeMetadata(extraParams: Record<string, unknown>): boolean {
  return (
    toStringArray(extraParams.upstream_param_names).length > 0
    || Boolean(extraParams.dynamic_param_options)
    || Boolean(extraParams.upload_mode)
    || Boolean(extraParams.upload_param_names)
  );
}

function findActualParamName(
  extraParams: Record<string, unknown>,
  candidates: string[],
): string | undefined {
  const upstreamParamNames = new Set(
    toStringArray(extraParams.upstream_param_names).map((item) => item.toLowerCase())
  );

  for (const candidate of candidates) {
    if (upstreamParamNames.has(candidate.toLowerCase())) {
      return candidate;
    }
  }

  for (const candidate of candidates) {
    if (getLingkeParamEntries(extraParams, candidate).length > 0) {
      return candidate;
    }
  }

  for (const candidate of candidates) {
    if (getLingkeDefaultDynamicValue(extraParams, candidate) !== undefined) {
      return candidate;
    }
  }

  return undefined;
}

function resolveOptionEntryValue(
  entries: LingkeParamOptionEntry[],
  candidates: unknown[],
): string | undefined {
  const tryMatch = (candidate: unknown): string | undefined => {
    const normalized = normalizeLower(candidate);
    if (!normalized) return undefined;

    if (entries.length === 0) {
      return normalizeString(candidate) || undefined;
    }

    const matched = entries.find((entry) => (
      entry.value.toLowerCase() === normalized || entry.label.toLowerCase() === normalized
    ));
    if (matched) return matched.value;

    const candidateDigits = String(candidate ?? '').match(/(\d+)/)?.[1] || '';
    if (!candidateDigits) return undefined;
    const byDigits = entries.find((entry) => (
      entry.value.match(/(\d+)/)?.[1] === candidateDigits
      || entry.label.match(/(\d+)/)?.[1] === candidateDigits
    ));
    return byDigits?.value;
  };

  for (const candidate of candidates) {
    const matched = tryMatch(candidate);
    if (matched !== undefined) return matched;
  }

  return entries[0]?.value;
}

function resolveBooleanValue(candidates: unknown[]): boolean | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === 'boolean') return candidate;

    const normalized = normalizeLower(candidate);
    if (!normalized) continue;
    if (['true', '1', 'yes', 'on', 'enable', 'enabled'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off', 'disable', 'disabled'].includes(normalized)) return false;
  }

  return undefined;
}

function normalizeOptionEntries(entries: LingkeParamOptionEntry[]): Array<{ value: string; label: string; description?: string }> {
  return entries.map((entry) => ({
    value: entry.value,
    label: entry.label,
    ...(entry.description ? { description: entry.description } : {}),
  }));
}

function deleteConfigKey(
  config: VideoConfigObject,
  key: keyof Pick<VideoConfigObject, 'generation_mode' | 'quality_version' | 'model_version' | 'version' | 'off_peak'>,
) {
  delete (config as Record<string, unknown>)[key];
}

export function sanitizeLingkeVideoConfigObject(
  videoConfigObject?: VideoConfigObject,
): VideoConfigObject | undefined {
  if (!videoConfigObject) return videoConfigObject;

  const extraParams = cloneExtraParams(videoConfigObject.extra_params);
  if (!hasLingkeRuntimeMetadata(extraParams)) {
    return videoConfigObject;
  }

  const nextConfig: VideoConfigObject = {
    ...videoConfigObject,
    extra_params: extraParams,
  };

  const topLevelFields: Array<{
    key: 'generation_mode' | 'quality_version' | 'model_version' | 'version';
    optionKey: 'generation_mode_options' | 'quality_version_options' | 'model_version_options' | 'version_options';
    paramNames: string[];
  }> = [
    {
      key: 'generation_mode',
      optionKey: 'generation_mode_options',
      paramNames: ['generation_mode', 'mode'],
    },
    {
      key: 'quality_version',
      optionKey: 'quality_version_options',
      paramNames: ['quality_version'],
    },
    {
      key: 'model_version',
      optionKey: 'model_version_options',
      paramNames: ['model_version', 'model_variant'],
    },
    {
      key: 'version',
      optionKey: 'version_options',
      paramNames: ['version'],
    },
  ];

  for (const field of topLevelFields) {
    const actualParamName = findActualParamName(extraParams, field.paramNames);
    const optionEntries = actualParamName ? getLingkeParamEntries(extraParams, actualParamName) : [];

    if (optionEntries.length > 0) {
      extraParams[field.optionKey] = normalizeOptionEntries(optionEntries);
    } else {
      delete extraParams[field.optionKey];
    }

    if (!actualParamName) {
      deleteConfigKey(nextConfig, field.key);
      continue;
    }

    const resolvedValue = resolveOptionEntryValue(optionEntries, [
      nextConfig[field.key],
      getLingkeDefaultDynamicValue(extraParams, actualParamName),
      ...field.paramNames.map((paramName) => getLingkeDefaultDynamicValue(extraParams, paramName)),
    ]);

    if (resolvedValue && resolvedValue.trim()) {
      nextConfig[field.key] = resolvedValue;
    } else {
      deleteConfigKey(nextConfig, field.key);
    }

    const aliasKey = `${field.key}_param_name`;
    if (actualParamName !== field.key) {
      extraParams[aliasKey] = actualParamName;
    } else {
      delete extraParams[aliasKey];
    }
  }

  const offPeakParamName = findActualParamName(extraParams, ['off_peak']);
  if (!offPeakParamName) {
    deleteConfigKey(nextConfig, 'off_peak');
  } else {
    const resolvedOffPeak = resolveBooleanValue([
      nextConfig.off_peak,
      getLingkeDefaultDynamicValue(extraParams, offPeakParamName),
      getLingkeDefaultDynamicValue(extraParams, 'off_peak'),
    ]);
    if (typeof resolvedOffPeak === 'boolean') {
      nextConfig.off_peak = resolvedOffPeak;
    } else {
      deleteConfigKey(nextConfig, 'off_peak');
    }
  }

  return nextConfig;
}

export function sanitizeLingkeVideoModelConfig(model: VideoModel): VideoModel {
  const nextVideoConfigObject = sanitizeLingkeVideoConfigObject(model.videoConfigObject);
  if (nextVideoConfigObject === model.videoConfigObject) {
    return model;
  }

  return {
    ...model,
    videoConfigObject: nextVideoConfigObject,
  };
}
