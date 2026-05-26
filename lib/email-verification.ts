import nodemailer from 'nodemailer';
import { checkRateLimit, RateLimitConfig } from '@/lib/rate-limit';
import {
  deleteEmailVerificationCode,
  getLatestEmailVerificationCode,
  incrementEmailCodeAttempts,
  saveEmailVerificationCode,
} from '@/lib/db-email-codes';

const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function getSmtpConfig() {
  return {
    host: process.env.SMTP_HOST || process.env.SMTP_SERVER || 'smtp.163.com',
    port: Number(process.env.SMTP_PORT || 465),
    secure: String(process.env.SMTP_SECURE || process.env.SMTP_SSL_ENABLED || 'true').toLowerCase() !== 'false',
    user: process.env.SMTP_USER || process.env.SMTP_ACCOUNT || '',
    pass: process.env.SMTP_PASS || process.env.SMTP_TOKEN || '',
    from: process.env.SMTP_FROM || process.env.SMTP_USER || process.env.SMTP_ACCOUNT || '',
    forceAuthLogin: String(process.env.SMTP_FORCE_AUTH_LOGIN || 'false').toLowerCase() === 'true',
  };
}

function makeCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export async function sendRegisterEmailCode(email: string) {
  const target = normalizeEmail(email);
  if (!/^\S+@\S+\.\S+$/.test(target)) {
    throw new Error('邮箱格式不正确');
  }

  const existing = await getLatestEmailVerificationCode(target);
  const now = Date.now();
  if (existing && now - Number(existing.created_at || 0) < RESEND_COOLDOWN_MS) {
    throw new Error('发送太频繁，请稍后再试');
  }

  const smtp = getSmtpConfig();
  if (!smtp.user || !smtp.pass || !smtp.from) {
    throw new Error('SMTP 邮件服务未配置');
  }

  const code = makeCode();
  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: {
      user: smtp.user,
      pass: smtp.pass,
    },
    authMethod: smtp.forceAuthLogin ? 'LOGIN' : undefined,
  });

  await transporter.sendMail({
    from: smtp.from,
    to: target,
    subject: '注册验证码',
    text: `您的注册验证码是：${code}。验证码 10 分钟内有效。`,
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.7;color:#111">
        <h2>注册验证码</h2>
        <p>您的验证码是：</p>
        <div style="font-size:28px;font-weight:700;letter-spacing:6px;margin:16px 0">${code}</div>
        <p>验证码 10 分钟内有效。如非本人操作，请忽略本邮件。</p>
      </div>
    `,
  });

  await saveEmailVerificationCode(target, code, now + CODE_TTL_MS);
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[Email Code Debug] ${target} => ${code}`);
  }
}

export async function verifyRegisterEmailCode(email: string, code: string) {
  const target = normalizeEmail(email);
  const record = await getLatestEmailVerificationCode(target);
  if (!record) return { ok: false, error: '请先获取邮箱验证码' };
  if (Date.now() > Number(record.expires_at || 0)) {
    await deleteEmailVerificationCode(target);
    return { ok: false, error: '邮箱验证码已过期' };
  }
  if (Number(record.attempts || 0) >= 5) {
    await deleteEmailVerificationCode(target);
    return { ok: false, error: '验证码错误次数过多，请重新获取' };
  }
  if (String(record.code || '') !== code.trim()) {
    await incrementEmailCodeAttempts(target);
    return { ok: false, error: '邮箱验证码错误' };
  }
  await deleteEmailVerificationCode(target);
  return { ok: true };
}

export function assertEmailCodeRateLimit(request: Request) {
  const result = checkRateLimit(request, RateLimitConfig.AUTH, 'email-code');
  if (!result.allowed) {
    throw new Error('请求太频繁，请稍后再试');
  }
}
