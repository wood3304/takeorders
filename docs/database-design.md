# 云数据库设计

## 1. 集合总览

本项目只需要一个业务集合：

| 集合 | 用途 |
| --- | --- |
| `recipes` | 存储菜谱主体、所有者 openid、图片文件 ID、用料和步骤 |

不额外创建 `users` 集合：当前需求只需要 openid 身份和菜谱数据，openid 由 `login` 云函数即时返回，无需持久化用户资料。

## 2. `recipes` 字段设计

| 字段名 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `_id` | String | 是 | 云数据库自动生成 | 文档主键，导入时生成新 ID |
| `_openid` | String | 是 | 无 | 菜谱所有者。小程序端 add 会自动注入，**云函数端 add 不会自动注入**，因此本项目在云函数中显式写入 `getWXContext().OPENID` |
| `title` | String | 是 | 无 | 菜名，去除首尾空格后 1–40 字 |
| `imageFileID` | String | 否 | `''` | 云存储文件 ID，形如 `cloud://env-id.xxx/recipe-images/...`；空字符串表示无图 |
| `description` | String | 否 | `''` | 菜品简介，最多 300 字 |
| `category` | String | 否 | `''` | 分类，最多 20 字，如“家常菜” |
| `cookTime` | Number | 否 | `0` | 耗时，单位分钟，0–600；0 表示未填写 |
| `difficulty` | String | 否 | `''` | `简单` / `中等` / `困难` / `''` |
| `ingredients` | Array<String> | 是 | `[]` | 原材料，至少 1 条，最多 30 条，每条最多 100 字 |
| `steps` | Array<String> | 是 | `[]` | 制作步骤，至少 1 步，最多 30 步，每步最多 500 字；数组顺序即展示顺序 |
| `ingredientCount` | Number | 是 | 自动计算 | `ingredients.length` 的冗余字段，列表页使用 |
| `stepCount` | Number | 是 | 自动计算 | `steps.length` 的冗余字段，列表页使用 |
| `sourceRecipeId` | String / null | 否 | `null` | 导入来源的原菜谱 `_id`；自建菜谱为 `null` |
| `schemaVersion` | Number | 是 | `1` | 数据结构版本，便于后续迁移 |
| `createdAt` | Date | 是 | 服务端时间 | `db.serverDate()`，客户端不可伪造 |
| `updatedAt` | Date | 是 | 服务端时间 | 每次保存刷新，列表默认按此倒序 |

### 2.1 示例文档

```json
{
  "_id": "a1b2c3d4e5f6",
  "_openid": "oAbCd1234567890abcdefghijklmn",
  "title": "番茄炒蛋",
  "imageFileID": "cloud://cloud1-xxxx.636c-cloud1-xxxx-1234567890/recipe-images/oAbCd.../1710000000000-a1b2c3.jpg",
  "description": "酸甜下饭，十分钟就能上桌。",
  "category": "家常菜",
  "cookTime": 15,
  "difficulty": "简单",
  "ingredients": ["番茄 2 个", "鸡蛋 3 个", "盐 适量", "葱花 少许"],
  "steps": [
    "番茄洗净切块，鸡蛋打散加少许盐。",
    "热锅倒油，鸡蛋炒至凝固后盛出。",
    "原锅下番茄炒出汁，倒回鸡蛋翻匀。",
    "撒葱花，调味后出锅。"
  ],
  "ingredientCount": 4,
  "stepCount": 4,
  "sourceRecipeId": null,
  "schemaVersion": 1,
  "createdAt": "2026-11-06T06:00:00.000Z",
  "updatedAt": "2026-11-06T06:00:00.000Z"
}
```

### 2.2 为什么原材料/步骤使用字符串数组

- 小程序端每条记录只有一个文本输入框，语音识别也直接回填字符串，模型最简单、最稳定。
- 数组顺序就是步骤顺序，上移/下移只需交换数组元素。
- 云函数对每条内容做长度限制，避免单文档无限膨胀。
- 如果以后需要“用量/单位”结构化，可升级为对象数组，并提升 `schemaVersion`。

## 3. 索引建议

在「云开发控制台 → 数据库 → recipes → 索引管理」创建：

| 索引名 | 字段 | 排序 | 适用查询 |
| --- | --- | --- | --- |
| `idx_openid_updated` | `_openid` | ASC | 我的菜谱 |
|  | `updatedAt` | DESC | 按更新时间倒序 |
| `idx_updated` | `updatedAt` | DESC | 发现页全部菜谱 |
| `idx_image_file` | `imageFileID` | ASC | 删除/替换图片时统计引用数 |
| `idx_title` | `title` | ASC | 可选，菜名前缀类查询辅助 |

说明：

- `listRecipes` 的模糊搜索使用 `db.RegExp({ regexp, options: 'i' })`，不是前缀索引能完全优化的查询；个人菜谱数据量小，使用正则足够。数据量明显增大时，建议新增规范化标题字段或做分词搜索，而不是在客户端拉全量。
- 排序依赖 `updatedAt`，因此每次保存都必须刷新该字段（云函数已实现）。
- 若云数据库提示需要组合索引，按控制台提示补建 `_openid + updatedAt` 即可。

## 4. 数据库安全规则

推荐在「recipes → 权限设置 → 自定义安全规则」中设置：

```json
{
  "read": false,
  "write": false
}
```

含义：**客户端完全不能直接读写 `recipes`**。所有读取、写入、导入都通过云函数完成；云函数使用管理端权限，不受该规则限制。

这样做的好处：

- 客户端不能通过 `wx.cloud.database()` 绕过云函数直接修改别人的 `_openid` 或菜谱内容。
- 权限校验集中在一处，便于审计。
- 发现页仍然可用，因为 `listRecipes` 在云函数里读取数据后只返回安全字段。

如果你希望在控制台之外也允许客户端直接读，可把 `read` 改为 `"auth != null"`，但不建议打开 `write`。本项目客户端没有使用直连数据库，因此保持 `false` 即可。

## 5. 云存储设计

### 5.1 路径规范

客户端上传时使用：

```text
recipe-images/{openid}/{timestamp}-{random}.{ext}
```

例如：

```text
recipe-images/oAbCd1234567890abcdefghijklmn/1710000000000-a1b2c3.jpg
```

数据库只保存上传返回的 `fileID`，不保存临时路径或临时 URL。

### 5.2 权限

在「云开发控制台 → 存储 → 权限设置」选择：

> **所有用户可读，仅创建者可写**

原因：

- 详情页需要让其他用户看到菜品图片；
- 上传必须由已登录用户在客户端完成（`wx.cloud.uploadFile`）；
- 删除图片由云函数管理端执行，不受客户端写权限限制；
- 不建议设为“仅创建者可读写”，否则他人打开详情页会看不到图片。

### 5.3 临时录音

语音输入会先上传临时音频：

```text
voice-temp/{openid}/{timestamp}-{random}.mp3
```

- 由微信原生 `wx.getRecorderManager` 录制，客户端限制 55 秒、mp3 / 16k / 48kbps。
- `speechToText` 云函数校验路径必须位于当前 openid 下，再调用腾讯云一句话识别。
- 识别成功或失败后，云函数在 `finally` 中删除临时文件；客户端也会兜底删除。
- 临时录音不写入数据库。

### 5.4 图片引用与清理

- 导入菜谱复用原菜谱的 `imageFileID`，不复制物理文件。
- 云文件是不可变对象：原菜谱换图只会修改数据库字段，不会改变旧文件内容。
- `saveRecipe` 在图片变化后、`deleteRecipe` 在删除成功后，均按 `imageFileID` 查询 `recipes` 的引用数：
  - 仍有引用：保留文件，保证导入副本正常显示；
  - 引用数为 0：调用 `cloud.deleteFile` 删除。
- 极端并发下引用计数可能短暂不准；如需强一致，可改用事务或延迟清理任务。

## 6. 权限矩阵

| 操作 | 未登录 | 菜谱作者 | 其他登录用户 |
| --- | --- | --- | --- |
| 登录拿 openid | 允许 | 允许 | 允许 |
| 查看自己的菜谱列表 | 否 | 是 | 是（仅自己的） |
| 查看他人菜谱列表 | 否 | 是（发现页排除自己） | 是 |
| 查看菜谱详情 | 否 | 是 | 是 |
| 新增菜谱 | 否 | 是 | 是（创建自己的） |
| 编辑菜谱 | 否 | 是 | **否**，云函数返回 `FORBIDDEN` |
| 删除菜谱 | 否 | 是 | **否**，云函数返回 `FORBIDDEN` |
| 导入他人菜谱 | 否 | 否（自己的不能导入） | 是，生成自己的副本 |
| 修改原菜谱 | — | 仅自己的 | **否**，导入只新增文档 |

## 7. 字段校验约束

云函数 `saveRecipe` 会再次校验，不能只依赖小程序端：

| 字段 | 规则 |
| --- | --- |
| `title` | 非空，≤ 40 字 |
| `description` | ≤ 300 字 |
| `category` | ≤ 20 字 |
| `cookTime` | 0–600 的整数 |
| `difficulty` | 空或 `简单` / `中等` / `困难` |
| `imageFileID` | 空或 `cloud://` 开头，≤ 1024 字符 |
| `ingredients` | 数组，1–30 条，每条 1–100 字 |
| `steps` | 数组，1–30 条，每条 1–500 字 |
| 客户端 `_openid` | 一律忽略，服务端覆盖 |

## 8. 数据演进建议

- `schemaVersion` 当前为 `1`。以后如果增加字段，可在云函数中按版本做兼容读取。
- 增加“收藏/点赞”等社交能力时，建议新增独立集合，不要修改菜谱所有权字段。
- 增加“回收站”时，可加 `deletedAt` 软删除字段，列表查询排除；当前是硬删除。
- 增加图片审核时，可在上传后调用内容安全接口，并将审核状态保存到菜谱文档。
