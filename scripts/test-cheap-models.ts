import { generateWithSora } from '../lib/sora';
import { getVideoModelWithChannel } from '../lib/db';

const TESTS = [
  { id: 'fc0f6992-8637-46db-9771-647b364b148a', name: '快乐马-文生视频', prompt: 'A paper airplane flying above a calm lake at sunset, cinematic, smooth motion.' },
  { id: 'd0f65796-a6b2-4147-81e9-59b457354d13', name: '可灵-V3', prompt: 'A futuristic city street at night with neon lights and gentle camera movement.' },
];

async function main() {
  const results: Array<Record<string, unknown>> = [];

  for (const item of TESTS) {
    const config = await getVideoModelWithChannel(item.id);
    if (!config) {
      results.push({ modelId: item.id, name: item.name, ok: false, error: 'model_not_found' });
      continue;
    }

    const requestedDuration = '1s';
    const request = {
      model: 'sora2-landscape-8s',
      modelId: item.id,
      aspectRatio: 'landscape',
      duration: requestedDuration,
      prompt: item.prompt,
      videoConfigObject: {
        aspect_ratio: '16:9',
        video_length: 1,
        resolution: '720P',
      },
      files: [],
    } as any;

    const startedAt = Date.now();
    try {
      const result = await generateWithSora(request, () => {});
      results.push({
        modelId: item.id,
        name: item.name,
        ok: true,
        url: result.url,
        cost: result.cost,
        elapsedMs: Date.now() - startedAt,
        defaultDuration: config.model.defaultDuration,
      });
    } catch (error) {
      results.push({
        modelId: item.id,
        name: item.name,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        elapsedMs: Date.now() - startedAt,
        defaultDuration: config.model.defaultDuration,
      });
    }
  }

  console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
