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

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export const DEFAULT_DATA = {
  version: 2,
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

---

进入编辑模式后点击「编辑简介」即可替换这段文字，支持 **加粗**、列表、\`高亮\` 和链接。`,
  },
  socials: [],
  works: [
    { id: 'col-portrait', title: '人像', desc: '', items: [] },
    { id: 'col-commercial', title: '商业修图', desc: '', items: [] },
    { id: 'col-film', title: '短片', desc: '', items: [] },
  ],
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
    if (kind === 'works') return (this.data.works || []).find(c => c.id === id);
    // 兼容旧路由旧代码，兜底查 works
    return (this.data.works || []).find(c => c.id === id);
  },
};

function migrate(json) {
  const d = { ...structuredClone(DEFAULT_DATA), ...json };
  d.profile = { ...DEFAULT_DATA.profile, ...(json.profile || {}) };
  d.socials = Array.isArray(json.socials) ? json.socials : [];

  // 新版统一使用 works
  if (Array.isArray(json.works)) {
    d.works = json.works;
  } else {
    // 兼容旧版：合并 photos + videos
    d.works = [];
    const seen = new Set();
    for (const c of [...(json.photos || []), ...(json.videos || [])]) {
      if (!c || typeof c !== 'object') continue;
      let id = c.id || uid();
      if (seen.has(id)) id = `${id}-${Date.now().toString(36)}`;
      seen.add(id);
      const items = Array.isArray(c.items) ? c.items : [];
      d.works.push({
        id,
        title: c.title || '未命名专栏',
        desc: c.desc || '',
        items: items.map(it => ({
          ...it,
          kind: it.kind || (it.poster || /\.(mp4|webm|mov|m4v)(\?|$)/i.test(it.src || '') ? 'video' : 'image'),
        })),
      });
    }
  }
  for (const c of d.works) c.items = Array.isArray(c.items) ? c.items : [];

  // 清理旧字段
  delete d.photos;
  delete d.videos;
  return d;
}

/** 随机取 n 张作品作为首页展示 */
export function featuredOf(col, n = 3) {
  const arr = [...col.items];
  // Fisher-Yates 洗牌
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, n);
}
