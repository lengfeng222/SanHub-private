import { NextResponse } from 'next/server';
import { assertEmailCodeRateLimit, sendRegisterEmailCode } from '@/lib/email-verification';

export async function POST(request: Request) {
  try {
    assertEmailCodeRateLimit(request);
    const { email } = await request.json();
    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: '请输入邮箱' }, { status: 400 });
    }
    await sendRegisterEmailCode(email);
    return NextResponse.json({ success: true, message: '验证码已发送，请查看邮箱' });
  } catch (error) {
    console.error('[Email Code] send failed:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : '验证码发送失败' }, { status: 400 });
  }
}
