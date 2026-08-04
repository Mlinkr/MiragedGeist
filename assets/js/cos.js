/* ===========================================================
 * 腾讯云 COS · 浏览器经云函数（SCF）中转上传
 * -----------------------------------------------------------
 * 安全模型：COS SecretId/SecretKey 只存在于云函数服务端，
 *   浏览器把图片/视频 POST 到中转地址，由云函数签名后直传桶。
 *   访客浏览器完全拿不到任何 COS 凭证 —— 适合面向所有人的公开站点。
 *
 * 前置条件（在云函数部署时配置）：
 *   1) 云函数环境变量：COS_SECRET_ID / COS_SECRET_KEY / COS_BUCKET / COS_REGION
 *   2) 云函数「执行超时时间」设为 60 秒（上传大图/视频需要）
 *   3) 云函数已开启「函数 URL」或 API 网关，且允许跨域（响应头
 *      Access-Control-Allow-Origin: *，允许方法 POST/OPTIONS）
 *
 * 与直传相比：桶本身【不需要】开 PUT CORS，跨域由云函数中转地址承担。
 * =========================================================== */

const LS_RELAY = 'mg_cos_sync_url';

// 清理上一版「浏览器直传」遗留在本机浏览器的 COS 密钥（现已改为服务端中转，
// 密钥不应留在前端）。无遗留则无副作用。
['mg_cos_id', 'mg_cos_key'].forEach(k => { try { localStorage.removeItem(k); } catch { /* ignore */ } });

/** 是否配置了中转地址（同一个地址同时用于上传与改名/移动同步） */
export function cosReady() {
  return !!((localStorage.getItem(LS_RELAY) || '').trim());
}

/**
 * 经云函数中转，把一个对象传到 COS。
 * @param {string} key        对象键，如 Photos/folder/name.jpg
 * @param {Blob}   blob        内容（原始图 / 缩略图 / 视频 / 封面帧）
 * @param {string} contentType MIME
 * @param {(p:number)=>void} [onProgress] 0~1 上传进度（浏览器 → 云函数这一段）
 * @returns {Promise<{ok:boolean,key:string,url:string}>}
 */
export function cosRelay(key, blob, contentType, onProgress) {
  const base = (localStorage.getItem(LS_RELAY) || '').trim();
  if (!base) throw new Error('COS 中转地址未配置');
  const sep = base.includes('?') ? '&' : '?';
  const u = `${base}${sep}action=upload&key=${encodeURIComponent(key)}`
          + `&ct=${encodeURIComponent(contentType || 'application/octet-stream')}`;
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', u);
    xhr.setRequestHeader('Content-Type', contentType || 'application/octet-stream');
    if (onProgress) xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const j = JSON.parse(xhr.responseText || '{}');
          if (j.ok) return resolve(j);
          return reject(new Error(j.err || '云函数返回失败'));
        } catch { return reject(new Error('云函数返回无法解析')); }
      }
      let msg = `云函数 ${xhr.status}`;
      try {
        const m = /<Message>([^<]+)<\/Message>/.exec(xhr.responseText || '');
        if (m) msg += ' · ' + m[1];
      } catch { /* ignore */ }
      reject(new Error(msg));
    };
    xhr.onerror = () => reject(new Error('网络错误：无法连接云函数中转地址'));
    xhr.send(blob);
  });
}
