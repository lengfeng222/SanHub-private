type NamedModel = {
  name?: string;
  apiModel?: string;
  modelId?: string;
  imageUrl?: string;
};

const PLACEHOLDER_IMAGES = new Set([
  '',
  '/img/image.png',
  '/img/video.png',
  '/img/admin.png',
  '/img/home.png',
]);

function normalize(value?: string | null) {
  return (value || '').trim();
}

export function isPlaceholderModelImageUrl(value?: string | null) {
  return PLACEHOLDER_IMAGES.has(normalize(value));
}

function providerImageByRaw(raw: string): string | undefined {
  if (/openai|gpt/.test(raw)) return 'https://cos.lingkeai.vip/openai_bai.svg';
  if (/deepseek/.test(raw)) return 'https://cos.lingkeai.vip/deepseek.svg';
  if (/claude|opus|sonnet|haiku/.test(raw)) return 'https://cos.lingkeai.vip/claude.svg';
  if (/grok/.test(raw)) return 'https://cos.lingkeai.vip/Grok_bai.svg';
  if (/gemini|veo/.test(raw)) return 'https://cos.lingkeai.vip/gemini.svg';
  if (/minimax|mimo|海螺/.test(raw)) return 'https://cos.lingkeai.vip/minimax.svg';
  if (/qwen|千问|万相/.test(raw)) return 'https://cos.lingkeai.vip/qwen.svg';
  if (/doubao|豆包|sd 2\.0/.test(raw)) return 'https://cos.lingkeai.vip/doubao.svg';
  if (/vidu/.test(raw)) return 'https://cos.lingkeai.vip/vidu-icon.svg';
  if (/kling|可灵/.test(raw)) return 'https://cos.lingkeai.vip/kling.svg';
  if (/pix/.test(raw)) return 'https://cos.lingkeai.vip/PixVerse.svg';
  if (/happyhorse|快乐马/.test(raw)) return 'https://cos.lingkeai.vip/happyhorse.svg';
  if (/banana|nanobanana/.test(raw)) return '/huantu-logo.jpg';
  if (/sora/.test(raw)) return '/huantu-logo.jpg';
  return undefined;
}

function resolvePreferredImage(model: NamedModel) {
  const raw = `${model.name || ''} ${model.apiModel || ''} ${model.modelId || ''}`.toLowerCase();
  return providerImageByRaw(raw);
}

export function resolveChatModelImage(model: NamedModel) {
  const current = normalize(model.imageUrl);
  if (current && !isPlaceholderModelImageUrl(current) && current !== '/huantu-logo.jpg') {
    return current;
  }
  return resolvePreferredImage(model) || current || '/huantu-logo.jpg';
}

export function resolveImageModelImage(model: NamedModel) {
  const current = normalize(model.imageUrl);
  if (current && !isPlaceholderModelImageUrl(current)) {
    return current;
  }
  return resolvePreferredImage(model) || '/huantu-logo.jpg';
}

export function resolveVideoModelImage(model: NamedModel) {
  const current = normalize(model.imageUrl);
  if (current && !isPlaceholderModelImageUrl(current)) {
    return current;
  }
  return resolvePreferredImage(model) || '/huantu-logo.jpg';
}
