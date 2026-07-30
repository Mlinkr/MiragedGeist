# MiragedGeist · 个人名片工作台

一个纯静态、零服务器、可永久访问的个人主页。所有人都能打开看，只有你（持有 Token 的浏览器）能编辑和上传。

## 🟢 已上线

| | |
|---|---|
| **网址** | **https://gmr2002.github.io/MiragedGeist/** |
| 仓库 | https://github.com/gmr2002/MiragedGeist |
| 部署 | GitHub Pages · main 分支 · 根目录 · 已强制 HTTPS |

任何人点开链接都能浏览，无需登录。你自己编辑只需下面第 1 步。

---

## 一、开始编辑（唯一要做的事）

### 1. 生成日常用的 Token

`头像菜单` → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token：

- **Expiration**：选 No expiration（否则到期要重配）
- **Repository access**：Only select repositories → 选中 **MiragedGeist**
- **Permissions** → Repository permissions → **Contents** 改成 `Read and write`

生成后复制那串 `github_pat_...`，**只显示这一次**。

### 2. 连接

打开 https://gmr2002.github.io/MiragedGeist/ → 拉到页面最底部 → 点右下角那个不起眼的**小菱形 ◆**。

owner 和 repo 会自动填好（`gmr2002` / `MiragedGeist`），**你只需要粘贴 Token** → 点「连接仓库」。

之后就能改头像、背景、简介，加社媒卡片，建专栏传作品。改完点顶部 **「发布到线上」**，约 30 秒后所有访客都能看到新内容。

> Token 只存在你自己浏览器的 localStorage 里，不会写进任何文件、不会推到仓库、访客拿不到。换电脑或换浏览器需重新填一次。

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

### 方案 A：改用户名，免费拿到 `miragedgeist.github.io`

经查 **GitHub 用户名 `MiragedGeist` 目前无人注册**。改名后网址会变成最干净的形式：

1. https://github.com/settings/admin → Change username → 改成 `MiragedGeist`
2. 把仓库 `MiragedGeist` 改名为 `MiragedGeist.github.io`（Settings → 顶部 Repository name）
3. 网址即变为 **https://miragedgeist.github.io/**

代价：另一个仓库 `Study-room` 的地址会跟着变（GitHub 会自动做旧链接跳转，但 git remote 需要更新）。改名随时可做，早做早省事。

### 方案 B：买自己的域名 `miragedgeist.com`

阿里云 / 腾讯云 / Namecheap 约 60-100 元/年：

1. 域名商后台加解析：
   - `A` 记录 `@` → `185.199.108.153`、`185.199.109.153`、`185.199.110.153`、`185.199.111.153`（四条都加）
   - `CNAME` 记录 `www` → `gmr2002.github.io`
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
