/* 社交媒体：链接识别 + 尽力自动抓取（失败自动降级为手动填写） */

export const PLATFORMS = {
  weibo:     { name: '微博',       badge: '微', color: '#E6162D', labels: ['粉丝', '关注', '微博'] },
  xiaohongshu:{name: '小红书',     badge: '书', color: '#FF2442', labels: ['粉丝', '关注', '笔记'] },
  douyin:    { name: '抖音',       badge: '抖', color: '#FE2C55', labels: ['粉丝', '关注', '作品'] },
  bilibili:  { name: '哔哩哔哩',   badge: 'B',  color: '#00A1D6', labels: ['粉丝', '关注', '视频'] },
  zhihu:     { name: '知乎',       badge: '知', color: '#0084FF', labels: ['关注者', '关注', '回答'] },
  wechat:    { name: '微信',       badge: '信', color: '#07C160', labels: ['读者', '', '文章'] },
  qq:        { name: 'QQ',        badge: 'Q',  color: '#12B7F5', labels: ['', '', ''] },
  instagram: { name: 'Instagram',  badge: 'IG', color: '#E1306C', labels: ['Followers', 'Following', 'Posts'] },
  x:         { name: 'X / Twitter',badge: 'X',  color: '#1d9bf0', labels: ['Followers', 'Following', 'Posts'] },
  youtube:   { name: 'YouTube',    badge: 'YT', color: '#FF0000', labels: ['Subscribers', '', 'Videos'] },
  tiktok:    { name: 'TikTok',     badge: 'TT', color: '#25F4EE', labels: ['Followers', 'Following', 'Likes'] },
  github:    { name: 'GitHub',     badge: 'GH', color: '#8b949e', labels: ['Followers', 'Following', 'Repos'] },
  behance:   { name: 'Behance',    badge: 'Be', color: '#1769FF', labels: ['Followers', 'Following', 'Projects'] },
  zcool:     { name: '站酷',       badge: '酷', color: '#F85455', labels: ['粉丝', '关注', '作品'] },
  netease:   { name: '网易云音乐', badge: '云', color: '#C20C0C', labels: ['粉丝', '关注', '动态'] },
  lofter:    { name: 'LOFTER',     badge: 'LO', color: '#3B7CFF', labels: ['粉丝', '关注', '作品'] },
  pixiv:     { name: 'pixiv',      badge: 'P',  color: '#0096FA', labels: ['粉丝', '关注', '作品'] },
  email:     { name: '邮箱',       badge: '@',  color: '#7c5cff', labels: ['', '', ''] },
  link:      { name: '网站',       badge: '链', color: '#7c5cff', labels: ['', '', ''] },
};

const RULES = [
  [/(^|\.)weibo\.(com|cn)/i, 'weibo'],
  [/xiaohongshu\.com|xhslink\.com/i, 'xiaohongshu'],
  [/douyin\.com|iesdouyin\.com/i, 'douyin'],
  [/bilibili\.com|b23\.tv/i, 'bilibili'],
  [/zhihu\.com/i, 'zhihu'],
  [/weixin\.qq\.com|mp\.weixin/i, 'wechat'],
  [/instagram\.com/i, 'instagram'],
  [/(^|\.)(x|twitter)\.com/i, 'x'],
  [/youtube\.com|youtu\.be/i, 'youtube'],
  [/tiktok\.com/i, 'tiktok'],
  [/github\.com/i, 'github'],
  [/behance\.net/i, 'behance'],
  [/zcool\.com\.cn/i, 'zcool'],
  [/music\.163\.com/i, 'netease'],
  [/lofter\.com/i, 'lofter'],
  [/pixiv\.net/i, 'pixiv'],
  [/^mailto:|^[^\s@]+@[^\s@]+\.[^\s@]+$/i, 'email'],
];

export function detectPlatform(url = '') {
  const u = url.trim();
  for (const [re, key] of RULES) if (re.test(u)) return key;
  return 'link';
}

export function normalizeUrl(raw = '') {
  let u = raw.trim();
  if (!u) return '';
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(u)) return 'mailto:' + u;
  if (!/^https?:\/\//i.test(u) && !/^mailto:/i.test(u)) u = 'https://' + u;
  return u;
}

/* ---------------- CORS 代理 ---------------- */
const PROXIES = [
  u => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  u => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
  u => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
];

async function viaProxy(url, { json = true, timeout = 9000 } = {}) {
  let lastErr;
  for (const wrap of PROXIES) {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), timeout);
      const res = await fetch(wrap(url), { signal: ctl.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error('proxy ' + res.status);
      const text = await res.text();
      return json ? JSON.parse(text) : text;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('全部代理不可用');
}

/* ---------------- 各平台抓取 ---------------- */

/** @returns {Promise<{name,avatar,stats:[n,n,n],handle}|null>} */
export async function fetchProfile(platform, url) {
  try {
    switch (platform) {
      case 'github':   return await fetchGitHub(url);
      case 'weibo':    return await fetchWeibo(url);
      case 'bilibili': return await fetchBilibili(url);
      case 'zhihu':    return await fetchZhihu(url);
      case 'youtube':  return await fetchMetaOnly(url);
      case 'instagram':
      case 'x':
      case 'behance':
      case 'pixiv':    return await fetchMetaOnly(url);
      default:         return null; // 小红书 / 抖音 / TikTok 等有签名风控，直接手动
    }
  } catch { return null; }
}

/** 哪些平台值得尝试自动抓取（用于 UI 文案） */
export const AUTO_OK = ['github', 'weibo', 'bilibili', 'zhihu', 'youtube', 'instagram', 'x', 'behance', 'pixiv'];

/** 带超时的 fetch，避免网络挂起导致界面卡死 */
async function timedFetch(url, ms = 9000, opts = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctl.signal }); }
  finally { clearTimeout(t); }
}

async function fetchGitHub(url) {
  const login = (url.match(/github\.com\/([^/?#]+)/i) || [])[1];
  if (!login) return null;
  const r = await timedFetch(`https://api.github.com/users/${login}`);
  if (!r.ok) return null;
  const d = await r.json();
  return {
    name: d.name || d.login,
    handle: '@' + d.login,
    avatar: d.avatar_url,
    stats: [d.followers, d.following, d.public_repos],
  };
}

async function fetchWeibo(url) {
  const page = url.replace(/[?#].*$/, '').replace(/\/+$/, '');
  // 1) 优先结构化接口（能拿到粉丝数）；仅当链接里直接带 UID 时尝试
  const uid = (page.match(/weibo\.(?:com|cn)\/u\/(\d{6,})/i) || [])[1];
  let structured = null;
  if (uid) {
    try { structured = await fetchWeiboStructured(uid); } catch {}
  }
  // 2) OG 标签兜底：读 PC 主页公开 HTML，无需登录，至少拿到昵称 + 头像
  let og = null;
  try { og = await fetchMetaOnly(page); } catch {}
  if (!structured && !og) return null;
  const name = (structured?.name || og?.name || '')
    .replace(/_?的?微博.*$/, '').trim(); // 去掉 "的微博_微博" 这类后缀
  return {
    name,
    handle: structured ? structured.handle : '',
    avatar: structured?.avatar || og?.avatar || '',
    stats: structured ? structured.stats : [-1, -1, -1],
  };
}

/** 移动端容器接口，能顺带拿到粉丝/关注/微博数；失败返回 null（被风控时正常） */
async function fetchWeiboStructured(uid) {
  let d = null;
  try {
    d = await viaProxy(`https://m.weibo.cn/api/container/getIndex?type=uid&value=${uid}`);
  } catch { return null; }
  const u = d?.data?.userInfo;
  if (!u) return null;
  return {
    name: u.screen_name,
    handle: '微博 UID ' + uid,
    avatar: (u.avatar_hd || u.profile_image_url || '').replace(/^http:/, 'https:'),
    stats: [u.followers_count, u.follow_count, u.statuses_count],
  };
}

async function fetchBilibili(url) {
  const mid = (url.match(/space\.bilibili\.com\/(\d+)/i) || [])[1];
  if (!mid) return null;
  const d = await viaProxy(`https://api.bilibili.com/x/web-interface/card?mid=${mid}&photo=false`);
  const c = d?.data?.card;
  if (!c) return null;
  return {
    name: c.name,
    handle: 'UID ' + mid,
    avatar: (c.face || '').replace(/^http:/, 'https:'),
    stats: [Number(c.fans), Number(c.attention), d?.data?.archive_count ?? -1],
  };
}

async function fetchZhihu(url) {
  const token = (url.match(/zhihu\.com\/people\/([^/?#]+)/i) || [])[1];
  if (!token) return null;
  const d = await viaProxy(`https://www.zhihu.com/api/v4/members/${token}?include=follower_count,following_count,answer_count`);
  if (!d || d.error) return null;
  return {
    name: d.name,
    handle: '@' + token,
    avatar: (d.avatar_url || '').replace(/_(is|xl|l)\./, '_xl.').replace(/^http:/, 'https:'),
    stats: [d.follower_count, d.following_count, d.answer_count],
  };
}

/** 通用兜底：抓页面 OG 标签，至少拿到昵称和头像 */
async function fetchMetaOnly(url) {
  const html = await viaProxy(url, { json: false, timeout: 11000 });
  if (typeof html !== 'string' || html.length < 50) return null;
  const pick = (...res) => {
    for (const re of res) { const m = html.match(re); if (m) return m[1]; }
    return '';
  };
  const title = pick(
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i,
    /<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)/i,
    /<title[^>]*>([^<]{1,80})<\/title>/i
  );
  const image = pick(
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)/i
  );
  const desc = pick(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)/i);
  // 从描述里尽力抠出粉丝数，例如 "1.2M Followers" / "1,234 subscribers"
  const num = s => {
    const m = desc.match(s);
    if (!m) return -1;
    let v = parseFloat(m[1].replace(/,/g, ''));
    if (/K/i.test(m[0])) v *= 1e3;
    if (/M/i.test(m[0])) v *= 1e6;
    if (/万/.test(m[0])) v *= 1e4;
    return Math.round(v);
  };
  if (!title && !image) return null;
  return {
    name: (title || '').split(/[|·\-—(（]/)[0].trim().replace(/^\(?@/, '@'),
    handle: '',
    avatar: image ? image.replace(/&amp;/g, '&') : '',
    stats: [
      num(/([\d.,]+[KM万]?)\s*(?:Followers|followers|subscribers|订阅|粉丝)/),
      num(/([\d.,]+[KM万]?)\s*(?:Following|following|关注)/),
      num(/([\d.,]+[KM万]?)\s*(?:Posts|posts|videos|视频|作品)/),
    ],
  };
}
