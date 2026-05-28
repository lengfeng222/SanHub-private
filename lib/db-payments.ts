import type { Generation } from '@/types';
import { createDatabaseAdapter, type DatabaseAdapter } from './db-adapter';
import { generateId } from './utils';
import { getUserById, updateUser, updateUserBalance } from './db';
import { resolveMembershipUpdate } from './member-pricing';

export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'closed';

export interface PaymentOrder {
  id: string;
  outTradeNo: string;
  userId: string;
  amount: number;
  points: number;
  payType: string;
  status: PaymentStatus;
  tradeNo?: string;
  paidAt?: number;
  createdAt: number;
  updatedAt: number;
}

let adapter: DatabaseAdapter | null = null;
let initialized = false;

function getAdapter(): DatabaseAdapter {
  if (!adapter) adapter = createDatabaseAdapter();
  return adapter;
}

function rowToOrder(row: any): PaymentOrder {
  return {
    id: row.id,
    outTradeNo: row.out_trade_no,
    userId: row.user_id,
    amount: Number(row.amount),
    points: Number(row.points),
    payType: row.pay_type,
    status: row.status,
    tradeNo: row.trade_no || undefined,
    paidAt: row.paid_at ? Number(row.paid_at) : undefined,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export async function initializePaymentTables(): Promise<void> {
  if (initialized) return;
  const db = getAdapter();
  await db.execute(`
    CREATE TABLE IF NOT EXISTS payment_orders (
      id VARCHAR(36) PRIMARY KEY,
      out_trade_no VARCHAR(64) UNIQUE NOT NULL,
      user_id VARCHAR(36) NOT NULL,
      amount DECIMAL(10,2) NOT NULL,
      points INT NOT NULL,
      pay_type VARCHAR(20) DEFAULT 'alipay',
      status ENUM('pending','paid','failed','closed') DEFAULT 'pending',
      trade_no VARCHAR(100) DEFAULT '',
      paid_at BIGINT DEFAULT 0,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      INDEX idx_out_trade_no (out_trade_no),
      INDEX idx_user_id (user_id),
      INDEX idx_status (status)
    )
  `);
  initialized = true;
}

export async function createPaymentOrder(input: {
  userId: string;
  amount: number;
  points: number;
  payType: string;
}): Promise<PaymentOrder> {
  await initializePaymentTables();
  const db = getAdapter();
  const now = Date.now();
  const id = generateId();
  const outTradeNo = `RC${now}${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

  await db.execute(
    `INSERT INTO payment_orders (id, out_trade_no, user_id, amount, points, pay_type, status, trade_no, paid_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', '', 0, ?, ?)`,
    [id, outTradeNo, input.userId, input.amount.toFixed(2), input.points, input.payType, now, now]
  );

  return {
    id,
    outTradeNo,
    userId: input.userId,
    amount: input.amount,
    points: input.points,
    payType: input.payType,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  };
}

export async function getPaymentOrderByOutTradeNo(outTradeNo: string): Promise<PaymentOrder | null> {
  await initializePaymentTables();
  const db = getAdapter();
  const [rows] = await db.execute('SELECT * FROM payment_orders WHERE out_trade_no = ? LIMIT 1', [outTradeNo]);
  const row = (rows as any[])[0];
  return row ? rowToOrder(row) : null;
}

export async function getUserPaymentOrders(userId: string, limit = 20): Promise<PaymentOrder[]> {
  await initializePaymentTables();
  const db = getAdapter();
  const safeLimit = Math.max(1, Math.min(100, Math.floor(Number(limit) || 20)));
  const [rows] = await db.execute(
    `SELECT * FROM payment_orders WHERE user_id = ? ORDER BY created_at DESC LIMIT ${safeLimit}`,
    [userId]
  );
  return (rows as any[]).map(rowToOrder);
}

export async function getRecentPaymentOrders(limit = 20): Promise<PaymentOrder[]> {
  await initializePaymentTables();
  const db = getAdapter();
  const safeLimit = Math.max(1, Math.min(100, Math.floor(Number(limit) || 20)));
  const [rows] = await db.execute(
    `SELECT * FROM payment_orders ORDER BY created_at DESC LIMIT ${safeLimit}`
  );
  return (rows as any[]).map(rowToOrder);
}

export async function markPaymentOrderPaid(outTradeNo: string, tradeNo: string): Promise<{ credited: boolean; order: PaymentOrder | null }> {
  await initializePaymentTables();
  const db = getAdapter();
  const now = Date.now();
  const order = await getPaymentOrderByOutTradeNo(outTradeNo);
  if (!order) return { credited: false, order: null };

  if (order.status === 'paid') {
    return { credited: false, order };
  }

  const [result] = await db.execute(
    `UPDATE payment_orders SET status = 'paid', trade_no = ?, paid_at = ?, updated_at = ?
     WHERE out_trade_no = ? AND status <> 'paid'`,
    [tradeNo, now, now, outTradeNo]
  );
  const affected = (result as any).affectedRows ?? (result as any).changes ?? 0;
  if (!affected) {
    return { credited: false, order: await getPaymentOrderByOutTradeNo(outTradeNo) };
  }

  await updateUserBalance(order.userId, order.points, 'strict');
  const user = await getUserById(order.userId);
  const membershipUpdate = resolveMembershipUpdate(user, order.amount, now);
  if (user && membershipUpdate) {
    await updateUser(order.userId, membershipUpdate);
  }
  const paidOrder = await getPaymentOrderByOutTradeNo(outTradeNo);
  return { credited: true, order: paidOrder };
}

export async function paymentOrderToGeneration(order: PaymentOrder): Promise<Generation> {
  return {
    id: order.id,
    userId: order.userId,
    type: 'chat',
    prompt: `充值订单 ${order.outTradeNo}`,
    params: { model: 'recharge', originalPrompt: order.payType },
    resultUrl: '',
    cost: -order.points,
    status: order.status === 'paid' ? 'completed' : 'pending',
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}
