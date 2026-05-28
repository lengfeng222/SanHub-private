'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { signIn, useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Loader2, ArrowRight } from 'lucide-react';
import { BrandMark } from '@/components/brand/brand-mark';
import { Captcha } from '@/components/ui/captcha';
import { AnimatedBackground } from '@/components/ui/animated-background';
import { useSiteConfig } from '@/components/providers/site-config-provider';

const AUTH_BRAND_NAME = '幻途';
const inputClassName =
  'h-12 w-full rounded-xl border border-white/[0.07] bg-[#171b21]/90 px-4 text-sm text-foreground placeholder:text-foreground/30 outline-none transition-colors focus:border-white/15 focus:ring-2 focus:ring-white/10';
const labelClassName = 'text-xs text-foreground/42';
const captchaInputClassName =
  'h-12 min-w-0 flex-1 rounded-xl border border-white/[0.07] bg-[#171b21]/90 px-4 text-sm uppercase tracking-widest text-foreground placeholder:normal-case placeholder:tracking-normal placeholder:text-foreground/30 outline-none transition-colors focus:border-white/15 focus:ring-2 focus:ring-white/10';
const captchaImageClassName = 'h-12 w-[120px] cursor-pointer overflow-hidden rounded-xl border border-white/[0.07] bg-[#101419]';
const captchaButtonClassName =
  'flex h-12 w-12 items-center justify-center rounded-xl border border-white/[0.07] bg-[#11151a]/80 transition-colors hover:bg-[#171b21] disabled:opacity-50';

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawCallbackUrl = searchParams.get('callbackUrl');
  const callbackUrl = rawCallbackUrl?.startsWith('/') && !rawCallbackUrl.startsWith('//') ? rawCallbackUrl : '/supervideo';
  const { data: session, status, update } = useSession();
  const siteConfig = useSiteConfig();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [captchaId, setCaptchaId] = useState('');
  const [captchaCode, setCaptchaCode] = useState('');
  const [captchaKey, setCaptchaKey] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [loginSuccess, setLoginSuccess] = useState(false);
  const redirectingRef = useRef(false);

  useEffect(() => {
    if ((status === 'authenticated' && session) || loginSuccess) {
      if (redirectingRef.current) return;
      redirectingRef.current = true;
      router.push(callbackUrl);
    }
  }, [status, session, loginSuccess, router, callbackUrl]);

  const handleCaptchaChange = useCallback((id: string, code: string) => {
    setCaptchaId(id);
    setCaptchaCode(code);
  }, []);

  if (status === 'authenticated') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-foreground/50">正在跳转...</div>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!captchaCode || captchaCode.length !== 4) {
      setError('请输入4位验证码');
      return;
    }

    setLoading(true);

    try {
      const captchaRes = await fetch('/api/captcha/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: captchaId, code: captchaCode }),
      });

      const captchaData = await captchaRes.json();
      if (!captchaData.success) {
        setError('验证码错误');
        setCaptchaKey((key) => key + 1);
        setLoading(false);
        return;
      }

      const result = await signIn('credentials', {
        email,
        password,
        redirect: false,
      });

      if (result?.error) {
        setError(result.error);
        setCaptchaKey((key) => key + 1);
      } else if (result?.ok) {
        await update();
        setLoginSuccess(true);
      }
    } catch {
      setError('登录失败，请重试');
      setCaptchaKey((key) => key + 1);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden text-foreground">
      <AnimatedBackground variant="auth" />

      <main className="relative z-10 flex flex-1 flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm space-y-8">
          <div className="text-center">
            <Link href="/" className="inline-flex flex-col items-center gap-4 group">
              <BrandMark
                size={40}
                rounded="rounded-xl"
                className="border-white/15 shadow-[0_0_35px_rgba(56,189,248,0.22)] transition-transform group-hover:scale-105"
              />
              <h1 className="text-[2rem] font-light leading-none tracking-[-0.04em] text-foreground/90">{AUTH_BRAND_NAME}</h1>
            </Link>
            <p className="mt-5 text-sm text-foreground/34">欢迎回来</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <label className={labelClassName}>邮箱</label>
              <input
                type="email"
                placeholder="your@email.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                className={inputClassName}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className={labelClassName}>密码</label>
                <Link href="/forgot-password" className="text-xs text-foreground/42 transition-colors hover:text-foreground/80">
                  忘记密码？
                </Link>
              </div>
              <input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                className={inputClassName}
              />
            </div>

            <Captcha
              key={captchaKey}
              onCaptchaChange={handleCaptchaChange}
              labelClassName={labelClassName}
              inputClassName={captchaInputClassName}
              imageClassName={captchaImageClassName}
              buttonClassName={captchaButtonClassName}
            />

            {error && (
              <div className="rounded-xl border border-red-500/25 bg-red-500/10 p-3">
                <p className="text-sm text-red-300">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-3 rounded-full bg-foreground px-6 py-3.5 font-medium text-background shadow-[0_18px_55px_rgba(255,255,255,0.08)] transition-all hover:scale-[1.01] hover:bg-foreground/92 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  登录中...
                </>
              ) : (
                <>
                  登录
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </form>

          <div className="text-center text-sm">
            <span className="text-foreground/36">还没有账号？</span>{' '}
            <Link href="/register" className="text-foreground/78 transition-colors hover:text-foreground">
              立即注册
            </Link>
          </div>
        </div>
      </main>

      <footer className="relative z-10 pb-8 text-center">
        <p className="text-xs tracking-wide text-foreground/24">{siteConfig.copyright}</p>
      </footer>
    </div>
  );
}
