/* ===========================================================
 * 腾讯云 COS · 浏览器经云函数（SCF）中转上传
 * -----------------------------------------------------------
 * 安全模型：COS SecretId/SecretKey 只存在于云函数服务端，
 *   浏览器通过两阶段上传：先向 SCF 要预签名 URL，再直传桶。
 *   访客浏览器完全拿不到任何 COS 凭证 —— 适合面向所有人的公开站点。
 *
 * v4.0 核心变更：新增「预签名直传」模式（cosRelayPresigned）。
 *   旧「base64 中转」模式（cosRelay）保留为小图 fallback。
 *   预签名模式彻底绕开 SCF ~6MB 体量限制，支持任意大小文件。
 *
 * 两阶段流程：
 *   Phase 1: 浏览器 POST {key, contentType} → SCF → 返回 presigned PUT URL
 *   Phase 2: 浏览器 XHR PUT 原始文件 → COS 桶（直传，无体量限制）
 *
 * 前置条件：
 *   1) 云函数环境变量：COS_SECRET_ID / COS_SECRET_KEY / COS_BUCKET / COS_REGION
 *   2) 云函数执行超时 ≥ 60s
 *   3) 云函数已开启函数 URL
 *   4) ★ COS 桶已配置 CORS 规则（允许来自 GitHub Pages 域名的 PUT）
 *      （首次部署时由 SCF 自动设置，见 index.py 的 _ensure_cors）
 * =========================================================== */

const LS_RELAY = 'mg_cos_sync_url';

/** 上传超时（毫秒），应略大于云函数执行超时 */
const UPLOAD_TIMEOUT_MS = 120_000;

/** ★ v4.0: 超过此阈值自动切换到预签名直传模式（base64 编码后约 6MB = SCF 体量上限） */
const PRESIGN_THRESHOLD_BYTES = 4 * 1024 * 1024; // 4MB 原始文件 → base64 后 ~5.3MB，安全范围内

// 清理上一版「浏览器直传」遗留在本机浏览器的 COS 密钥（现已改为服务端中转，
// 密钥不应留在前端）。无遗留则无副作用。
['mg_cos_id', 'mg_cos_key'].forEach(k => { try { localStorage.removeItem(k); } catch { /* ignore */ } });

/** 是否配置了中转地址（同一个地址同时用于上传与改名/移动同步） */
export function cosReady() {
  return !!((localStorage.getItem(LS_RELAY) || '').trim());
}

/**
 * ★ v4.0 主力上传方式：两阶段预签名直传（无体量限制）。
 *
 * Phase 1: 向 SCF POST action=presign（只传 key + contentType，几十字节）
 *          → 拿到 COS 预签名 PUT URL
 * Phase 2: XHR PUT 原始文件到该 URL（直传桶，支持任意大小）
 *
 * @param {string} key        对象键
 * @param {Blob}   blob       文件内容
 * @param {string} contentType MIME 类型
 * @param {(p:number)=>void} [onProgress] 上传进度 0~1
 * @returns {Promise<{ok:boolean,key:string,url:string}>}
 */
export function cosRelayPresigned(key, blob, contentType, onProgress) {
  const base = (localStorage.getItem(LS_RELAY) || '').trim();
  if (!base) return Promise.reject(new Error('COS 中转地址未配置'));
  let urlBase = base.trim();
  if (urlBase && !urlBase.startsWith('http://') && !urlBase.startsWith('https://')) {
    urlBase = 'https://' + urlBase;
  }

  // Phase 1: 向 SCF 要预签名 URL
  const sep = urlBase.includes('?') ? '&' : '?';
  const presignUrl = `${urlBase}${sep}action=presign&key=${encodeURIComponent(key)}`
                    + `&ct=${encodeURIComponent(contentType || 'application/octet-stream')}`;

  return fetch(presignUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '' })
    .then(r => {
      if (!r.ok) throw new Error(`预签名请求失败(HTTP ${r.status})`);
      return r.json();
    })
    .then(j => {
      if (!j.ok) throw new Error(j.err || '预签名失败');
      if (!j.putUrl) throw new Error('预签名响应缺少 putUrl');
      return j.putUrl;
    })
    // Phase 2: 用 XHR PUT 原始文件直传 COS（有真实进度、超时保护）
    .then(putUrl => new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.timeout = UPLOAD_TIMEOUT_MS;

      if (onProgress) {
        let lastT = 0;
        xhr.upload.onprogress = evt => {
          if (!evt.lengthComputable) return;
          const now = Date.now();
          if (now - lastT < 50) return;
          lastT = now;
          onProgress(Math.min(1, Math.max(0, evt.loaded / evt.total)));
        };
      }

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          const finalUrl = 'https://' + (new URL(putUrl).host) + '/' + encodeURIComponent(key).replace(/%2F/g, '/');
          resolve({ ok: true, key, url: finalUrl });
        } else {
          reject(new Error(`COS 直传返回 HTTP ${xhr.status}`));
        }
      };
      xhr.onerror = () => reject(new Error('COS 直传网络错误或跨域拦截（请确认桶 CORS 已配置允许来自本站的 PUT）'));
      xhr.ontimeout = () => { xhr.abort(); reject(new Error(`COS 直传超时（${UPLOAD_TIMEOUT_MS / 1000}s）`)); };
      xhr.onabort = () => reject(new Error('上传已取消'));

      xhr.open('PUT', putUrl, true);
      xhr.setRequestHeader('Content-Type', contentType || 'application/octet-stream');
      xhr.send(blob);
    }));
}

/**
 * 经云函数中转上传（v3 兼容模式：base64 中转，受 ~6MB 体量限制）。
 *
 * v4.0 起仅作为 cosRelayPresigned 的 fallback（小图/旧浏览器兼容）。
 * 大图会自动切换到预签名直传模式。
 *
 * @param {string} key
 * @param {Blob}   blob
 * @param {string} contentType
 * @param {(p:number)=>void} [onProgress]
 * @returns {Promise<{ok:boolean,key:string,url:string}>}
 */
export function cosRelay(key, blob, contentType, onProgress) {
  // ★ v4.0 智能路由：大图自动走预签名直传（无体量限制）
  if (blob && blob.size > PRESIGN_THRESHOLD_BYTES) {
    console.log('[cos] 文件', (blob.size / 1024 / 1024).toFixed(1), 'MB > 阈值，使用预签名直传');
    return cosRelayPresigned(key, blob, contentType, onProgress);
  }
  // 小图：沿用 v3 base64 中转（兼容性好，无需桶 CORS）
  const base = (localStorage.getItem(LS_RELAY) || '').trim();
  if (!base) throw new Error('COS 中转地址未配置');

  // 自动补全 https:// 前缀（用户可能只填了域名）
  let urlBase = base.trim();
  if (urlBase && !urlBase.startsWith('http://') && !urlBase.startsWith('https://')) {
    urlBase = 'https://' + urlBase;
  }

  // 真实 MIME 通过 query 参数 ct 传给云函数；请求头固定用 text/plain
  // （「简单请求」Content-Type，避免触发 CORS 预检 OPTIONS）
  const sep = urlBase.includes('?') ? '&' : '?';
  const url = `${urlBase}${sep}action=upload&key=${encodeURIComponent(key)}`
           + `&ct=${encodeURIComponent(contentType || 'application/octet-stream')}`;

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    // ★ 超时保护：120 秒内未完成则自动 abort
    xhr.timeout = UPLOAD_TIMEOUT_MS;

    let lastProgressTime = 0;
    const PROGRESS_THROTTLE_MS = 50; // 节流，避免高频更新 DOM

    // ★ 真实上传进度上报（这是 fetch 做不到的）
    xhr.upload.onprogress = (evt) => {
      if (!evt.lengthComputable || !onProgress) return;
      const now = Date.now();
      if (now - lastProgressTime < PROGRESS_THROTTLE_MS) return;
      lastProgressTime = now;
      const p = evt.loaded / evt.total;
      onProgress(Math.min(1, Math.max(0, p)));
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const j = JSON.parse(xhr.responseText);
          if (j.ok) return resolve(j);
          reject(new Error(j.err || `云函数业务失败(HTTP ${xhr.status})`));
        } catch (_) {
          reject(new Error(`云函数响应非JSON(HTTP ${xhr.status}): ${xhr.responseText.slice(0, 200)}`));
        }
      } else {
        // HTTP 错误（4xx / 5xx）—— 尝试解析错误体
        let detail = '';
        try { const j = JSON.parse(xhr.responseText || '{}'); detail = j.err || ''; } catch (_) { detail = xhr.responseText.slice(0, 120); }
        reject(new Error(`云函数返回 HTTP ${xhr.status}${detail ? ': ' + detail : ''}`));
      }
    };

    xhr.onerror = () => {
      // onerror 在网络层失败 / CORS 拦截时触发（无法读取 status/responseText）
      reject(new Error(
        '网络错误或跨域拦截：无法连接云函数。' +
        '可能原因：① 手机网络不稳 ② 运营商劫持 HTTPS ③ 云函数未开 CORS。' +
        '建议：切换 WiFi/4G 重试，或在管理面板运行「连通性诊断」。'
      ));
    };

    xhr.ontimeout = () => {
      xhr.abort();
      reject(new Error(`上传超时（${UPLOAD_TIMEOUT_MS / 1000}s）：文件较大或网络不稳定，请检查网络后重试`));
    };

    xhr.onabort = () => {
      reject(new Error('上传已取消'));
    };

    xhr.open('POST', url, true);
    xhr.setRequestHeader('Content-Type', 'text/plain');
    // ★ v3 核心：把 Blob 转成 base64 字符串发送。
    //   腾讯云函数 URL 会把 text/plain 的二进制 body 按 UTF-8 转字符串、丢字节；
    //   改发 base64 字符串，云函数再 base64 解回原始字节，图片完整进桶。
    //   text/plain 是「简单请求」，不触发 CORS 预检，手机端最稳。
    blobToBase64(blob).then(b64 => xhr.send(b64))
      .catch(e => reject(new Error('文件转 base64 失败：' + (e.message || e))));
  });
}

/** Blob/File → base64 字符串（去掉 data: 前缀） */
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const d = r.result || '';
      const i = d.indexOf(',');
      resolve(i >= 0 ? d.slice(i + 1) : d);
    };
    r.onerror = () => reject(r.error || new Error('读取文件失败'));
    r.readAsDataURL(blob);
  });
}

/**
 * 连通性诊断测试（3 步递进，用于排查手机端 onerror 根因）。
 * 返回每步的结果描述数组，可在控制台查看或展示给用户。
 */
export async function cosDiagnose() {
  let base = (localStorage.getItem(LS_RELAY) || '').trim();
  if (!base) return [{ step: '配置', ok: false, msg: '未配置中转地址' }];
  // 自动补全 https://
  if (!base.startsWith('http://') && !base.startsWith('https://')) base = 'https://' + base;
  const results = [];

  // Step 1: Image 加载测试（最轻量，测基本跨域可达性）
  results.push(await new Promise(r => {
    const img = new Image();
    img.onload = () => r({ step: '1-Image', ok: true, msg: 'Image 可加载 ✅' });
    img.onerror = () => r({ step: '1-Image', ok: false, msg: 'Image 加载失败 ❌' });
    img.src = base + '?t=' + Date.now();
    setTimeout(() => r({ step: '1-Image', ok: false, msg: 'Image 超时 ❌' }), 8000);
  }));

  // Step 2: fetch GET 测试（测 fetch API 跨域可达性）
  try {
    const r = await fetch(base + '?action=diag', { method: 'GET', cache: 'no-store' });
    results.push({ step: '2-fetchGET', ok: true, msg: `fetch GET ${r.status} ✅` });
  } catch (e) {
    results.push({ step: '2-fetchGET', ok: false, msg: `fetch GET 失败: ${e.message} ❌` });
  }

  // Step 3: fetch POST 测试（测 base64 中传路径，发 1 字节）
  try {
    const r = await fetch(base + '?action=upload&key=__diag__&ct=text/plain', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'x',
    });
    const t = await r.text();
    results.push({ step: '3-fetchPOST', ok: true, msg: `fetch POST ${r.status}: ${t.slice(0,80)} ✅` });
  } catch (e) {
    results.push({ step: '3-fetchPOST', ok: false, msg: `fetch POST 失败: ${e.message} ❌` });
  }

  // Step 4: presign 测试（测 v4.0 预签名直传路径）
  try {
    const r = await fetch(base + '?action=presign&key=__diag_presign__&ct=image/jpeg', {
      method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '',
    });
    const j = await r.json();
    if (j.ok && j.putUrl) {
      results.push({ step: '4-presign', ok: true, msg: `presign OK, putUrl 长度 ${j.putUrl.length} ✅` });
    } else {
      results.push({ step: '4-presign', ok: false, msg: `presign 失败: ${(j.err||'').slice(0,80)} ❌` });
    }
  } catch (e) {
    results.push({ step: '4-presign', ok: false, msg: `presign 失败: ${e.message} ❌` });
  }

  return results;
}
