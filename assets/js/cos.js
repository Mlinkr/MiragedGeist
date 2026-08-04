/* ===========================================================
 * 腾讯云 COS · 浏览器直传（无需云函数 / SCF）
 * -----------------------------------------------------------
 * 前端用 COS V1 签名（HMAC-SHA1）直接 PUT 到桶，上传原图 + 缩略图。
 * 配套：管理面板里填 SecretId / SecretKey / Bucket / Region（仅存本机浏览器）。
 *
 * 前置条件（在 COS 控制台配置）：
 *   1) CORS：来源填你的站点域名，允许方法 PUT/POST/GET/HEAD，
 *      允许 Header 填 *，暴露 Header 填 ETag / Content-Length / Authorization。
 *   2) 使用的密钥对该桶有「写入」权限（建议用子账号密钥，仅授权此桶）。
 *
 * 安全说明：SecretKey 会出现在访客浏览器里，仅适合个人 / 可信站点。
 *   若要杜绝密钥泄露，请改用云函数（SCF）中转上传——本文件即为其纯前端替代方案。
 * =========================================================== */

const LS = { id: 'mg_cos_id', key: 'mg_cos_key', bucket: 'mg_cos_bucket', region: 'mg_cos_region' };

/** 读取本机保存的 COS 配置 */
export function cosCfg() {
  const g = k => (localStorage.getItem(LS[k]) || '').trim();
  const bucket = g('bucket'), region = g('region');
  return {
    secretId: g('id'),
    secretKey: g('key'),
    bucket,
    region,
    host: bucket ? `${bucket}.cos.${region}.myqcloud.com` : '',
  };
}

/** 四项齐全才算可用 */
export function cosReady() {
  const c = cosCfg();
  return !!(c.secretId && c.secretKey && c.bucket && c.region && c.host);
}

export function saveCosCfg({ secretId, secretKey, bucket, region }) {
  const set = (k, v) => { v ? localStorage.setItem(LS[k], v.trim()) : localStorage.removeItem(LS[k]); };
  set('id', secretId); set('key', secretKey); set('bucket', bucket); set('region', region);
}

/* ---------------- 签名（移植自 cos-scf/index.py 的 _sign） ---------------- */

// COS V1 签名参与签名的头部白名单
const VALID_HEADERS = new Set([
  'cache-control', 'content-disposition', 'content-encoding', 'content-type',
  'content-md5', 'content-length', 'expect', 'expires', 'host', 'if-match',
  'if-modified-since', 'if-none-match', 'if-unmodified-since', 'origin', 'range',
  'transfer-encoding', 'pic-operations',
]);

// COS V1 编码：与 urllib.parse.quote(safe='-_.~') 等价
function enc(s) {
  return encodeURIComponent(String(s))
    .replace(/[!'()*~]/g, c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0').toUpperCase());
}
// 路径编码：保留 '/'（urllib.parse.quote(path, '/-_.~')）
function pathEnc(p) { return p.split('/').map(seg => enc(seg)).join('/'); }

const te = new TextEncoder();
async function sha1Hex(msg) {
  const buf = await crypto.subtle.digest('SHA-1', te.encode(msg));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
async function hmacSha1Hex(key, msg) {
  const k = typeof key === 'string' ? te.encode(key) : key;
  const m = typeof msg === 'string' ? te.encode(msg) : msg;
  const ckey = await crypto.subtle.importKey('raw', k, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', ckey, m);
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 生成 Authorization 串（V1）。method/path 用原始（未编码）值。
 * @param {string} method  GET/PUT/...
 * @param {string} path    /Photos/folder/name.jpg
 * @param {object} params  查询参数
 * @param {object} headers 请求头
 * @param {object} cfg     cosCfg()
 */
export async function cosSign(method, path, params, headers, cfg) {
  const now = Math.floor(Date.now() / 1000);
  const kt = `${now - 60};${now + 600}`;
  const hk = {};
  for (const [k, v] of Object.entries(headers || {})) {
    const lk = k.toLowerCase();
    if (VALID_HEADERS.has(lk) || lk.startsWith('x-cos-') || lk.startsWith('x-ci-')) hk[lk] = v;
  }
  if (!('host' in hk)) hk['host'] = cfg.host;
  const hs = Object.keys(hk).sort().map(k => `${enc(k)}=${enc(hk[k])}`).join('&');
  const ps = Object.keys(params || {}).sort().map(k => `${enc(k)}=${enc(params[k])}`).join('&');
  const httpStr = `${method.toLowerCase()}\n${path}\n${ps}\n${hs}\n`;
  const signKey = await hmacSha1Hex(cfg.secretKey, kt);
  const s1 = await sha1Hex(httpStr);
  const strToSign = `sha1\n${kt}\n${s1}\n`;
  const signature = await hmacSha1Hex(signKey, strToSign);
  const headerList = Object.keys(hk).sort().join(';');
  const paramList = Object.keys(params || {}).sort().join(';');
  return `q-sign-algorithm=sha1&q-ak=${cfg.secretId}&q-sign-time=${kt}&q-key-time=${kt}`
       + `&q-header-list=${headerList}&q-url-param-list=${paramList}&q-signature=${signature}`;
}

/**
 * 直传一个对象到 COS。
 * @param {string} key        对象键，如 Photos/folder/name.jpg
 * @param {Blob}   blob        内容
 * @param {string} contentType MIME
 * @param {(p:number)=>void} [onProgress] 0~1 进度回调
 */
export async function cosPut(key, blob, contentType, onProgress) {
  const cfg = cosCfg();
  if (!cosReady()) throw new Error('COS 未配置');
  const rawPath = '/' + key;
  const ctype = contentType || (blob.type || 'application/octet-stream');
  const auth = await cosSign('PUT', rawPath, null, { 'Content-Type': ctype }, cfg);
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', `https://${cfg.host}${pathEnc(rawPath)}`);
    xhr.setRequestHeader('Authorization', auth);
    xhr.setRequestHeader('Content-Type', ctype);
    if (onProgress) xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      let msg = `COS ${xhr.status}`;
      try {
        const m = /<Message>([^<]+)<\/Message>/.exec(xhr.responseText || '');
        if (m) msg += ' · ' + m[1];
      } catch { /* ignore */ }
      // 403 多半是签名 / 密钥权限问题；0 / 网络错误多半是 CORS 没开
      if (xhr.status === 403) msg += '（密钥无效或该密钥无此桶写入权限）';
      else if (xhr.status === 0) msg = '网络/CORS 拦截：请在 COS 控制台开启该域名的 PUT CORS';
      reject(new Error(msg));
    };
    xhr.onerror = () => reject(new Error('网络错误（可能被 CORS / 防盗链拦截）'));
    xhr.send(blob);
  });
}
