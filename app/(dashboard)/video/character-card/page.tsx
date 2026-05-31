'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function CharacterCardPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/video');
  }, [router]);

  return null;
}
