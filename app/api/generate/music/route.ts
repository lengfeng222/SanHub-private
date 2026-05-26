import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { generateAudio } from '@/lib/audio-generator';
import { getSystemConfig, getUserById, saveGeneration, updateGeneration, updateUserBalance, refundGenerationBalance } from '@/lib/db';
import { saveMediaAsync } from '@/lib/media-storage';
import { calculateBillingCost } from '@/lib/billing';

export const dynamic = 'force-dynamic';
export const maxDuration = 600;

const KIND = 'music' as const;
const DEFAULT_COST = Number(process.env.MUSIC_COST || 20);

export async function POST(request: NextRequest) {
  let generationId = '';
  let userId = '';
  let chargedCost = 0;

  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 });
    }

    const body = await request.json();
    const prompt = String(body.prompt || '').trim();
    const model = typeof body.model === 'string' ? body.model.trim() : undefined;
    const voice = typeof body.voice === 'string' ? body.voice.trim() : undefined;
    const format = typeof body.format === 'string' ? body.format.trim() : undefined;

    if (!prompt) {
      return NextResponse.json({ error: '请输入创作内容' }, { status: 400 });
    }

    const user = await getUserById(session.user.id);
    if (!user) return NextResponse.json({ error: '用户不存在' }, { status: 401 });
    if (user.disabled) return NextResponse.json({ error: '账号已被禁用' }, { status: 403 });

    const systemConfig = await getSystemConfig();
    const cost = calculateBillingCost({
      billingMode: systemConfig.audioProvider?.musicBillingMode,
      billingPrice: systemConfig.audioProvider?.musicBillingPrice,
      billingUnit: systemConfig.audioProvider?.musicBillingUnit,
      legacyCost: systemConfig.audioProvider?.musicCost || DEFAULT_COST,
    });
    if (user.balance < cost) {
      return NextResponse.json({ error: `余额不足，需要至少 ${cost} 积分` }, { status: 402 });
    }

    await updateUserBalance(user.id, -cost, 'strict');
    userId = user.id;
    chargedCost = cost;

    const generation = await saveGeneration({
      userId: user.id,
      type: KIND,
      prompt,
      params: { model, voice, format, progress: 0 },
      resultUrl: '',
      cost,
      status: 'processing',
      balancePrecharged: true,
      balanceRefunded: false,
    });
    generationId = generation.id;

    const result = await generateAudio({ kind: KIND, prompt, model, voice, format });
    const savedUrl = await saveMediaAsync(generation.id, result.url, {
      publicBaseUrl: new URL(request.url).origin,
      filename: `${generation.id}.${result.format || 'mp3'}`,
    });

    await updateGeneration(generation.id, {
      status: 'completed',
      resultUrl: savedUrl,
      params: {
        model: result.model,
        voice: result.voice,
        format: result.format,
        progress: 100,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        id: generation.id,
        type: KIND,
        status: 'completed',
        url: savedUrl,
      },
    });
  } catch (error) {
    if (generationId) {
      await updateGeneration(generationId, {
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : '生成失败',
      }).catch(() => {});
    }
    if (generationId && userId && chargedCost > 0) {
      await refundGenerationBalance(generationId, userId, chargedCost).catch(() => {});
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : '生成失败' },
      { status: 500 }
    );
  }
}
