'use client';

import { useState } from 'react';
import { Loader2, Mic } from 'lucide-react';

const KIND: 'music' | 'voice' = 'voice';
const VOICE_MODELS = ['豆包 语音合成 2.0', 'Gemini-3.1-TTS'];
const title = '语音';
const description = 'AI 语音生成';
const placeholder = '输入要朗读的文本，例如：欢迎来到幻途，在这里把想象变成内容作品。';
const iconClass = 'text-yellow-300';

export default function AudioPage() {
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState('');
  const [voice, setVoice] = useState('alloy');
  const [format, setFormat] = useState('mp3');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [resultUrl, setResultUrl] = useState('');

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setResultUrl('');

    if (!prompt.trim()) {
      setError('请输入创作内容');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`/api/generate/${KIND}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          model: model || undefined,
          voice: KIND === 'voice' ? voice : undefined,
          format: KIND === 'voice' ? format : undefined,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '生成失败');
      setResultUrl(data.data?.url || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
      <section className="surface p-6 md:p-8">
        <div className="mb-8 flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/[0.07] bg-[#0b0f14]">
            <Mic className={`h-5 w-5 ${iconClass}`} strokeWidth={1.8} />
          </div>
          <div>
            <h1 className="text-3xl font-light tracking-[-0.05em] text-foreground/90">{title}</h1>
            <p className="mt-1 text-sm text-foreground/42">{description}</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <label className="text-xs text-foreground/45">模型 ID（可选，留空使用环境变量默认模型）</label>
            <input
              value={model}
              onChange={(event) => setModel(event.target.value)}
              placeholder={KIND === 'voice' ? '豆包 语音合成 2.0 / Gemini-3.1-TTS / 上游模型名' : 'music-1 / 上游音乐模型名'}
              className="h-12 w-full rounded-xl border border-border/70 bg-input/70 px-4 text-sm outline-none transition focus:border-border focus:ring-2 focus:ring-ring/30"
            />
          </div>

          {KIND === 'voice' && (
            <>
            <div className="space-y-2">
              <label className="text-xs text-foreground/45">快捷模型</label>
              <select
                value={model}
                onChange={(event) => setModel(event.target.value)}
                className="h-12 w-full rounded-xl border border-border/70 bg-input/70 px-4 text-sm outline-none transition focus:border-border focus:ring-2 focus:ring-ring/30"
              >
                <option value="">留空使用后台默认</option>
                {VOICE_MODELS.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="text-xs text-foreground/45">音色</label>
                <input
                  value={voice}
                  onChange={(event) => setVoice(event.target.value)}
                  placeholder="alloy"
                  className="h-12 w-full rounded-xl border border-border/70 bg-input/70 px-4 text-sm outline-none transition focus:border-border focus:ring-2 focus:ring-ring/30"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs text-foreground/45">格式</label>
                <select
                  value={format}
                  onChange={(event) => setFormat(event.target.value)}
                  className="h-12 w-full rounded-xl border border-border/70 bg-input/70 px-4 text-sm outline-none transition focus:border-border focus:ring-2 focus:ring-ring/30"
                >
                  <option value="mp3">mp3</option>
                  <option value="wav">wav</option>
                  <option value="ogg">ogg</option>
                </select>
              </div>
            </div>
            </>
          )}

          <div className="space-y-2">
            <label className="text-xs text-foreground/45">创作内容</label>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder={placeholder}
              rows={9}
              className="w-full resize-none rounded-2xl border border-border/70 bg-input/70 p-4 text-sm leading-6 outline-none transition placeholder:text-foreground/25 focus:border-border focus:ring-2 focus:ring-ring/30"
            />
          </div>

          {error && (
            <div className="rounded-xl border border-red-500/25 bg-red-500/10 p-3 text-sm text-red-300">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="inline-flex h-12 items-center justify-center gap-3 rounded-full bg-foreground px-8 font-medium text-background transition-all hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {loading ? '生成中...' : `生成${title}`}
          </button>
        </form>
      </section>

      <aside className="surface p-6">
        <h2 className="text-lg font-medium text-foreground/90">生成结果</h2>
        <p className="mt-2 text-sm leading-6 text-foreground/45">
          这里会显示模型返回的音频结果。若提示未配置，请在 `.env.local` 或部署环境中填写对应 Base URL 和 API Key。
        </p>

        {resultUrl ? (
          <div className="mt-6 rounded-2xl border border-border/70 bg-background/50 p-4">
            <audio controls src={resultUrl} className="w-full" />
            <a
              href={resultUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-flex text-sm text-foreground/65 hover:text-foreground"
            >
              打开 / 下载音频
            </a>
          </div>
        ) : (
          <div className="mt-6 flex h-56 items-center justify-center rounded-2xl border border-dashed border-border/70 text-sm text-foreground/35">
            暂无结果
          </div>
        )}
      </aside>
    </div>
  );
}
