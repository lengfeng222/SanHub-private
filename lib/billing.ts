import type { BillingMode } from '@/types';

type BillingInput = {
  billingMode?: BillingMode;
  billingPrice?: number;
  billingUnit?: number;
  legacyCost?: number;
  seconds?: number;
  tokens?: number;
};

function isBillingMode(value: unknown): value is BillingMode {
  return value === 'per_call' || value === 'per_second' || value === 'per_1k_tokens';
}

function toNonNegativeInt(value: unknown): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return Math.floor(parsed);
}

export function normalizeBillingMode(
  value: unknown,
  fallback: BillingMode = 'per_call'
): BillingMode {
  return isBillingMode(value) ? value : fallback;
}

export function calculateBillingCost(input: BillingInput): number {
  const fallbackCost = toNonNegativeInt(input.legacyCost) ?? 0;
  const billingMode = normalizeBillingMode(input.billingMode, 'per_call');
  const billingPrice = toNonNegativeInt(input.billingPrice);
  const billingUnit = Math.max(1, toNonNegativeInt(input.billingUnit) ?? 1);

  if (billingMode === 'per_second') {
    if (billingPrice === undefined) return fallbackCost;
    const seconds = Math.max(1, toNonNegativeInt(input.seconds) ?? 1);
    return Math.ceil(seconds / billingUnit) * billingPrice;
  }

  if (billingMode === 'per_1k_tokens') {
    if (billingPrice === undefined) return fallbackCost;
    const tokens = Math.max(1, toNonNegativeInt(input.tokens) ?? 1);
    return Math.ceil(tokens / (1000 * billingUnit)) * billingPrice;
  }

  return billingPrice ?? fallbackCost;
}

export function formatBillingSummary(input: BillingInput): string {
  const billingMode = normalizeBillingMode(input.billingMode, 'per_call');
  const billingPrice = toNonNegativeInt(input.billingPrice);
  const billingUnit = Math.max(1, toNonNegativeInt(input.billingUnit) ?? 1);
  const fallbackCost = toNonNegativeInt(input.legacyCost) ?? 0;
  const price = billingPrice ?? fallbackCost;

  if (billingMode === 'per_second') {
    return `${price} 积分 / ${billingUnit} 秒`;
  }

  if (billingMode === 'per_1k_tokens') {
    return `${price} 积分 / ${billingUnit * 1000} Tokens`;
  }

  return `${price} 积分 / 次`;
}

