/* ===========================================================
 * 访客流量统计（Analytics）
 * -----------------------------------------------------------
 * 设计原则：**绝不影响页面渲染与任何既有功能**
 *   1. 全部逻辑包在 try/catch 里，任何异常都静默吞掉
 *   2. 埋点请求 fire-and-forget，不 await、不阻塞、不改 DOM
 *   3. 用 sendBeacon 优先（浏览器空闲时发送），退化到 fetch keepalive
 *   4. 页面空闲后才发（requestIdleCallback），不与首屏资源抢带宽
 *   5. 未配置 COS 中转地址时直接静默跳过
 *   6. 管理员在编辑模式下的访问不计入，避免自己刷高数据
 *
 * 数据落在自己的 COS 桶 Stats/ 前缀下，不经任何第三方。
 * 不存储原始 IP —— 服务端只保留逐日加盐的 8 位哈希用于 UV 去重。
 * =========================================================== */

const LS_RELAY = 'mg_cos_sync_url';
const LS_EDIT = 'mg_editing';
const SS_SENT = 'mg_visit_sent';     // 同一标签页会话内只上报一次，避免 hash 路由反复计数

/** 取中转地址（与上传共用同一个云函数） */
function relayBase() {
  try {
    let u = (localStorage.getItem(LS_RELAY) || '').trim();
    if (!u) return '';
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    return u;
  } catch (_) {
    return '';
  }
}

/** 管理员编辑模式：不计入访客统计 */
function isEditing() {
  try {
    return localStorage.getItem(LS_EDIT) === '1';
  } catch (_) {
    return false;
  }
}

/**
 * 上报一次访问。fire-and-forget，永不抛错。
 * 只发三个极短参数：路径 p、来源 r、本站域名 h（用于服务端判断站内跳转）。
 * UA 与 IP 由服务端从请求头取，前端不传，减少体积也更难伪造。
 */
export function trackVisit() {
  try {
    if (isEditing()) return;
    const base = relayBase();
    if (!base) return;
    // 同一会话只报一次（刷新页面算新会话，hash 切换不重复计数）
    try {
      if (sessionStorage.getItem(SS_SENT)) return;
      sessionStorage.setItem(SS_SENT, '1');
    } catch (_) { /* 隐私模式下 sessionStorage 可能不可用，忽略即可 */ }

    const p = (location.pathname + location.hash).slice(0, 120);
    const r = (document.referrer || '').slice(0, 300);
    const h = location.host;
    const sep = base.includes('?') ? '&' : '?';
    const url = `${base}${sep}action=visit&p=${encodeURIComponent(p)}`
              + `&r=${encodeURIComponent(r)}&h=${encodeURIComponent(h)}&t=${Date.now()}`;

    const fire = () => {
      try {
        // sendBeacon：浏览器择机发送，绝不阻塞主线程；失败则退回 fetch
        if (navigator.sendBeacon && navigator.sendBeacon(url)) return;
        fetch(url, { method: 'POST', mode: 'no-cors', keepalive: true, body: '' }).catch(() => {});
      } catch (_) { /* ignore */ }
    };
    // 等页面空闲再发，完全不与首屏渲染争资源
    if (typeof requestIdleCallback === 'function') requestIdleCallback(fire, { timeout: 4000 });
    else setTimeout(fire, 1600);
  } catch (_) {
    /* 统计永远不能影响正常浏览 */
  }
}

/** 拉取统计数据（仅管理面板调用） */
export async function fetchStats(days = 30) {
  const base = relayBase();
  if (!base) throw new Error('未配置 COS 中转地址');
  const sep = base.includes('?') ? '&' : '?';
  const r = await fetch(`${base}${sep}action=stats&days=${days}&t=${Date.now()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: '',
    cache: 'no-store',
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  if (!j.ok) throw new Error(j.err || '查询失败');
  return j;
}

/** 清空统计数据（可选只清 before 之前的） */
export async function clearStats(before = '') {
  const base = relayBase();
  if (!base) throw new Error('未配置 COS 中转地址');
  const r = await fetch(base, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ action: 'stats_clear', before }),
  });
  const j = await r.json();
  if (!j.ok) throw new Error(j.err || '清空失败');
  return j;
}
