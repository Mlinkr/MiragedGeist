# COS 桶文件夹同步服务（腾讯云 SCF 云函数）

网站「改名专栏 / 移动图片」时，让腾讯云 COS 桶里的文件夹和图片自动跟着变。
前端只持有本函数的 HTTPS 地址，凭证放在函数环境变量里（不进前端代码）。

## 部署步骤（手机/电脑浏览器均可）

1. 打开 [腾讯云 SCF 控制台](https://console.cloud.tencent.com/scf) → 函数服务 → **新建**
2. 创建方式：**Web 函数**（或事件函数均可）；运行环境选 **Python 3.10**
3. 把本目录 `index.py` 的内容粘贴到函数代码；`requirements.txt` 也一并上传（云函数会自动 `pip install` 依赖）
4. 进入函数 **函数配置 → 环境变量**，添加三项：
   | 键 | 值 |
   |----|----|
   | `COS_SECRET_ID` | 你的 SecretId |
   | `COS_SECRET_KEY` | 你的 SecretKey |
   | `COS_BUCKET` | `miragedgeist-1463128155` |
   | `COS_REGION` | `ap-guangzhou` |
5. **触发管理** → 创建 **API 网关触发**（Web 服务 / 公网访问），拿到一个 `https://xxxx.apigw.tencentcs.com/release/...` 地址
6. 网站里：管理面板 → 底部「COS 同步服务地址（SCF）」→ 粘贴这个地址 → 保存

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
