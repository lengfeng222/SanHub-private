'use client';

import { useEffect, useState } from 'react';
import { CreditCard, Loader2, Save, ShieldCheck, Coins, Link2 } from 'lucide-react';
import type { PaymentProviderConfig, SystemConfig } from '@/types';
import { toast } from '@/components/ui/toaster';

function toPayTypes(value: string) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export default function ManagePaymentPage() {
  const [config, setConfig] = useState<PaymentProviderConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/admin/settings', { cache: 'no-store' });
        const data = await res.json();
        if (res.ok) {
          setConfig(data.data.paymentProvider);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function save() {
    if (!config) return;
    setSaving(true);
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentProvider: config }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '保存失败');
      setConfig(data.data.paymentProvider);
      toast({ title: '易支付配置已保存' });
    } catch (error) {
      toast({
        title: '保存失败',
        description: error instanceof Error ? error.message : '未知错误',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-white/30" />
      </div>
    );
  }

  if (!config) {
    return <div className="py-10 text-center text-white/50">支付配置加载失败</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-[-0.04em] text-white">易支付配置</h1>
          <p className="mt-2 text-sm text-white/45">这里单独管理充值开关、商户参数、回调地址和积分比例。</p>
        </div>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-2xl bg-white px-4 py-2.5 text-sm font-medium text-black disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          保存配置
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-[24px] border border-white/10 bg-[#10141c]/90 p-5">
          <div className="flex items-center gap-2 text-white"><ShieldCheck className="h-4 w-4 text-emerald-300" />在线充值</div>
          <button
            type="button"
            onClick={() => setConfig((prev) => (prev ? { ...prev, enabled: !prev.enabled } : prev))}
            className={`mt-4 inline-flex rounded-full px-4 py-2 text-sm ${config.enabled ? 'bg-emerald-500/18 text-emerald-300' : 'bg-white/8 text-white/55'}`}
          >
            {config.enabled ? '已开启' : '已关闭'}
          </button>
        </div>
        <div className="rounded-[24px] border border-white/10 bg-[#10141c]/90 p-5">
          <div className="flex items-center gap-2 text-white"><Coins className="h-4 w-4 text-yellow-300" />积分比例</div>
          <div className="mt-3 text-3xl font-semibold text-white">1:{config.pointRate}</div>
        </div>
        <div className="rounded-[24px] border border-white/10 bg-[#10141c]/90 p-5">
          <div className="flex items-center gap-2 text-white"><CreditCard className="h-4 w-4 text-sky-300" />最低充值</div>
          <div className="mt-3 text-3xl font-semibold text-white">{config.minAmount} 元</div>
        </div>
      </div>

      <div className="rounded-[28px] border border-white/10 bg-[#10141c]/90 p-6">
        <div className="mb-5 flex items-center gap-2 text-white">
          <CreditCard className="h-4 w-4" />
          基础参数
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <input
            value={config.apiUrl}
            onChange={(e) => setConfig({ ...config, apiUrl: e.target.value })}
            placeholder="易支付接口地址，例如 https://vip1.zhunfu.cn/"
            className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-white placeholder:text-white/25 focus:outline-none"
          />
          <input
            value={config.pid}
            onChange={(e) => setConfig({ ...config, pid: e.target.value })}
            placeholder="商户 PID"
            className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-white placeholder:text-white/25 focus:outline-none"
          />
          <input
            value={config.key}
            onChange={(e) => setConfig({ ...config, key: e.target.value })}
            placeholder="商户 Key"
            className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-white placeholder:text-white/25 focus:outline-none"
          />
          <input
            value={config.payTypes.join(',')}
            onChange={(e) => setConfig({ ...config, payTypes: toPayTypes(e.target.value) })}
            placeholder="支付方式：alipay,wxpay"
            className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-white placeholder:text-white/25 focus:outline-none"
          />
        </div>
      </div>

      <div className="rounded-[28px] border border-white/10 bg-[#10141c]/90 p-6">
        <div className="mb-5 flex items-center gap-2 text-white">
          <Link2 className="h-4 w-4" />
          回调与积分
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <input
            value={config.notifyUrl}
            onChange={(e) => setConfig({ ...config, notifyUrl: e.target.value })}
            placeholder="异步通知地址，留空自动使用 /api/payment/notify"
            className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-white placeholder:text-white/25 focus:outline-none"
          />
          <input
            value={config.returnUrl}
            onChange={(e) => setConfig({ ...config, returnUrl: e.target.value })}
            placeholder="同步跳转地址，留空自动回到 /recharge"
            className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-white placeholder:text-white/25 focus:outline-none"
          />
          <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
            <span className="text-sm text-white/55">每 1 元</span>
            <input
              type="number"
              min="1"
              value={config.pointRate}
              onChange={(e) => setConfig({ ...config, pointRate: Math.max(1, Number(e.target.value) || 1) })}
              className="w-full bg-transparent text-white focus:outline-none"
            />
            <span className="text-sm text-white/55">积分</span>
          </div>
          <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
            <span className="text-sm text-white/55">最低</span>
            <input
              type="number"
              min="1"
              value={config.minAmount}
              onChange={(e) => setConfig({ ...config, minAmount: Math.max(1, Number(e.target.value) || 1) })}
              className="w-full bg-transparent text-white focus:outline-none"
            />
            <span className="text-sm text-white/55">元</span>
          </div>
        </div>
      </div>
    </div>
  );
}
