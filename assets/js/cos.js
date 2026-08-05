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
 *
 * v2 修复说明：
 *   - 改用 XMLHttpRequest 替代 fetch：XHR 的 upload.onprogress 能真实上报
 *     上传进度（fetch API 不支持上传进度），解决「一直显示上传中」的假死感。
 *   - 新增 120 秒超时自动取消：手机网络波动时不再无限挂起。
 *   - 超时 / 取消 / 网络 / 服务端 四类错误分别给出明确提示。
 * =========================================================== */

const LS_RELAY = 'mg_cos_sync_url';

/** 上传超时（毫秒），应略大于云函数执行超时 */
const UPLOAD_TIMEOUT_MS = 120_000;

// 清理上一版「浏览器直传」遗留在本机浏览器的 COS 密钥（现已改为服务端中转，
// 密钥不应留在前端）。无遗留则无副作用。
['mg_cos_id', 'mg_cos_key'].forEach(k => { try { localStorage.removeItem(k); } catch { /* ignore */ } });

/** 是否配置了中转地址（同一个地址同时用于上传与改名/移动同步） */
export function cosReady() {
  return !!((localStorage.getItem(LS_RELAY) || '').trim());
}

/**
 * 经云函数中转，把一个对象传到 COS。
 *
 * 内部使用 XMLHttpRequest（而非 fetch），原因：
 *   - XHR.upload.onprogress 可实时报告上传进度（fetch 无此能力）
 *   - XHR.timeout + xhr.abort() 可靠地实现超时取消
 *   - 手机浏览器对 XHR POST 的兼容性久经考验
 *
 * @param {string} key        对象键，如 Photos/folder/name.jpg
 * @param {Blob}   blob        内容（原始图 / 缩略图 / 视频 / 封面帧）
 * @param {string} contentType MIME
 * @param {(p:number)=>void} [onProgress] 0~1 上传进度回调（每 ~50ms 触发一次）
 * @returns {Promise<{ok:boolean,key:string,url:string}>}
 */
export function cosRelay(key, blob, contentType, onProgress) {
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
          reject(new Error(j.err || '云函数返回失败'));
        } catch (_) {
          reject(new Error(`云函数 ${xhr.status}: ${xhr.responseText.slice(0, 200)}`));
        }
      } else {
        // HTTP 错误（4xx / 5xx）
        try {
          const j = JSON.parse(xhr.responseText || '{}');
          reject(new Error(j.err || `云函数 ${xhr.status}`));
        } catch (_) {
          reject(new Error(`云函数 ${xhr.status}: ${xhr.responseText.slice(0, 200)}`));
        }
      }
    };

    xhr.onerror = () => {
      reject(new Error('网络错误：无法连接云函数（DNS/TLS/CORS 拦截或离线）'));
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
    xhr.send(blob);
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

  // Step 3: fetch POST 测试（测实际上传路径，发 1 字节）
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

  return results;
}
