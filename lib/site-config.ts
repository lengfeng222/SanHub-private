import { getSystemConfig } from '@/lib/db';
import type { ExtendedSiteConfig } from '@/components/providers/site-config-provider';

export async function getPublicSiteConfig(): Promise<ExtendedSiteConfig> {
  const config = await getSystemConfig();

  return {
    siteName: config.siteConfig?.siteName || '幻途',
    siteTagline: config.siteConfig?.siteTagline || '幻途 AI 内容创作平台',
    siteDescription: config.siteConfig?.siteDescription || '幻途，专注图像与视频生成的 AI 创作平台。',
    siteSubDescription:
      config.siteConfig?.siteSubDescription ||
      '支持文生图、参考图生成、文生视频、图生视频与 24 小时站内缓存，让你更快完成从灵感到成片的创作流程。',
    contactEmail: config.siteConfig?.contactEmail || 'support@aigcone.cn',
    copyright: config.siteConfig?.copyright || '本平台仅提供内容生成工具服务，不对产出内容真实性、合规性、版权归属承担相关责任。',
    poweredBy: config.siteConfig?.poweredBy || '幻途 · Huantu AI',
    defaultBalance: config.defaultBalance ?? 50,
    squareEnabled: config.featureFlags?.squareEnabled ?? true,
    gachaEnabled: config.featureFlags?.gachaEnabled ?? true,
    inviteEnabled: config.inviteSettings?.enabled ?? true,
    inviteRewardEnabled: config.inviteSettings?.rewardEnabled ?? true,
    inviteeBonusPoints: config.inviteSettings?.inviteeBonusPoints ?? 100,
    inviterBonusPoints: config.inviteSettings?.inviterBonusPoints ?? 50,
  };
}
