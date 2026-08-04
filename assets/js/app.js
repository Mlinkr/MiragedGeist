/* 入口：渲染 · 路由 · 灯箱 */
import { $, $$, el, fmtNum, md2html, closeDrawer, openDrawer, field, actions, toast } from './ui.js';
import { store, featuredOf, placeholder } from './store.js';
import { PLATFORMS } from './social.js';
import * as admin from './admin.js';

/* ============ 渲染 ============ */

export function renderAll() {
  renderHero();
  renderBio();
  renderSocials();
  renderCollections('works', $('#workCollections'));
  paintFilmHome();
  $('#year').textContent = new Date().getFullYear();
  $('#footMark').textContent = store.data.profile.name || 'MiragedGeist';
  document.title = store.data.profile.name || 'MiragedGeist';
  renderUpdated();
}

/* 页脚“更新于 X 前”：从 data.site.json 的 updatedAt 计算，并定时刷新 */
function fmtAgo(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (isNaN(t)) return '';
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return '刚刚';
  if (s < 3600) return Math.floor(s / 60) + ' 分钟前';
  if (s < 86400) return Math.floor(s / 3600) + ' 小时前';
  if (s < 604800) return Math.floor(s / 86400) + ' 天前';
  if (s < 2592000) return Math.floor(s / 604800) + ' 周前';
  if (s < 31536000) return Math.floor(s / 2592000) + ' 个月前';
  return Math.floor(s / 31536000) + ' 年前';
}
function renderUpdated() {
  const node = document.getElementById('updatedAt');
  if (!node) return;
  const ago = fmtAgo(store.data && store.data.updatedAt);
  node.textContent = ago ? '更新于 ' + ago : '';
}
setInterval(renderUpdated, 60000);

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

function brandTile(P, custom) {
  if (custom) {
    const img = el('img', { class: 'sc-av', src: custom, alt: P.name, style: `--brand:${P.color};background:${P.color}` });
    img.onerror = () => {
      const div = el('div', { class: 'sc-av brand-tile', style: `--brand:${P.color};background:${P.color}` });
      div.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${P.icon}"/></svg>`;
      img.replaceWith(div);
    };
    return img;
  }
  const div = el('div', { class: 'sc-av brand-tile', style: `--brand:${P.color};background:${P.color}` });
  div.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${P.icon}"/></svg>`;
  return div;
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
      brandTile(P, s.icon)
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
  const pager = $('#workPager');
  if (pager) pager.hidden = true;
  let list = store.data[kind] || [];
  // 修图产出：按专栏名搜索过滤（定位到相关专栏）
  if (kind === 'works' && workSearchTerm) {
    const t = workSearchTerm.toLowerCase();
    list = list.filter(c => (c.title || '').toLowerCase().includes(t));
  }
  if (!list.length) {
    host.append(el('div', { class: 'empty' },
      workSearchTerm ? '没有匹配的专栏' : (store.editing ? '还没有专栏，点右上角「新建专栏」开始' : '作品整理中')));
    return;
  }
  // 修图产出：搜索时展示全部匹配结果；未搜索时分页（3 个/页）
  let pageItems = list;
  if (kind === 'works' && !workSearchTerm) {
    const totalPages = Math.ceil(list.length / WORK_PAGE_SIZE);
    if (workPage >= totalPages) workPage = totalPages - 1;
    if (workPage < 0) workPage = 0;
    const start = workPage * WORK_PAGE_SIZE;
    pageItems = list.slice(start, start + WORK_PAGE_SIZE);
    if (totalPages > 1) renderPager(pager, totalPages, workPage, p => {
      workPage = p;
      renderCollections('works', host);
      // 翻页不跳顶，保持当前滚动位置
    });
  }
  pageItems.forEach(col => host.append(collectionCard(kind, col)));
}

function collectionCard(kind, col) {
  const idx = store.data[kind].indexOf(col);
  const picks = featuredOf(col, 3);
  const tiles = picks.map((it, i) => tile(kind, it, () => openLightbox(picks, i)));
  // 不足 3 格补预留框：编辑态可点击上传，访客态显示优雅占位
  while (tiles.length < 3) tiles.push(slot(kind, col.id, tiles.length));

  const titleNode = el('div', { class: 'col-title' },
    el('span', {
      class: 'col-title-text' + (store.editing ? ' editable' : ''),
      title: store.editing ? '点击编辑或删除专栏' : '',
      onclick: store.editing ? (e => { e.stopPropagation(); admin.openCollectionForm(col); }) : null,
    }, col.title || '未命名专栏'),
    el('span', { class: 'col-count small' }, `${col.items.length} 件`),
    el('span', { class: 'col-flex' }),
    el('a', { class: 'col-more icon', href: `#/c/${kind}/${col.id}`, title: '查看全部' }, '→'),
    el('span', { class: 'col-tools' },
      el('button', { class: 'mini-btn', title: '编辑 / 删除', onclick: e => { e.stopPropagation(); admin.openCollectionForm(col); } }, '✎'),
      el('button', { class: 'mini-btn', title: '上移', onclick: e => { e.stopPropagation(); admin.moveCollection(kind, idx, -1); } }, '↑'),
      el('button', { class: 'mini-btn', title: '下移', onclick: e => { e.stopPropagation(); admin.moveCollection(kind, idx, 1); } }, '↓'),
      el('button', { class: 'mini-btn danger', title: '删除专栏', onclick: e => { e.stopPropagation(); admin.removeCollection(kind, col.id); } }, '✕')
    )
  );

  return el('div', { class: 'collection' },
    el('div', { class: 'col-head' },
      el('div', { class: 'col-head-l' },
        titleNode,
        col.desc ? el('div', { class: 'col-desc' }, col.desc) : null
      )
    ),
    el('div', { class: 'tri' }, tiles)
  );
}

/** 预留矩形框：编辑态点击上传作品，访客态显示占位 */
function slot(kind, colId, i) {
  if (!store.editing) {
    return el('div', { class: 'tile tile-slot' },
      el('div', { class: 'slot-inner' },
        el('div', { class: 'slot-icon' }, '✦'),
        el('div', { class: 'slot-text' }, '敬请期待')
      )
    );
  }
  return el('div', {
    class: 'tile tile-slot editable',
    title: '点击上传作品（图片/视频，最多 9 个）',
    onclick: () => admin.uploadTo(kind, colId),
  },
    el('div', { class: 'slot-inner' },
      el('div', { class: 'slot-plus' }, '+'),
      el('div', { class: 'slot-text' }, '上传作品'),
      el('div', { class: 'slot-sub' }, `第 ${i + 1} 位`)
    )
  );
}

function tile(kind, it, onClick) {
  const isVideo = it.kind === 'video' || /\.(mp4|webm|mov|m4v)(\?|$)/i.test(it.src || '');
  const thumb = isVideo ? (it.poster || it.thumb) : (it.thumb || it.src);
  const media = isVideo && !thumb
    ? el('video', { src: it.src, preload: 'metadata', muted: 'muted', playsinline: '' })
    : el('img', {
        src: thumb || placeholder('作品'),
        loading: 'lazy', referrerpolicy: 'no-referrer', alt: it.title || '',
      });
  return el('div', { class: `tile${isVideo ? ' video' : ''}`, onclick: onClick },
    media,
    isVideo ? el('span', { class: 'play-badge' }) : null,
    it.title ? el('div', { class: 'tile-cap' }, it.title) : null,
    el('span', { class: `tile-star${it.star ? ' on' : ''}` }, '精选')
  );
}

/* ============ 影视Cut 渲染 ============ */

/** 首页：展示前 4 部影视 */
function paintFilmHome() {
  const host = $('#filmHome');
  host.innerHTML = '';
  const list = store.data.films || [];
  if (!list.length) {
    host.append(el('div', { class: 'empty', style: 'grid-column:1/-1' },
      store.editing ? '还没有影视，点右上角「+ 添加影视」' : '影视资料整理中'));
    return;
  }
  list.slice(0, 4).forEach(f => host.append(filmCard(f)));
}

function truncate(s = '', n = 50) {
  s = String(s).replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function filmCard(film) {
  const img = el('img', {
    src: film.image || placeholder('影视', 600, 800),
    loading: 'lazy', referrerpolicy: 'no-referrer', alt: film.title || '',
  });
  return el('div', { class: 'film-card' },
    el('div', { class: 'film-thumb', onclick: () => openFilmModal(film) },
      img,
      el('span', { class: 'film-play', title: '查看详情' }, '▦'),
      store.editing ? el('div', { class: 'film-tools' },
        el('button', { class: 'mini-btn', title: '编辑', onclick: e => { e.stopPropagation(); admin.openFilmForm(film); } }, '✎'),
        el('button', { class: 'mini-btn danger', title: '删除', onclick: e => { e.stopPropagation(); admin.removeFilm(film.id); } }, '✕')
      ) : null
    ),
    el('div', { class: 'film-meta' },
      el('div', { class: 'film-title' }, film.title || '未命名影视'),
      film.desc ? el('div', { class: 'film-desc' }, truncate(film.desc, 44)) : null
    )
  );
}

/** 影视Cut 列表：全部 + 搜索 + 分页（>30 分页） */
function paintFilmsList() {
  const list = (store.data.films || [])
    .filter(f => !filmSearchTerm || (f.title || '').toLowerCase().includes(filmSearchTerm.toLowerCase()));
  const grid = $('#filmList');
  grid.innerHTML = '';

  const totalPages = list.length ? Math.ceil(list.length / FILM_PAGE_SIZE) : 1;
  if (filmListPage >= totalPages) filmListPage = totalPages - 1;
  if (filmListPage < 0) filmListPage = 0;
  const start = filmListPage * FILM_PAGE_SIZE;
  const pageItems = list.slice(start, start + FILM_PAGE_SIZE);

  $('#filmEmpty').hidden = list.length > 0;
  if (!list.length) $('#filmEmpty').textContent = filmSearchTerm ? '没有匹配的影视' : (store.editing ? '还没有影视，点右上角「+ 添加影视」' : '还没有影视资料');

  pageItems.forEach(f => grid.append(filmCard(f)));
  renderPager($('#filmPager'), totalPages, filmListPage, p => { filmListPage = p; paintFilmsList(); }); // 翻页不跳顶，保持当前滚动位置
}

/* ============ 影视信息弹层 ============ */

function openFilmModal(film) {
  filmModalFilm = film;
  const box = $('#filmbox');
  $('#filmboxImg').src = film.image || placeholder('影视', 600, 800);
  $('#filmboxImg').alt = film.title || '';
  $('#filmboxImg').referrerPolicy = 'no-referrer';
  $('#filmboxTitle').textContent = film.title || '未命名影视';
  $('#filmboxDesc').innerHTML = md2html(film.desc || '');
  $$('#filmboxDesc a').forEach(a => { a.target = '_blank'; a.rel = 'noopener'; });
  const links = $('#filmboxLinks');
  links.innerHTML = '';
  const usable = (film.links || []).filter(l => l.url);
  if (!usable.length) {
    links.append(el('div', { class: 'hint' }, '暂无网盘资源链接'));
  } else {
    usable.forEach(l => {
      links.append(el('a', {
        class: 'netdisk-link', href: l.url, target: '_blank', rel: 'noopener',
        title: '打开 / 保存' + (l.name ? '「' + l.name + '」' : '') + '资源',
      },
        el('span', { class: 'nd-name' }, l.name || '资源链接'),
        el('span', { class: 'nd-go' }, '保存 / 打开 ↗')
      ));
    });
  }
  box.hidden = false;
  document.body.style.overflow = 'hidden';
}
function closeFilmModal() {
  $('#filmbox').hidden = true;
  $('#filmboxImg').src = '';
  filmModalFilm = null;
  document.body.style.overflow = '';
}

/* ============ 专栏详情 ============ */

let currentDetail = null;
let detailPage = 0;            // 详情页当前页码（0 基）
const DETAIL_PAGE_SIZE = 30;   // 每页 30 张（3 张/行 × 10 行）

/* ============ 影视Cut ============ */

let workSearchTerm = '';
let workPage = 0;             // 修图产出首页当前页码（0 基）
const WORK_PAGE_SIZE = 3;     // 修图产出首页每页 3 个专栏
let filmSearchTerm = '';
let filmListPage = 0;          // 影视列表当前页码（0 基）
const FILM_PAGE_SIZE = 30;     // 影视列表每页 30 部，超过则分页
let filmModalFilm = null;      // 当前弹层展示的影视对象

function renderDetail(kind, id) {
  const col = store.findCollection(kind, id);
  if (!col) { location.hash = ''; return; }
  const sameCol = currentDetail && currentDetail.id === id;
  if (!sameCol) detailPage = 0;   // 进入新专栏时回到第一页
  currentDetail = { kind, id };

  const tEl = $('#detailTitle');
  tEl.textContent = col.title || '未命名专栏';
  tEl.classList.toggle('editable', store.editing);
  tEl.title = store.editing ? '点击编辑或删除专栏' : '';
  tEl.onclick = store.editing ? () => admin.openCollectionForm(col) : null;
  $('#detailDesc').textContent = col.desc || '';

  $('#detailUpload').onclick = () => admin.uploadTo(kind, id);
  $('#detailAddUrl').onclick = () => admin.addRemoteImages(kind, id);
  $('#detailEdit').onclick = () => admin.openCollectionForm(col);
  $('#detailDelete').onclick = () => admin.removeCollection(kind, id);

  paintDetailGrid();
}

/** 仅重绘网格 + 分页器（翻页、上传、删除、排序后复用，不重置页码） */
function paintDetailGrid() {
  if (!currentDetail) return;
  const col = store.findCollection(currentDetail.kind, currentDetail.id);
  if (!col) return;
  const grid = $('#detailGrid');
  grid.innerHTML = '';

  const items = col.items;
  const totalPages = items.length ? Math.ceil(items.length / DETAIL_PAGE_SIZE) : 1;
  if (detailPage >= totalPages) detailPage = totalPages - 1;
  if (detailPage < 0) detailPage = 0;
  const start = detailPage * DETAIL_PAGE_SIZE;
  const pageItems = items.slice(start, start + DETAIL_PAGE_SIZE);

  $('#detailEmpty').hidden = items.length > 0 || store.editing;
  $('#detailEmpty').textContent = store.editing ? '' : '这个专栏还没有作品';

  pageItems.forEach((it, i) => {
    const globalIndex = start + i;   // 全量数组中的真实下标（灯箱/拖拽排序用）
    const isVideo = it.kind === 'video' || /\.(mp4|webm|mov|m4v)(\?|$)/i.test(it.src || '');
    const thumb = isVideo ? (it.poster || it.thumb) : (it.thumb || it.src);
    const media = isVideo
      ? el('video', { src: it.src, poster: it.poster || '', controls: '', preload: 'metadata', playsinline: '' })
      : el('img', { src: thumb, loading: 'lazy', referrerpolicy: 'no-referrer', alt: '' });
    const node = el('div', { class: 'm-item' },
      media,
      el('div', { class: 'tile-tools' },
        el('button', { class: 'mini-btn', title: '设为精选', onclick: e => { e.stopPropagation(); admin.toggleStar(currentDetail.kind, currentDetail.id, it.id); } }, it.star ? '★' : '☆'),
        el('button', { class: 'mini-btn', title: '移动到其它专栏', onclick: e => { e.stopPropagation(); openMovePicker(it.id, currentDetail.id); } }, '⇄'),
        el('button', { class: 'mini-btn', title: '改标题', onclick: e => { e.stopPropagation(); admin.renameItem(currentDetail.kind, currentDetail.id, it.id); } }, '✎'),
        el('button', { class: 'mini-btn', title: '改图片链接（外链/站内）', onclick: e => { e.stopPropagation(); admin.editItemUrl(currentDetail.kind, currentDetail.id, it.id); } }, '🔗'),
        el('button', { class: 'mini-btn danger', title: '删除', onclick: e => { e.stopPropagation(); admin.removeItem(currentDetail.kind, currentDetail.id, it.id); } }, '✕')
      )
    );
    if (!isVideo) {
      media.addEventListener('click', e => {
        if (window.__blockLightboxClick) {
          window.__blockLightboxClick = false;
          e.stopPropagation();
          return;
        }
        openLightbox(col.items, globalIndex);
      });
    }
    if (store.editing) {
      enableDragSort(node, globalIndex);
      enableLongPressDelete(node, it);
    }
    grid.append(node);
  });

  renderPager($('#detailPager'), totalPages, detailPage, p => { detailPage = p; paintDetailGrid(); }); // 翻页不跳顶，保持当前滚动位置
}

/** 弹出选择器：把某件作品移动到其它专栏 */
function openMovePicker(itemId, fromColId) {
  const others = (store.data.works || []).filter(c => c.id !== fromColId);
  if (!others.length) {
    toast('还没有其它专栏，先去新建一个吧');
    return;
  }
  const opts = others.map(c => el('option', { value: c.id },
    `${c.title || '未命名专栏'}${c.items?.length ? `（${c.items.length} 件）` : ''}`));
  const sel = el('select', { class: 'drawer-select' }, ...opts);
  const node = el('div', {},
    el('p', { class: 'hint' }, '选择要移动到的目标专栏：'),
    field('目标专栏', sel),
    actions('移动到这里', () => {
      const to = sel.value;
      closeDrawer();
      admin.moveItem('works', fromColId, itemId, to);
    })
  );
  openDrawer('移动作品到其它专栏', node);
}
function renderPager(pager, totalPages, current, onSelect) {
  pager.hidden = totalPages <= 1;
  pager.innerHTML = '';
  if (totalPages <= 1) return;

  // 翻页保持当前滚动位置：记录 y，重渲染后原样恢复（防止浏览器滚动锚定跳移）
  const go = (p) => {
    const y = window.scrollY;
    onSelect(p);
    window.scrollTo({ top: y, behavior: 'instant' });
  };

  pager.append(el('button', {
    class: 'pg-btn' + (current === 0 ? ' disabled' : ''),
    disabled: current === 0 ? 'disabled' : null,
    'aria-label': '上一页',
    onclick: () => { if (current > 0) go(current - 1); },
  }, '‹'));

  pageNumbers(current, totalPages).forEach(n => {
    if (n === '…') {
      pager.append(el('span', { class: 'pg-ellipsis' }, '…'));
    } else {
      const on = n === current + 1;
      pager.append(el('button', {
        class: 'pg-btn' + (on ? ' on' : ''),
        'aria-label': `第 ${n} 页`,
        onclick: () => go(n - 1),
      }, String(n)));
    }
  });

  pager.append(el('button', {
    class: 'pg-btn' + (current === totalPages - 1 ? ' disabled' : ''),
    disabled: current === totalPages - 1 ? 'disabled' : null,
    'aria-label': '下一页',
    onclick: () => { if (current < totalPages - 1) go(current + 1); },
  }, '›'));
}

/* 生成分页数字（0 基 current，总页数 total），超出阈值用省略号折叠 */
function pageNumbers(current, total) {
  const cur = current + 1;
  const out = [];
  if (total <= 9) {
    for (let i = 1; i <= total; i++) out.push(i);
    return out;
  }
  out.push(1);
  const left = Math.max(2, cur - 1);
  const right = Math.min(total - 1, cur + 1);
  if (left > 2) out.push('…');
  for (let i = left; i <= right; i++) out.push(i);
  if (right < total - 1) out.push('…');
  out.push(total);
  return out;
}

/* 编辑模式：拖拽排序 */
function enableDragSort(node, index) {
  node.draggable = true;
  node.dataset.dragIndex = index;
  node.addEventListener('dragstart', e => {
    e.dataTransfer.effectAllowed = 'move';
    node.classList.add('dragging');
    window.__dragSourceIndex = index;
  });
  node.addEventListener('dragend', () => {
    node.classList.remove('dragging');
    window.__dragSourceIndex = null;
    $$('.m-item').forEach(n => n.classList.remove('drag-over'));
  });
  node.addEventListener('dragover', e => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    node.classList.add('drag-over');
  });
  node.addEventListener('dragleave', () => node.classList.remove('drag-over'));
  node.addEventListener('drop', e => {
    e.preventDefault();
    node.classList.remove('drag-over');
    const src = window.__dragSourceIndex;
    if (src == null || src === index || !currentDetail) return;
    const col = store.findCollection('works', currentDetail.id);
    if (!col) return;
    const arr = col.items;
    [arr[src], arr[index]] = [arr[index], arr[src]];
    changed();
  });
}

/* 编辑模式：长按删除 */
function enableLongPressDelete(node, it) {
  let timer = null;
  const clear = () => { if (timer) { clearTimeout(timer); timer = null; } };
  const start = e => {
    if (e.button && e.button !== 0) return;
    timer = setTimeout(() => {
      timer = null;
      window.__blockLightboxClick = true;
      setTimeout(() => window.__blockLightboxClick = false, 120);
      if (window.confirm('删除这张作品？')) admin.removeItem('works', currentDetail.id, it.id);
    }, 600);
  };
  node.addEventListener('touchstart', start, { passive: true });
  node.addEventListener('touchend', clear);
  node.addEventListener('touchmove', clear);
  node.addEventListener('mousedown', start);
  node.addEventListener('mouseup', clear);
  node.addEventListener('mouseleave', clear);
}

/* ============ 灯箱 ============ */

let lbItems = [], lbIndex = 0;

export function openLightbox(items, index) {
  lbItems = items; lbIndex = index;
  $('#lightbox').hidden = false;
  document.body.style.overflow = 'hidden';
  paintLightbox();
}
/* 跨域友好的"一键下载"：先 fetch 成 blob 触发下载；跨域未开 CORS 时回退到新标签打开 */
function downloadName(it, isVideo) {
  let urlName = '';
  try { urlName = decodeURIComponent(new URL(it.src, location.href).pathname.split('/').pop() || ''); } catch {}
  const hasExt = /\.[a-z0-9]{1,5}$/i.test(urlName);
  const ext = hasExt ? urlName.split('.').pop().toLowerCase() : (isVideo ? 'mp4' : 'jpg');
  const base = (it.title || urlName.replace(/\.[^.]+$/, '') || (isVideo ? 'video' : 'image'));
  return base + '.' + ext;
}
/* 跨域友好的"一键下载"：先 fetch 成 blob 触发下载；返回 true/false 表示是否成功 */
async function downloadViaBlob(url, filename) {
  try {
    const res = await fetch(url, { mode: 'cors', referrerPolicy: 'no-referrer' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const blob = await res.blob();
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objUrl; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(objUrl), 5000);
    return true;
  } catch {
    return false; // 跨域未开 CORS 时交由调用方决定 fallback
  }
}

/* Cloudinary：在 URL 加 fl_attachment 让服务端强制下载（无需 CORS，最稳） */
function isCloudinaryUrl(u){ return /res\.cloudinary\.com\/.+\/image\/upload\//.test(u || ''); }
function cloudinaryAttachmentUrl(u){
  // 注意：fl_attachment 后面用 /，不是 :filename，否则 Cloudinary 返回 400
  return u.replace('/image/upload/', '/image/upload/fl_attachment/');
}

/* 腾讯云 COS：检测 + 构建查看 URL */
const COS_HOST_RE = /\.cos\.[-\w]+\.myqcloud\.com$/;
function isCosUrl(u){ try { return COS_HOST_RE.test(new URL(u, location.href).hostname); } catch{ return false; } }
function cosViewUrl(src){
  /* 灯箱查看用：加数据万象缩放，避免加载 28MB 原图 */
  if (!isCosUrl(src)) return src;
  const sep = src.includes('?') ? '|' : '?';
  return `${src}${sep}imageMogr2/thumbnail/2000x/quality/90`;
}

function paintLightbox() {
  const it = lbItems[lbIndex];
  if (!it) return;
  const stage = $('#lbStage');
  stage.innerHTML = '';
  const isVideo = it.kind === 'video' || /\.(mp4|webm|mov|m4v)(\?|$)/i.test(it.src || '');
  /* 图片：COS 用数据万象缩略版查看(快)，非 COS 用原图 */
  const viewSrc = isVideo ? it.src : (isCosUrl(it.src) ? cosViewUrl(it.src) : it.src);
  if (isVideo) {
    stage.append(el('video', { src: it.src, controls: '', autoplay: '', playsinline: '', poster: it.poster || '' }));
  } else {
    const img = el('img', { src: viewSrc, referrerpolicy: 'no-referrer', alt: it.title || '图片' });
    let fellBack = false;
    img.onerror = () => {
      // 数据万象缩略失败 -> 退回原图（不含 CI 参数）；都失败则给出提示
      if (!fellBack && it.src && it.src !== viewSrc) { fellBack = true; img.src = it.src; }
      else { img.alt = '图片加载失败，请检查网络或原图链接'; }
    };
    stage.append(img);
  }

  const cap = $('#lbCap');
  cap.innerHTML = '';
  const dlBtn = el('a', {
    class: 'lb-download',
    href: it.src,
    download: it.title || (isVideo ? 'video' : 'image'),
    target: '_blank',
    rel: 'noopener',
  }, isVideo ? '下载原视频' : '下载原图');
  dlBtn.onclick = (e) => {
    e.preventDefault();
    if (isCloudinaryUrl(it.src)) {
      window.open(cloudinaryAttachmentUrl(it.src), '_blank', 'noopener');
    } else {
      const name = downloadName(it, isVideo);
      downloadViaBlob(it.src, name).then(ok => {
        if (!ok) {
          toast('已开始新标签打开，请长按图片选择「存储到文件」');
          window.open(it.src, '_blank', 'noopener');
        }
      });
    }
  };
  cap.append(dlBtn);
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
  const m = h.match(/^#\/c\/works\/(.+)$/);
  if (m) {
    $('#view-home').hidden = true;
    $('#view-detail').hidden = false;
    renderDetail('works', m[1]);
    window.scrollTo(0, 0);
    return;
  }
  // 影视Cut 列表
  const f = h.match(/^#\/films$/);
  if (f) {
    $('#view-home').hidden = true;
    $('#view-detail').hidden = true;
    $('#view-films').hidden = false;
    filmListPage = 0;
    filmSearchTerm = '';
    const fs = $('#filmSearch'); if (fs) fs.value = '';
    paintFilmsList();
    window.scrollTo(0, 0);
    return;
  }
  // 兼容旧版路由，自动重定向到新路由
  const old = h.match(/^#\/c\/(photos|videos)\/(.+)$/);
  if (old) {
    location.replace(`#/c/works/${old[2]}`);
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
  if (!$('#view-films').hidden) paintFilmsList();
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
    if (!$('#filmbox').hidden) {
      if (e.key === 'Escape') closeFilmModal();
      return;
    }
    if ($('#lightbox').hidden) return;
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowLeft') step(-1);
    if (e.key === 'ArrowRight') step(1);
  });

  $('#adminKey').onclick = () => admin.openConsole();
  $$('[data-edit]').forEach(b => b.onclick = () => admin.handleEdit(b.dataset.edit));
  $$('[data-close-drawer]').forEach(b => b.onclick = closeDrawer);

  // 修图产出：专栏名搜索
  $('#workSearch').addEventListener('input', e => {
    workSearchTerm = e.target.value.trim();
    workPage = 0;
    renderCollections('works', $('#workCollections'));
  });
  // 影视Cut：返回 / 搜索 / 添加 / 弹层关闭
  $('#filmsBackBtn').onclick = () => { if (history.length > 1) history.back(); else location.hash = ''; };
  $('#filmAddBtn').onclick = () => admin.openFilmForm(null);
  $('#filmSearch').addEventListener('input', e => {
    filmSearchTerm = e.target.value.trim();
    filmListPage = 0;
    paintFilmsList();
  });
  $('#filmboxClose').onclick = closeFilmModal;
  $('#filmbox').addEventListener('click', e => { if (e.target.id === 'filmbox') closeFilmModal(); });

  admin.init();
  if (!ok && !store.editing) {
    console.info('[MiragedGeist] 未找到 data/site.json，正在展示默认内容。进入管理模式发布一次即可生成。');
  }
}

init();
