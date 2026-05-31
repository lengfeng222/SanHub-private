import type { ImageChannel, ImageModel, VideoChannel, VideoModel } from '@/types';
import {
  getImageChannels,
  getImageModels,
  getVideoChannels,
  getVideoModels,
} from '@/lib/db';
import { getLingkeImageAliases } from '@/lib/lingke-image-sync';
import { getLingkeVideoAliases } from '@/lib/lingke-video-sync';

type ResolvedImageModelConfig = {
  model: ImageModel;
  channel: ImageChannel;
  effectiveBaseUrl: string;
  effectiveApiKey: string;
};

type ResolvedVideoModelConfig = {
  model: VideoModel;
  channel: VideoChannel;
  effectiveBaseUrl: string;
  effectiveApiKey: string;
};

type LookupInput = {
  modelId?: string | null;
  model?: string | null;
  apiModel?: string | null;
};

const VIDEO_MODEL_LOOKUP_BRIDGES: Record<string, string[]> = {
  '9f9e4bdc-7008-4abc-9eb7-aab8809f75b0': ['veo3.1'],
  'veo3.1-lite': ['veo3.1'],
  'veo 3.1 lite': ['veo3.1'],
  'veo_3_1_t2v_lite_landscape': ['veo3.1'],
  'veo_3_1_t2v_lite_portrait': ['veo3.1'],
  'veo_3_1_i2v_lite_landscape': ['veo3.1'],
  'veo_3_1_i2v_lite_portrait': ['veo3.1'],
  'veo_3_1_interpolation_lite_landscape': ['veo3.1'],
  'veo_3_1_interpolation_lite_portrait': ['veo3.1'],
};

function normalizeToken(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function normalizeLooseToken(value: unknown): string {
  return normalizeToken(value).replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, '');
}

function dedupeStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = String(value || '').trim();
    if (!normalized) continue;
    const lowered = normalized.toLowerCase();
    if (seen.has(lowered)) continue;
    seen.add(lowered);
    result.push(normalized);
  }

  return result;
}

function buildLookupTerms(
  values: Array<string | null | undefined>,
  aliasExpander: (...items: Array<string | null | undefined>) => string[],
  bridges?: Record<string, string[]>,
): string[] {
  const direct = dedupeStrings(values);
  const expanded = [...direct];

  for (const value of direct) {
    expanded.push(...aliasExpander(value));

    const bridged = bridges?.[normalizeToken(value)] || [];
    if (bridged.length > 0) {
      expanded.push(...bridged);
      expanded.push(...aliasExpander(...bridged));
    }
  }

  return dedupeStrings(expanded);
}

function buildExactLookupSet(values: string[]): Set<string> {
  return new Set(values.map((value) => normalizeToken(value)).filter(Boolean));
}

function buildLooseLookupSet(values: string[]): Set<string> {
  return new Set(values.map((value) => normalizeLooseToken(value)).filter(Boolean));
}

function pickImageChannel(
  channels: ImageChannel[],
  channelId: string,
  requireEnabled: boolean,
): ImageChannel | null {
  const exact = channels.find((channel) => channel.id === channelId);
  if (exact && (!requireEnabled || exact.enabled)) {
    return exact;
  }

  const enabledChannels = channels.filter((channel) => channel.enabled);
  if (enabledChannels.length === 1) {
    return enabledChannels[0] || null;
  }

  if (!requireEnabled && channels.length === 1) {
    return channels[0] || null;
  }

  return null;
}

function pickVideoChannel(
  channels: VideoChannel[],
  channelId: string,
  requireEnabled: boolean,
): VideoChannel | null {
  const exact = channels.find((channel) => channel.id === channelId);
  if (exact && (!requireEnabled || exact.enabled)) {
    return exact;
  }

  const enabledChannels = channels.filter((channel) => channel.enabled);
  if (enabledChannels.length === 1) {
    return enabledChannels[0] || null;
  }

  if (!requireEnabled && channels.length === 1) {
    return channels[0] || null;
  }

  return null;
}

function toResolvedImageModelConfig(
  model: ImageModel,
  channels: ImageChannel[],
  requireEnabled: boolean,
): ResolvedImageModelConfig | null {
  const channel = pickImageChannel(channels, model.channelId, requireEnabled);
  if (!channel) return null;
  if (requireEnabled && (!model.enabled || !channel.enabled)) return null;

  return {
    model,
    channel,
    effectiveBaseUrl: model.baseUrl || channel.baseUrl,
    effectiveApiKey: model.apiKey || channel.apiKey,
  };
}

function toResolvedVideoModelConfig(
  model: VideoModel,
  channels: VideoChannel[],
  requireEnabled: boolean,
): ResolvedVideoModelConfig | null {
  const channel = pickVideoChannel(channels, model.channelId, requireEnabled);
  if (!channel) return null;
  if (requireEnabled && (!model.enabled || !channel.enabled)) return null;

  return {
    model,
    channel,
    effectiveBaseUrl: model.baseUrl || channel.baseUrl,
    effectiveApiKey: model.apiKey || channel.apiKey,
  };
}

function scoreLookupMatch(
  directTerms: string[],
  aliasTerms: string[],
  lookupExact: Set<string>,
  lookupLoose: Set<string>,
): number {
  let score = 0;

  for (const term of directTerms) {
    const normalized = normalizeToken(term);
    if (normalized && lookupExact.has(normalized)) {
      score = Math.max(score, 500);
    }

    const loose = normalizeLooseToken(term);
    if (loose && lookupLoose.has(loose)) {
      score = Math.max(score, 420);
    }
  }

  for (const term of aliasTerms) {
    const normalized = normalizeToken(term);
    if (normalized && lookupExact.has(normalized)) {
      score = Math.max(score, 360);
    }

    const loose = normalizeLooseToken(term);
    if (loose && lookupLoose.has(loose)) {
      score = Math.max(score, 300);
    }
  }

  return score;
}

function scoreImageModelMatch(
  model: ImageModel,
  lookupExact: Set<string>,
  lookupLoose: Set<string>,
): number {
  const direct = dedupeStrings([model.id, model.name, model.apiModel]);
  const aliases = getLingkeImageAliases(model.name, model.apiModel);
  return scoreLookupMatch(direct, aliases, lookupExact, lookupLoose);
}

function scoreVideoModelMatch(
  model: VideoModel,
  lookupExact: Set<string>,
  lookupLoose: Set<string>,
): number {
  const direct = dedupeStrings([model.id, model.name, model.apiModel]);
  const aliases = getLingkeVideoAliases(model.name, model.apiModel);
  return scoreLookupMatch(direct, aliases, lookupExact, lookupLoose);
}

export async function resolveImageModelWithChannelSelection(
  input: LookupInput,
): Promise<ResolvedImageModelConfig | null> {
  const directModelId = String(input.modelId || '').trim();

  const [models, channels] = await Promise.all([
    getImageModels(false),
    getImageChannels(false),
  ]);

  if (directModelId) {
    const directModel = models.find((model) => model.id === directModelId);
    if (directModel) {
      const resolved = toResolvedImageModelConfig(directModel, channels, false);
      if (resolved) {
        return resolved;
      }
    }
  }

  const lookupTerms = buildLookupTerms(
    [input.modelId, input.model, input.apiModel],
    (...items) => getLingkeImageAliases(...items),
  );
  const lookupExact = buildExactLookupSet(lookupTerms);
  const lookupLoose = buildLooseLookupSet(lookupTerms);

  if (lookupExact.size === 0 && lookupLoose.size === 0) {
    return null;
  }

  const ranked = models
    .map((model) => ({
      model,
      score: scoreImageModelMatch(model, lookupExact, lookupLoose),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      if (Boolean(right.model.enabled) !== Boolean(left.model.enabled)) {
        return Number(Boolean(right.model.enabled)) - Number(Boolean(left.model.enabled));
      }
      return left.model.sortOrder - right.model.sortOrder;
    });

  for (const candidate of ranked) {
    const resolved = toResolvedImageModelConfig(candidate.model, channels, true);
    if (resolved) {
      return resolved;
    }
  }

  return null;
}

export async function resolveVideoModelWithChannelSelection(
  input: LookupInput,
): Promise<ResolvedVideoModelConfig | null> {
  const directModelId = String(input.modelId || '').trim();

  const [models, channels] = await Promise.all([
    getVideoModels(false),
    getVideoChannels(false),
  ]);

  if (directModelId) {
    const directModel = models.find((model) => model.id === directModelId);
    if (directModel) {
      const resolved = toResolvedVideoModelConfig(directModel, channels, false);
      if (resolved) {
        return resolved;
      }
    }
  }

  const lookupTerms = buildLookupTerms(
    [input.modelId, input.model, input.apiModel],
    (...items) => getLingkeVideoAliases(...items),
    VIDEO_MODEL_LOOKUP_BRIDGES,
  );
  const lookupExact = buildExactLookupSet(lookupTerms);
  const lookupLoose = buildLooseLookupSet(lookupTerms);

  if (lookupExact.size === 0 && lookupLoose.size === 0) {
    return null;
  }

  const ranked = models
    .map((model) => ({
      model,
      score: scoreVideoModelMatch(model, lookupExact, lookupLoose),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      if (Boolean(right.model.enabled) !== Boolean(left.model.enabled)) {
        return Number(Boolean(right.model.enabled)) - Number(Boolean(left.model.enabled));
      }
      return left.model.sortOrder - right.model.sortOrder;
    });

  for (const candidate of ranked) {
    const resolved = toResolvedVideoModelConfig(candidate.model, channels, true);
    if (resolved) {
      return resolved;
    }
  }

  return null;
}
