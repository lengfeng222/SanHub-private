import { NextResponse } from 'next/server';
import { createCaptcha } from '@/lib/captcha';

// 禁用路由缓存
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { id, svg } = await createCaptcha();
    
    return NextResponse.json({
      success: true,
      data: {
        id,
        svg,
      },
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Pragma': 'no-cache',
      },
    });
  } catch (error) {
    console.error('Captcha generation error:', error);
    return NextResponse.json(
      { error: '验证码生成失败' },
      { status: 500 }
    );
  }
}
