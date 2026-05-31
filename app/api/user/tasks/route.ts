import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getPendingGenerations } from '@/lib/db';
import { shouldHideGenerationFromUserFeeds } from '@/lib/generation-visibility';
import type { Generation } from '@/types';

export const dynamic = 'force-dynamic';

// 获取用户正在进行的任务
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const rawLimit = parseInt(searchParams.get('limit') || '50');
    const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 50, 1), 200);
    const tasks = (await getPendingGenerations(session.user.id, limit))
      .filter((task) => !shouldHideGenerationFromUserFeeds(task));

    return NextResponse.json({
      data: tasks.map((t: Generation) => ({
        id: t.id,
        prompt: t.prompt,
        type: t.type,
        status: t.status,
        progress: typeof t.params?.progress === 'number' ? t.params.progress : 0,
        modelId: t.params?.modelId,
        model: t.params?.model,
        errorMessage: t.errorMessage || undefined,
        upstreamTaskId: t.params?.upstreamTaskId,
        upstreamStatus: t.params?.upstreamStatus,
        upstreamState: t.params?.upstreamState,
        upstreamStatusGroup: t.params?.upstreamStatusGroup,
        upstreamProgress:
          typeof t.params?.upstreamProgress === 'number' ? t.params.upstreamProgress : undefined,
        upstreamUpdatedAt:
          typeof t.params?.upstreamUpdatedAt === 'number' ? t.params.upstreamUpdatedAt : undefined,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      })),
    });
  } catch (error) {
    console.error('[API] Failed to get pending tasks:', error);
    return NextResponse.json(
      { error: '获取任务失败' },
      { status: 500 }
    );
  }
}
