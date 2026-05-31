import { resolveChatModelImage } from '@/lib/model-images';

export type LingkeSyncedChatModel = {
  name: string;
  modelId: string;
  supportsVision: boolean;
  maxTokens: number;
  costPerMessage: number;
  billingMode: 'per_call';
  billingPrice: number;
  billingUnit: number;
  imageUrl?: string;
};

type LingkeRemoteChatModel = {
  id?: string;
};

const LINGKE_CHAT_VISIBLE_MODELS = [
  ['GPT-5.5 中推理', 'gpt-5.5-medium'],
  ['GPT-5.4 mini', 'gpt-5.4-mini'],
  ['GPT-5.5 低推理', 'gpt-5.5-low'],
  ['GPT-5.4 nano', 'gpt-5.4-nano'],
  ['GPT-5.4', 'gpt-5.4'],
  ['deepseek-v4-pro', 'deepseek-v4-pro'],
  ['GPT-5.3 对话', 'gpt-5.3-chat-latest'],
  ['GPT-5.5', 'gpt-5.5'],
  ['GPT-5.4 深度推理', 'gpt-5.4-xhigh'],
  ['MiniMax-M2.7', 'MiniMax-M2.7'],
  ['千问 3.6 Plus', 'qwen3.6-plus'],
  ['deepseek-v4-flash', 'deepseek-v4-flash'],
  ['grok-4.3', 'grok-4.3'],
  ['opus-4-7', 'claude-opus-4-7'],
  ['grok-4-20', 'grok-4-20-non-reasoning'],
  ['GPT-5.5 深度推理', 'gpt-5.5-xhigh'],
  ['GPT-5.5 高推理', 'gpt-5.5-high'],
  ['Claude Sonnet 4.6', 'claude-sonnet-4-6'],
  ['Claude Haiku 4.5', 'claude-haiku-4-5-20251001'],
  ['Claude Opus 4.6', 'claude-opus-4-6'],
  ['Claude Opus 4.5', 'claude-opus-4-5-20251101'],
  ['Gemini 3.1 Pro Preview', 'gemini-3.1-pro-preview'],
  ['Gemini 3.5 Flash', 'gemini-3.5-flash'],
  ['Gemini 3 Pro Preview', 'gemini-3-pro-preview'],
  ['Gemini 3 Flash Preview', 'gemini-3-flash-preview'],
  ['Mimo V2.5 Pro', 'mimo-v2.5-pro'],
  ['Grok 4.1', 'grok-4.1'],
  ['Grok 4.2', 'grok-4.2'],
  ['GPT-5.2', 'gpt-5.2'],
  ['GPT-5.2 Chat', 'gpt-5.2-chat-latest'],
  ['GPT-5.3 Codex', 'gpt-5.3-codex'],
  ['千问 3.5 Plus', 'qwen3.5-plus'],
  ['千问 3.5 Flash', 'qwen3.5-flash'],
  ['DeepSeek V3.2', 'deepseek-v3.2'],
  ['豆包 Seed 2.0 Pro', 'doubao-seed-2-0-pro-260215'],
  ['豆包 Seed 1.8', 'doubao-seed-1-8-251228'],
] as const;

const DISPLAY_NAME_MAP = new Map<string, string>(
  LINGKE_CHAT_VISIBLE_MODELS.map(([name, modelId]) => [modelId, name])
);

function normalizeName(value: unknown): string {
  return String(value || '').trim();
}

function buildPreset(modelId: string, name?: string): LingkeSyncedChatModel {
  const displayName = normalizeName(name) || DISPLAY_NAME_MAP.get(modelId) || modelId;
  return {
    name: displayName,
    modelId,
    supportsVision: false,
    maxTokens: 128000,
    costPerMessage: 1,
    billingMode: 'per_call',
    billingPrice: 1,
    billingUnit: 1,
    imageUrl: resolveChatModelImage({
      name: displayName,
      modelId,
    }),
  };
}

export function getLingkeFallbackChatModels(): LingkeSyncedChatModel[] {
  return LINGKE_CHAT_VISIBLE_MODELS.map(([name, modelId]) => buildPreset(modelId, name));
}

export async function fetchLingkeRemoteChatModels(
  baseUrl: string,
  apiKey: string,
): Promise<LingkeSyncedChatModel[]> {
  const normalizedBaseUrl = normalizeName(baseUrl).replace(/\/$/, '');
  const normalizedApiKey = normalizeName(apiKey).split(',')[0]?.trim() || '';
  if (!normalizedBaseUrl || !normalizedApiKey) {
    throw new Error('灵刻聊天渠道缺少 Base URL 或 API Key');
  }

  const response = await fetch(`${normalizedBaseUrl}/v1/models`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${normalizedApiKey}`,
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    const details = await response.text().catch(() => '');
    throw new Error(`拉取灵刻聊天模型失败 (${response.status})${details ? `: ${details}` : ''}`);
  }

  const data = await response.json().catch(() => ({}));
  const ids: string[] = Array.from(
    new Set(
      (Array.isArray(data?.data) ? data.data : [])
        .map((item: LingkeRemoteChatModel) => normalizeName(item?.id))
        .filter((value: string): value is string => Boolean(value))
    )
  );

  return ids.map((modelId) => buildPreset(modelId));
}
