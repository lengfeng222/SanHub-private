'use client';

import { useState, useCallback, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Loader2, ArrowRight, Gift } from 'lucide-react';
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

export default function RegisterPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const siteConfig = useSiteConfig();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [captchaId, setCaptchaId] = useState('');
  const [captchaCode, setCaptchaCode] = useState('');
  const [captchaKey, setCaptchaKey] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sendingEmailCode, setSendingEmailCode] = useState(false);
  const [emailCodeMessage, setEmailCodeMessage] = useState('');
  const [emailCodeCooldown, setEmailCodeCooldown] = useState(0);

  const defaultBalance = 50;

  useEffect(() => {
    if (status === 'authenticated' && session) {
      router.replace('/supervideo');
    }
  }, [status, session, router]);

  const handleCaptchaChange = useCallback((id: string, code: string) => {
    setCaptchaId(id);
    setCaptchaCode(code);
  }, []);

  useEffect(() => {
    if (emailCodeCooldown <= 0) return;
    const timer = window.setTimeout(() => setEmailCodeCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [emailCodeCooldown]);

  if (status === 'authenticated') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-foreground/50">正在跳转...</div>
      </div>
    );
  }

  const handleSendEmailCode = async () => {
    setError('');
    setEmailCodeMessage('');

    if (!email) {
      setError('请先输入邮箱');
      return;
    }

    setSendingEmailCode(true);
    try {
      const res = await fetch('/api/auth/email-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '发送失败');
      setEmailCodeMessage(data.message || '验证码已发送，请查看邮箱');
      setEmailCodeCooldown(60);
    } catch (err) {
      setError(err instanceof Error ? err.message : '验证码发送失败');
    } finally {
      setSendingEmailCode(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('两次密码输入不一致');
      return;
    }

    if (password.length < 6) {
      setError('密码至少需要 6 个字符');
      return;
    }

    if (!captchaCode || captchaCode.length !== 4) {
      setError('请输入4位验证码');
      return;
    }

    if (!emailCode || emailCode.trim().length < 4) {
      setError('请输入邮箱验证码');
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

      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password, emailCode }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || '注册失败');
      }

      router.push('/login?registered=true&callbackUrl=%2Fsupervideo');
    } catch (err) {
      setError(err instanceof Error ? err.message : '注册失败，请重试');
      setCaptchaKey((key) => key + 1);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden text-foreground">
      <AnimatedBackground variant="auth" />

      <main className="relative z-10 flex flex-1 flex-col items-center justify-center px-6 py-10">
        <div className="w-full max-w-sm space-y-6">
          <div className="text-center">
            <Link href="/" className="inline-flex flex-col items-center gap-4 group">
              <BrandMark
                size={40}
                rounded="rounded-xl"
                className="border-white/15 shadow-[0_0_35px_rgba(56,189,248,0.22)] transition-transform group-hover:scale-105"
              />
              <h1 className="text-[2rem] font-light leading-none tracking-[-0.04em] text-foreground/90">{AUTH_BRAND_NAME}</h1>
            </Link>
            <p className="mt-5 text-sm text-foreground/34">创建账号，开启创作之旅</p>
          </div>

          <div className="mx-auto flex w-fit items-center gap-2 rounded-full border border-teal-300/10 bg-teal-400/10 px-5 py-2.5 text-sm text-foreground/72 backdrop-blur-sm">
            <Gift className="h-4 w-4 text-sky-300" />
            <span>新用户赠送 <span className="font-medium text-foreground">{defaultBalance}</span> 积分</span>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label className={labelClassName}>昵称</label>
              <input
                type="text"
                placeholder="您的昵称"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                className={inputClassName}
              />
            </div>

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
              <label className={labelClassName}>邮箱验证码</label>
              <div className="flex gap-3">
                <input
                  type="text"
                  placeholder="输入邮箱验证码"
                  value={emailCode}
                  onChange={(event) => setEmailCode(event.target.value)}
                  required
                  className="h-12 min-w-0 flex-1 rounded-xl border border-white/[0.07] bg-[#171b21]/90 px-4 text-sm text-foreground placeholder:text-foreground/30 outline-none transition-colors focus:border-white/15 focus:ring-2 focus:ring-white/10"
                />
                <button
                  type="button"
                  onClick={handleSendEmailCode}
                  disabled={sendingEmailCode || emailCodeCooldown > 0}
                  className="h-12 shrink-0 rounded-xl border border-white/[0.07] bg-[#11151a]/80 px-4 text-xs text-foreground/55 transition-colors hover:bg-[#171b21] hover:text-foreground/80 disabled:opacity-50"
                >
                  {sendingEmailCode ? '发送中...' : emailCodeCooldown > 0 ? `${emailCodeCooldown}s` : '发送验证码'}
                </button>
              </div>
              {emailCodeMessage && <p className="text-xs text-foreground/34">{emailCodeMessage}</p>}
            </div>

            <div className="space-y-2">
              <label className={labelClassName}>密码</label>
              <input
                type="password"
                placeholder="至少 6 个字符"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                className={inputClassName}
              />
            </div>

            <div className="space-y-2">
              <label className={labelClassName}>确认密码</label>
              <input
                type="password"
                placeholder="再次输入密码"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
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
                  注册中...
                </>
              ) : (
                <>
                  创建账号
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </form>

          <div className="text-center text-sm">
            <span className="text-foreground/36">已有账号？</span>{' '}
            <Link href="/login" className="text-foreground/78 transition-colors hover:text-foreground">
              立即登录
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
