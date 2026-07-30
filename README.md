# MiragedGeist · 个人名片工作台

一个纯静态、零服务器、可永久访问的个人主页。所有人都能打开看，只有你（持有 Token 的浏览器）能编辑和上传。

---

## 一、10 分钟上线

### 1. 建仓库

登录 GitHub，新建仓库：

| 项目 | 填写 |
|---|---|
| Repository name | `MiragedGeist.github.io` |
| 可见性 | **Public**（必须，Pages 免费版要求公开） |
| Initialize | 都不勾 |

> 仓库名用 `你的用户名.github.io` 时，网址最短：`https://miragedgeist.github.io/`
> 如果你的 GitHub 用户名不是 MiragedGeist，仓库名就填 `MiragedGeist`，网址会是 `https://你的用户名.github.io/MiragedGeist/`——照样包含 MiragedGeist。

### 2. 传代码

把本文件夹里**所有内容**（含隐藏文件 `.nojekyll`）传到仓库根目录。

网页方式：仓库页 → `Add file` → `Upload files` → 把文件夹拖进去 → `Commit changes`。

命令行方式：

```bash
cd miragedgeist
git init && git branch -M main
git add -A && git commit -m "feat: 个人名片工作台"
git remote add origin https://github.com/<你的用户名>/<仓库名>.git
git push -u origin main
```

### 3. 开 Pages

仓库 → `Settings` → 左侧 `Pages` → Source 选 **Deploy from a branch** → Branch 选 `main` / `/ (root)` → Save。

等 1 分钟，页面顶部会出现你的永久网址。**这个链接就是终身的，发给谁都能打开。**

### 4. 生成 Token（只有你自己需要）

`头像菜单` → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token：

- **Expiration**：选 No expiration（否则到期要重配）
- **Repository access**：Only select repositories → 选中你刚建的仓库
- **Permissions** → Repository permissions → **Contents** 改成 `Read and write`

生成后复制那串 `github_pat_...`，**只显示这一次**。

### 5. 开始编辑

打开你的网址 → 拉到页面最底部 → 点右下角那个不起眼的**小菱形 ◆** → 填入 owner / repo / Token → 连接。

之后就能改头像、背景、简介，加社媒卡片，建专栏传作品。改完点顶部 **「发布到线上」**，约 30 秒后所有访客都能看到新内容。

---

## 二、日常使用

### 换头像 / 背景
编辑模式下，头像右下角和背景右上角有相机按钮，点一下选图即可。图片会自动压缩后存进仓库。

### 改简介
「关于我」右侧的 **编辑简介**。支持简易 Markdown：

| 写法 | 效果 |
|---|---|
| `**加粗**` | **加粗** |
| `` `高亮` `` | 青色高亮标签 |
| `- 条目` | 无序列表 |
| `1. 条目` | 有序列表 |
| `# 小标题` | 小标题 |
| `[文字](链接)` | 超链接 |
| `---` | 分隔线 |

### 加社媒卡片
点「+ 粘贴链接添加」→ 粘贴主页链接 → 自动识别平台并尝试抓取。

**能自动抓到头像 + 昵称 + 粉丝数的平台：**
微博、哔哩哔哩、知乎、GitHub

**只能抓到头像 + 昵称（粉丝数看运气）：**
Instagram、X / Twitter、YouTube、Behance、pixiv

**必须手动填的平台：**
小红书、抖音、TikTok——这几家有登录风控和接口签名，任何纯前端方案都拿不到数据。手动填完之后卡片外观和自动抓的**一模一样**，访客完全看不出区别。手动填法：昵称、粉丝数直接照抄你的主页数字；头像可以在手机 App 里保存原图后传到仓库，或直接右键复制图片地址粘进「头像地址」。

> 微博头像有防盗链，如果卡片头像显示不出来，点表单里的 **「把头像存到我的仓库」**，转存一次就永久稳定了。

### 传作品

1. 「+ 新建专栏」建分类，比如「人像」「女性写真」「商业修图」「旅拍 Vlog」
2. 专栏里的虚线方块点一下就能选文件，**支持一次多选批量上传**
3. 首页每个专栏固定展示 **3 张精选**，点「查看全部」进详情页看全部
4. 详情页每张图右上角：`☆` 设为精选（决定首页展示哪 3 张）、`✎` 改标题、`✕` 删除

图片会自动生成压缩版和缩略图，首页加载很快。视频会自动截取一帧当封面。

### 发布
**所有修改都要点「发布到线上」才会对访客生效。** 顶部彩色条会提示「有未发布修改」。

---

## 三、几个要注意的点

**单文件 100MB 上限。** 这是 GitHub 的硬限制，本站在 45MB 就会拦你。剪辑成片建议先压：

```bash
ffmpeg -i 原片.mp4 -vf scale=-2:1080 -c:v libx264 -crf 26 -preset slow \
       -c:a aac -b:a 128k -movflags +faststart 压缩后.mp4
```

CRF 数值越大文件越小（23 高质量 / 26 均衡 / 30 小体积）。一段 3 分钟 1080p 片子压完通常 20-40MB。

**长片更建议走外链。** 传 B站或 YouTube，然后把视频页链接做成社媒卡片，既不占空间，播放也更流畅。

**Token 安全。** Token 只存在你自己浏览器的 localStorage 里，不会写进任何文件、不会推到仓库、访客拿不到。但**别在公共电脑上登录**；如果不小心泄露，去 GitHub 撤销该 Token 再重新生成即可。换电脑就重新填一次。

**仓库大小。** 建议控制在 1GB 以内。图片自动压缩后一张约 200-500KB，几百张完全没问题。

---

## 四、绑定自己的域名（可选）

想要 `miragedgeist.com` 这种，需要自己买域名（阿里云/腾讯云/Namecheap，约 60-100 元/年）：

1. 域名商后台加解析：
   - `A` 记录 `@` → `185.199.108.153`、`185.199.109.153`、`185.199.110.153`、`185.199.111.153`（四条都加）
   - `CNAME` 记录 `www` → `你的用户名.github.io`
2. 仓库 Settings → Pages → Custom domain 填入域名 → Save
3. 等 DNS 生效（几分钟到几小时），回来勾上 **Enforce HTTPS**

---

## 五、文件结构

```
├── index.html          页面骨架
├── .nojekyll           关闭 Jekyll，防止资源被过滤
├── assets/
│   ├── css/style.css   全部样式
│   └── js/
│       ├── app.js      渲染 · 路由 · 灯箱
│       ├── admin.js    编辑模式 · 上传 · 发布
│       ├── github.js   仓库读写
│       ├── social.js   平台识别 · 信息抓取
│       ├── store.js    数据模型
│       └── ui.js       通用组件
├── data/site.json      ← 你的全部内容都在这里
└── media/              ← 你上传的图片和视频
```

**`data/site.json` 是你整个站点的全部内容。** 管理面板里可以「导出备份」，存一份到网盘，任何时候都能恢复。

---

## 六、常见问题

**改完没变化？**
GitHub Pages 有 30 秒左右的构建延迟，等一下强制刷新（Ctrl/Cmd + Shift + R）。

**点发布报 401 / 403？**
Token 过期或权限不足。重新生成一个，确认 Contents 权限是 `Read and write`，且 Repository access 选中了这个仓库。

**图片传上去显示裂图？**
检查仓库根目录有没有 `.nojekyll` 这个空文件。没有的话 GitHub 会忽略下划线开头的路径，补一个即可。

**想在手机上传作品？**
可以。手机浏览器打开网址，同样点右下角小菱形填 Token，选图会直接调起相册。

**社媒抓取一直转圈？**
25 秒后会自动放弃并提示手动填写，不会卡死。抓取依赖第三方 CORS 代理，偶尔不稳定属正常，手动填的效果完全一样。
