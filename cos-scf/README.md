# COS 桶文件夹同步服务（腾讯云 SCF 云函数）

网站「改名专栏 / 移动图片」时，让腾讯云 COS 桶里的文件夹和图片自动跟着变。
前端只持有本函数的 HTTPS 地址，凭证放在函数环境变量里（不进前端代码）。

## 部署步骤（手机/电脑浏览器均可）

1. 打开 [腾讯云 SCF 控制台](https://console.cloud.tencent.com/scf) → 函数服务 → **新建**
2. 创建方式：**Web 函数**（重点！Web 函数自带 HTTP 地址，**不用建 API 网关触发**——旧网关已迁移不可用）；运行环境选 **Python 3.10**
3. 把本目录 `index.py` 的内容粘贴到函数代码；`requirements.txt` 也一并上传（云函数会自动 `pip install` 依赖）
4. 进入函数 **函数配置 → 环境变量**，添加四项：
   | 键 | 值 |
   |----|----|
   | `COS_SECRET_ID` | 你的 SecretId |
   | `COS_SECRET_KEY` | 你的 SecretKey |
   | `COS_BUCKET` | `miragedgeist-1463128155` |
   | `COS_REGION` | `ap-guangzhou` |
5. 保存并**部署**后，Web 函数页面会直接给出一个 **访问路径 / 公网地址**（形如 `https://xxx.apigw.tencentcs.com/...` 或函数自带域名）。这就是要填到网站的地址。
6. 网站里：管理面板 → 底部「COS 同步服务地址（SCF）」→ 粘贴这个地址 → 保存

> 注意：**不要去「触发管理」建 API 网关触发**，腾讯云 API 网关已迁移，旧触发方式现在建不出来。Web 函数自带访问地址，足够用。

## 接口

`POST <地址>` ，JSON body：

- 改名文件夹：`{"action":"rename_folder","old":"旧名","new":"新名"}`
  把 `Photos/<旧名>/` 整目录复制到 `Photos/<新名>/` 并删旧
- 移动图片：`{"action":"move_object","from":"源专栏","to":"目标专栏","file":"文件名.jpg"}`
  把 `Photos/<源>/<file>` 复制到 `Photos/<目标>/<file>` 并删旧

返回 `{"ok":true,...}` 表示成功。

## 说明

- 函数只做「服务端复制 + 删旧」，不存储任何图片内容，凭证不外泄。
- 没填地址时，网站改名/移动只改网页数据、不动桶（功能优雅降级）。
- 复制失败会报错并返回，前端会提示你手动在桶里调整。
