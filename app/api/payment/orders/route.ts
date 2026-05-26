import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSystemConfig } from '@/lib/db';
import { createPaymentOrder, getUserPaymentOrders } from '@/lib/db-payments';
import { buildEpaySubmitUrl, getBaseUrlFromRequest } from '@/lib/epay';

function normalizeAmount(value: unknown): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 100) / 100;
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: '请先登录' }, { status: 401 });
  }

  const orders = await getUserPaymentOrders(session.user.id, 30);
  return NextResponse.json({ success: true, data: orders });
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 });
    }

    const config = await getSystemConfig();
    const payment = config.paymentProvider;
    if (!payment.enabled || !payment.pid || !payment.key) {
      return NextResponse.json({ error: '支付暂未开启，请先在后台配置易支付' }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const amount = normalizeAmount(body.amount);
    const payType = typeof body.payType === 'string' ? body.payType : 'alipay';
    if (!payment.payTypes.includes(payType)) {
      return NextResponse.json({ error: '不支持的支付方式' }, { status: 400 });
    }
    if (amount < payment.minAmount) {
      return NextResponse.json({ error: `最低充值 ${payment.minAmount} 元` }, { status: 400 });
    }

    const points = Math.floor(amount * payment.pointRate);
    if (points <= 0) {
      return NextResponse.json({ error: '充值金额无效' }, { status: 400 });
    }

    const order = await createPaymentOrder({
      userId: session.user.id,
      amount,
      points,
      payType,
    });

    const baseUrl = getBaseUrlFromRequest(request);
    const notifyUrl = payment.notifyUrl || `${baseUrl}/api/payment/notify`;
    const returnUrl = payment.returnUrl || `${baseUrl}/recharge?out_trade_no=${order.outTradeNo}`;
    const payUrl = buildEpaySubmitUrl(payment.apiUrl, {
      pid: payment.pid,
      type: payType,
      out_trade_no: order.outTradeNo,
      notify_url: notifyUrl,
      return_url: returnUrl,
      name: `积分充值 ${order.points} 积分`,
      money: order.amount.toFixed(2),
    }, payment.key);

    return NextResponse.json({ success: true, data: { order, payUrl } });
  } catch (error) {
    console.error('[Payment] create order failed:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : '创建支付订单失败' }, { status: 500 });
  }
}

