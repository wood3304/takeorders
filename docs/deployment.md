# 部署与测试指南

以下步骤按「第一次在微信开发者工具中运行」编写。项目当前 AppID 为 `wx51bba6084aee1075`，目录根即小程序根目录，云函数目录为 `cloudfunctions/`。

## 1. 准备工作

1. 安装最新稳定版微信开发者工具。
2. 使用有该小程序开发权限的微信号登录。
3. 确认小程序已开通云开发（若未开通，开发者工具会引导开通）。
4. 准备一个腾讯云账号并完成个人实名认证，用于开通语音识别 ASR。
5. 准备两个不同的微信号，用于验证“别人只能看、不能改”和“导入副本”逻辑。

## 2. 导入项目

1. 微信开发者工具 → 导入项目 → 选择本项目根目录。
2. AppID 使用 `wx51bba6084aee1075`，或替换为自己的 AppID。
3. 项目使用 WebView 渲染（已移除模板的 Skyline 配置），基础库建议 3.0.0 以上，项目私有配置为 `3.17.6`。

## 3. 开通云开发

1. 点击开发者工具顶部「云开发」。
2. 新建或选择一个云环境。
3. 记下环境 ID，例如 `cloud1-1gxxxxxx`。

### 3.1 指定云环境（可选）

默认情况下小程序会使用当前账号的默认云环境。若你有多个环境，编辑：

```js
// utils/config.js
module.exports = {
  CLOUD_ENV: 'cloud1-1gxxxxxx',
  // ...
}
```

云函数使用 `cloud.DYNAMIC_CURRENT_ENV`，会自动跟随部署所在环境，不需要逐个填写环境 ID。

> 注意：客户端和云函数必须处于同一环境；在开发者工具顶部切换环境后，重新编译。

## 4. 创建数据库集合

云开发控制台 → 数据库：

1. 点击「添加集合」。
2. 集合名填写 **`recipes`**（区分大小写）。
3. 创建后暂时不需要手动添加记录。

如果云函数报 `COLLECTION_MISSING` 或“集合不存在”，回到这一步检查集合名称。

## 5. 设置数据库权限（重要）

选择 `recipes` → 权限设置 → 自定义安全规则，填入：

```json
{
  "read": false,
  "write": false
}
```

保存后，客户端直接 `wx.cloud.database().collection('recipes')` 会被拒绝；所有数据访问都通过云函数完成。云函数使用管理端权限，仍可正常读写。

> 如果你希望保留客户端直读能力，可以把 `read` 改为 `"auth != null"`，但不要把 `write` 打开。本项目的客户端代码没有使用直连数据库，因此保持 `false` 更安全。

## 6. 创建索引

数据库 → `recipes` → 索引管理 → 添加索引：

| 索引名 | 字段 1 | 字段 2 |
| --- | --- | --- |
| `idx_openid_updated` | `_openid` 升序 | `updatedAt` 降序 |
| `idx_updated` | `updatedAt` 降序 | — |
| `idx_image_file` | `imageFileID` 升序 | — |
| `idx_title`（可选） | `title` 升序 | — |

索引创建是异步的，等待状态变为“可用”再测试列表。若控制台提示建立组合索引，按提示补建。

## 7. 上传 7 个云函数

在开发者工具左侧文件树中展开 `cloudfunctions`，依次对以下目录右键：

```text
login
listRecipes
getRecipe
saveRecipe
deleteRecipe
importRecipe
speechToText
```

选择：

> **上传并部署：云端安装依赖（不上传 node_modules）**

每个函数都带有自己的 `package.json`，依赖只有官方 `wx-server-sdk`。`speechToText` 不依赖腾讯云 SDK，使用 Node 内置 `https/crypto` 实现 TC3 签名。部署完成后：

1. 打开云开发控制台 → 云函数，确认 7 个函数都存在。
2. 分别查看函数详情，确认运行环境为 Node.js（建议 Node.js 16 或 18）。
3. 在云函数日志中确认没有安装依赖失败。
4. 如云函数执行超时（默认超时时间较短），在云开发控制台将 `saveRecipe`、`listRecipes` 的超时时间调到 10 秒左右；把 `speechToText` 的超时时间调到 20 秒左右。

### 7.1 快速自检 `login`

云函数控制台的“云端测试”不一定带有小程序用户上下文，`OPENID` 可能为空，因此不要只在控制台判断登录成功。

建议先编译小程序，在开发者工具 Console 中执行：

```js
wx.cloud.callFunction({ name: 'login' }).then(console.log)
```

应返回：

```js
{
  result: {
    success: true,
    data: {
      openid: 'oXxxxx...',
      appid: 'wx51bba6084aee1075'
    }
  }
}
```

若没有 openid，检查是否从小程序端发起调用，以及云环境是否一致。

## 8. 配置腾讯云一句话识别 ASR

个人主体小程序无法添加“微信同声传译”插件，因此项目已改为：

```text
wx.getRecorderManager 录音
→ 上传到云存储 voice-temp/{openid}/
→ speechToText 云函数
→ 腾讯云 SentenceRecognition 一句话识别
→ 返回文字并删除临时音频
```

### 8.1 开通腾讯云 ASR

1. 登录 [腾讯云控制台](https://console.cloud.tencent.com/)，完成个人实名认证。
2. 进入「语音识别」产品页，按控制台提示开通服务。
3. 确认账户有可用资源包或开通后付费，否则会返回 `UserHasNoAmount` / `UserHasNoFreeAmount`。

### 8.2 创建 API 密钥

1. 打开 [访问管理 → API 密钥管理](https://console.cloud.tencent.com/capi)。
2. 新建密钥，得到 `SecretId` 和 `SecretKey`。
3. 不要把它们写进小程序代码、Git 仓库或聊天记录。

### 8.3 配置云函数环境变量

云开发控制台 → 云函数 → `speechToText` → 配置 → 环境变量：

| 变量名 | 值 | 必填 |
| --- | --- | --- |
| `TENCENT_SECRET_ID` | 腾讯云 SecretId | 是 |
| `TENCENT_SECRET_KEY` | 腾讯云 SecretKey | 是 |
| `TENCENT_ASR_REGION` | `ap-shanghai`（默认） | 否 |

保存后重新部署/更新 `speechToText` 云函数，并把超时时间改为 20 秒左右。

> 云函数环境变量只在服务端读取，客户端调用 `speechToText` 时只传音频 `fileID`，不会接触密钥。
>
> 如果未配置密钥，语音按钮会提示“语音识别未配置”，但文字编辑、图片和菜谱功能不受影响。
>
> 腾讯云 ASR 按调用量计费/提供一定免费额度，具体以腾讯云账单为准。官方文档：[一句话识别](https://cloud.tencent.com/document/product/1093/35646)、[签名 v3](https://cloud.tencent.com/document/api/1093/35641)。

### 8.4 语音没有调用/没有日志怎么查

先确认小程序端和云函数端都是最新代码：重新编译，并重新上传 `speechToText`、`listRecipes`、`getRecipe`。

在开发者工具 Console 中点击语音，按顺序观察日志：

```text
[voice] tap
[voice] record permission granted
[recorder] start
[recorder] onStart
[voice] recording started
[voice] stop requested
[recorder] onStop
[voice] recording result
[voice] uploading audio
[voice] audio uploaded
[voice] calling speechToText
[voice] speechToText returned
```

| 最后出现的日志 | 说明 |
| --- | --- |
| 没有 `[voice] tap` | 页面还是旧代码/旧缓存，或按钮事件没有触发；重新编译真机预览。 |
| 停在 `[voice] tap` | 录音权限申请失败或页面被判定 hidden；查看是否有错误 toast/弹窗，真机测试。 |
| 有 `[recorder] start` 但没有 `onStop` | 录音没有启动或被系统中断；检查麦克风权限、真机环境、录音格式兼容性。 |
| 有 `[voice] recording result` 但没有 `uploading` 后成功 | 云存储上传失败；检查存储权限和网络。 |
| 有 `[voice] calling speechToText` 但云函数无日志 | `speechToText` 未部署到当前环境；确认云开发控制台当前环境与 `CLOUD_ENV` 一致。 |
| 云函数有 `[speechToText] invoked` 但返回 `ASR_NOT_CONFIGURED` | 未配置 `TENCENT_SECRET_ID` / `TENCENT_SECRET_KEY`。 |
| 云函数日志显示 `[speechToText] success` | ASR 成功，检查客户端是否收到文字以及目标输入框索引。 |

还可以在 Console 直接测试云函数是否部署：

```js
wx.cloud.callFunction({ name: 'speechToText', data: {} }).then(console.log)
```

- 返回 `AUDIO_INVALID`：云函数已部署，且入口日志会出现 `[speechToText] invoked`；
- 返回 `FUNCTION_NOT_FOUND` 或调用失败：云函数未部署到当前环境；
- 返回 `ASR_NOT_CONFIGURED`：云函数已部署，但缺少腾讯云环境变量。

## 9. 配置存储权限

云开发控制台 → 存储 → 权限设置，选择：

> **所有用户可读，仅创建者可写**

原因：

- 详情页需要展示其他用户上传的菜品图；
- 客户端需要上传自己的图片和临时录音；
- 云函数删除文件时使用管理端权限，不受客户端写限制。

> 新版 `listRecipes` / `getRecipe` 还会通过云函数管理端生成临时 HTTPS 图片地址，作为“别人看不到图”的兜底；但推荐仍然把存储读权限设为所有用户可读，`imageFileID` 直接展示和编辑页预览会更稳定。

上传路径由代码生成为：

```text
recipe-images/{openid}/{timestamp}-{random}.{ext}
voice-temp/{openid}/{timestamp}-{random}.mp3
```

`voice-temp` 是临时录音，`speechToText` 识别后会在 `finally` 中删除；客户端也会做一次兜底清理。

## 10. 配置隐私与麦克风权限

1. 小程序管理后台 → 设置 → 服务内容声明 → 用户隐私保护指引。
2. 声明使用 **麦克风**，用途填写“用于菜谱原材料和制作步骤的语音转文字输入”。
3. 同时说明录音会临时上传至云存储，并传输至腾讯云语音识别服务完成转写，识别后会删除临时音频。
4. 根据后台提示完成隐私协议审核/发布。
5. 真机首次点击语音按钮时，微信会弹出录音授权；用户拒绝后，代码会引导打开设置页。

> 不同基础库版本对隐私弹窗的交互略有差异。如果真机点击语音没有任何反应，先在后台补充隐私声明，再检查是否拒绝了录音权限。

## 11. 编译与首次运行

1. 点击「编译」。
2. 首次打开登录页，点击「微信一键登录」。
3. 登录后进入首页，点击「新建」创建第一道菜谱。
4. 选择图片（拍照/相册）→ 填写菜名、用料、步骤 → 保存。
5. 保存成功后进入详情页；返回首页应能看到卡片。

如果登录页一直提示“云函数未部署”，检查：

- 7 个云函数是否已经上传；
- `speechToText` 是否配置了腾讯云密钥；
- 开发者工具当前云环境与 `CLOUD_ENV` 是否一致；
- `utils/config.js` 是否被误填了错误环境 ID；
- 云函数控制台是否能看到调用日志。

## 12. 双账号验收清单

### 12.1 账号 A：创建与编辑

- [ ] 创建菜谱，上传图片，确认数据库 `imageFileID` 是 `cloud://` 开头。
- [ ] 编辑菜谱，修改菜名/用料/步骤，确认详情页更新。
- [ ] 调整步骤顺序后保存，刷新详情页顺序仍然正确。
- [ ] 删除菜谱，确认列表消失、数据库记录消失。
- [ ] 语音输入原材料与步骤，确认识别结果回填。
- [ ] 搜索菜名，确认结果正确；输入 `.`、`*` 等字符不会导致云函数报错。

> 开发者工具切换测试账号后，如果页面仍显示旧 openid，清除 Storage 中的 `recipe_openid` 再重新登录。openid 只影响展示，云端读写始终以真实 `getWXContext().OPENID` 为准。

### 12.2 账号 B：查看与导入

- [ ] 用账号 B 打开「发现菜谱」，能看到账号 A 的菜谱。
- [ ] 打开详情，页面只显示「导入菜谱」，没有编辑/删除按钮。
- [ ] 点击导入，确认生成一条新的「我的菜谱」记录。
- [ ] 检查云数据库：新记录的 `_openid` 是 B 的 openid，`sourceRecipeId` 是 A 的原菜谱 `_id`，原记录没有被修改。
- [ ] B 编辑副本的菜名、用料、步骤，A 的原菜谱不受影响。
- [ ] A 修改原菜谱，B 的副本不受影响。
- [ ] A 删除原菜谱，B 的副本图片仍然可以正常显示。
- [ ] B 删除副本，A 已删除的原菜谱不会被“恢复”。

### 12.3 越权防护

在账号 B 的开发者工具 Console 中尝试删除 A 的菜谱：

```js
wx.cloud.callFunction({
  name: 'deleteRecipe',
  data: { id: 'A的菜谱_id' }
}).then(console.log)
```

应返回：

```js
{ success: false, code: 'FORBIDDEN', message: '只能删除自己创建的菜谱' }
```

尝试直接读取数据库（在权限规则为 `read: false` 时）：

```js
wx.cloud.database().collection('recipes').get()
```

应被拒绝。云函数仍能正常返回列表，说明权限规则生效。

### 12.4 导入自己的菜谱

在账号 A 的详情页不会出现导入按钮；如果通过 Console 强行调用：

```js
wx.cloud.callFunction({
  name: 'importRecipe',
  data: { id: 'A自己的菜谱_id' }
}).then(console.log)
```

应返回 `CANNOT_IMPORT_OWN`。

## 13. 常见问题

| 现象 | 原因与处理 |
| --- | --- |
| 登录提示“云函数未部署” | 对应云函数未上传，或当前环境选错；重新上传 `login` 并确认环境。 |
| `COLLECTION_MISSING` | 没有创建 `recipes` 集合，或集合名拼写错误（区分大小写）。 |
| 列表为空但数据库有数据 | 检查记录的 `_openid` 是否为当前用户；发现页会排除自己的记录。 |
| 图片不显示 | 先确认已重新部署 `listRecipes`/`getRecipe` 并重新编译；响应里应有 `imageUrl`。如果 `imageUrl` 为空，检查 `imageFileID` 是否为空、云存储文件是否被删除；如果只有别人看不到图片，优先检查云存储权限是否为“所有用户可读，仅创建者可写”。 |
| 发现页别人菜谱无图 | 新版本 `listRecipes` 会批量生成临时 `imageUrl`。重新部署该云函数并刷新；若仍无图，查看云函数日志里 `getTempFileURL failed` 的错误。 |
| 图片上传失败 | 未登录、存储写权限不足、图片超过 8MB，或网络异常；查看 Console 的 `wx.cloud.uploadFile` 错误。 |
| 语音按钮无反应 | 未声明麦克风隐私、用户拒绝录音权限，或 `wx.getRecorderManager` 不可用；检查授权设置。 |
| 提示“语音识别未配置” | `speechToText` 云函数没有配置 `TENCENT_SECRET_ID` / `TENCENT_SECRET_KEY`，配置后重新部署。 |
| 语音识别返回 `ASR_FAILED` | 检查腾讯云 ASR 是否开通、是否欠费/额度耗尽、音频是否超过 60 秒或 3MB；查看云函数日志中的 Tencent RequestId。 |
| 语音返回 `AUDIO_INVALID` | 录音路径中的 openid 与当前云端身份不一致；开发者工具切换账号后清除 Storage 中的 `recipe_openid` 再重试。 |
| 语音识别超时 | 把 `speechToText` 云函数超时时间调到 20 秒，检查云函数所在网络能否访问 `asr.tencentcloudapi.com`。 |
| 语音识别结果为空 | 环境嘈杂或说话太短；重新点击语音并靠近麦克风。 |
| 删除原菜谱后副本图片丢失 | 检查是否绕过云函数直接用控制台删除了存储文件；正常通过 `deleteRecipe` 删除会做引用计数，不会误删。 |
| `saveRecipe` 返回 `FORBIDDEN` | 当前账号不是原菜谱作者；这是预期的权限保护。 |
| 索引未生效/查询报错 | 等待索引构建完成；按控制台提示补建组合索引。 |
| 修改后列表不刷新 | 首页 `onShow` 会检查数据版本号；如绕过小程序直接改数据库，请下拉刷新或重新进入。 |
| 云函数安装依赖失败 | 重新选择“云端安装依赖”；确认网络和云环境正常；必要时在函数目录执行 `npm install` 后上传全部文件。 |

## 14. 上线前建议

1. **内容安全**：公开上线前，在 `saveRecipe` 中调用 `security.msgSecCheck` 检查文本，在图片上传后调用图片内容安全接口；本项目为个人菜谱演示，未接入。
2. **数据备份**：在云开发控制台配置数据库备份。
3. **配额与告警**：关注云函数调用次数、数据库读写次数、存储容量、图片流量，以及腾讯云 ASR 调用量和费用；公开运营时建议按 openid 增加语音识别频率限制。
4. **错误监控**：在云函数控制台为 `INTERNAL` 和 `ASR_FAILED` 错误配置日志告警。
5. **隐私合规**：确保隐私保护指引覆盖麦克风、相册/相机用途，并遵守微信小程序审核规范。
6. **性能**：数据量较大时，将菜名正则搜索改为独立的检索字段或前缀查询；当前实现面向个人/小团队菜谱规模。

## 15. 本地校验说明

项目已通过：

- 全部 `.js` 文件的 `node --check` 语法校验；
- 全部 `.json` 文件的 `JSON.parse` 校验；
- 页面路径、云函数目录和 `app.json` 配置的人工检查；
- `speechToText` 的腾讯云 TC3 签名格式检查（不包含真实密钥，无法代替真实 ASR 联调）。

由于当前环境没有微信开发者工具和你的云环境，未执行真机 UI 与云函数联调。按本文完成部署后，建议先按第 12 节逐项验收。
