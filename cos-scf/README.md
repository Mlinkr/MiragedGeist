# 腾讯云函数 SCF 版签名服务（不走 Cloudflare）

和 `cloudflare-worker/worker.js` 功能完全一样：给前端返回一次性 COS 预签名 PUT URL，手机批量直传原画质大图。
区别：部署在你**已有的腾讯云账号**的云函数上，不用开 Cloudflare。SecretKey 只存函数环境变量，不下发前端。

签名算法与腾讯云 SDK 一致（已用 Node / Python 对照 SDK 参照签名验证通过）。

---

## 部署步骤（腾讯云控制台，手机/电脑浏览器都行）

1. 控制台搜 **云函数 SCF** → 进入 → **新建函数**。
2. 创建方式「从头开始」→ 函数类型「**事件函数**」→ 运行环境 **Python 3.10** → 名称如 `cos-signer`。
3. 函数代码：把 `index.py` 内容整段粘贴（或本地 zip 上传）→ **执行方法**填 `index.main_handler`。
4. **函数配置 → 环境变量** 添加（SecretKey 建议勾「加密」）：
   - `COS_SECRET_ID` = 你的 SecretId（AKID…）
   - `COS_SECRET_KEY` = 你的 SecretKey
   - `COS_BUCKET` = `miragedgeist-1463128155`
   - `COS_REGION` = `ap-guangzhou`
5. **触发管理 → 创建触发方式** → 触发类型选 **HTTP 触发**（部分账号叫 API 网关触发）→ 创建后拿到**公网访问地址**
   （形如 `https://xxxx.tencentcs.com/...` 或 `https://xxxx.apigw.tencentcs.com/...`）。
6. **跨域**：触发配置里开启 CORS —— Allow-Origin `*`、Allow-Methods 含 `POST,OPTIONS`、Allow-Header `*`。
7. 把第 5 步的地址填进 `upload-cos.html` 的「签名服务地址」。

---

## 前置：桶还要开 CORS + 数据万象 + 公有读（一次性）

- **数据万象**：存储桶 → 数据万象 → 开通（缩略图 `?imageMogr2/thumbnail/1600x` 实时缩放依赖它，已验证可用）。
- **CORS**：存储桶 → 安全管理 → 跨域访问 CORS → 新增：Origin `*`，Method `PUT,POST,GET,HEAD,OPTIONS`，Allow-Header `*`。
- **公有读**：存储桶 → 权限管理 → 公有读（网页才能直接加载图片）。

---

## 前端怎么用

`upload-cos.html`：填「签名服务地址」（就是本云函数地址）+ 存放目录（修图 `Photos` / 影视 `Cut`），
多选图片即批量直传原画质，每行输出 `原图 | 标题 | 缩略图`，复制后去网站后台「🌐 粘贴外链图片」粘贴即可。

---

## 安全要点

- **SecretKey 只存在函数环境变量**，本仓库不含任何密钥。
- 每个预签名 URL 带 `q-sign-time`，默认 10 分钟内有效，无法被抓包后复用盗传。
- 若怀疑 SecretKey 泄露：到腾讯云控制台**禁用/重置**该密钥，再更新函数环境变量即可。
