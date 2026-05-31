import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { initializeDatabase } from '@/lib/db';
import { createDatabaseAdapter } from '@/lib/db-adapter';
import { triggerRuntimeMediaCleanup } from '@/lib/media-storage';
import {
  parseGenerationParams,
  refreshLingkeImageGenerationIfNeeded,
  refreshLingkeVideoGenerationIfNeeded,
  shouldSyncLingkeImageTask,
  shouldSyncLingkeVideoTask,
} from '@/lib/lingke-generation-sync';
import type { Generation } from '@/types';

export const dynamic = 'force-dynamic';

function isInternalSyncAuthorized(request: NextRequest): boolean {
  const configuredSecret =
    process.env.INTERNAL_SYNC_SECRET
    || process.env.NEXTAUTH_SECRET
    || 'dev-nextauth-secret-change-me';
  if (!configuredSecret) return false;

  const headerSecret = request.headers.get('x-internal-sync-secret') || '';
  if (headerSecret && headerSecret === configuredSecret) {
    return true;
  }

  const authorization = request.headers.get('authorization') || '';
  if (authorization === `Bearer ${configuredSecret}`) {
    return true;
  }

  const token = request.nextUrl.searchParams.get('token') || '';
  if (token && token === configuredSecret) {
    return true;
  }

  return false;
}

function mapGenerationRow(row: any): Generation {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    prompt: row.prompt,
    params: typeof row.params === 'string' ? JSON.parse(row.params) : row.params,
    resultUrl: row.result_url,
    cost: row.cost,
    status: row.status || 'completed',
    balancePrecharged: Boolean(row.balance_precharged),
    balanceRefunded: Boolean(row.balance_refunded),
    errorMessage: row.error_message || undefined,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at || row.created_at),
  };
}

function buildPublicBaseUrl(request: NextRequest): string {
  const explicit = process.env.PUBLIC_BASE_URL || process.env.NEXTAUTH_URL || '';
  if (explicit) return explicit.replace(/\/$/, '');
  return new URL(request.url).origin;
}

export async function POST(request: NextRequest) {
  try {
    if (!isInternalSyncAuthorized(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await triggerRuntimeMediaCleanup().catch((error) => {
      console.warn('[LingkeSync] Runtime media cleanup skipped:', error);
    });

    await initializeDatabase();
    const db = createDatabaseAdapter();
    const publicBaseUrl = buildPublicBaseUrl(request);

    const limit = Math.max(1, Math.min(500, Number(request.nextUrl.searchParams.get('limit') || 200)));
    const sinceMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const [rows] = await db.execute(
      `SELECT * FROM generations
       WHERE status IN ('pending', 'processing', 'failed')
       AND created_at >= ?
       ORDER BY updated_at DESC
       LIMIT ${limit}`,
      [sinceMs]
    );

    const generations = (rows as any[]).map(mapGenerationRow);
    const candidates = generations.filter((generation) => {
      const generationParams = parseGenerationParams(generation.params);
      return shouldSyncLingkeVideoTask(generation, generationParams) || shouldSyncLingkeImageTask(generation, generationParams);
    });

    const summary = {
      scanned: generations.length,
      candidates: candidates.length,
      updated: 0,
      completed: 0,
      failed: 0,
      processing: 0,
      skipped: 0,
      errors: [] as Array<{ id: string; message: string }>,
    };

    for (const generation of candidates) {
      try {
        const beforeStatus = generation.status;
        let updated = generation;

        if (generation.type.includes('video')) {
          updated = await refreshLingkeVideoGenerationIfNeeded(generation, publicBaseUrl, true);
        } else if (generation.type.endsWith('-image')) {
          updated = await refreshLingkeImageGenerationIfNeeded(generation, publicBaseUrl, true);
        } else {
          summary.skipped += 1;
          continue;
        }

        if (updated.updatedAt !== generation.updatedAt || updated.status !== beforeStatus || updated.resultUrl !== generation.resultUrl) {
          summary.updated += 1;
        } else {
          summary.skipped += 1;
        }

        if (updated.status === 'completed') summary.completed += 1;
        else if (updated.status === 'failed') summary.failed += 1;
        else if (updated.status === 'processing' || updated.status === 'pending') summary.processing += 1;
      } catch (error) {
        summary.errors.push({
          id: generation.id,
          message: error instanceof Error ? error.message : '同步失败',
        });
      }
    }

    const jobId = createHash('sha1')
      .update(`${Date.now()}-${summary.scanned}-${summary.updated}`)
      .digest('hex')
      .slice(0, 12);

    return NextResponse.json({
      success: true,
      data: {
        jobId,
        ...summary,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '同步失败' },
      { status: 500 }
    );
  }
}
