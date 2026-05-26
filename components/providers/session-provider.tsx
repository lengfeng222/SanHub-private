'use client';

import type { Session } from 'next-auth';
import { SessionProvider } from 'next-auth/react';

interface AuthSessionProviderProps {
  children: React.ReactNode;
  session?: Session | null;
}

export function AuthSessionProvider({ children, session }: AuthSessionProviderProps) {
  return (
    <SessionProvider
      session={session}
      refetchInterval={5 * 60}
      refetchOnWindowFocus={true}
    >
      {children}
    </SessionProvider>
  );
}
