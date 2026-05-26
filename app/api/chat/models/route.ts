import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getChatModels, createChatModel, updateChatModel, deleteChatModel } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions).catch(() => null);
    if (!session?.user) {
      return NextResponse.json({ success: false, error: '未登录' }, { status: 401 });
    }

    const isAdmin = session.user.role === 'admin';
    const { searchParams } = new URL(request.url);
    const all = searchParams.get('all') === 'true';

    // Admin can get all models with full data
    if (isAdmin && all) {
      const models = await getChatModels(false);
      return NextResponse.json({ success: true, data: models });
    }

    // Regular users only get enabled models without sensitive data
    const models = await getChatModels(true);
    const safeModels = models.map((m) => ({
      id: m.id,
      name: m.name,
      modelId: m.modelId,
      supportsVision: m.supportsVision,
      maxTokens: m.maxTokens,
      enabled: m.enabled,
      costPerMessage: m.costPerMessage,
      billingMode: m.billingMode,
      billingPrice: m.billingPrice,
      billingUnit: m.billingUnit,
      imageUrl: m.imageUrl,
    }));

    return NextResponse.json({ success: true, data: safeModels });
  } catch (error) {
    console.error('Failed to get chat models:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '获取聊天模型失败' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions).catch(() => null);
    if (!session?.user || session.user.role !== 'admin') {
      return NextResponse.json({ success: false, error: '无权限' }, { status: 403 });
    }

    const body = await request.json();
    const { name, apiUrl, apiKey, modelId, supportsVision, maxTokens, costPerMessage, billingMode, billingPrice, billingUnit, imageUrl, enabled } = body;

    if (!name || !apiUrl || !apiKey || !modelId) {
      return NextResponse.json({ success: false, error: '缺少必要参数' }, { status: 400 });
    }

    const model = await createChatModel({
      name,
      apiUrl,
      apiKey,
      modelId,
      supportsVision: supportsVision ?? false,
      maxTokens: maxTokens ?? 4096,
      costPerMessage: costPerMessage ?? 1,
      billingMode: billingMode ?? 'per_call',
      billingPrice: billingPrice ?? costPerMessage ?? 1,
      billingUnit: billingUnit ?? 1,
      imageUrl: imageUrl || undefined,
      enabled: enabled ?? true,
    });

    return NextResponse.json({ success: true, data: model });
  } catch (error) {
    console.error('Failed to create chat model:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '创建失败' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions).catch(() => null);
    if (!session?.user || session.user.role !== 'admin') {
      return NextResponse.json({ success: false, error: '无权限' }, { status: 403 });
    }

    const body = await request.json();
    const { id, ...updates } = body;

    if (!id) {
      return NextResponse.json({ success: false, error: '缺少 ID' }, { status: 400 });
    }

    const model = await updateChatModel(id, updates);
    if (!model) {
      return NextResponse.json({ success: false, error: '模型不存在' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: model });
  } catch (error) {
    console.error('Failed to update chat model:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '更新失败' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions).catch(() => null);
    if (!session?.user || session.user.role !== 'admin') {
      return NextResponse.json({ success: false, error: '无权限' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ success: false, error: '缺少 ID' }, { status: 400 });
    }

    const success = await deleteChatModel(id);
    if (!success) {
      return NextResponse.json({ success: false, error: '删除失败' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete chat model:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '删除失败' },
      { status: 500 }
    );
  }
}
