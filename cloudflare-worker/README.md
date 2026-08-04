# 腾讯云 COS 预签名上传 Worker（手机直传原画质大图）

网站图片已迁移到腾讯云对象存储（COS）。手机要上传原图（不限大小，COS 无 10MB 限制），需要**预签名上传**——
但 SecretKey 绝不能下发到手机。本 Worker 把 SecretKey 存在自己的环境变量里，只向前端返回一次性**预签名 PUT URL**，
前端拿它**直传 COS**，SecretKey 永不下发到手机或仓库，安全。

配合 `upload-cos.html`（填 Worker 地址即生效）使用。

---

## 一、签名算法

与腾讯云 Python SDK（`cos_auth.py`）完全一致，已用 Node 对照 SDK 参照签名验证通过：

```
format_str = "put\n/<Key路径>\n\nhost=<桶域名>\n"      # 注意：host 处是对象路径，真实 host 在 headers
sha1      = SHA1(format_str)
str_to_sign= "sha1\n<signTime>\n<sha1>\n"
sign_key  = HMAC-SHA1(SecretKey, signTime)            # 取十六进制字符串
signature = HMAC-SHA1(sign_key, str_to_sign)          # 取十六进制字符串
```

---

## 二、桶前置设置（一次性）

1. **数据万象**：COS 控制台 → 存储桶 → 数据万象 → 开通（缩略图 `?imageMogr2/thumbnail/1600x` 实时缩放依赖它）。
2. **CORS**：存储桶 → 安全管理 → 跨域访问 CORS → 新增规则：
   - 来源 Origin：`*`（或你的站点域名）
   - Method：`PUT,POST,GET,HEAD,OPTIONS`
   - Allow-Header：`*`
   - 保存。否则浏览器直传会被 CORS 拦。
3. **公有读**：存储桶 → 权限管理 → 公有读（网页才能直接加载图片）。

---

## 三、部署 Worker（两种，任选其一）

### 方式 1：Cloudflare 控制台（手机/网页都能做，不用装命令行）

1. 注册/登录 [dash.cloudflare.com](https://dash.cloudflare.com)（免费）。
2. **Workers & Pages → Create → Create Worker**，命名（如 `cos-signer`）。
3. 把 `worker.js` 内容**整段粘贴**覆盖默认代码 → **Deploy**。
4. 进入该 Worker → **Settings → Variables → 添加变量**（SecretKey 选 Encrypt 加密）：
   - `COS_SECRET_ID` = 你的 SecretId（AKID…）
   - `COS_SECRET_KEY` = 你的 SecretKey
   - `COS_BUCKET` = 桶名（如 `miragedgeist-1463128155`）
   - `COS_REGION` = 地域（如 `ap-guangzhou`）
5. 复制 Worker 地址（形如 `https://cos-signer.<账户>.workers.dev`）。
6. 填进 `upload-cos.html` 的「签名 Worker 地址」。

### 方式 2：wrangler 命令行

```bash
cd cloudflare-worker
npm i -g wrangler && wrangler login
wrangler secret put COS_SECRET_KEY          # 交互粘贴 SecretKey（加密）
# 在 wrangler.toml 里填 COS_SECRET_ID / COS_BUCKET / COS_REGION
wrangler deploy
```

---

## 四、前端怎么用

`upload-cos.html`：填 Worker 地址 + 存放目录（修图 `Photos` / 影视 `Cut`），选图即直传原画质，
每行输出 `原图 | 标题 | 缩略图` 格式，复制后去网站后台「🌐 粘贴外链图片」粘贴即可。

---

## 五、安全要点

- **SecretKey 只存在 Worker 环境变量**，本仓库不含任何密钥。
- 每个预签名 URL 带 `q-sign-time`，默认 10 分钟内有效，无法被抓包后复用盗传。
- 若怀疑 SecretKey 泄露：到腾讯云控制台**禁用/重置**该密钥，再更新 Worker 环境变量即可。
