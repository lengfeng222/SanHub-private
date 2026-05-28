import { getVideoChannels, getVideoModels, updateVideoModel } from '@/lib/db';
import { createLingkeSyncedVideoModelFromName } from '@/lib/lingke-video-pricing';

const AMBIGUOUS_NON_VIDEO_MODELS = new Set([
  '可灵-V3',
  'Kling-V3',
  '可灵-V3-Omni',
  'Kling-V3-Omni',
]);

function isMeaningfulPricingSync(model: ReturnType<typeof createLingkeSyncedVideoModelFromName>): boolean {
  if (model.pricingRules.length > 0) return true;
  if (model.billingMode !== 'per_second') return true;
  if (model.billingPrice !== 12) return true;
  if (model.durations.some((item) => item.cost !== 96)) return true;
  return false;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const channels = await getVideoChannels();
  const lingkeChannelIds = new Set(
    channels
      .filter((channel) => channel.type === 'lingke-media')
      .map((channel) => channel.id)
  );

  if (lingkeChannelIds.size === 0) {
    console.log('[backfill] 未找到灵刻视频渠道');
    return;
  }

  const models = (await getVideoModels()).filter((model) => lingkeChannelIds.has(model.channelId));

  let updated = 0;
  let disabled = 0;
  let skipped = 0;

  for (const model of models) {
    const modelKey = model.apiModel || model.name;

    if (AMBIGUOUS_NON_VIDEO_MODELS.has(modelKey)) {
      console.log(`[backfill] 标记为非视频并禁用: ${model.name} (${model.apiModel})`);
      if (!dryRun) {
        await updateVideoModel(model.id, {
          enabled: false,
        });
      }
      disabled += 1;
      continue;
    }

    const preset = createLingkeSyncedVideoModelFromName(modelKey, model.imageUrl);
    if (!isMeaningfulPricingSync(preset)) {
      console.log(`[backfill] 跳过未识别价格模型: ${model.name} (${model.apiModel})`);
      skipped += 1;
      continue;
    }

    console.log(
      `[backfill] 同步 ${model.name} -> ${preset.billingMode} / ${preset.billingPrice} / rules=${preset.pricingRules.length}`
    );

    if (!dryRun) {
      await updateVideoModel(model.id, {
        name: preset.name,
        description: preset.description,
        apiModel: preset.apiModel,
        features: preset.features,
        aspectRatios: preset.aspectRatios,
        durations: preset.durations,
        defaultAspectRatio: preset.defaultAspectRatio,
        defaultDuration: preset.defaultDuration,
        videoConfigObject: preset.videoConfigObject,
        highlight: preset.highlight ?? model.highlight,
        enabled: model.enabled,
        billingMode: preset.billingMode,
        billingPrice: preset.billingPrice,
        billingUnit: preset.billingUnit,
        normalPrice: preset.normalPrice,
        vipPrice: preset.vipPrice,
        svipPrice: preset.svipPrice,
        pricingRules: preset.pricingRules,
        imageUrl: preset.imageUrl || model.imageUrl,
      });
    }

    updated += 1;
  }

  console.log(
    `[backfill] 完成 updated=${updated} disabled=${disabled} skipped=${skipped} dryRun=${dryRun ? 'yes' : 'no'}`
  );
}

main().catch((error) => {
  console.error('[backfill] 失败:', error);
  process.exit(1);
});
