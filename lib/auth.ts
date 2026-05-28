import { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { verifyPassword, getUserById, initializeDatabase } from './db';
import type { SafeUser } from '@/types';

// ========================================
// NextAuth 配置
// ========================================

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error('请输入邮箱和密码');
        }

        // 初始化数据库 (首次运行)
        await initializeDatabase();

        const user = await verifyPassword(
          credentials.email,
          credentials.password
        );

        if (!user) {
          throw new Error('邮箱或密码错误');
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          balance: user.balance,
          membershipLevel: user.membershipLevel,
          membershipExpiresAt: user.membershipExpiresAt,
        };
      },
    }),
  ],
  callbacks: {
    async redirect({ url, baseUrl }) {
      // 登出后跳转到登录页
      if (url.startsWith('/')) return `${baseUrl}${url}`;
      // 允许同源跳转
      if (new URL(url).origin === baseUrl) return url;
      return baseUrl;
    },
    async jwt({ token, user, trigger, session }) {
      // 初次登录
      if (user) {
        token.id = user.id as string;
        token.role = (user as SafeUser).role;
        token.balance = (user as SafeUser).balance;
        token.membershipLevel = (user as SafeUser).membershipLevel;
        token.membershipExpiresAt = (user as SafeUser).membershipExpiresAt;
      }

      // 手动触发 session 更新时刷新用户数据
      if (trigger === 'update' && session) {
        const freshUser = await getUserById(token.id as string);
        if (freshUser) {
          token.balance = freshUser.balance;
          token.role = freshUser.role;
          token.name = freshUser.name;
          token.membershipLevel = freshUser.membershipLevel;
          token.membershipExpiresAt = freshUser.membershipExpiresAt;
        }
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as 'user' | 'admin' | 'moderator';
        session.user.balance = token.balance as number;
        session.user.membershipLevel = token.membershipLevel as SafeUser['membershipLevel'];
        session.user.membershipExpiresAt = token.membershipExpiresAt as number | undefined;
        
        // 每次都从数据库获取最新余额，避免缓存导致积分不一致
        try {
          const freshUser = await getUserById(token.id as string);
          if (freshUser) {
            // 用户被禁用时，返回 null session 强制登出
            if (freshUser.disabled) {
              return null as unknown as typeof session;
            }
            session.user.balance = freshUser.balance;
            session.user.role = freshUser.role;
            session.user.name = freshUser.name;
            session.user.membershipLevel = freshUser.membershipLevel;
            session.user.membershipExpiresAt = freshUser.membershipExpiresAt;
            session.user.disabled = freshUser.disabled;
          }
          // 用户不存在时保持 token 中的缓存值（已在上面设置）
        } catch (error) {
          // 数据库查询失败时使用 token 中的缓存值（已在上面设置）
          console.error('[Auth] Failed to fetch user in session callback:', error);
        }
      }
      return session;
    },
  },
  pages: {
    signIn: '/login',
    error: '/login',
  },
  session: {
    strategy: 'jwt',
    maxAge: 7 * 24 * 60 * 60, // 7 天
  },
  secret: process.env.NEXTAUTH_SECRET || 'sanhub-local-dev-secret',
};
