/* 入口：渲染 · 路由 · 灯箱 */
import { $, $$, el, fmtNum, md2html, closeDrawer } from './ui.js';
import { store, featuredOf, placeholder } from './store.js';
import { PLATFORMS } from './social.js';
import * as admin from './admin.js';

/* ============ 渲染 ============ */

export function renderAll() {
  renderHero();
  renderBio();
  renderSocials();
  renderCollections('photos', $('#photoCollections'));
  renderCollections('videos', $('#videoCollections'));
  $('#year').textContent = new Date().getFullYear();
  $('#footMark').textContent = store.data.profile.name || 'MiragedGeist';
  document.title = store.data.profile.name || 'MiragedGeist';
}

function renderHero() {
  const p = store.data.profile;
  $('#heroCover').style.backgroundImage = `url("${p.cover || placeholder('', 1600, 700, '#161428', '#241a3d')}")`;
  $('#heroAvatar').src = p.avatar || placeholder(String(p.name || 'M').slice(0, 1).toUpperCase(), 400, 400, '#2a2140', '#3a2a5e');
  $('#heroAvatar').referrerPolicy = 'no-referrer';
  $('#heroName').textContent = p.name || 'MiragedGeist';
  $('#heroTagline').textContent = p.tagline || '';
  const meta = $('#heroMeta');
  meta.innerHTML = '';
  (p.chips || []).filter(Boolean).forEach(c => meta.append(el('span', { class: 'chip' }, c)));
}

function renderBio() {
  $('#bioBox').innerHTML = md2html(store.data.profile.bio || '');
  $$('#bioBox a').forEach(a => { a.target = '_blank'; a.rel = 'noopener'; });
}

function renderSocials() {
  const grid = $('#socialGrid');
  grid.innerHTML = '';
  const list = store.data.socials || [];
  if (!list.length) {
    grid.append(el('div', { class: 'empty', style: 'grid-column:1/-1;padding:34px 0' },
      store.editing ? '还没有社媒卡片，点右上角「粘贴链接添加」' : '暂未添加社交媒体'));
    return;
  }
  list.forEach((s, idx) => grid.append(socialCard(s, idx)));
}

function socialCard(s, idx) {
  const P = PLATFORMS[s.platform] || PLATFORMS.link;
  const stats = (s.stats || []).map(Number);
  const statNodes = P.labels.map((lab, i) =>
    (lab && stats[i] >= 0)
      ? el('div', { class: 'sc-stat' }, el('b', {}, fmtNum(stats[i])), el('span', {}, lab))
      : null
  ).filter(Boolean);

  const card = el('div', { class: 'social-card', style: `--brand:${P.color}` },
    el('a', {
      href: s.url, target: '_blank', rel: 'noopener me',
      'aria-label': `${P.name} · ${s.name || ''}`,
      style: 'position:absolute;inset:0;z-index:1',
    }),
    el('div', { class: 'sc-avwrap' },
      el('img', {
        class: 'sc-av', loading: 'lazy', referrerpolicy: 'no-referrer',
        src: s.avatar || placeholder(P.badge, 200, 200, '#1c1c2a', P.color + '55'),
        alt: s.name || P.name,
        onerror: e => { e.target.src = placeholder(P.badge, 200, 200, '#1c1c2a', P.color + '55'); },
      }),
      el('span', { class: 'sc-badge', title: P.name }, P.badge)
    ),
    el('div', { class: 'sc-main' },
      el('div', { class: 'sc-name' }, s.name || P.name),
      el('div', { class: 'sc-plat' }, [P.name, s.handle].filter(Boolean).join(' · ')),
      statNodes.length ? el('div', { class: 'sc-stats' }, statNodes) : null
    ),
    el('span', { class: 'sc-go' }, '↗'),
    el('div', { class: 'sc-tools' },
      el('button', { class: 'mini-btn', title: '上移', onclick: e => { e.stopPropagation(); admin.moveSocial(idx, -1); } }, '↑'),
      el('button', { class: 'mini-btn', title: '编辑', onclick: e => { e.stopPropagation(); admin.openSocialForm(s); } }, '✎'),
      el('button', { class: 'mini-btn danger', title: '删除', onclick: e => { e.stopPropagation(); admin.removeSocial(s.id); } }, '✕')
    )
  );
  return card;
}

function renderCollections(kind, host) {
  host.innerHTML = '';
  const list = store.data[kind] || [];
  if (!list.length) {
    host.append(el('div', { class: 'empty' },
      store.editing ? '还没有专栏，点右上角「新建专栏」开始' : '作品整理中'));
    return;
  }
  list.forEach(col => host.append(collectionCard(kind, col)));
}

function collectionCard(kind, col) {
  const picks = featuredOf(col, 3);
  const tiles = picks.map((it, i) => tile(kind, it, () => openLightbox(picks, i)));
  if (store.editing) {
    while (tiles.length < 3) tiles.push(el('div', { class: 'tile tile-add', onclick: () => admin.uploadTo(kind, col.id) }, '+'));
  }
  return el('div', { class: 'collection' },
    el('div', { class: 'col-head' },
      el('div', {},
        el('div', { class: 'col-title' }, col.title || '未命名专栏',
          el('span', { class: 'col-count' }, `${col.items.length} 件`)),
        col.desc ? el('div', { class: 'col-desc' }, col.desc) : null
      ),
      el('a', { class: 'col-more', href: `#/c/${kind}/${col.id}` }, '查看全部 ', el('span', {}, '→'))
    ),
    el('div', { class: 'tri' }, tiles)
  );
}

function tile(kind, it, onClick) {
  const isVideo = kind === 'videos';
  const media = isVideo && !it.poster
    ? el('video', { src: it.src, preload: 'metadata', muted: 'muted', playsinline: '' })
    : el('img', {
        src: (isVideo ? it.poster : (it.thumb || it.src)) || placeholder('作品'),
        loading: 'lazy', referrerpolicy: 'no-referrer', alt: it.title || '',
      });
  return el('div', { class: `tile${isVideo ? ' video' : ''}`, onclick: onClick },
    media,
    isVideo ? el('span', { class: 'play-badge' }) : null,
    it.title ? el('div', { class: 'tile-cap' }, it.title) : null,
    el('span', { class: `tile-star${it.star ? ' on' : ''}` }, '精选')
  );
}

/* ============ 专栏详情 ============ */

let currentDetail = null;

function renderDetail(kind, id) {
  const col = store.findCollection(kind, id);
  if (!col) { location.hash = ''; return; }
  currentDetail = { kind, id };
  $('#detailTitle').textContent = col.title || '未命名专栏';
  $('#detailDesc').textContent = col.desc || '';
  const grid = $('#detailGrid');
  grid.innerHTML = '';
  $('#detailEmpty').hidden = col.items.length > 0;

  col.items.forEach((it, i) => {
    const isVideo = kind === 'videos';
    const media = isVideo
      ? el('video', { src: it.src, poster: it.poster || '', controls: '', preload: 'metadata', playsinline: '' })
      : el('img', { src: it.src, loading: 'lazy', referrerpolicy: 'no-referrer', alt: it.title || '' });
    const node = el('div', { class: 'm-item' },
      media,
      (it.title || it.desc) ? el('div', { class: 'm-cap' }, [it.title, it.desc].filter(Boolean).join(' · ')) : null,
      el('div', { class: 'tile-tools' },
        el('button', { class: 'mini-btn', title: '设为精选', onclick: e => { e.stopPropagation(); admin.toggleStar(kind, id, it.id); } }, it.star ? '★' : '☆'),
        el('button', { class: 'mini-btn', title: '改标题', onclick: e => { e.stopPropagation(); admin.renameItem(kind, id, it.id); } }, '✎'),
        el('button', { class: 'mini-btn danger', title: '删除', onclick: e => { e.stopPropagation(); admin.removeItem(kind, id, it.id); } }, '✕')
      )
    );
    if (!isVideo) media.addEventListener('click', () => openLightbox(col.items, i));
    grid.append(node);
  });

  $('#detailUpload').onclick = () => admin.uploadTo(kind, id);
  $('#detailEdit').onclick = () => admin.openCollectionForm(kind, col);
  $('#detailDelete').onclick = () => admin.removeCollection(kind, id);
}

/* ============ 灯箱 ============ */

let lbItems = [], lbIndex = 0;

export function openLightbox(items, index) {
  lbItems = items; lbIndex = index;
  $('#lightbox').hidden = false;
  document.body.style.overflow = 'hidden';
  paintLightbox();
}
function paintLightbox() {
  const it = lbItems[lbIndex];
  if (!it) return;
  const stage = $('#lbStage');
  stage.innerHTML = '';
  const isVideo = /\.(mp4|webm|mov|m4v)(\?|$)/i.test(it.src || '') || it.kind === 'video';
  stage.append(isVideo
    ? el('video', { src: it.src, controls: '', autoplay: '', playsinline: '', poster: it.poster || '' })
    : el('img', { src: it.src, referrerpolicy: 'no-referrer', alt: it.title || '' }));
  $('#lbCap').textContent = [it.title, it.desc].filter(Boolean).join(' · ');
  const multi = lbItems.length > 1;
  $('#lbPrev').hidden = !multi; $('#lbNext').hidden = !multi;
}
function closeLightbox() {
  $('#lightbox').hidden = true;
  $('#lbStage').innerHTML = '';
  document.body.style.overflow = '';
}
function step(d) { lbIndex = (lbIndex + d + lbItems.length) % lbItems.length; paintLightbox(); }

/* ============ 路由 ============ */

function route() {
  const h = location.hash;
  const m = h.match(/^#\/c\/(photos|videos)\/(.+)$/);
  if (m) {
    $('#view-home').hidden = true;
    $('#view-detail').hidden = false;
    renderDetail(m[1], m[2]);
    window.scrollTo(0, 0);
    return;
  }
  $('#view-detail').hidden = true;
  $('#view-home').hidden = false;
  currentDetail = null;
  if (h === '#admin') { history.replaceState(null, '', location.pathname + location.search); admin.openConsole(); }
}

export function refresh() {
  renderAll();
  if (currentDetail) renderDetail(currentDetail.kind, currentDetail.id);
}

/* ============ 启动 ============ */

async function init() {
  const ok = await store.load();
  renderAll();
  route();

  window.addEventListener('hashchange', route);
  window.addEventListener('mg:render', refresh);

  $('#backBtn').onclick = () => { if (history.length > 1) history.back(); else location.hash = ''; };
  $('#lbClose').onclick = closeLightbox;
  $('#lbPrev').onclick = () => step(-1);
  $('#lbNext').onclick = () => step(1);
  $('#lightbox').addEventListener('click', e => { if (e.target.id === 'lightbox') closeLightbox(); });
  document.addEventListener('keydown', e => {
    if ($('#lightbox').hidden) return;
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowLeft') step(-1);
    if (e.key === 'ArrowRight') step(1);
  });

  $('#adminKey').onclick = () => admin.openConsole();
  $$('[data-edit]').forEach(b => b.onclick = () => admin.handleEdit(b.dataset.edit));
  $$('[data-close-drawer]').forEach(b => b.onclick = closeDrawer);

  admin.init();
  if (!ok && !store.editing) {
    console.info('[MiragedGeist] 未找到 data/site.json，正在展示默认内容。进入管理模式发布一次即可生成。');
  }
}

init();
