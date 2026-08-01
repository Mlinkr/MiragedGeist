/* 管理模式：连接仓库 · 编辑内容 · 上传媒体 · 一键发布 */
import { $, el, field, input, textarea, actions, openDrawer, closeDrawer, toast, busy, uid, confirmBox } from './ui.js';
import { gh } from './github.js';
import { store, DEFAULT_DATA } from './store.js';
import { PLATFORMS, detectPlatform, normalizeUrl, fetchProfile, AUTO_OK } from './social.js';

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
  if (!store.editing) { bar?.remove(); return; }
  if (!bar) {
    bar = el('div', { class: 'edit-bar' });
    document.body.prepend(bar);
  }
  bar.innerHTML = '';
  const mode = gh.ready ? `${gh.cfg.owner}/${gh.cfg.repo}` : '本地体验模式（不会保存到线上）';
  bar.append(
    el('span', {}, `编辑模式 · ${mode}${store.dirty ? ' · 有未发布修改' : ''}`),
    gh.ready ? el('button', { onclick: () => publish() }, store.dirty ? '发布到线上' : '重新发布') : null,
    el('button', { onclick: () => openConsole() }, '面板'),
    el('button', { onclick: () => setEditing(false) }, '退出')
  );
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
        if (!existing) store.data.works.push(c);
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
export function renameCollection(kind, id) {
  const col = store.findCollection('works', id);
  if (!col) return;
  const v = window.prompt('专栏名称', col.title || '');
  if (v === null) return;
  col.title = v.trim() || '未命名专栏';
  changed();
  toast('已改名，记得发布', 'ok');
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

export async function uploadTo(kind, colId) {
  const col = store.findCollection('works', colId);
  if (!col) return;
  let files = await pickFiles({ accept: 'image/*,video/*', multiple: true });
  if (!files.length) return;

  // 限制单次最多 9 个文件
  if (files.length > 9) {
    toast(`一次最多上传 9 个文件，已自动选取前 9 个`, '');
    files = files.slice(0, 9);
  }

  const mode = QUALITY[getQuality()] || QUALITY.high;
  let done = 0;
  for (const file of files) {
    try {
      busy(true, `上传中 ${++done}/${files.length}…`);
      const isImage = file.type.startsWith('image/');
      const isVideo = file.type.startsWith('video/');
      const base = `media/works/${colId}/${uid()}`;

      if (isImage) {
        let src, ext = 'jpg';
        if (mode.maxSide === 0) {
          // 原图直传：保留原始文件与扩展名
          ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
          if (gh.ready && file.size > 45 * 1024 * 1024) {
            toast(`${file.name} 超过 45MB，已自动转为高画质压缩`, 'err');
            src = await storeMedia(await compressImage(file, 3000, .94), base, 'jpg');
            ext = 'jpg';
          } else {
            src = await storeMedia(file, base, ext);
          }
        } else {
          src = await storeMedia(await compressImage(file, mode.maxSide, mode.q), base, 'jpg');
        }
        // 缩略图始终生成，保证首页加载速度
        const thumb = await compressImage(file, 700, .8);
        const th = await storeMedia(thumb, base + '-t', 'jpg');
        col.items.push({ id: uid(), src, thumb: th, kind: 'image', title: cleanName(file.name), star: col.items.length < 3 });
      } else if (isVideo) {
        if (gh.ready && file.size > 45 * 1024 * 1024) {
          toast(`${file.name} 超过 45MB，建议压缩后再传`, 'err');
          continue;
        }
        const ext = (file.name.split('.').pop() || 'mp4').toLowerCase();
        const src = await storeMedia(file, base, ext);
        const poster = await videoPoster(file).catch(() => null);
        const posterPath = poster ? await storeMedia(poster, `${base}-p`, 'jpg') : '';
        col.items.push({ id: uid(), src, poster: posterPath, thumb: posterPath, kind: 'video', title: cleanName(file.name), star: col.items.length < 3 });
      } else {
        toast(`${file.name} 不是图片或视频，已跳过`, 'err');
      }
    } catch (e) {
      toast(`${file.name} 上传失败：${e.message}`, 'err');
    } finally {
      busy(false);
    }
  }
  changed();
  toast(gh.ready ? '上传完成，记得点「发布」' : '已加入本地预览（未连接仓库，不会保存到线上）', gh.ready ? 'ok' : '');
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

/** 移动作品到其它专栏：从源专栏移除、追加到目标专栏 */
export function moveItem(kind, fromColId, itemId, toColId) {
  if (!fromColId || !toColId || fromColId === toColId) return;
  const from = store.findCollection('works', fromColId);
  const to = store.findCollection('works', toColId);
  if (!from || !to) return;
  const it = from.items.find(i => i.id === itemId);
  if (!it) return;
  from.items = from.items.filter(i => i.id !== itemId);
  to.items.push(it);
  changed();
  toast(`已移动到「${to.title || '未命名专栏'}」`, 'ok');
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
