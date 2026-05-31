import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json({ error: '角色卡功能已下线' }, { status: 410 });
}
