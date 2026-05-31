import { redirect } from 'next/navigation';

export default async function CreatePage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = (await searchParams) || {};
  const rawMode = Array.isArray(params.mode) ? params.mode[0] : params.mode;
  const mode = String(rawMode || '').trim().toLowerCase();

  if (mode === 'video') {
    redirect('/supervideo');
  }

  redirect('/gptimage');
}
