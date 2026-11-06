# 私房菜谱 · 微信云开发小程序

一个使用 **微信原生小程序 + 微信云开发（云数据库 / 云存储 / 云函数）** 实现的个人菜谱小程序。支持微信身份登录、菜谱增删改查、菜名搜索、图片上传、语音转文字、他人菜谱查看与一键导入。

> 项目已按微信开发者工具目录结构组织，AppID 使用当前工程的 `wx51bba6084aee1075`。导入后需开通云开发、创建集合、上传云函数，并配置腾讯云 ASR 密钥即可运行。

## 1. 功能一览

- 微信云函数静默登录，`cloud.getWXContext().OPENID` 作为唯一用户标识。
- 每道菜谱只能由创建者编辑、删除；其他用户只能查看。
- 「发现菜谱」展示其他用户的菜谱，详情页可一键导入。
- 导入会复制一条新记录，新记录的 `_openid` 为当前用户，原菜谱完全不变；副本可自由编辑、删除。
- 新增/编辑菜谱：菜品名称、图片、简介、分类、耗时、难度、多条原材料、有序步骤。
- 图片支持拍照/相册，上传至云存储，数据库只保存 `cloud://` 文件 ID。
- 原材料和步骤均支持录音转文字：微信原生录音 → 云存储 → 云函数调用腾讯云一句话识别 ASR，识别结果自动回填。
- 步骤支持上移、下移、删除、新增，序号实时更新。
- 菜谱列表支持「我的菜谱 / 发现菜谱」切换、菜名搜索、分页、下拉刷新。
- 全部数据写入均由云函数完成，数据库安全规则可关闭客户端直读直写。
- 不依赖自建第三方后端；除官方 `wx-server-sdk` 外没有额外 npm 依赖，ASR 使用腾讯云官方 HTTP API 签名调用。

## 2. 目录结构

```text
.
├─ app.js / app.json / app.wxss
├─ project.config.json
├─ pages
│  ├─ login        登录页
│  ├─ index        我的菜谱 / 发现菜谱
│  ├─ detail       菜谱详情、编辑/删除入口、导入
│  └─ edit         新建/编辑菜谱（图片、原材料、步骤、语音）
├─ utils
│  ├─ auth.js      登录与 openid 缓存
│  ├─ cloud.js     云函数调用与统一错误处理
│  ├─ config.js    云环境、分页、分类配置
│  ├─ format.js    时间、耗时、菜谱展示格式化
│  └─ recorder.js  微信原生录音与录音权限封装
├─ cloudfunctions
│  ├─ login
│  ├─ listRecipes
│  ├─ getRecipe
│  ├─ saveRecipe
│  ├─ deleteRecipe
│  ├─ importRecipe
│  └─ speechToText  腾讯云一句话识别 ASR
├─ scripts
│  └─ verify-cloud.js  云函数内存测试（本地校验用）
└─ docs
   ├─ database-design.md
   ├─ api.md
   └─ deployment.md
```

## 3. 页面清单

| 页面 | 路径 | 功能说明 |
| --- | --- | --- |
| 登录页 | `pages/login/login` | 微信身份登录，调用 `login` 云函数获取 openid；已有缓存时自动进入；支持分享深链登录后回跳。 |
| 首页 | `pages/index/index` | 顶部用户信息；搜索框；「我的菜谱 / 发现菜谱」切换；卡片展示菜品图、菜名、耗时、难度、用料/步骤数；我的菜谱卡片带编辑、删除；分页加载、下拉刷新。 |
| 详情页 | `pages/detail/detail` | 图片大图、简介、耗时/难度、用料清单、编号步骤；作者可编辑/删除；非作者显示「导入菜谱」；支持分享。 |
| 编辑页 | `pages/edit/edit` | 新建或编辑；选择/更换/移除图片；基础字段；动态增删原材料；步骤增删、上下移动；每条原材料/步骤支持语音输入；保存前前端校验，最终由云函数再次校验权限与数据。 |

## 4. 云函数清单

| 云函数 | 作用 | 关键权限逻辑 |
| --- | --- | --- |
| `login` | 返回当前微信用户 openid | 只读 `getWXContext().OPENID`，不接受客户端身份参数。 |
| `listRecipes` | 分页查询我的菜谱 / 发现菜谱，按菜名搜索 | 我的菜谱按当前 openid 过滤；发现页排除自己；返回字段不含完整 openid。 |
| `getRecipe` | 获取单条菜谱详情 | 所有登录用户可读；只返回 `isOwner`，不返回作者 openid。 |
| `saveRecipe` | 新增或更新菜谱 | 新增时服务端写入当前 `_openid`；更新时先校验原记录所有权，并在更新条件中再次带 `_openid`。 |
| `deleteRecipe` | 删除菜谱 | 只有 `_openid === 当前 OPENID` 才能删除；图片按引用计数清理。 |
| `importRecipe` | 导入他人菜谱 | 读取原菜谱后新建记录，新记录 `_openid` 强制为当前用户；原记录不做任何修改；禁止导入自己的菜谱。 |
| `speechToText` | 录音转文字 | 校验录音文件必须位于当前用户 `voice-temp/{openid}/` 下；调用腾讯云一句话识别；识别后删除临时音频；密钥只放在云函数环境变量。 |

**统一返回格式**

```js
// 成功
{ success: true, data: { ... } }
// 失败
{ success: false, code: 'FORBIDDEN', message: '只能编辑自己创建的菜谱' }
```

## 5. 数据表与索引

完整字段说明、示例数据、权限矩阵见 [docs/database-design.md](docs/database-design.md)。

核心集合：`recipes`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `_id` | String | 云数据库自动生成的主键 |
| `_openid` | String | 菜谱所有者，由云函数写入当前用户 openid |
| `title` | String | 菜名，1–40 字 |
| `imageFileID` | String | 云存储文件 ID，可为空 |
| `description` | String | 简介，最多 300 字 |
| `category` | String | 分类，最多 20 字 |
| `cookTime` | Number | 耗时（分钟），0–600 |
| `difficulty` | String | 简单 / 中等 / 困难 / 空 |
| `ingredients` | Array<String> | 原材料，最多 30 条，每条最多 100 字 |
| `steps` | Array<String> | 步骤，最多 30 步，每步最多 500 字 |
| `ingredientCount` | Number | 冗余计数，列表页避免拉取大数组 |
| `stepCount` | Number | 冗余计数 |
| `sourceRecipeId` | String / null | 导入来源的菜谱 ID；自建为 null |
| `schemaVersion` | Number | 数据结构版本，当前为 1 |
| `createdAt` | Date | 服务端时间 |
| `updatedAt` | Date | 服务端时间 |

推荐索引（云开发控制台 → 数据库 → recipes → 索引管理）：

1. `_openid ASC, updatedAt DESC`：我的菜谱列表。
2. `updatedAt DESC`：发现页列表。
3. `imageFileID ASC`：导入复用图片后的引用计数清理。
4. `title ASC`（可选）：菜名前缀检索辅助；当前模糊搜索使用 `db.RegExp`，数据量很大时仍可能扫描。

## 6. 权限与导入设计

### 6.1 身份来源

openid 只能由云函数从微信上下文获取：

```js
const { OPENID } = cloud.getWXContext()
```

客户端传入的 `_openid`、`openid` 一律忽略。新增记录时由云函数显式写入：

```js
{ _openid: OPENID, ... }
```

### 6.2 编辑/删除强制校验

- `saveRecipe` 更新前读取原记录，判断 `oldRecipe._openid === OPENID`。
- 更新语句再次使用 `where({ _id: id, _openid: OPENID })`，并检查 `stats.updated`。
- `deleteRecipe` 同样先校验所有权。
- 云数据库安全规则建议设置为「所有用户不可读写」，让客户端无法绕过云函数直接改库；云函数使用管理端权限，不受该规则限制。

### 6.3 导入为什么是独立副本

导入生成一条全新的文档：

```js
{
  _openid: 当前用户,
  title: 原菜谱.title,
  imageFileID: 原菜谱.imageFileID,
  ingredients: 原菜谱.ingredients.slice(),
  steps: 原菜谱.steps.slice(),
  sourceRecipeId: 原菜谱._id,
  createdAt: 新时间,
  updatedAt: 新时间
}
```

- 新文档有自己的 `_id`，编辑/删除只影响副本。
- 导入不修改原记录，原记录也不会被“转移”。
- 图片是不可变的云文件，副本复用同一个 `cloud fileID`；删除和替换图片时按 `imageFileID` 统计引用数，只有无人引用时才真正删除文件，因此删除原菜谱不会导致副本图片失效。
- 如果希望每次导入都物理复制一份图片文件，可在 `importRecipe` 中增加 `cloud.downloadFile + cloud.uploadFile`，但会消耗额外云函数时间与存储；当前方案更轻量，且数据行为已经互相独立。

## 7. 语音输入说明

个人主体小程序无法申请“微信同声传译”插件，因此项目已移除该插件，改为 **微信原生录音 + 腾讯云一句话识别 ASR**：

```text
wx.getRecorderManager 录音（mp3 / 16k / 55 秒）
        ↓
wx.cloud.uploadFile 上传到 voice-temp/{openid}/xxx.mp3
        ↓
speechToText 云函数下载音频
        ↓
调用腾讯云 SentenceRecognition（一句话识别）
        ↓
返回文字，客户端追加到原材料/步骤输入框
        ↓
云函数与客户端都清理临时音频
```

### 7.1 需要配置腾讯云

1. 登录腾讯云控制台，完成个人实名认证。
2. 开通「语音识别」服务。
3. 在「访问管理 → API 密钥管理」创建 SecretId / SecretKey。
4. 在云开发控制台 → 云函数 → `speechToText` → 配置 → 环境变量中添加：

```text
TENCENT_SECRET_ID=你的SecretId
TENCENT_SECRET_KEY=你的SecretKey
TENCENT_ASR_REGION=ap-shanghai
```

5. 将 `speechToText` 云函数超时时间调到 20 秒左右，重新部署。

> 密钥只存在于云函数环境变量，不会写入小程序代码，也不会下发到客户端。
>
> 录音会临时上传到云存储并发送给腾讯云 ASR 转写，识别后删除；上线前需在隐私保护指引中如实说明。
>
> 腾讯云 ASR 按调用量计费，是否提供免费额度、具体价格以腾讯云控制台为准。
>
> 官方接口文档：[一句话识别](https://cloud.tencent.com/document/product/1093/35646)、[签名方法 v3](https://cloud.tencent.com/document/api/1093/35641)。

### 7.2 使用方式

点击每条原材料或步骤右侧的「语音」开始录音，说完后再点一次「停止」，页面显示“正在识别”，成功后文字自动追加到当前输入框。录音超过 55 秒会自动结束，避免超过腾讯云 60 秒限制。

### 7.3 完全不想接腾讯云怎么办

微信小程序目前没有面向个人主体的公开免费“录音直接转文字”原生 API。若不接入腾讯云 ASR，唯一完全原生的替代方式是让用户直接使用手机输入法键盘上的麦克风键输入文字；项目里的语音按钮可以保留为提示，也可以删除。除此之外没有既不使用插件、又不调用外部 ASR 服务的应用内语音识别方案。

## 8. 快速开始

1. 用微信开发者工具导入本目录。
2. 开通云开发并创建环境；如果使用非默认环境，填写 `utils/config.js` 中的 `CLOUD_ENV`。
3. 创建 `recipes` 集合，设置安全规则为不可直读直写（或按文档设置）。
4. 右键 `cloudfunctions` 下 7 个云函数，逐个「上传并部署：云端安装依赖」。
5. 为 `speechToText` 配置腾讯云 ASR 环境变量，并把超时时间调到 20 秒左右。
6. 在小程序后台隐私保护指引中声明麦克风用途。
7. 编译运行，使用两个不同微信号测试查看、导入、越权保护与语音链路。

完整步骤与测试清单见 [docs/deployment.md](docs/deployment.md)，云函数入参/返回见 [docs/api.md](docs/api.md)。

## 9. 本地校验

```bash
# 云函数业务逻辑（内存 Mock，不需要云环境）
node scripts/verify-cloud.js
```

该测试覆盖创建、列表、搜索、详情、越权编辑/删除、导入独立副本、图片引用计数清理，以及 `speechToText` 的腾讯云 TC3 签名格式。它不能替代微信开发者工具中的真实云环境/ASR 联调。

项目还已通过全部 `.js` 的 `node --check` 与全部 `.json` 的 `JSON.parse` 校验。

## 10. 说明与边界

- 现有 AppID 是 `wx51bba6084aee1075`，如果换成自己的 AppID，需要同步更换云环境，并重新配置腾讯云 ASR 密钥。
- 语音链路依赖腾讯云 ASR 服务；未配置密钥时，文字编辑和菜谱功能仍然可用，只有语音按钮会提示“语音识别未配置”。
- 当前未接入内容安全审核（`security.msgSecCheck` / 图片审核）。如果要上线公开版本，建议在 `saveRecipe` 和图片上传后增加审核逻辑。
- 删除菜谱只删除数据库记录与“无人引用”的图片；未保存的临时上传图片如果客户端清理失败，可在云存储控制台按 `recipe-images/` 目录清理；临时录音位于 `voice-temp/`，云函数识别后会主动删除。
- 菜名搜索使用云数据库正则，适合个人/小规模数据；大数据量可增加独立的搜索字段或分页前缀搜索。
- 本地完成了 JavaScript/JSON/WXML 结构校验、云函数内存测试与腾讯云 TC3 签名格式检查，但无法在此环境启动微信开发者工具进行真机 UI/ASR 联调；部署文档中列出了逐项验收步骤。
