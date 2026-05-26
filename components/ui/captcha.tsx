'use client';

import { useState, useEffect, useRef } from 'react';
import { RefreshCw } from 'lucide-react';

interface CaptchaProps {
  onCaptchaChange: (id: string, code: string) => void;
  labelClassName?: string;
  inputClassName?: string;
  imageClassName?: string;
  buttonClassName?: string;
}

export function Captcha({
  onCaptchaChange,
  labelClassName = 'text-sm text-foreground/60 uppercase tracking-wider',
  inputClassName = 'flex-1 px-4 py-3 bg-input/70 border border-border/70 rounded-xl text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-border focus:ring-2 focus:ring-ring/30 transition-colors backdrop-blur-sm uppercase tracking-widest',
  imageClassName = 'h-[46px] w-[120px] rounded-xl overflow-hidden border border-border/70 cursor-pointer bg-card/80',
  buttonClassName = 'p-3 bg-card/60 border border-border/70 rounded-xl hover:bg-card/80 transition-colors disabled:opacity-50',
}: CaptchaProps) {
  const [captchaId, setCaptchaId] = useState('');
  const [captchaSvg, setCaptchaSvg] = useState('');
  const [captchaCode, setCaptchaCode] = useState('');
  const [loading, setLoading] = useState(false);
  
  // 使用 ref 存储回调和状态，完全避免依赖问题
  const callbackRef = useRef(onCaptchaChange);
  const captchaIdRef = useRef('');
  const fetchingRef = useRef(false);
  
  // 更新回调引用
  useEffect(() => {
    callbackRef.current = onCaptchaChange;
  }, [onCaptchaChange]);

  const refreshCaptcha = async () => {
    // 防止并发请求
    if (fetchingRef.current || loading) return;
    fetchingRef.current = true;
    setLoading(true);
    
    try {
      const res = await fetch('/api/captcha', { cache: 'no-store' });
      const data = await res.json();
      if (data.success) {
        setCaptchaId(data.data.id);
        captchaIdRef.current = data.data.id;
        setCaptchaSvg(data.data.svg);
        setCaptchaCode('');
        callbackRef.current(data.data.id, '');
      }
    } catch (error) {
      console.error('Failed to load captcha:', error);
    } finally {
      setLoading(false);
      fetchingRef.current = false;
    }
  };

  // 只在组件首次挂载时加载验证码，使用空依赖数组
  useEffect(() => {
    // 如果已经有验证码了就不再请求
    if (captchaSvg) return;
    refreshCaptcha();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCodeChange = (code: string) => {
    setCaptchaCode(code);
    callbackRef.current(captchaIdRef.current, code);
  };

  return (
    <div className="space-y-2">
      <label className={labelClassName}>验证码</label>
      <div className="flex gap-3">
        <input
          type="text"
          placeholder="请输入验证码"
          value={captchaCode}
          onChange={(e) => handleCodeChange(e.target.value.toUpperCase())}
          maxLength={4}
          required
          className={inputClassName}
        />
        <div className="flex items-center gap-2">
          <div
            className={imageClassName}
            onClick={refreshCaptcha}
            dangerouslySetInnerHTML={{ __html: captchaSvg }}
          />
          <button
            type="button"
            onClick={refreshCaptcha}
            disabled={loading}
            className={buttonClassName}
            title="刷新验证码"
          >
            <RefreshCw className={`w-5 h-5 text-foreground/60 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>
    </div>
  );
}
