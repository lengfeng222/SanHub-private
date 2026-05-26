import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { DashboardBackgroundWrapper } from '@/components/ui/dashboard-background-wrapper';
import { AuthSessionProvider } from '@/components/providers/session-provider';
import { ManageShell } from '@/components/manage/manage-shell';

export default async function ManageLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);

  if (!session) redirect('/login');
  if (session.user.role !== 'admin' && session.user.role !== 'moderator') redirect('/');

  return (
    <div className="relative min-h-screen">
      <DashboardBackgroundWrapper />
      <AuthSessionProvider>
        <ManageShell user={session.user}>{children}</ManageShell>
      </AuthSessionProvider>
    </div>
  );
}
