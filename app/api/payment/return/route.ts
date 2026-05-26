import { NextResponse } from 'next/server';
import { getSystemConfig } from '@/lib/db';
import { markPaymentOrderPaid } from '@/lib/db-payments';
import { verifyEpaySign } from '@/lib/epay';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const params: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    params[key] = value;
  });

  try {
    const config = await getSystemConfig();
    if (verifyEpaySign(params, config.paymentProvider.key || '') && params.out_trade_no) {
      const status = params.trade_status || params.status || '';
      if (status === 'TRADE_SUCCESS' || status === 'TRADE_FINISHED' || status === 'success') {
        await markPaymentOrderPaid(params.out_trade_no, params.trade_no || '');
      }
    }
  } catch (error) {
    console.error('[Payment] return handling failed:', error);
  }

  return NextResponse.redirect(new URL(`/recharge?out_trade_no=${params.out_trade_no || ''}`, request.url));
}

