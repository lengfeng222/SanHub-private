import { NextRequest, NextResponse } from 'next/server';
import { verifyCaptcha } from '@/lib/captcha';

export async function POST(request: NextRequest) {
  try {
    const { id, code } = await request.json();

    if (!id || !code) {
      return NextResponse.json(
        { success: false, error: '请输入验证码' },
        { status: 400 }
      );
    }

    const isValid = await verifyCaptcha(id, code);

    if (!isValid) {
      return NextResponse.json(
        { success: false, error: '验证码错误或已过期' },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Captcha verification error:', error);
    return NextResponse.json(
      { success: false, error: '验证失败' },
      { status: 500 }
    );
  }
}
