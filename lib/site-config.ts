import { getSystemConfig } from '@/lib/db';
import type { ExtendedSiteConfig } from '@/components/providers/site-config-provider';

export async function getPublicSiteConfig(): Promise<ExtendedSiteConfig> {
  const config = await getSystemConfig();

  return {
    siteName: config.siteConfig?.siteName || '幻途',
    siteTagline: config.siteConfig?.siteTagline || '幻途 AI 内容创作平台',
    siteDescription: config.siteConfig?.siteDescription || '幻途，连接图像、视频、音乐、语音与多模型对话的一体化 AI 创作平台。',
    siteSubDescription:
      config.siteConfig?.siteSubDescription ||
      '在这里，你可以把灵感快速转成可见、可听、可传播的内容作品，用更低门槛完成从想法到产出的全过程。',
    contactEmail: config.siteConfig?.contactEmail || 'support@aigcone.cn',
    copyright: config.siteConfig?.copyright || '本平台仅提供内容生成工具服务，不对产出内容真实性、合规性、版权归属承担相关责任。',
    poweredBy: config.siteConfig?.poweredBy || '幻途 · Huantu AI',
    defaultBalance: config.defaultBalance ?? 50,
    squareEnabled: config.featureFlags?.squareEnabled ?? true,
    gachaEnabled: config.featureFlags?.gachaEnabled ?? true,
    characterCardEnabled: config.featureFlags?.characterCardEnabled ?? true,
    inviteEnabled: config.inviteSettings?.enabled ?? true,
    inviteRewardEnabled: config.inviteSettings?.rewardEnabled ?? true,
    inviteeBonusPoints: config.inviteSettings?.inviteeBonusPoints ?? 100,
    inviterBonusPoints: config.inviteSettings?.inviterBonusPoints ?? 50,
  };
}
