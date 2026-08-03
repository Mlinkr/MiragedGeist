# Cloudinary 签名上传 Worker（原画质大图直传）

手机上传原图到 Cloudinary 时，免签名（unsigned）上传有 **10MB 单文件上限**，超过就被拒。
本 Worker 用 Cloudinary 的**签名上传**突破该限制（上限约 100MB / 文件），并且把 API Secret 藏在 Worker 环境变量里——
前端只拿到一次性签名，**Secret 永不下发到手机或仓库**，安全。

配合 `upload-cloudinary.html`（填 Worker 地址即生效）使用。

---

## 一、原理

```
手机浏览器 --POST {folder}--> Worker(持有 Secret) --返回一次性签名--> 手机
手机 --file + 签名 + api_key--> Cloudinary 直传（原画质，无 10MB 限制）
```

签名规则与 `signed_reupload.py` 完全一致：把 `timestamp`+`folder` 按 key 排序拼成
`folder=X&timestamp=Y`，末尾追加 Secret，取 SHA-1 十六进制。

---

## 二、部署（两种，任选其一）

### 方式 1：Cloudflare 控制台（手机/网页都能做，不用装命令行）

1. 注册/登录 [dash.cloudflare.com](https://dash.cloudflare.com)（免费）。
2. 左侧 **Workers & Pages → Create → Create Worker**，随便命名（如 `cld-signer`）。
3. 把 `worker.js` 的内容**整段粘贴**覆盖默认代码 → **Deploy**。
4. 进入该 Worker → **Settings → Variables → 添加变量**：
   - `CLOUDINARY_CLOUD_NAME` = `gopfeu83`
   - `CLOUDINARY_API_KEY` = `864775887227493`
   - `CLOUDINARY_API_SECRET` = `你的 Secret`（**加密变量**，选 "Encrypt" / secret 类型）
5. 保存后回到 Worker 主页，复制它的地址（形如 `https://cld-signer.<你账户>.workers.dev`）。
6. 把这个地址填进 `upload-cloudinary.html` 的「签名 Worker 地址」即可。

### 方式 2：wrangler 命令行（电脑端）

```bash
cd cloudflare-worker
npm i -g wrangler
wrangler login
wrangler secret put CLOUDINARY_API_SECRET   # 交互粘贴 Secret
wrangler deploy
# 部署后终端会给出 Worker 地址
```

> `wrangler.toml` 里已写好 cloud name / api key 默认值；Secret 必须走 `wrangler secret put` 注入，不要写进文件。

---

## 三、前端怎么用

`upload-cloudinary.html` 已支持双模式：
- **填了 Worker 地址** → 自动走签名上传，原画质、任意大小（修图选 `Photos`，影视 Cut 选 `Cut`）。
- **没填 Worker 地址** → 退回免签名 preset（≤10MB，老用法，零配置）。

Worker 收到的 `folder` 就是前端填的「存放目录」，决定图进 Cloudinary 的 `Photos` 还是 `Cut` 文件夹。

---

## 四、安全要点

- **API Secret 只存在 Worker 环境变量**，本仓库不含任何密钥（`wrangler.toml` 也没写 Secret）。
- 每个签名带 `timestamp`，仅在几分钟内有效，无法被抓包后复用盗传。
- 若怀疑 Secret 泄露：到 Cloudinary 控制台 **Regenerate API Secret**，再更新 Worker 的环境变量即可。
