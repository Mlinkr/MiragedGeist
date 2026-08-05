/* 管理模式：连接仓库 · 编辑内容 · 上传媒体 · 一键发布 */
/* 注意：?v= 为防缓存版本号，修改任意 js 文件后须同步 +1（与 index.html 一致） */
import { $, el, field, input, textarea, actions, openDrawer, closeDrawer, toast, busy, uid, confirmBox } from './ui.js?v=5';
import { gh } from './github.js?v=5';
import { store, DEFAULT_DATA } from './store.js?v=5';
import { PLATFORMS, detectPlatform, normalizeUrl, fetchProfile, AUTO_OK } from './social.js?v=5';
import { cosReady, cosRelay, cosRelayPresigned, cosDiagnose } from './cos.js?v=6';

const LS_EDIT = 'mg_editing';
const LS_LOCAL = 'mg_local_data';
const LS_QUALITY = 'mg_img_quality';

/* 图片画质档位 */
export const QUALITY = {
  origin: { label: '原图直传', desc: '不做任何处理，画质 100% 保留。文件较大，单张建议 < 20MB', maxSide: 0, q: 1 },
  high:   { label: '高画质（推荐）', desc: '长边 3000px、质量 94%，肉眼几乎无损，体积约为原图 1/4', maxSide: 3000, q: .94 },
  normal: { label: '标准', desc: '长边 2000px、质量 88%，加载最快，适合大量作品', maxSide: 2000, q: .88 },
};
export const getQuality = () => localStorage.getItem(LS_QUALITY) || 'high';
export const setQuality = v => localStorage.setItem(LS_QUALITY, v);

const rerender = () => window.dispatchEvent(new Event('mg:render'));
const changed = () => { store.mark(); saveLocal(); rerender(); };

/* ---------- 本地草稿（体验模式 / 防丢失） ---------- */
function saveLocal() {
  try { localStorage.setItem(LS_LOCAL, store.json()); } catch { /* 超额忽略 */ }
}
function loadLocal() {
  try {
    const raw = localStorage.getItem(LS_LOCAL);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return null;
}

export function init() {
  if (localStorage.getItem(LS_EDIT) === '1') setEditing(true, true);
  window.addEventListener('mg:dirty', paintBar);
  if (store.dirty) paintBar(); // 刷新后自动恢复了本机草稿，立即提示发布
}

/* ================= 编辑模式开关 ================= */

export function setEditing(on, silent) {
  store.editing = on;
  document.body.classList.toggle('editing', on);
  localStorage.setItem(LS_EDIT, on ? '1' : '0');
  paintBar();
  rerender();
  if (!silent) toast(on ? '已进入编辑模式' : '已退出编辑模式', 'ok');
}

function paintBar() {
  let bar = $('.edit-bar');
  if (!store.editing) { bar?.remove(); paintFab(); return; }
  if (!bar) {
    bar = el('div', { class: 'edit-bar' });
    document.body.prepend(bar);
  }
  bar.innerHTML = '';
  paintFab();
  const mode = gh.ready ? `${gh.cfg.owner}/${gh.cfg.repo}` : '本地体验模式（不会保存到线上）';
  bar.append(
    el('span', {}, `编辑模式 · ${mode}${store.dirty ? ' · 有未发布修改' : ''}`),
    gh.ready ? el('button', { onclick: () => publish() }, store.dirty ? '发布到线上' : '重新发布') : null,
    el('button', { onclick: () => openConsole() }, '面板'),
    el('button', { onclick: () => setEditing(false) }, '退出')
  );
}

/* 常驻「一键发布」气泡：有未发布修改时，无论是否进入编辑模式都能直接发布 */
function paintFab() {
  let fab = $('.publish-fab');
  if (store.dirty) {
    if (!fab) { fab = el('button', { class: 'publish-fab' }); document.body.append(fab); }
    if (gh.ready) {
      fab.className = 'publish-fab';
      fab.textContent = '↑ 有未发布修改 · 点此发布';
      fab.onclick = () => publish();
    } else {
      fab.className = 'publish-fab warn';
      fab.textContent = '⚠ 未连接仓库 · 点此连接';
      fab.onclick = () => openConsole();
    }
  } else {
    fab?.remove();
  }
}

async function publish() {
  try {
    busy(true, '正在发布到 GitHub…');
    await store.publish();
    busy(false);
    toast('已发布，GitHub Pages 约 30 秒后生效', 'ok');
  } catch (e) {
    busy(false);
    toast('发布失败：' + e.message, 'err');
  }
  paintBar();
}

/* ================= 管理面板 ================= */

export function openConsole() {
  const box = el('div');

  if (!gh.ready) {
    box.append(
      el('div', { class: 'tip' }, '连接你的 GitHub 仓库后，才能把内容和图片视频真正保存到线上。Token 只存在你自己的浏览器里，访客看不到、也拿不到。'),
      field('仓库拥有者 (owner)', input({ id: 'f_owner', value: gh.cfg.owner || '', placeholder: 'MiragedGeist' })),
      field('仓库名 (repo)', input({ id: 'f_repo', value: gh.cfg.repo || '', placeholder: 'MiragedGeist.github.io' })),
      field('分支', input({ id: 'f_branch', value: gh.cfg.branch || 'main' })),
      field('Personal Access Token',
        el('input', { type: 'password', id: 'f_token', placeholder: 'github_pat_… 或 ghp_…' }),
        '在 GitHub → Settings → Developer settings → <b>Fine-grained tokens</b> 里生成，Repository access 选中本仓库，权限勾 <code>Contents: Read and write</code>。'),
      actions('连接仓库', async btn => {
        gh.save({
          owner: $('#f_owner').value.trim(),
          repo: $('#f_repo').value.trim(),
          branch: $('#f_branch').value.trim() || 'main',
          token: $('#f_token').value.trim(),
        });
        btn.disabled = true;
        try {
          const u = await gh.whoami();
          await gh.repoInfo();
          toast(`已连接：${u.login}`, 'ok');
          closeDrawer(); setEditing(true); openConsole();
        } catch (e) {
          gh.save({ token: '' });
          toast('连接失败：' + e.message, 'err');
        }
        btn.disabled = false;
      }, '关闭')
    );

    box.append(el('div', { style: 'margin-top:26px;padding-top:18px;border-top:1px solid var(--line)' },
      el('div', { class: 'hint', style: 'margin-bottom:10px' }, '只想先试试效果？本地体验模式下所有修改只存在本机浏览器，可随时导出 JSON。'),
      el('button', {
        class: 'btn-ghost', style: 'width:100%;padding:11px',
        onclick: () => {
          const local = loadLocal();
          if (local && confirmBox('检测到本机草稿，是否恢复？')) Object.assign(store.data, local);
          closeDrawer(); setEditing(true);
        },
      }, '进入本地体验模式')
    ));
  } else {
    box.append(
      el('div', { class: 'tip ok' }, `已连接 <b>${gh.cfg.owner}/${gh.cfg.repo}</b> · 分支 ${gh.cfg.branch}<br>线上地址：<code>https://${gh.cfg.owner}.github.io${gh.cfg.repo.endsWith('.github.io') ? '' : '/' + gh.cfg.repo}/</code>`),
      el('button', { class: 'btn-solid', style: 'width:100%;padding:12px;margin-bottom:11px', onclick: () => { closeDrawer(); publish(); } },
        store.dirty ? '发布全部修改' : '重新发布一次'),
      el('button', { class: 'btn-ghost', style: 'width:100%;padding:11px;margin-bottom:11px', onclick: () => setEditing(!store.editing) },
        store.editing ? '退出编辑模式' : '进入编辑模式'),
      el('button', { class: 'btn-ghost', style: 'width:100%;padding:11px;margin-bottom:11px', onclick: () => openProfileForm() }, '编辑名字 / 标签 / 简介'),
      qualityPicker(),
      el('button', { class: 'btn-ghost', style: 'width:100%;padding:11px;margin-bottom:11px', onclick: () => store.download() }, '导出 site.json 备份'),
      el('button', {
        class: 'btn-ghost danger', style: 'width:100%;padding:11px',
        onclick: () => { if (confirmBox('断开连接会清除本机保存的 Token，确定吗？')) { gh.logout(); setEditing(false); closeDrawer(); toast('已断开'); } },
      }, '断开连接（清除 Token）')
    );
  }
  // COS 直传配置：与 GitHub 连接与否无关，始终可配（配好即直传 COS，无需云函数）
  box.append(cosConfigBox());
  openDrawer('管理面板', box);
}

/** 上传画质选择器 */
function qualityPicker() {
  const cur = getQuality();
  const box = el('div', { class: 'field', style: 'margin:4px 0 15px' }, el('label', {}, '图片上传画质'));
  const seg = el('div', { class: 'seg', style: 'margin-bottom:8px' });
  const note = el('div', { class: 'hint' }, QUALITY[cur].desc);
  Object.entries(QUALITY).forEach(([k, v]) => {
    seg.append(el('button', {
      class: k === cur ? 'on' : '',
      onclick: e => {
        setQuality(k);
        [...seg.children].forEach(c => c.classList.remove('on'));
        e.target.classList.add('on');
        note.textContent = v.desc;
        toast(`已切换为「${v.label}」`, 'ok');
      },
    }, v.label));
  });
  box.append(seg, note);
  return box;
}

/* ================= 编辑入口分发 ================= */

export function handleEdit(key) {
  switch (key) {
    case 'avatar': return pickAndSetImage('avatar');
    case 'cover': return pickAndSetImage('cover');
    case 'bio': return openProfileForm();
    case 'social-add': return openSocialForm(null);
    case 'work-add': return openCollectionForm(null);
    case 'film-add': return openFilmForm(null);
  }
}

/* ================= 个人资料 ================= */

export function openProfileForm() {
  const p = store.data.profile;
  const box = el('div', {},
    field('名字', input({ id: 'p_name', value: p.name || '' })),
    field('一句话标签', input({ id: 'p_tag', value: p.tagline || '' })),
    field('小标签（逗号分隔）', input({ id: 'p_chips', value: (p.chips || []).join('，') })),
    field('简介', textarea({ id: 'p_bio', rows: 12 }),
      '支持简易 Markdown：<code>**加粗**</code>、<code>`高亮`</code>、<code>- 列表</code>、<code>[文字](链接)</code>、<code>---</code> 分隔线。'),
    actions('保存', () => {
      p.name = $('#p_name').value.trim();
      p.tagline = $('#p_tag').value.trim();
      p.chips = $('#p_chips').value.split(/[，,]/).map(s => s.trim()).filter(Boolean);
      p.bio = $('#p_bio').value;
      changed(); closeDrawer(); toast('已更新，记得发布', 'ok');
    })
  );
  box.querySelector('#p_bio').value = p.bio || '';
  openDrawer('编辑个人资料', box);
}

async function pickAndSetImage(which) {
  const [file] = await pickFiles({ accept: 'image/*' });
  if (!file) return;
  const isAvatar = which === 'avatar';
  busy(true, isAvatar ? '上传头像…' : '上传背景…');
  let path;
  try {
    const blob = await compressImage(file, isAvatar ? 800 : 2800, .93);
    path = await storeMedia(blob, isAvatar ? `media/avatar-${uid()}` : `media/cover-${uid()}`, 'jpg');
  } catch (e) {
    busy(false); return toast('上传失败：' + e.message, 'err');
  }
  busy(false);
  store.data.profile[which] = path;
  changed();
  toast(isAvatar ? '头像已更新' : '背景已更新', 'ok');
}

/* ================= 社交媒体 ================= */

export function openSocialForm(existing) {
  const s = existing || { id: uid(), platform: 'link', url: '', name: '', handle: '', avatar: '', icon: '', stats: [-1, -1, -1] };
  const box = el('div');

  const urlIn = input({ id: 's_url', value: s.url, placeholder: '粘贴主页链接，例如 https://weibo.com/u/1234567890' });
  const platSel = el('select', { id: 's_plat' },
    ...Object.entries(PLATFORMS).map(([k, v]) => el('option', { value: k, selected: k === s.platform ? '' : null }, v.name)));

  const statRow = el('div', { class: 'field' });
  const nameIn = input({ id: 's_name', value: s.name, placeholder: '显示名称' });
  const handleIn = input({ id: 's_handle', value: s.handle, placeholder: '@账号 / UID（可留空）' });
  const avatarIn = input({ id: 's_avatar', value: s.avatar, placeholder: '头像图片地址（可留空）' });
  const iconIn = input({ id: 's_icon', value: s.icon || '', placeholder: '自定义图标地址（留空则用官方图标）' });
  const st = [0, 1, 2].map(i => el('input', { type: 'number', id: 's_st' + i, value: (s.stats?.[i] ?? -1) }));

  const paintStatLabels = () => {
    const P = PLATFORMS[platSel.value] || PLATFORMS.link;
    statRow.innerHTML = '';
    statRow.append(el('label', {}, '数据（填 -1 表示不显示）'),
      el('div', { class: 'row', style: 'grid-template-columns:repeat(3,1fr)' },
        ...st.map((n, i) => el('div', {}, el('div', { class: 'hint', style: 'margin:0 0 4px' }, P.labels[i] || '不显示'), n))));
  };
  paintStatLabels();
  platSel.onchange = paintStatLabels;

  const status = el('div', { class: 'hint' });

  const grab = async () => {
    const url = normalizeUrl(urlIn.value);
    if (!url) return toast('先粘贴链接', 'err');
    urlIn.value = url;
    const plat = detectPlatform(url);
    platSel.value = plat;
    paintStatLabels();
    const P = PLATFORMS[plat];
    status.textContent = '正在识别…';
    busy(true, `正在读取 ${P.name} 资料…`);
    let info = null;
    try {
      info = await Promise.race([
        fetchProfile(plat, url),
        new Promise(res => setTimeout(() => res(null), 25000)),
      ]);
    } catch { info = null; }
    busy(false);
    if (!info) {
      status.innerHTML = '<span style="color:#ffd79a">没能自动识别（接口/代理受限或主页无公开信息），可用主页公开信息生成，仍为空就手动填一下，效果完全一样。</span>';
      if (!nameIn.value) nameIn.value = P.name;
      return;
    }
    if (info.name) nameIn.value = info.name;
    if (info.handle) handleIn.value = info.handle;
    if (info.avatar) avatarIn.value = info.avatar;
    (info.stats || []).forEach((v, i) => { if (v >= 0) st[i].value = v; });
    status.innerHTML = '<span style="color:#a7f3d0">抓取成功，可继续手动微调。</span>';
  };

  box.append(
    el('div', { class: 'tip' }, '粘贴主页链接后点「识别并抓取」。能自动带出头像与昵称；抓不到时也会用主页公开信息生成，仍为空再手动填写即可。'),
    field('主页链接', urlIn),
    el('button', { class: 'btn-solid', style: 'width:100%;padding:10px;margin:-6px 0 14px', onclick: grab }, '识别并抓取'),
    status,
    field('平台', platSel),
    field('显示名称', nameIn),
    field('账号 / 备注', handleIn),
    field('头像地址', avatarIn, '留空则显示平台配色占位图。抓来的外链若显示不出来，可点下方「把头像存到我的仓库」。'),
    gh.ready ? el('button', {
      class: 'btn-ghost', style: 'width:100%;padding:9px;margin:-8px 0 16px',
      onclick: async () => {
        const src = avatarIn.value.trim();
        if (!src || src.startsWith('media/')) return toast('没有需要转存的外链头像');
        try {
          busy(true, '转存头像…');
          const blob = await fetchImageBlob(src);
          const small = await compressImage(blob, 300, .9);
          avatarIn.value = await storeMedia(small, `media/social/${s.id}`, 'jpg');
          busy(false); toast('头像已存到你的仓库', 'ok');
        } catch (e) { busy(false); toast('转存失败：' + e.message, 'err'); }
      },
    }, '把头像存到我的仓库（更稳定）') : null,
    gh.ready ? el('button', {
      class: 'btn-ghost', style: 'width:100%;padding:9px;margin:-8px 0 8px',
      onclick: async () => {
        const [file] = await pickFiles({ accept: 'image/*' });
        if (!file) return;
        try {
          busy(true, '上传头像…');
          const blob = await compressImage(file, 400, .92);
          avatarIn.value = await storeMedia(blob, `media/social/${s.id}`, 'jpg');
          busy(false); toast('头像已上传', 'ok');
        } catch (e) { busy(false); toast('上传失败：' + e.message, 'err'); }
      },
    }, '从本机上传头像（覆盖链接头像）') : null,
    field('自定义图标（可选）', iconIn, '留空则使用官方品牌图标；上传后会覆盖官方图标。'),
    gh.ready ? el('button', {
      class: 'btn-ghost', style: 'width:100%;padding:9px;margin:-8px 0 16px',
      onclick: async () => {
        const [file] = await pickFiles({ accept: 'image/*' });
        if (!file) return;
        try {
          busy(true, '上传图标…');
          const blob = await compressImage(file, 200, .95);
          iconIn.value = await storeMedia(blob, `media/social/${s.id}-icon`, 'jpg');
          busy(false); toast('图标已上传（覆盖官方图标）', 'ok');
        } catch (e) { busy(false); toast('上传失败：' + e.message, 'err'); }
      },
    }, '上传自定义图标（覆盖官方图标）') : null,
    statRow,
    actions(existing ? '保存修改' : '添加卡片', () => {
      const url = normalizeUrl(urlIn.value);
      if (!url) return toast('链接不能为空', 'err');
      Object.assign(s, {
        url, platform: platSel.value,
        name: nameIn.value.trim() || PLATFORMS[platSel.value].name,
        handle: handleIn.value.trim(),
        avatar: avatarIn.value.trim(),
        icon: iconIn.value.trim(),
        stats: st.map(n => Number(n.value)),
      });
      if (!existing) store.data.socials.push(s);
      changed(); closeDrawer(); toast('已保存，记得发布', 'ok');
    })
  );
  openDrawer(existing ? '编辑社媒卡片' : '添加社媒卡片', box);

  if (!existing) urlIn.addEventListener('paste', () => setTimeout(grab, 60));
}

export function removeSocial(id) {
  if (!confirmBox('删除这张社媒卡片？')) return;
  store.data.socials = store.data.socials.filter(s => s.id !== id);
  changed();
}
export function moveSocial(idx, dir) {
  const arr = store.data.socials;
  const j = idx + dir;
  if (j < 0 || j >= arr.length) return;
  [arr[idx], arr[j]] = [arr[j], arr[idx]];
  changed();
}

/* ================= 专栏 ================= */

export function openCollectionForm(existing) {
  const c = existing || { id: uid(), title: '', desc: '', items: [] };
  const box = el('div', {},
    field('专栏名称', input({ id: 'c_title', value: c.title, placeholder: '例如：人像 / 商业 / 短片' })),
    field('一句话描述', input({ id: 'c_desc', value: c.desc, placeholder: '可留空' }))
  );

  const btnRow = el('div', { class: 'drawer-actions' },
    el('button', { class: 'btn-ghost', onclick: closeDrawer }, '取消'),
    el('button', {
      class: 'btn-solid',
      onclick: () => {
        c.title = $('#c_title').value.trim() || '未命名专栏';
        c.desc = $('#c_desc').value.trim();
        if (!existing) { c.id = c.title; store.data.works.push(c); }  // 新专栏 id=标题，即 COS 文件夹名
        changed(); closeDrawer();
        toast(existing ? '已保存' : '专栏已创建，点方块上传作品', 'ok');
      }
    }, existing ? '保存' : '创建专栏')
  );

  if (existing) {
    btnRow.append(el('button', {
      class: 'btn-ghost danger',
      onclick: () => { closeDrawer(); removeCollection('works', c.id); }
    }, '删除专栏'));
  }

  box.append(btnRow);
  openDrawer(existing ? '编辑专栏' : '新建专栏', box);
}

/** 首页点标题直接改名 */
export async function renameCollection(kind, id) {
  const col = store.findCollection('works', id);
  if (!col) return;
  const v = window.prompt('专栏名称', col.title || '');
  if (v === null) return;
  const newName = v.trim() || '未命名专栏';
  // 用真实 COS 文件夹名（从 URL 解析），不要用 col.id（slug）当文件夹
  const oldFolder = col.folder || folderOf(col) || col.id;
  if (newName === oldFolder) { col.title = newName; changed(); return; }
  col.title = newName;
  col.folder = newName;          // 记录真实文件夹名，后续改名/移动都用它
  colCosUrls(col, oldFolder, newName);  // 改写本专栏所有图片 URL 的文件夹
  changed();
  toast('已改名，记得发布', 'ok');
  cosSync({ action: 'rename_folder', old: oldFolder, new: newName },
          '桶内文件夹已同步重命名', '桶文件夹同步失败');
}

export function moveCollection(kind, idx, dir) {
  const arr = store.data.works;
  const j = idx + dir;
  if (j < 0 || j >= arr.length) return;
  [arr[idx], arr[j]] = [arr[j], arr[idx]];
  changed();
}

export async function removeCollection(kind, id) {
  const col = store.findCollection('works', id);
  if (!col) return;
  if (!confirmBox(`删除专栏「${col.title}」及其中的 ${col.items.length} 件作品？\n仓库里的文件也会一并删除。`)) return;

  // 删除仓库中的媒体文件
  if (gh.ready) {
    const paths = new Set();
    for (const it of col.items) {
      [it.src, it.thumb, it.poster].forEach(p => { if (p && p.startsWith('media/')) paths.add(p); });
    }
    for (const p of paths) {
      try { await gh.deleteFile(p, 'chore: remove collection media'); } catch { /* ignore */ }
    }
  }

  store.data.works = store.data.works.filter(c => c.id !== id);
  changed();
  if (location.hash.includes(id)) location.hash = '';
  toast('专栏已删除', 'ok');
}

/* ================= 影视Cut ================= */

export function openFilmForm(existing) {
  const f = existing || { id: uid(), title: '', desc: '', image: '', links: [] };
  const box = el('div');

  const titleIn = input({ id: 'f_title', value: f.title, placeholder: '影视名称' });
  const descIn = textarea({ id: 'f_desc', rows: 5, placeholder: '影视相关说明（支持简易 Markdown）' });
  descIn.value = f.desc || '';

  const imgEl = el('img', { class: 'form-img-preview', alt: '', src: f.image || '' });
  if (!f.image) imgEl.style.display = 'none';
  const upZone = el('div', { class: 'up-zone', onclick: () => pickFilmImage(f, imgEl) },
    el('div', {}, f.image ? '点击更换影视图片' : '点击上传影视图片'),
    el('div', { class: 'hint' }, '海报 / 剧照，建议竖图')
  );

  // 网盘链接动态列表
  const linksBox = el('div', { class: 'links-editor' });
  function addLinkRow(l) {
    const nameIn = input({ value: (l && l.name) || '', placeholder: '网盘名称，如 百度网盘' });
    const urlIn = input({ value: (l && l.url) || '', placeholder: '资源链接 https://pan.baidu.com/...' });
    const row = el('div', { class: 'link-row' },
      nameIn, urlIn,
      el('button', { class: 'mini-btn danger', title: '删除此链接', onclick: e => { e.stopPropagation(); row.remove(); } }, '✕')
    );
    linksBox.append(row);
    return row;
  }
  const initialLinks = (f.links && f.links.length) ? f.links : [{ name: '百度网盘', url: '' }, { name: '夸克网盘', url: '' }];
  initialLinks.forEach(addLinkRow);
  const addLinkBtn = el('button', { class: 'btn-ghost', style: 'width:100%;margin-top:8px', onclick: () => addLinkRow({}) }, '+ 添加网盘链接');

  const act = actions(existing ? '保存修改' : '添加影视', () => {
    const links = [...linksBox.querySelectorAll('.link-row')]
      .map(r => { const ins = r.querySelectorAll('input'); return { name: ins[0].value.trim(), url: ins[1].value.trim() }; })
      .filter(l => l.url || l.name);
    if (!f.image) return toast('请先上传一张影视图片', 'err');
    f.title = titleIn.value.trim() || '未命名影视';
    f.desc = descIn.value;
    f.links = links;
    if (!existing) store.data.films.push(f);
    changed(); closeDrawer();
    toast(existing ? '已保存，记得发布' : '影视已添加，记得发布', 'ok');
  });

  if (existing) {
    act.append(el('button', {
      class: 'btn-ghost danger', onclick: () => { closeDrawer(); removeFilm(f.id); }
    }, '删除影视'));
  }

  box.append(
    field('影视名', titleIn),
    field('影视说明', descIn, '支持简易 Markdown：**加粗**、<code>`高亮`</code>、<code>- 列表</code>、<code>[文字](链接)</code>'),
    field('影视图片', el('div', {}, upZone, imgEl)),
    field('网盘资源链接', el('div', {}, linksBox, addLinkBtn), '可添加百度网盘、夸克网盘等多个资源链接，访客点击即可跳转保存。'),
    act
  );
  openDrawer(existing ? '编辑影视' : '添加影视', box);
}

/** 影视图片：连接仓库就上传，否则退化为本地 dataURL */
async function pickFilmImage(f, imgEl) {
  const [file] = await pickFiles({ accept: 'image/*' });
  if (!file) return;
  busy(true, '上传影视图片…');
  try {
    const blob = await compressImage(file, 1400, .92);
    const path = await storeMedia(blob, `media/films/${f.id}/${uid()}`, 'jpg');
    f.image = path;
    imgEl.src = path; imgEl.style.display = '';
    toast('图片已选好，保存后生效', 'ok');
  } catch (e) {
    toast('上传失败：' + e.message, 'err');
  } finally {
    busy(false);
  }
}

export async function removeFilm(id) {
  const f = (store.data.films || []).find(x => x.id === id);
  if (!f) return;
  if (!confirmBox('删除这部影视资料？')) return;
  if (gh.ready && f.image && f.image.startsWith('media/')) {
    try { await gh.deleteFile(f.image, 'chore: remove film image'); } catch { /* ignore */ }
  }
  store.data.films = store.data.films.filter(x => x.id !== id);
  changed();
  toast('影视已删除', 'ok');
}

/* ================= 媒体上传 ================= */

/* ================= 批量上传（浏览器直传 COS / GitHub / 本地） ================= */

/** 入口（兼容旧调用 uploadTo(kind, colId)）：打开批量上传抽屉 */
export async function uploadTo(kind, colId) {
  const col = store.findCollection('works', colId);
  if (!col) return;
  openUploader(col);
}

/* 把常见底层错误翻译成易懂的中文提示（上传失败时对用户更友好） */
function describeError(e) {
  const m = (e && e.message) || String(e || '未知错误');
  if (/abort|取消/i.test(m)) return '已取消';
  if (/超时|timeout/i.test(m)) return m;
  if (/CORS|跨域|Access-Control/i.test(m)) return '跨域被拦截：大文件请确认桶 CORS 允许 PUT（v4.0 预签名直传模式）';
  if (/network|网络|DNS|TLS|连接|offline/i.test(m)) return '网络错误：无法连接服务器，请检查网络后重试';
  if (/8MB|20MB|45MB|过大|Payload|413/i.test(m)) return '文件过大：请检查 COS 桶存储配额或联系管理员';
  if (/未配置|not configured/i.test(m)) return '存储未配置：请先在管理面板填写 COS 中转地址或连接 GitHub';
  return m || '未知错误';
}

function openUploader(col) {
  const folder = col.folder || folderOf(col) || col.title || col.id;
  const target = cosReady() ? 'cos' : (gh.ready ? 'github' : 'local');
  const targetText = target === 'cos'
    ? `腾讯云 COS（v4.0 预签名直传，大图无限制）✅`
    : target === 'github'
      ? `GitHub 仓库 media/works/${col.id}/`
      : `本机预览（未连接任何存储，不会保存）⚠`;

  const items = [];               // {id, file, kind, status, progress, err, result, committed, _node, _status, _bar, _retry}
  let quality = getQuality();
  let running = false;

  /* ★ 关键修复：getCtx 必须定义在 openUploader 作用域。
     旧代码把它写在 renderItem() 内部，runUpload() 调用时抛 ReferenceError，
     而 runUpload 在抛错前已把按钮置为「上传中…」且 running=true，于是 UI 永久卡死。
     现在 runUpload 与重试按钮都能正确取到最新的 mode/target/folder。 */
  function getCtx() {
    return {
      mode: QUALITY[quality] || QUALITY.high,
      target: cosReady() ? 'cos' : (gh.ready ? 'github' : 'local'),
      folder: col.folder || folderOf(col) || col.title || col.id,
      ghBase: `media/works/${col.id}`,
    };
  }

  // 画质选择
  const qSeg = el('div', { class: 'seg' });
  Object.entries(QUALITY).forEach(([k, v]) => {
    qSeg.append(el('button', {
      class: k === quality ? 'on' : '',
      onclick: e => { quality = k; [...qSeg.children].forEach(c => c.classList.remove('on')); e.target.classList.add('on'); },
    }, v.label));
  });

  // 选择 / 拖拽区
  const fileInput = el('input', { type: 'file', accept: 'image/*,video/*', multiple: 'multiple', style: 'display:none' });
  document.body.append(fileInput);
  const pick = () => fileInput.click();
  const drop = el('div', { class: 'up-zone', tabindex: '0' },
    el('div', { style: 'font-size:15px;margin-bottom:6px' }, '把图片 / 视频拖到这里'),
    el('div', { class: 'hint', style: 'margin-top:6px' }, '或点击选择（可一次选多张）· 支持图片与视频')
  );
  const stop = e => { e.preventDefault(); e.stopPropagation(); };
  drop.onclick = pick;
  drop.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } };
  drop.ondragover = e => { stop(e); drop.classList.add('drag'); };
  drop.ondragleave = e => { stop(e); drop.classList.remove('drag'); };
  drop.ondrop = e => { stop(e); drop.classList.remove('drag'); addFiles([...(e.dataTransfer?.files || [])]); };
  fileInput.onchange = () => { if (fileInput.files.length) addFiles([...fileInput.files]); fileInput.value = ''; };

  const list = el('div', { class: 'up-list' });
  const emptyHint = el('div', { class: 'up-empty' }, '还没有选择文件');
  list.append(emptyHint);
  const summary = el('div', { class: 'up-summary' });

  const startBtn = el('button', { class: 'btn-solid', onclick: runUpload }, '开始上传');
  const clearBtn = el('button', { class: 'btn-ghost', onclick: clearAll }, '清空列表');
  const addBtn = el('button', { class: 'btn-ghost', onclick: pick }, '继续添加');

  function fmtSize(n) {
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
  }
  function refreshSummary() {
    const total = items.length;
    const done = items.filter(i => i.status === 'done').length;
    const err = items.filter(i => i.status === 'error').length;
    summary.textContent = total ? `共 ${total} 个 · 已完成 ${done}${err ? ` · 失败 ${err}` : ''}` : '';
  }
  function addFiles(files) {
    for (const f of files) {
      const kind = f.type.startsWith('image/') ? 'image' : f.type.startsWith('video/') ? 'video' : 'other';
      if (kind === 'other') { toast(`${f.name} 不是图片或视频，已跳过`, 'err'); continue; }
      const it = { id: uid(), file: f, kind, status: 'pending', progress: 0, err: '' };
      items.push(it);
      renderItem(it);
    }
    if (files.length) emptyHint.hidden = true;
    refreshSummary();
  }
  function renderItem(it) {
    const prev = el('div', { class: 'up-thumb' });
    if (it.kind === 'image') prev.append(el('img', { src: URL.createObjectURL(it.file), alt: '' }));
    else prev.append(el('video', { src: URL.createObjectURL(it.file), muted: '', preload: 'metadata' }));
    const status = el('div', { class: 'up-item-status' }, '待上传');
    const barFill = el('i', {});
    // 重试按钮通过闭包 getCtx()（已提升到 openUploader 作用域）拿到最新 mode/target/folder
    const retry = el('button', { class: 'mini-btn', title: '重试', style: 'display:none', onclick: () => {
      if (running) return toast('请等待当前上传完成', '');
      uploadOne(it, getCtx());
    } }, '↻');
    const remove = el('button', { class: 'mini-btn danger', title: '移除', onclick: () => removeItem(it) }, '✕');
    const node = el('div', { class: 'up-item' }, prev,
      el('div', { class: 'up-item-main' },
        el('b', {}, it.file.name),
        el('span', {}, fmtSize(it.file.size) + ' · ' + (it.kind === 'image' ? '图片' : '视频')),
        status,
        el('div', { class: 'up-bar' }, barFill)
      ),
      remove, retry);
    it._node = node; it._status = status; it._bar = barFill; it._retry = retry;
    list.append(node);
  }
  function removeItem(it) {
    const i = items.indexOf(it);
    if (i >= 0) items.splice(i, 1);
    it._node?.remove();
    if (!items.length) emptyHint.hidden = false;
    refreshSummary();
  }
  function setProgress(it, p) { it.progress = p; if (it._bar) it._bar.style.width = Math.round(p * 100) + '%'; }
  function setStatus(it, s, text) {
    it.status = s;
    if (it._status) it._status.textContent = text;
    if (it._node) { it._node.classList.toggle('done', s === 'done'); it._node.classList.toggle('error', s === 'error'); }
    if (it._retry) it._retry.style.display = s === 'error' ? '' : 'none';
  }
  // 原子化 UI 状态：上传中禁用按钮并锁定，结束后复原，避免界面卡死
  function setRunningUI(on) {
    running = on;
    startBtn.disabled = on;
    startBtn.textContent = on ? '上传中…' : '开始上传';
    clearBtn.disabled = on;
  }
  function clearAll() {
    if (running) return toast('上传中，无法清空', 'err');
    items.forEach(it => it._node?.remove());
    items.length = 0; emptyHint.hidden = false; refreshSummary();
  }
  /* 上传成功后把作品并入专栏；幂等（已并入则跳过），修复「重试成功却不显示」的问题 */
  function commitDone(it) {
    if (it.committed || !it.result) return false;
    it.committed = true;
    col.items.push({
      id: uid(), src: it.result.src, thumb: it.result.thumb || '',
      poster: it.result.poster || '', kind: it.result.kind,
      title: cleanName(it.file.name), star: col.items.length < 3,
    });
    changed();
    return true;
  }

  async function runUpload() {
    if (running) return;
    const pending = items.filter(i => i.status === 'pending' || i.status === 'error');
    if (!pending.length) return toast('没有待上传的文件', '');
    const ctx = getCtx();
    setRunningUI(true);
    pending.forEach(it => { if (it.status === 'error') { setStatus(it, 'pending', '待上传'); setProgress(it, 0); } });
    const CONC = 3;
    let cursor = 0;
    const worker = async () => {
      while (cursor < pending.length) {
        const it = pending[cursor++];
        await uploadOne(it, ctx);
      }
    };
    try {
      await Promise.all(Array.from({ length: Math.min(CONC, pending.length) }, worker));
    } catch (e) {
      // uploadOne 内部已吞掉单项异常，这里仅兜底
      toast('上传流程异常：' + (e.message || e), 'err');
    } finally {
      setRunningUI(false);   // 无论如何都会复原按钮，杜绝「永久上传中」
      refreshSummary();
      const added = items.filter(i => i.committed);
      if (added.length) toast(`已上传 ${added.length} 件，记得点「发布」`, 'ok');
      const failed = items.filter(i => i.status === 'error');
      if (failed.length) toast(`${failed.length} 个上传失败，可点 ↻ 重试`, 'err');
    }
  }

  /** 给异步操作加超时（毫秒），超时自动 reject */
  function withTimeout(promise, ms, label) {
    if (ms <= 0) return promise;
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} 超时（${Math.round(ms / 1000)}s），图片过大或手机性能不足，请换小图或降低画质`)), ms)),
    ]);
  }

  /** 判断错误是否属于「可降级」类型（网络/CORS/超时），这类错误换一条路径可能成功 */
  function isFallbackError(e) {
    const m = (e && e.message) || '';
    // v4.0: 「跨域」不再降级（大图已自动走预签名直传；仍报跨域=桶 CORS 未配置，应提示用户而非静默降级到 GitHub）
    return /网络|超时|timeout|连接|DNS|TLS|offline/i.test(m);
  }

  async function uploadOne(it, ctx) {
    if (!it.file || it.status === 'done') return;
    setStatus(it, 'uploading', '准备中…'); setProgress(it, 0);
    const name = uid();
    const mode = ctx.mode;
    // ★ 单文件总超时：3 分钟（压缩 + 上传原图 + 上传缩略图）
    const TOTAL_TIMEOUT_MS = 180_000;
    const deadline = Date.now() + TOTAL_TIMEOUT_MS;
    const checkTimeout = () => {
      if (Date.now() > deadline) throw new Error('上传总超时（3min）：网络过慢或文件过大，请重试');
    };

    try {
      if (ctx.target === 'cos') {
        /* ★ COS 上传：独立 try/catch */
        try {
          if (it.kind === 'image') {
          // ---- 阶段 1：确定上传内容 ----
          // ★ v4.0: 「原图直传」= 零压缩、零修改、保留原始格式，直接走预签名直传（无大小限制）
          //   高画质/标准模式才做客户端压缩（缩略图始终压缩到 700px）
          const isOriginal = (mode.maxSide === 0);
          setStatus(it, 'uploading', isOriginal ? '准备原图…' : '压缩中…');
          let blob, ctype, ext;
          if (isOriginal) {
            blob = it.file;                                    // 原始文件，零修改
            ctype = it.file.type || 'image/jpeg';
            // 保留原始扩展名（支持 jpg/png/heic/webp 等）
            ext = (it.file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
          } else {
            blob = await withTimeout(compressImage(it.file, mode.maxSide, mode.q), 60_000, '图片压缩');
            checkTimeout();
            ctype = 'image/jpeg';
            ext = 'jpg';
          }
          // v4.0: 不再有 8MB 硬限制（预签名直传无体量上限）
          // ---- 阶段 2：上传原图到 COS ----
          setStatus(it, 'uploading', '上传中… (1/2)');
          const r1 = await cosRelay(`Photos/${ctx.folder}/${name}.${ext}`, blob, ctype, p => setProgress(it, p * 0.80));
          checkTimeout();
          // ---- 阶段 3：生成并上传缩略图（始终压缩到 700px）----
          setStatus(it, 'uploading', '上传缩略图…');
          const thumb = await withTimeout(compressImage(it.file, 700, .8), 30_000, '缩略图压缩');
          checkTimeout();
          const r2 = await cosRelay(`Photos/${ctx.folder}/${name}-t.jpg`, thumb, 'image/jpeg', p => setProgress(it, 0.80 + p * 0.20));
          it.result = { src: r1.url, thumb: r2.url, kind: 'image' };
        } else {
          // 视频：v4.0 去掉 20MB 硬限制（预签名直传无上限）
          const ext = (it.file.name.split('.').pop() || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp4';
          setStatus(it, 'uploading', '上传视频中…');
          const r1 = await cosRelay(`Photos/${ctx.folder}/${name}.${ext}`, it.file, it.file.type || 'video/mp4', p => setProgress(it, p * 0.8));
          checkTimeout();
          const poster = await withTimeout(videoPoster(it.file), 15_000, '视频截帧').catch(() => null);
          let posterUrl = '';
          if (poster) {
            checkTimeout();
            const r2 = await cosRelay(`Photos/${ctx.folder}/${name}-p.jpg`, poster, 'image/jpeg', p => setProgress(it, 0.8 + p * 0.2));
            posterUrl = r2.url;
          } else setProgress(it, 1);
          it.result = { src: r1.url, poster: posterUrl, thumb: posterUrl, kind: 'video' };
        }
        /* ---- COS 分支结束 ---- */
        } catch (cosErr) {
          // ★ 可降级错误（网络/CORS/超时）+ GitHub 已连接 → 自动降级
          if (isFallbackError(cosErr) && gh.ready) {
            console.warn('[upload] COS 失败，降级到 GitHub:', cosErr.message);
            setStatus(it, 'uploading', 'COS 不可用，降级到 GitHub…'); setProgress(it, 0);
            /* ---- GitHub 降级上传（与下方 github 分支逻辑一致） ---- */
            const ghBase = `media/works/${col.id}/${name}`;
            try {
              if (it.kind === 'image') {
                let src;
                if (mode.maxSide === 0) {
                  setStatus(it, 'uploading', 'GitHub 上传原图…');
                  const ext = (it.file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
                  src = await withTimeout(storeMedia(it.file, ghBase, ext), 90_000, 'GitHub 上传原图');
                } else {
                  setStatus(it, 'uploading', '压缩中…');
                  const compressed = await withTimeout(compressImage(it.file, mode.maxSide, mode.q), 60_000, '图片压缩');
                  checkTimeout();
                  setStatus(it, 'uploading', 'GitHub 上传中…');
                  src = await withTimeout(storeMedia(compressed, ghBase, 'jpg'), 90_000, 'GitHub 上传');
                }
                checkTimeout(); setProgress(it, 0.80);
                setStatus(it, 'uploading', 'GitHub 上传缩略图…');
                const thumb = await withTimeout(
                  storeMedia(await withTimeout(compressImage(it.file, 700, .8), 30_000, '缩略图压缩'), ghBase + '-t', 'jpg'),
                  60_000, 'GitHub 上传缩略图'
                );
                it.result = { src, thumb, kind: 'image' };
              } else {
                const ext = (it.file.name.split('.').pop() || 'mp4').toLowerCase();
                setStatus(it, 'uploading', 'GitHub 上传视频…');
                const src = await withTimeout(storeMedia(it.file, ghBase, ext), 120_000, 'GitHub 上传视频');
                checkTimeout(); setProgress(it, 0.85);
                const poster = await withTimeout(videoPoster(it.file), 15_000, '视频截帧').catch(() => null);
                let posterPath = '';
                if (poster) { checkTimeout(); posterPath = await withTimeout(storeMedia(poster, `${ghBase}-p`, 'jpg'), 60_000, 'GitHub 上传封面'); }
                it.result = { src, poster: posterPath, thumb: posterPath, kind: 'video' };
              }
            } catch (ghErr) {
              throw new Error(`COS 与 GitHub 均失败。COS: ${cosErr.message} | GitHub: ${ghErr.message}`);
            }
          } else {
            throw cosErr; // 不可降级（如文件过大/业务错误），或 GitHub 未连接 → 原样抛出
          }
        }
      } else if (ctx.target === 'github') {
        const base = `media/works/${col.id}/${name}`;
        if (it.kind === 'image') {
          let src, ext = 'jpg';
          if (mode.maxSide === 0) {
            // 原图直传
            setStatus(it, 'uploading', '上传到 GitHub…');
            if (gh.ready && it.file.size > 45 * 1024 * 1024) {
              src = await withTimeout(storeMedia(await compressImage(it.file, 3000, .94), base, 'jpg'), 120_000, 'GitHub 上传(大图)');
              ext = 'jpg';
            } else {
              ext = (it.file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
              src = await withTimeout(storeMedia(it.file, base, ext), 90_000, 'GitHub 上传原图');
            }
          } else {
            // 需要压缩
            setStatus(it, 'uploading', '压缩中…');
            const compressed = await withTimeout(compressImage(it.file, mode.maxSide, mode.q), 60_000, '图片压缩');
            checkTimeout();
            setStatus(it, 'uploading', '上传到 GitHub… (1/2)');
            src = await withTimeout(storeMedia(compressed, base, 'jpg'), 90_000, 'GitHub 上传');
          }
          checkTimeout();
          setProgress(it, 0.80);
          setStatus(it, 'uploading', '上传缩略图到 GitHub…');
          const thumb = await withTimeout(
            storeMedia(await withTimeout(compressImage(it.file, 700, .8), 30_000, '缩略图压缩'), base + '-t', 'jpg'),
            60_000, 'GitHub 上传缩略图'
          );
          it.result = { src, thumb, kind: 'image' };
        } else {
          const ext = (it.file.name.split('.').pop() || 'mp4').toLowerCase();
          if (it.file.size > 45 * 1024 * 1024) throw new Error('视频超过 45MB，建议压缩后再传');
          setStatus(it, 'uploading', '上传视频到 GitHub…');
          const src = await withTimeout(storeMedia(it.file, base, ext), 120_000, 'GitHub 上传视频');
          checkTimeout();
          setProgress(it, 0.85);
          const poster = await withTimeout(videoPoster(it.file), 15_000, '视频截帧').catch(() => null);
          let posterPath = '';
          if (poster) {
            checkTimeout();
            posterPath = await withTimeout(storeMedia(poster, `${base}-p`, 'jpg'), 60_000, 'GitHub 上传封面');
          }
          it.result = { src, poster: posterPath, thumb: posterPath, kind: 'video' };
        }
      } else {
        // 本地预览：转 dataURL（不保存，仅本机）
        if (it.kind === 'image') {
          const blob = mode.maxSide === 0 ? it.file : await compressImage(it.file, mode.maxSide, mode.q);
          it.result = { src: await blobToDataURL(blob), thumb: await blobToDataURL(await compressImage(it.file, 700, .8)), kind: 'image' };
        } else {
          it.result = { src: await blobToDataURL(it.file), thumb: '', poster: '', kind: 'video' };
        }
        setProgress(it, 1);
      }
      setProgress(it, 1);
      setStatus(it, 'done', '✓ 已完成');
      commitDone(it);
    } catch (e) {
      setStatus(it, 'error', '✗ ' + describeError(e));
    }
  }

  const box = el('div', {},
    el('div', { class: 'tip' }, `目标存储：${targetText}`,
      // 版本标识：修改代码后请同步更新此数字，用于确认浏览器是否加载了最新版本
      el('span', { style: 'font-size:11px;color:#999;margin-left:8px;font-weight:normal' }, 'v4.0')),
    field('上传画质', qSeg, '原图直传：零压缩、保留原始格式与尺寸（v4.0 预签名直传，无大小限制）；高画质/标准：自动压缩后再传。'),
    drop,
    list,
    summary,
    el('div', { class: 'drawer-actions', style: 'margin-top:16px' }, clearBtn, addBtn, startBtn)
  );
  openDrawer(`上传作品 · ${col.title || '未命名专栏'}`, box);
}

export function toggleStar(kind, colId, itemId) {
  const col = store.findCollection('works', colId);
  const it = col?.items.find(i => i.id === itemId);
  if (!it) return;
  it.star = !it.star;
  changed();
}
export function renameItem(kind, colId, itemId) {
  const col = store.findCollection('works', colId);
  const it = col?.items.find(i => i.id === itemId);
  if (!it) return;
  const v = window.prompt('作品标题', it.title || '');
  if (v === null) return;
  it.title = v.trim();
  changed();
}
export function removeItem(kind, colId, itemId) {
  const col = store.findCollection('works', colId);
  if (!col || !confirmBox('从专栏中移除这件作品？')) return;
  const it = col.items.find(i => i.id === itemId);
  col.items = col.items.filter(i => i.id !== itemId);
  changed();
  if (gh.ready && it) {
    [it.src, it.thumb, it.poster].filter(p => p && p.startsWith('media/'))
      .forEach(p => gh.deleteFile(p, 'chore: remove media').catch(() => {}));
  }
}

/* 是否为远程地址（http/https）；否则视为站内相对路径 */
function isRemoteUrl(u) { return /^https?:\/\//i.test((u || '').trim()); }

/* ================= COS 桶文件夹同步 ================= */
/* 把「专栏改名 / 图片移动」同步到腾讯云 COS 桶。需要用户自己部署的 SCF 后台（凭证不进前端）。
   地址存本机 localStorage，未配置时只改本地数据、不报错。 */
function getCosSyncUrl() { return (localStorage.getItem('mg_cos_sync_url') || '').trim(); }
function setCosSyncUrl(v) { v ? localStorage.setItem('mg_cos_sync_url', v.trim()) : localStorage.removeItem('mg_cos_sync_url'); }

/**
 * 管理面板里的「COS 中转地址」配置：只填云函数 URL（存本机浏览器），
 * 浏览器把图发到云函数，由它在服务端用 COS 密钥直传桶——密钥永不进访客浏览器。
 * 同一个地址同时服务「上传」与「改名 / 移动同步」。
 */
function cosConfigBox() {
  const relayIn = input({ id: 'f_cos_relay', value: getCosSyncUrl(), placeholder: 'https://xxx.apigw.tencentcs.com/... 或 scf 函数URL' });
  const status = el('div', { class: 'hint', style: 'margin-top:8px' },
    cosReady() ? '✅ 已配置，v4.0 预签名直传（大图无限制，密钥不暴露）' : '未配置：上传会退回 GitHub / 本机预览');
  const diagResult = el('div', { class: 'hint', style: 'margin-top:6px;font-size:12px;color:var(--text2);display:none' });
  return el('div', { style: 'margin-top:14px;padding-top:14px;border-top:1px solid var(--line)' },
    field('COS 中转地址（云函数 URL）', relayIn,
      '浏览器把图片发到这个云函数，由它在<b>服务端</b>用 COS 密钥直传桶——密钥只在服务器，访客浏览器完全拿不到，适合公开站点。'
      + '同一个地址同时用于「上传」与「改名 / 移动同步」。部署时记得把云函数<b>执行超时设为 60 秒</b>。'),
    el('button', {
      class: 'btn-ghost', style: 'width:100%;padding:10px',
      onclick: () => {
        setCosSyncUrl(relayIn.value);
        const ok = cosReady();
        status.innerHTML = ok ? '✅ 已配置，v4.0 预签名直传（大图无限制，密钥不暴露）' : '未配置：上传会退回 GitHub / 本机预览';
        toast(ok ? 'COS 中转已配置' : '已清除', ok ? 'ok' : '');
      },
    }, '保存 COS 中转地址'),
    el('button', {
      class: 'btn-ghost', style: 'width:100%;padding:8px;margin-top:6px',
      onclick: async () => {
        diagResult.style.display = 'block';
        diagResult.innerHTML = '⏳ 正在诊断连通性...';
        try {
          const results = await cosDiagnose();
          diagResult.innerHTML = results.map(r =>
            `<div style="margin:2px 0">${r.ok ? '✅' : '❌'} ${r.step}: ${r.msg}</div>`
          ).join('');
          // 如果全部失败，给出具体建议
          const allFail = results.every(r => !r.ok);
          if (allFail) {
            diagResult.innerHTML += '<div style="color:var(--danger);margin-top:6px">💡 建议：检查手机网络/WiFi、确认函数 URL 可在浏览器直接打开、或尝试切换网络环境</div>';
          }
        } catch (e) {
          diagResult.innerHTML = `❌ 诊断异常: ${e.message}`;
        }
      },
    }, '🔍 诊断连通性'),
    diagResult,
    status
  );
}

/* 从 URL 提取 COS 域名基地址（兼容直链 cos.*.myqcloud.com 与 CDN *.file.myqcloud.com） */
function cosBaseOf(u) {
  const m = /^https:\/\/[^/]+\.myqcloud\.com\//.exec(u || '');
  return m ? m[0] : '';
}
/* 从专栏首个图片 URL 解析出真实 COS 文件夹名（如 Photos/Kpop/ -> 'Kpop'）。
   注意：col.id 只是前端 slug（如 ms92t7bf36gbo），真正的桶文件夹是显示名派生出来的，
   改名/移动必须以真实文件夹名为准，否则会改错/改不到桶。 */
function folderOf(col) {
  for (const it of col.items || []) {
    const u = it.src || it.thumb || '';
    const m = /\/Photos\/([^/]+)\//.exec(u);
    if (m) return m[1];
  }
  return '';
}
/* 把 URL 里的 Photos/<oldId>/ 改写为 Photos/<newId>/ */
function rewriteCosFolder(u, oldId, newId) {
  const base = cosBaseOf(u);
  if (!base) return u;
  const oldPath = `Photos/${oldId}/`, newPath = `Photos/${newId}/`;
  return u.startsWith(base + oldPath) ? base + newPath + u.slice((base + oldPath).length) : u;
}
/* 整专栏改写 URL 文件夹名 */
function colCosUrls(col, oldId, newId) {
  for (const it of col.items || []) {
    for (const k of ['src', 'thumb', 'poster']) {
      if (it[k]) it[k] = rewriteCosFolder(it[k], oldId, newId);
    }
  }
}
/* 单张图片改写 URL 文件夹名 */
function itemCosUrl(it, fromId, toId) {
  for (const k of ['src', 'thumb', 'poster']) {
    if (it[k]) it[k] = rewriteCosFolder(it[k], fromId, toId);
  }
}
/* 调 SCF 后台；未配置地址则静默跳过 */
async function cosSync(payload, okMsg, failMsg) {
  const url = getCosSyncUrl();
  if (!url) return;
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const j = await res.json().catch(() => ({}));
    if (!j.ok) throw new Error(j.err || '后台返回失败');
    if (okMsg) toast(okMsg, 'ok');
  } catch (e) {
    toast((failMsg || '桶同步失败') + '：' + e.message, 'err');
  }
}

/**
 * 添加外链图片：粘贴 URL（每行一个，支持 `url | 标题 | 缩略图url`）。
 * 外链图片直接由浏览器从图床/CDN 加载，不经过 GitHub，不占仓库空间、不耗 Pages 月流量，
 * 因此适合放成百上千张高清原图（单张 ≤100MB 都没问题）。
 */
export function addRemoteImages(kind, colId) {
  const col = store.findCollection(kind, colId) || store.findCollection('works', colId);
  if (!col) return;
  const ta = textarea({
    id: 'remoteUrls', rows: 9,
    placeholder: '每行一个图片链接，例如：\nhttps://your-cdn.com/col/a.jpg\nhttps://your-cdn.com/col/b.jpg | 作品标题\nhttps://your-cdn.com/col/c.jpg | 标题 | https://your-cdn.com/col/c-t.jpg',
  });
  const content = el('div', {},
    field('粘贴外链图片链接', ta,
      '每行一个图片地址。可用 <code>|</code> 分隔填写「标题」与「缩略图地址」。<br>' +
      '<b>外链图片直接从你的图床 / CDN 加载，不经过 GitHub，不占仓库空间、不耗 Pages 月流量</b>，' +
      '适合放成百上千张高清原图（单张 ≤100MB 都没问题）。'),
  );
  const done = actions('添加', () => {
    const lines = ta.value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (!lines.length) return toast('请先粘贴至少一个链接', 'err');
    let added = 0, skipped = 0;
    for (const line of lines) {
      const parts = line.split('|').map(s => s.trim());
      const src = parts[0];
      if (!src) { skipped++; continue; }
      if (!isRemoteUrl(src) && !/^(media\/|\.\/|\/)/.test(src)) { skipped++; continue; }
      const title = parts[1] || '';
      const thumb = parts[2] || '';
      col.items.push({
        id: uid(),
        src,
        thumb: thumb || '',
        kind: 'image',
        title: title || cleanName(src.split('?')[0].split('/').pop() || '作品'),
        star: col.items.length < 3,
      });
      added++;
    }
    changed();
    closeDrawer();
    toast(added ? `已添加 ${added} 张外链图片${skipped ? `（${skipped} 行无效已跳过）` : ''}` : '没有有效的图片链接', added ? 'ok' : 'err');
  });
  openDrawer('🌐 粘贴外链图片', el('div', {}, content, done));
}

/** 修改某件作品的图片链接（支持外链 https://… 或站内 media/… 路径） */
export function editItemUrl(kind, colId, itemId) {
  const col = store.findCollection('works', colId);
  const it = col?.items.find(i => i.id === itemId);
  if (!it) return;
  const src = window.prompt('图片地址（外链填 https://…，站内填 media/… 路径）', it.src || '');
  if (src === null) return;
  const thumb = window.prompt('缩略图地址（可留空；留空则使用原图作为缩略图）', it.thumb || '');
  if (thumb === null) return;
  it.src = src.trim();
  it.thumb = (thumb.trim() || '');
  if (!it.kind) it.kind = 'image';
  changed();
  toast('链接已更新', 'ok');
}

/** 移动作品到其它专栏：从源专栏移除、追加到目标专栏 */
export async function moveItem(kind, fromColId, itemId, toColId) {
  if (!fromColId || !toColId || fromColId === toColId) return;
  const from = store.findCollection('works', fromColId);
  const to = store.findCollection('works', toColId);
  if (!from || !to) return;
  const it = from.items.find(i => i.id === itemId);
  if (!it) return;
  const fromFolder = from.folder || folderOf(from) || fromColId;
  const toFolder = to.folder || folderOf(to) || toColId;
  itemCosUrl(it, fromFolder, toFolder);   // 改写该图片 URL 的文件夹
  from.items = from.items.filter(i => i.id !== itemId);
  to.items.push(it);
  changed();
  toast(`已移动到「${to.title || '未命名专栏'}」`, 'ok');
  const file = (it.src.split('?')[0].split('/').pop() || '');
  cosSync({ action: 'move_object', from: fromFolder, to: toFolder, file },
          '桶内图片已同步移动', '桶图片同步失败');
}

/* ---------- 存储：连接了仓库就上传，否则退化为本地 dataURL ---------- */
async function storeMedia(blobOrFile, basePath, ext) {
  if (gh.ready) {
    const path = `${basePath}.${ext}`;
    await gh.putBinary(path, blobOrFile, `feat(media): ${path}`);
    return path;
  }
  return await blobToDataURL(blobOrFile);
}

/* ---------- 文件工具 ---------- */
function pickFiles({ accept = '*/*', multiple = false } = {}) {
  return new Promise(resolve => {
    const inp = el('input', { type: 'file', accept, style: 'display:none' });
    if (multiple) inp.multiple = true;
    inp.onchange = () => { resolve([...inp.files]); inp.remove(); };
    document.body.append(inp);
    inp.click();
  });
}

function cleanName(n = '') {
  return n.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').slice(0, 40);
}

export function compressImage(file, maxSide = 2000, quality = .88) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const ctx = cv.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, w, h);
      cv.toBlob(b => b ? resolve(b) : reject(new Error('压缩失败')), 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('无法读取图片')); };
    img.src = url;
  });
}

function videoPoster(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.preload = 'metadata'; v.muted = true; v.playsInline = true; v.src = url;
    v.onloadeddata = () => { v.currentTime = Math.min(1, (v.duration || 2) / 3); };
    v.onseeked = () => {
      const cv = document.createElement('canvas');
      const scale = Math.min(1, 900 / Math.max(v.videoWidth, v.videoHeight));
      cv.width = v.videoWidth * scale; cv.height = v.videoHeight * scale;
      cv.getContext('2d').drawImage(v, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url);
      cv.toBlob(b => b ? resolve(b) : reject(new Error('截帧失败')), 'image/jpeg', .82);
    };
    v.onerror = () => { URL.revokeObjectURL(url); reject(new Error('无法读取视频')); };
  });
}

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

async function fetchImageBlob(url) {
  const tries = [url, `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`, `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`];
  for (const u of tries) {
    try {
      const r = await fetch(u, { referrerPolicy: 'no-referrer' });
      if (r.ok) {
        const b = await r.blob();
        if (b.size > 100) return b;
      }
    } catch { /* next */ }
  }
  throw new Error('图片无法下载（防盗链）');
}

/* 首次没有数据时提供一键示例结构，方便理解 */
export function seedDemo() {
  Object.assign(store.data, structuredClone(DEFAULT_DATA));
  changed();
}
