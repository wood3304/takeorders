# 云函数接口说明

所有接口均通过 `wx.cloud.callFunction({ name, data })` 调用。

客户端封装在 `utils/cloud.js`：

- 成功：取 `res.result.data`；
- 失败：抛出带 `code` 的 `Error`，页面统一使用 `toastError` 提示；
- 云函数内部一律使用 `cloud.getWXContext().OPENID`，不接收客户端传入的身份字段。

## 1. `login`

获取当前微信用户的 openid。

**入参**

无。

**返回**

```json
{
  "success": true,
  "data": {
    "openid": "oAbCd...",
    "appid": "wx51bba6084aee1075"
  }
}
```

## 2. `listRecipes`

分页查询菜谱列表。

**入参**

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `scope` | String | 否 | `mine`（默认）或 `discover` |
| `keyword` | String | 否 | 菜名关键词，最多 30 字 |
| `offset` | Number | 否 | 偏移量，默认 0 |
| `limit` | Number | 否 | 每页条数，1–20，默认 12 |

**返回**

```json
{
  "success": true,
  "data": {
    "list": [
      {
        "id": "a1b2c3",
        "title": "番茄炒蛋",
        "imageFileID": "cloud://...",
        "imageUrl": "https://临时签名地址...",
        "description": "酸甜下饭",
        "category": "家常菜",
        "cookTime": 15,
        "difficulty": "简单",
        "ingredientCount": 4,
        "stepCount": 4,
        "sourceRecipeId": null,
        "createdAt": 1762322400000,
        "updatedAt": 1762322400000,
        "isOwner": true
      }
    ],
    "hasMore": false
  }
}
```

注意：不返回字段 `_openid`，也不返回完整用料/步骤。

`imageUrl` 是云函数管理端调用 `cloud.getTempFileURL` 生成的临时 HTTPS 地址，客户端优先使用它展示图片；这样即使云存储是“仅创建者可读”，其他用户也能正常看到菜品图。临时地址过期后重新进入列表会重新生成。

## 3. `getRecipe`

获取单条菜谱详情，任何已登录用户可调用。

**入参**

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | String | 是 | 菜谱 `_id` |

**返回**

```json
{
  "success": true,
  "data": {
    "id": "a1b2c3",
    "title": "番茄炒蛋",
    "imageFileID": "cloud://...",
    "imageUrl": "https://临时签名地址...",
    "description": "酸甜下饭",
    "category": "家常菜",
    "cookTime": 15,
    "difficulty": "简单",
    "ingredients": ["番茄 2 个", "鸡蛋 3 个"],
    "steps": ["番茄切块", "鸡蛋炒熟", "一起翻炒"],
    "ingredientCount": 2,
    "stepCount": 3,
    "sourceRecipeId": null,
    "createdAt": 1762322400000,
    "updatedAt": 1762322400000,
    "isOwner": true
  }
}
```

## 4. `saveRecipe`

新增或更新菜谱。新增时 `id` 留空。

**入参**

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | String | 否 | 更新时传菜谱 `_id`；新增不传或空字符串 |
| `title` | String | 是 | 1–40 字 |
| `imageFileID` | String | 否 | 云存储 fileID，空字符串表示无图 |
| `description` | String | 否 | ≤ 300 字 |
| `category` | String | 否 | ≤ 20 字 |
| `cookTime` | Number | 否 | 0–600，单位分钟 |
| `difficulty` | String | 否 | `''` / `简单` / `中等` / `困难` |
| `ingredients` | Array<String> | 是 | 1–30 条，每条 ≤ 100 字 |
| `steps` | Array<String> | 是 | 1–30 条，每条 ≤ 500 字 |

**新增返回**

```json
{ "success": true, "data": { "id": "new-id" } }
```

**更新返回**

```json
{ "success": true, "data": { "id": "updated-id" } }
```

**权限失败示例**

```json
{
  "success": false,
  "code": "FORBIDDEN",
  "message": "只能编辑自己创建的菜谱"
}
```

## 5. `deleteRecipe`

删除自己的菜谱。

**入参**

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | String | 是 | 菜谱 `_id` |

**返回**

```json
{ "success": true, "data": { "id": "deleted-id" } }
```

非所有者返回：

```json
{
  "success": false,
  "code": "FORBIDDEN",
  "message": "只能删除自己创建的菜谱"
}
```

## 6. `importRecipe`

把他人菜谱复制为当前用户的独立副本，原菜谱不修改。

**入参**

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | String | 是 | 原菜谱 `_id` |

**返回**

```json
{
  "success": true,
  "data": {
    "id": "new-copy-id",
    "title": "番茄炒蛋",
    "sourceRecipeId": "original-id"
  }
}
```

**错误码**

| code | 含义 |
| --- | --- |
| `CANNOT_IMPORT_OWN` | 不能导入自己的菜谱 |
| `INVALID_SOURCE` | 原菜谱内容不完整，无法导入 |
| `NOT_FOUND` | 原菜谱不存在或已删除 |
| `FORBIDDEN` | 权限不足 |

## 7. `speechToText`

把当前用户上传的临时录音交给腾讯云一句话识别 ASR。

**前置条件**

`speechToText` 云函数必须配置环境变量：

```text
TENCENT_SECRET_ID
TENCENT_SECRET_KEY
TENCENT_ASR_REGION（可选，默认 ap-shanghai）
```

**入参**

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `fileID` | String | 是 | 必须位于 `voice-temp/{当前openid}/` 下的云存储文件 ID |
| `format` | String | 否 | 默认 `mp3`，支持 mp3/wav/m4a/aac/pcm/ogg-opus/speex/silk/amr |
| `duration` | Number | 否 | 录音时长（毫秒），超过 60000 会拒绝 |

**返回**

```json
{
  "success": true,
  "data": {
    "text": "番茄两个鸡蛋三个",
    "requestId": "腾讯云请求ID",
    "audioDuration": 3200
  }
}
```

**错误码**

| code | 含义 |
| --- | --- |
| `AUDIO_INVALID` | 文件地址不合法或读不到录音 |
| `ASR_AUDIO_INVALID` | 录音格式不支持 |
| `ASR_AUDIO_TOO_LARGE` | 录音超过 60 秒或文件过大 |
| `ASR_NOT_CONFIGURED` | 云函数未配置腾讯云 SecretId/SecretKey |
| `ASR_FAILED` | 腾讯云 ASR 返回失败，message 含具体原因 |

音频识别结束后，云函数会删除临时文件；客户端也会做一次删除兜底。

## 8. 统一错误码

| code | 建议处理 |
| --- | --- |
| `UNAUTHORIZED` | 清除本地 openid，回到登录页 |
| `INVALID_INPUT` | 直接展示 message，提示用户修改表单 |
| `FORBIDDEN` | 提示无权限，返回详情/列表 |
| `NOT_FOUND` | 提示菜谱已删除，返回首页 |
| `COLLECTION_MISSING` | 部署阶段提示创建 `recipes` 集合 |
| `FUNCTION_NOT_FOUND` | 部署阶段提示上传对应云函数 |
| `ASR_NOT_CONFIGURED` | 部署阶段提示配置腾讯云 ASR 密钥 |
| `INTERNAL` | 提示稍后重试，查看云函数日志 |

## 9. 客户端调用示例

```js
const { callFunction, toastError } = require('../../utils/cloud')

try {
  const data = await callFunction('listRecipes', {
    scope: 'mine',
    keyword: '',
    offset: 0,
    limit: 12
  })
  console.log(data.list)
} catch (err) {
  toastError(err)
}
```
