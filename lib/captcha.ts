// ========================================
// 简单验证码生成器
// ========================================

import { deleteCaptchaCode, getCaptchaCode, saveCaptchaCode } from '@/lib/db-captchas';

// 生成随机验证码
export function generateCaptchaCode(length = 4): string {
  const chars = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // 排除容易混淆的字符 I, O
  let code = '';
  for (let i = 0; i < length; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// 生成验证码ID
export function generateCaptchaId(): string {
  return Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
}

// 存储验证码
export async function storeCaptcha(id: string, code: string, ttl = 300000): Promise<void> {
  const now = Date.now();
  await saveCaptchaCode(id, code, now + ttl);
}

// 验证验证码
export async function verifyCaptcha(id: string, code: string): Promise<boolean> {
  const stored = await getCaptchaCode(id);
  if (!stored) return false;
  
  // 检查是否过期
  if (Number(stored.expires_at || 0) < Date.now()) {
    await deleteCaptchaCode(id);
    return false;
  }
  
  // 验证后删除（一次性使用）
  await deleteCaptchaCode(id);
  
  return String(stored.code || '') === code.toUpperCase();
}

// 生成验证码SVG图片
export function generateCaptchaSvg(code: string): string {
  const width = 120;
  const height = 40;
  
  // 随机颜色
  const randomColor = () => {
    const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8'];
    return colors[Math.floor(Math.random() * colors.length)];
  };
  
  // 生成干扰线
  let lines = '';
  for (let i = 0; i < 4; i++) {
    const x1 = Math.random() * width;
    const y1 = Math.random() * height;
    const x2 = Math.random() * width;
    const y2 = Math.random() * height;
    lines += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${randomColor()}" stroke-width="1" opacity="0.5"/>`;
  }
  
  // 生成干扰点
  let dots = '';
  for (let i = 0; i < 30; i++) {
    const x = Math.random() * width;
    const y = Math.random() * height;
    dots += `<circle cx="${x}" cy="${y}" r="1" fill="${randomColor()}" opacity="0.5"/>`;
  }
  
  // 生成文字
  let text = '';
  const charWidth = width / (code.length + 1);
  for (let i = 0; i < code.length; i++) {
    const x = charWidth * (i + 0.5);
    const y = height / 2 + 8;
    const rotate = Math.random() * 30 - 15;
    const fontSize = 20 + Math.random() * 6;
    text += `<text x="${x}" y="${y}" font-size="${fontSize}" font-family="Arial, sans-serif" font-weight="bold" fill="${randomColor()}" transform="rotate(${rotate}, ${x}, ${y})">${code[i]}</text>`;
  }
  
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="100%" height="100%" fill="#1a1a1a"/>
    ${lines}
    ${dots}
    ${text}
  </svg>`;
}

// 创建验证码（返回ID和SVG）
export async function createCaptcha(): Promise<{ id: string; svg: string }> {
  const id = generateCaptchaId();
  const code = generateCaptchaCode();
  await storeCaptcha(id, code);
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[Captcha Debug] ${id} => ${code}`);
  }
  const svg = generateCaptchaSvg(code);
  
  return { id, svg };
}
