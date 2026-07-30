/* 通用 UI 工具：toast / busy / drawer / 确认框 */

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  kids.flat().forEach(c => c !== null && c !== undefined && n.append(c.nodeType ? c : String(c)));
  return n;
}

export function esc(s = '') {
  return String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

export function toast(msg, type = '') {
  const t = el('div', { class: `toast ${type}` }, msg);
  $('#toastWrap').append(t);
  setTimeout(() => { t.style.transition = '.3s'; t.style.opacity = '0'; t.style.transform = 'translateY(10px)'; }, 2600);
  setTimeout(() => t.remove(), 3000);
}

let busyCount = 0;
export function busy(on, text = '处理中…') {
  busyCount = on ? busyCount + 1 : Math.max(0, busyCount - 1);
  $('#busyText').textContent = text;
  $('#busy').hidden = busyCount === 0;
}

/* 抽屉 */
export function openDrawer(title, contentNode) {
  $('#drawerTitle').textContent = title;
  const body = $('#drawerBody');
  body.innerHTML = '';
  body.append(contentNode);
  body.scrollTop = 0;
  $('#drawer').hidden = false;
  document.body.style.overflow = 'hidden';
  const first = body.querySelector('input,textarea,select');
  if (first) setTimeout(() => first.focus(), 120);
}
export function closeDrawer() {
  $('#drawer').hidden = true;
  document.body.style.overflow = '';
}

/* 表单辅助 */
export function field(label, inputNode, hint) {
  return el('div', { class: 'field' },
    el('label', {}, label),
    inputNode,
    hint ? el('div', { class: 'hint', html: hint }) : null
  );
}
export function input(attrs = {}) { return el('input', { type: 'text', ...attrs }); }
export function textarea(attrs = {}) { return el('textarea', attrs); }

export function actions(okText, onOk, cancelText = '取消') {
  const okBtn = el('button', { class: 'btn-solid', onclick: () => onOk(okBtn) }, okText);
  return el('div', { class: 'drawer-actions' },
    el('button', { class: 'btn-ghost', onclick: closeDrawer }, cancelText),
    okBtn
  );
}

export function confirmBox(msg) { return window.confirm(msg); }

export function fmtNum(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0) return '—';
  if (v >= 100000000) return (v / 100000000).toFixed(v % 100000000 === 0 ? 0 : 1) + '亿';
  if (v >= 10000) return (v / 10000).toFixed(v % 10000 === 0 ? 0 : 1) + '万';
  return String(v);
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* 极简 Markdown → HTML（用于简介编辑） */
export function md2html(src = '') {
  const lines = esc(src).split(/\r?\n/);
  let out = '', inList = null;
  const inline = s => s
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<em>$1</em>');
  const closeList = () => { if (inList) { out += `</${inList}>`; inList = null; } };
  for (let raw of lines) {
    const line = raw.trim();
    if (!line) { closeList(); continue; }
    if (/^---+$/.test(line)) { closeList(); out += '<hr>'; continue; }
    let m;
    if ((m = line.match(/^#{1,4}\s+(.*)$/))) { closeList(); out += `<h3>${inline(m[1])}</h3>`; continue; }
    if ((m = line.match(/^[-*+]\s+(.*)$/))) {
      if (inList !== 'ul') { closeList(); out += '<ul>'; inList = 'ul'; }
      out += `<li>${inline(m[1])}</li>`; continue;
    }
    if ((m = line.match(/^\d+[.)]\s+(.*)$/))) {
      if (inList !== 'ol') { closeList(); out += '<ol>'; inList = 'ol'; }
      out += `<li>${inline(m[1])}</li>`; continue;
    }
    closeList();
    out += `<p>${inline(line)}</p>`;
  }
  closeList();
  return out;
}
