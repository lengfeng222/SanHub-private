import { NextResponse } from 'next/server';
import { getSystemConfig } from '@/lib/db';
import { markPaymentOrderPaid } from '@/lib/db-payments';
import { verifyEpaySign } from '@/lib/epay';

async function readParams(request: Request): Promise<Record<string, string>> {
  const url = new URL(request.url);
  const params: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    params[key] = value;
  });

  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
    const form = await request.formData();
    form.forEach((value, key) => {
      if (typeof value === 'string') params[key] = value;
    });
  }

  return params;
}

async function handleNotify(request: Request) {
  const params = await readParams(request);
  const config = await getSystemConfig();
  const payment = config.paymentProvider;

  if (!payment.key || !verifyEpaySign(params, payment.key)) {
    console.warn('[Payment] invalid sign', params);
    return new NextResponse('fail', { status: 400 });
  }

  const tradeStatus = params.trade_status || params.status || '';
  if (tradeStatus !== 'TRADE_SUCCESS' && tradeStatus !== 'TRADE_FINISHED' && tradeStatus !== 'success') {
    return new NextResponse('success');
  }

  const outTradeNo = params.out_trade_no;
  if (!outTradeNo) {
    return new NextResponse('fail', { status: 400 });
  }

  await markPaymentOrderPaid(outTradeNo, params.trade_no || '');
  return new NextResponse('success');
}

export async function GET(request: Request) {
  return handleNotify(request);
}

export async function POST(request: Request) {
  return handleNotify(request);
}

