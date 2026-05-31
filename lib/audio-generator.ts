/* eslint-disable no-console */

import { getSystemConfig } from '@/lib/db';

type AudioKind = 'music' | 'voice';

export interface AudioGenerateRequest {
  kind: AudioKind;
  prompt: string;
  model?: string;
  voice?: string;
  format?: string;
}

export interface AudioGenerateResult {
  url: string;
  mimeType: string;
  model: string;
  voice?: string;
  format?: string;
}

function requireValue(value: string | undefined, label: string): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new Error(`${label} 未配置`);
  return trimmed;
}

function dataUrlFromBuffer(buffer: Buffer, mimeType: string): string {
  return `data:${mimeType};base64,${buffer.toString('base64')}`;
}

function pickString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function pickAudioUrl(value: unknown, depth = 0): string | undefined {
  if (depth > 6 || value === null || value === undefined) return undefined;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('data:audio/')) {
      return trimmed;
    }
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try { return pickAudioUrl(JSON.parse(trimmed), depth + 1); } catch { return undefined; }
    }
    return trimmed.match(/https?:\/\/[^\s"'<>`]+/i)?.[0];
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = pickAudioUrl(item, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['url', 'audio_url', 'audioUrl', 'music_url', 'musicUrl', 'output_url', 'outputUrl', 'file_url', 'fileUrl', 'result_url', 'resultUrl']) {
      const found = pickAudioUrl(record[key], depth + 1);
      if (found) return found;
    }
    const base64 = pickString(record.b64_json) || pickString(record.audio_base64) || pickString(record.base64);
    if (base64) {
      const mimeType = pickString(record.mime_type) || pickString(record.mimeType) || 'audio/mpeg';
      return `data:${mimeType};base64,${base64.replace(/^data:[^;]+;base64,/, '')}`;
    }
    for (const item of Object.values(record)) {
      const found = pickAudioUrl(item, depth + 1);
      if (found) return found;
    }
  }
  return undefined;
}

async function getAudioProviderConfig() {
  const config = await getSystemConfig();
  return config.audioProvider;
}

function shouldUseLingkeMedia(baseUrl: string, endpointPath: string, model: string): boolean {
  const base = (baseUrl || '').toLowerCase();
  const endpoint = (endpointPath || '').toLowerCase();
  const modelId = (model || '').toLowerCase();
  return base.includes('lingkeai.ai')
    || endpoint.includes('/v1/media/generate')
    || modelId.includes('music-2.5')
    || modelId.includes('doubao-tts-2.0')
    || modelId.includes('gemini-2.5-pro-preview-tts')
    || modelId.includes('gemini-3.1-tts')
    || modelId.includes('海螺 音乐生成 2.5+')
    || modelId.includes('豆包 语音合成 2.0')
    || modelId.includes('vidu-音乐mv');
}

function resolveLingkeVoiceModel(model?: string): string {
  const normalized = (model || '').trim();
  if (!normalized) return '豆包 语音合成 2.0';
  if (normalized === 'Gemini-3.1-TTS') return 'gemini-2.5-pro-preview-tts';
  return normalized;
}

function isViduMusicMvModel(model?: string): boolean {
  const normalized = (model || '').trim().toLowerCase();
  return normalized === 'vidu-音乐mv' || normalized === 'vidu music mv' || normalized === 'vidu-music-mv';
}

function resolveLingkeMusicModel(model?: string): string {
  const normalized = (model || '').trim();
  if (!normalized) return '海螺 音乐生成 2.5+';
  return normalized;
}

function normalizeLingkeProviderError(kind: AudioKind, detail: string, model?: string): string {
  const prefix = kind === 'music' ? '音乐模型接口错误' : '语音模型接口错误';
  const safeDetail = String(detail || '').trim();
  if (/insufficient\s+balance/i.test(safeDetail)) {
    return `${prefix}：上游渠道余额不足`;
  }
  if (kind === 'music' && isViduMusicMvModel(model)) {
    if (/参数验证失败/i.test(safeDetail) || /validation/i.test(safeDetail)) {
      return `${prefix}：VIDU-音乐MV 属于视频生成模型，请到「视频生成」页面使用，并上传音频文件后再提交`;
    }
  }
  return `${prefix}: ${safeDetail || '生成失败'}`;
}

function resolveLingkeVoiceParams(model: string, voice?: string, format?: string): Record<string, unknown> {
  if (model === '豆包 语音合成 2.0' || model === 'doubao-tts-2.0') {
    return {
      speaker: voice || 'zh_female_vv_uranus_bigtts',
      speech_rate: '0',
      emotion: 'happy',
      emotion_scale: '4',
      format: format || 'mp3',
    };
  }

  if (model === 'Gemini-3.1-TTS' || model === 'gemini-2.5-pro-preview-tts') {
    return {
      voice_id: voice || 'Zephyr',
      model_version: 'pro',
    };
  }

  return {
    voice_id: voice || 'Zephyr',
    format: format || 'mp3',
  };
}

async function pollLingkeMedia(baseUrl: string, apiKey: string, taskId: string): Promise<any> {
  const statusUrl = `${baseUrl.replace(/\/$/, '')}/v1/media/status?task_id=${encodeURIComponent(taskId)}`;
  for (let i = 0; i < 180; i += 1) {
    const response = await fetch(statusUrl, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`媒体任务查询失败 (${response.status})`);
    }
    const audioUrl = pickAudioUrl((data as any)?.data) || pickAudioUrl(data);
    if (Number((data as any)?.code ?? 0) === 200 && audioUrl) {
      return data;
    }
    const status = String((data as any)?.data?.status || (data as any)?.status || '').toLowerCase();
    if (status === 'failed' || status === 'error' || status === 'cancelled') {
      throw new Error(String((data as any)?.data?.msg || (data as any)?.msg || '音频生成失败'));
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  throw new Error('音频生成超时');
}

async function generateWithLingkeMedia(request: AudioGenerateRequest, baseUrl: string, apiKey: string, rawModel: string): Promise<AudioGenerateResult> {
  const apiUrl = `${baseUrl.replace(/\/$/, '')}/v1/media/generate`;
  const model = request.kind === 'music' ? resolveLingkeMusicModel(rawModel) : resolveLingkeVoiceModel(rawModel);

  if (request.kind === 'music' && isViduMusicMvModel(model)) {
    throw new Error('音乐模型接口错误：VIDU-音乐MV 属于视频生成模型，请到「视频生成」页面使用，并上传音频文件后再提交');
  }

  const params: Record<string, unknown> = request.kind === 'music'
    ? {
        is_instrumental: request.prompt.includes('[主歌') || request.prompt.includes('[Verse') ? 'song' : 'instrumental',
        sample_rate: '44100',
        bitrate: '256000',
      }
    : resolveLingkeVoiceParams(model, request.voice, request.format);

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      prompt: request.prompt,
      params,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || Number((data as any)?.code ?? 0) !== 200) {
    const detail = String((data as any)?.msg || (data as any)?.data?.详情 || (data as any)?.data?.msg || '生成失败');
    const normalizedMessage = normalizeLingkeProviderError(request.kind, detail, model);
    throw new Error(response.ok ? normalizedMessage : `${normalizedMessage} (${response.status})`);
  }

  const directUrl = pickAudioUrl((data as any)?.data) || pickAudioUrl(data);
  if (directUrl) {
    return {
      url: directUrl,
      mimeType: request.format === 'wav' ? 'audio/wav' : 'audio/mpeg',
      model,
      voice: request.voice,
      format: request.format || 'mp3',
    };
  }

  const taskId = pickString((data as any)?.data?.task_id) || String((data as any)?.data?.task_id || '');
  if (!taskId) {
    throw new Error('未返回任务 ID');
  }

  const finalData = await pollLingkeMedia(baseUrl, apiKey, taskId);
  const audioUrl = pickAudioUrl((finalData as any)?.data) || pickAudioUrl(finalData);
  if (!audioUrl) throw new Error('生成成功但未包含音频 URL');

  return {
    url: audioUrl,
    mimeType: request.format === 'wav' ? 'audio/wav' : 'audio/mpeg',
    model,
    voice: request.voice,
    format: request.format || 'mp3',
  };
}

async function generateMusic(request: AudioGenerateRequest): Promise<AudioGenerateResult> {
  const provider = await getAudioProviderConfig();
  const baseUrl = requireValue(provider.musicBaseUrl || process.env.MUSIC_BASE_URL || process.env.AUDIO_BASE_URL, 'MUSIC_BASE_URL');
  const apiKey = requireValue(provider.musicApiKey || process.env.MUSIC_API_KEY || process.env.AUDIO_API_KEY, 'MUSIC_API_KEY');
  const model = request.model || provider.musicModel || process.env.MUSIC_MODEL || 'music-1';
  const endpointPath = provider.musicEndpointPath || process.env.MUSIC_ENDPOINT_PATH || '/v1/audio/generations';

  if (shouldUseLingkeMedia(baseUrl, endpointPath, model)) {
    return generateWithLingkeMedia(request, baseUrl, apiKey, model);
  }

  const url = `${baseUrl.replace(/\/$/, '')}${endpointPath.startsWith('/') ? endpointPath : `/${endpointPath}`}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt: request.prompt, response_format: request.format || 'url' }),
  });

  if (!response.ok) {
    const details = await response.text().catch(() => '');
    throw new Error(`音乐模型接口错误 (${response.status})${details ? `: ${details.slice(0, 300)}` : ''}`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.startsWith('audio/')) {
    const buffer = Buffer.from(await response.arrayBuffer());
    return { url: dataUrlFromBuffer(buffer, contentType.split(';')[0] || 'audio/mpeg'), mimeType: contentType, model };
  }

  const data = await response.json();
  const audioUrl = pickAudioUrl(data);
  if (!audioUrl) throw new Error('音乐模型返回成功但未包含音频 URL 或 base64');
  return { url: audioUrl, mimeType: 'audio/mpeg', model };
}

async function generateVoice(request: AudioGenerateRequest): Promise<AudioGenerateResult> {
  const provider = await getAudioProviderConfig();
  const baseUrl = requireValue(provider.voiceBaseUrl || process.env.VOICE_BASE_URL || process.env.AUDIO_BASE_URL || process.env.OPENAI_BASE_URL, 'VOICE_BASE_URL');
  const apiKey = requireValue(provider.voiceApiKey || process.env.VOICE_API_KEY || process.env.AUDIO_API_KEY || process.env.OPENAI_API_KEY, 'VOICE_API_KEY');
  const model = request.model || provider.voiceModel || process.env.VOICE_MODEL || 'tts-1';
  const voice = request.voice || provider.voiceVoice || process.env.VOICE_VOICE || 'alloy';
  const format = request.format || provider.voiceFormat || process.env.VOICE_FORMAT || 'mp3';
  const endpointPath = provider.voiceEndpointPath || process.env.VOICE_ENDPOINT_PATH || '/v1/audio/speech';

  if (shouldUseLingkeMedia(baseUrl, endpointPath, model)) {
    return generateWithLingkeMedia({ ...request, voice, format }, baseUrl, apiKey, model);
  }

  const url = `${baseUrl.replace(/\/$/, '')}${endpointPath.startsWith('/') ? endpointPath : `/${endpointPath}`}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input: request.prompt, voice, response_format: format }),
  });

  if (!response.ok) {
    const details = await response.text().catch(() => '');
    throw new Error(`语音模型接口错误 (${response.status})${details ? `: ${details.slice(0, 300)}` : ''}`);
  }

  const contentType = response.headers.get('content-type')?.split(';')[0] || (format === 'wav' ? 'audio/wav' : 'audio/mpeg');
  const buffer = Buffer.from(await response.arrayBuffer());
  return { url: dataUrlFromBuffer(buffer, contentType), mimeType: contentType, model, voice, format };
}

export async function generateAudio(request: AudioGenerateRequest): Promise<AudioGenerateResult> {
  if (request.kind === 'music') return generateMusic(request);
  return generateVoice(request);
}
