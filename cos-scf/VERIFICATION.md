# SCF 同步函数 · 修复与验证报告

> 函数：`Cos_scfa`（事件函数 + 函数 URL 公网）
> 桶：`miragedgeist-1463128155`（ap-guangzhou）
> 触发：前端管理面板改名/移动图片时 POST 调用

## 修复的两个根因

| # | 问题 | 现象 | 修复 |
|---|------|------|------|
| 1 | **COS V1 签名错误** | `SignatureDoesNotMatch`；方法未转小写、header 用 `\n` 连接而非 `&`、key/value 未按 `'-_.~'` 做 urlencode、签名用的是 URL 编码后的 path 而非原始 path | 复刻官方 `qcloud_cos` SDK 的签名算法（纯标准库，零依赖）；签名用**原始 path**，发请求用 `'-_.~'` 编码后的 path |
| 2 | **函数 URL 请求体被 base64 编码** | 前端/带参数的 POST 请求体被腾讯云函数 URL 做 base64 编码并置 `isBase64Encoded=true`，旧代码未解码直接 `json.loads` → 整个函数没执行（返回 `Expecting value`），改名从未发生 | `main_handler` 兼容 `isBase64Encoded`：命中时先 base64 解码再解析 JSON |

## 验证过程与结果

### 1. 签名算法正确性（与官方 SDK 逐字节比对）
本地用官方 `qcloud_cos` SDK 与自写 `_sign` 对同一组请求（GET 列举 / PUT 复制 / DELETE）生成 Authorization 字符串，**完全一致**（固定时间戳下逐字节相等）。

### 2. 真实只读请求
直接对桶发 `ListObjects`，返回正确 XML，列出全部 6 个顶层文件夹：
`Kpop / 周也 / 孟子义 / 胡先煦 / 赵今麦 / 迪丽热巴` —— 签名通过。

### 3. 真机端到端 rename（部署在 SCF 上的函数 URL）
用测试文件夹真实执行 copy+delete 改名，验证后清理，测试数据零残留：

| 用例 | 结果 |
|------|------|
| 英文文件夹 `__scf_test__` → `__scf_test2__` | ✅ PASS（文件落到新目录，旧目录清空） |
| 中文文件夹 `演示目录` → `演示目录2` | ✅ PASS（中文路径 URL 编码与 COS 解码验签正确） |

### 4. 调试端点清理
临时 `__debug__` 回显端点已移除，POST 该 body 现走正常逻辑（返回 `unknown action`）。

## 结论
函数已完全工作。在前端管理面板改名/移动图片时，桶内对应文件夹会同步改名。

## 安全提醒（建议择期处理）
对话中曾明文出现 COS 的 SecretId/SecretKey 与 GitHub PAT，属于已泄露凭证。建议：
1. 腾讯云「访问管理」禁用并重新生成该 COS 密钥对，更新 SCF 环境变量。
2. GitHub Settings → Developer settings 撤销该 PAT，更新本地 git 远程地址。
