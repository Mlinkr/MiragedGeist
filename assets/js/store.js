/* 站点数据：加载 / 修改 / 发布 */
import { gh } from './github.js';

export const DATA_PATH = 'data/site.json';

export function placeholder(text = 'MiragedGeist', w = 800, h = 1000, c1 = '#1b1b2b', c2 = '#2a2140') {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>
<rect width="100%" height="100%" fill="url(#g)"/>
<text x="50%" y="50%" fill="#5a5a78" font-family="sans-serif" font-size="${Math.round(w / 16)}"
 text-anchor="middle" dominant-baseline="middle">${text}</text></svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

export const DEFAULT_DATA = {
  version: 1,
  profile: {
    name: 'MiragedGeist',
    tagline: '修图 · 剪辑 · 视觉叙事',
    avatar: '',
    cover: '',
    chips: ['Retouching', 'Video Editing', '接稿中'],
    bio: `这里是 **MiragedGeist**，一个把光影当语言的人。

- 人像精修 / 商业修图 / 色彩重塑
- 短片剪辑 / Vlog / 节奏与叙事
- 合作与约稿请通过下方任意平台私信

> 进入管理模式后点击「编辑简介」即可替换这段文字，支持 **加粗**、列表、\`高亮\` 和 [链接](https://github.com)。`,
  },
  socials: [],
  photos: [],
  videos: [],
  updatedAt: '',
};

export const store = {
  data: structuredClone(DEFAULT_DATA),
  dirty: false,
  editing: false,

  async load() {
    try {
      const res = await fetch(`${DATA_PATH}?t=${Date.now()}`, { cache: 'no-store' });
      if (res.ok) {
        const json = await res.json();
        this.data = migrate(json);
        return true;
      }
    } catch { /* 首次部署还没有 site.json，用默认值 */ }
    this.data = structuredClone(DEFAULT_DATA);
    return false;
  },

  mark() { this.dirty = true; window.dispatchEvent(new CustomEvent('mg:dirty')); },

  json() {
    return JSON.stringify({ ...this.data, updatedAt: new Date().toISOString() }, null, 2);
  },

  async publish() {
    if (!gh.ready) throw new Error('尚未连接 GitHub 仓库');
    this.data.updatedAt = new Date().toISOString();
    await gh.putText(DATA_PATH, this.json(), 'chore(site): 更新页面内容');
    this.dirty = false;
    window.dispatchEvent(new CustomEvent('mg:dirty'));
  },

  download() {
    const blob = new Blob([this.json()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'site.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  },

  findCollection(kind, id) {
    return (this.data[kind] || []).find(c => c.id === id);
  },
};

function migrate(json) {
  const d = { ...structuredClone(DEFAULT_DATA), ...json };
  d.profile = { ...DEFAULT_DATA.profile, ...(json.profile || {}) };
  d.socials = Array.isArray(json.socials) ? json.socials : [];
  d.photos = Array.isArray(json.photos) ? json.photos : [];
  d.videos = Array.isArray(json.videos) ? json.videos : [];
  for (const c of [...d.photos, ...d.videos]) c.items = Array.isArray(c.items) ? c.items : [];
  return d;
}

/** 精选：优先取标了星的，不足用前面的补齐到 3 个 */
export function featuredOf(col, n = 3) {
  const stars = col.items.filter(i => i.star);
  const rest = col.items.filter(i => !i.star);
  return [...stars, ...rest].slice(0, n);
}
