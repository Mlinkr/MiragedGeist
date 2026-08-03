/**
 * Cloudflare Worker —— Cloudinary 签名上传代理
 * ------------------------------------------------------------------
 * 作用：浏览器（手机）直传 Cloudinary 原画质大图时，需要 API Secret 做签名。
 *       但 Secret 绝不能发给前端。本 Worker 把 Secret 放在【环境变量】里，
 *       只向前端返回一个「一次性签名」，前端拿签名 + API Key 直接传原图。
 *
 * 优点：
 *   - 突破免签名上传 10MB 上限 → 原图任意大小（Cloudinary 单文件上限 100MB）。
 *   - Secret 只存在 Worker 环境变量，前端/仓库/GitHub 都看不到。
 *   - 每个签名带 timestamp，几分钟内有效，无法被复用盗传。
 *
 * 部署后，前端（upload-cloudinary.html）填 Worker 地址即可用。
 *
 * 环境变量（Cloudflare 控制台 → Worker → Settings → Variables）：
 *   CLOUDINARY_CLOUD_NAME   e.g. gopfeu83
 *   CLOUDINARY_API_KEY      e.g. 864775887227493
 *   CLOUDINARY_API_SECRET   ← 只放这里，绝不下发前端
 */

// 用 Web Crypto 计算 SHA-1 的十六进制摘要（与 Cloudinary 规则一致）
async function sha1Hex(str) {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// 按 Cloudinary 规则生成签名：
// 把参与签名的参数（不含 file / api_key / signature）按 key 排序，
// 拼成 key=value&key=value，末尾追加上 Secret，再 SHA-1。
async function makeSignature(params, secret) {
  const raw = Object.keys(params)
    .sort()
    .map(k => `${k}=${params[k]}`)
    .join('&') + secret;
  return sha1Hex(raw);
}

function corsHeaders() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
  };
}

export default {
  async fetch(request, env) {
    // 预检请求
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed. POST JSON { folder } to /sign', { status: 405 });
    }

    let body = {};
    try { body = await request.json(); } catch { /* 允许空 body */ }

    // 前端可传 folder（如 Photos / Cut），默认 Photos
    const folder = (body.folder && String(body.folder).trim()) || 'Photos';

    // timestamp 必须是秒级 Unix 时间戳（Cloudinary 要求）
    const timestamp = Math.floor(Date.now() / 1000);
    const params = { timestamp, folder };
    const signature = await makeSignature(params, env.CLOUDINARY_API_SECRET || '');

    const out = {
      timestamp,
      folder,
      api_key: env.CLOUDINARY_API_KEY || '',
      signature,
      cloud: env.CLOUDINARY_CLOUD_NAME || '',
    };

    return new Response(JSON.stringify(out), {
      status: 200,
      headers: { 'content-type': 'application/json', ...corsHeaders() },
    });
  },
};
