/* GitHub 仓库作为后台：读写 data/site.json 与 media/ 下的图片视频 */

const LS_KEY = 'mg_gh_cfg';
const API = 'https://api.github.com';

export const gh = {
  cfg: loadCfg(),

  get ready() { return !!(this.cfg.token && this.cfg.owner && this.cfg.repo); },

  save(patch) {
    this.cfg = { ...this.cfg, ...patch };
    localStorage.setItem(LS_KEY, JSON.stringify(this.cfg));
  },
  logout() {
    localStorage.removeItem(LS_KEY);
    this.cfg = loadCfg();
  },

  async api(path, opts = {}) {
    const res = await fetch(API + path, {
      ...opts,
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(this.cfg.token ? { Authorization: `Bearer ${this.cfg.token}` } : {}),
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
        ...opts.headers,
      },
    });
    if (res.status === 404) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || `GitHub ${res.status}`);
    return data;
  },

  async whoami() {
    const u = await this.api('/user');
    if (!u) throw new Error('Token 无效');
    return u;
  },

  async repoInfo() {
    const r = await this.api(`/repos/${this.cfg.owner}/${this.cfg.repo}`);
    if (!r) throw new Error('仓库不存在或 Token 无权访问');
    return r;
  },

  contentsUrl(path) {
    const b = this.cfg.branch ? `?ref=${encodeURIComponent(this.cfg.branch)}` : '';
    return `/repos/${this.cfg.owner}/${this.cfg.repo}/contents/${encodeURI(path)}${b}`;
  },

  async getFile(path) {
    const r = await this.api(this.contentsUrl(path));
    if (!r) return null;
    return { sha: r.sha, text: r.content ? b64ToText(r.content.replace(/\n/g, '')) : '' };
  },

  /** 写入文本文件 */
  async putText(path, text, message) {
    const cur = await this.api(this.contentsUrl(path)).catch(() => null);
    return this.api(`/repos/${this.cfg.owner}/${this.cfg.repo}/contents/${encodeURI(path)}`, {
      method: 'PUT',
      body: JSON.stringify({
        message: message || `chore: update ${path}`,
        content: textToB64(text),
        sha: cur?.sha,
        branch: this.cfg.branch || undefined,
      }),
    });
  },

  /** 写入二进制（File / Blob / ArrayBuffer） */
  async putBinary(path, data, message) {
    const b64 = await toBase64(data);
    const cur = await this.api(this.contentsUrl(path)).catch(() => null);
    await this.api(`/repos/${this.cfg.owner}/${this.cfg.repo}/contents/${encodeURI(path)}`, {
      method: 'PUT',
      body: JSON.stringify({
        message: message || `feat: upload ${path}`,
        content: b64,
        sha: cur?.sha,
        branch: this.cfg.branch || undefined,
      }),
    });
    return path;
  },

  async deleteFile(path, message) {
    const cur = await this.api(this.contentsUrl(path)).catch(() => null);
    if (!cur?.sha) return;
    await this.api(`/repos/${this.cfg.owner}/${this.cfg.repo}/contents/${encodeURI(path)}`, {
      method: 'DELETE',
      body: JSON.stringify({ message: message || `chore: remove ${path}`, sha: cur.sha, branch: this.cfg.branch || undefined }),
    });
  },
};

function loadCfg() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch { /* ignore */ }
  const guessed = guessRepo();
  // 在 GitHub Pages 上，owner/repo 由域名决定；账号改名后从域名自动适配，
  // 只保留已保存的 token 与 branch，发布功能无需手动重连。
  const ownerRepo = guessed.owner ? guessed : { owner: saved.owner || '', repo: saved.repo || '' };
  return { ...ownerRepo, branch: saved.branch || 'main', token: saved.token || '' };
}

/** 从当前地址猜测 owner/repo，省去手填 */
function guessRepo() {
  const host = location.hostname;
  const seg = location.pathname.split('/').filter(Boolean);
  if (host.endsWith('.github.io')) {
    const owner = host.replace('.github.io', '');
    // 用户主页仓库 owner.github.io，或项目页 owner.github.io/repo
    const repo = seg.length && !seg[0].includes('.') ? seg[0] : `${owner}.github.io`;
    return { owner, repo };
  }
  return { owner: '', repo: '' };
}

/* ---------- 编码工具 ---------- */
export function textToB64(text) {
  const bytes = new TextEncoder().encode(text);
  return bytesToB64(bytes);
}
export function b64ToText(b64) {
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
export function bytesToB64(bytes) {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}
export async function toBase64(data) {
  if (data instanceof ArrayBuffer) return bytesToB64(new Uint8Array(data));
  if (data instanceof Blob) return bytesToB64(new Uint8Array(await data.arrayBuffer()));
  if (typeof data === 'string') return textToB64(data);
  throw new Error('不支持的数据类型');
}
