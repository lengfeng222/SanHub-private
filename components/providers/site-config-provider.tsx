'use client';

import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import type { SiteConfig } from '@/types';

// Extended config that includes runtime settings
export interface ExtendedSiteConfig extends SiteConfig {
  defaultBalance: number;
  squareEnabled: boolean;
  gachaEnabled: boolean;
  inviteEnabled: boolean;
  inviteRewardEnabled: boolean;
  inviteeBonusPoints: number;
  inviterBonusPoints: number;
}

const defaultSiteConfig: ExtendedSiteConfig = {
  siteName: '幻途',
  siteTagline: '幻途 AI 内容创作平台',
  siteDescription: '幻途，专注图像与视频生成的 AI 创作平台。',
  siteSubDescription: '支持文生图、参考图生成、文生视频、图生视频与 24 小时站内缓存，让你更快完成从灵感到成片的创作流程。',
  contactEmail: 'support@aigcone.cn',
  copyright: '本平台仅提供内容生成工具服务，不对产出内容真实性、合规性、版权归属承担相关责任。',
  poweredBy: '幻途 · Huantu AI',
  defaultBalance: 50,
  squareEnabled: true,
  gachaEnabled: true,
  inviteEnabled: true,
  inviteRewardEnabled: true,
  inviteeBonusPoints: 100,
  inviterBonusPoints: 50,
};

interface SiteConfigContextType {
  config: ExtendedSiteConfig;
  refreshConfig: () => Promise<void>;
}

const SiteConfigContext = createContext<SiteConfigContextType>({
  config: defaultSiteConfig,
  refreshConfig: async () => {},
});

export function useSiteConfig() {
  const { config } = useContext(SiteConfigContext);
  return config;
}

export function useSiteConfigRefresh() {
  const { refreshConfig } = useContext(SiteConfigContext);
  return refreshConfig;
}

interface SiteConfigProviderProps {
  children: ReactNode;
  initialConfig?: ExtendedSiteConfig;
}

export function SiteConfigProvider({ children, initialConfig }: SiteConfigProviderProps) {
  const [config, setConfig] = useState<ExtendedSiteConfig>(initialConfig || defaultSiteConfig);

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/site-config', { cache: 'no-store' });
      const data = await res.json();
      if (data.success && data.data) {
        setConfig({
          ...data.data,
          defaultBalance: data.data.defaultBalance ?? 50,
          squareEnabled: data.data.squareEnabled ?? true,
          gachaEnabled: data.data.gachaEnabled ?? true,
          inviteEnabled: data.data.inviteEnabled ?? true,
          inviteRewardEnabled: data.data.inviteRewardEnabled ?? true,
          inviteeBonusPoints: data.data.inviteeBonusPoints ?? 100,
          inviterBonusPoints: data.data.inviterBonusPoints ?? 50,
        });
      }
    } catch (error) {
      console.error('Failed to fetch site config:', error);
    }
  }, []);

  return (
    <SiteConfigContext.Provider value={{ config, refreshConfig: fetchConfig }}>
      {children}
    </SiteConfigContext.Provider>
  );
}
