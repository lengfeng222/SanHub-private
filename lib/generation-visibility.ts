import type { Generation } from '@/types';

const HIDDEN_GENERATION_MODEL_ALIASES = new Set([
  'veo3.1-lite',
  'nano banana edit',
]);

const HIDDEN_GENERATION_MODEL_IDS = new Set([
  '9f9e4bdc-7008-4abc-9eb7-aab8809f75b0',
]);

const HIDDEN_GENERATION_ERROR_SNIPPETS = [
  '当前分组下该模型暂未配置渠道',
];

function normalizeCandidate(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function extractGenerationModelCandidates(generation: Generation): string[] {
  const params = generation.params && typeof generation.params === 'object'
    ? generation.params as Record<string, unknown>
    : {};

  return [
    params.model,
    params.modelName,
    params.model_name,
    params.api_model,
    params.apiModel,
  ]
    .map(normalizeCandidate)
    .filter(Boolean);
}

function extractGenerationModelIdCandidates(generation: Generation): string[] {
  const params = generation.params && typeof generation.params === 'object'
    ? generation.params as Record<string, unknown>
    : {};

  return [
    params.modelId,
    params.model_id,
  ]
    .map(normalizeCandidate)
    .filter(Boolean);
}

export function shouldHideGenerationFromUserFeeds(generation: Generation): boolean {
  const modelCandidates = extractGenerationModelCandidates(generation);
  if (modelCandidates.some((candidate) => HIDDEN_GENERATION_MODEL_ALIASES.has(candidate))) {
    return true;
  }

  const modelIdCandidates = extractGenerationModelIdCandidates(generation);
  if (modelIdCandidates.some((candidate) => HIDDEN_GENERATION_MODEL_IDS.has(candidate))) {
    return true;
  }

  const errorMessage = normalizeCandidate(generation.errorMessage);
  if (errorMessage && HIDDEN_GENERATION_ERROR_SNIPPETS.some((snippet) => errorMessage.includes(normalizeCandidate(snippet)))) {
    return true;
  }

  return false;
}
