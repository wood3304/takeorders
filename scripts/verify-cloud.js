/**
 * 云函数业务逻辑离线测试（不连接微信云开发）
 *
 * 运行：node scripts/verify-cloud.js
 *
 * 该脚本用内存数据库模拟 wx-server-sdk 的最小 API，
 * 验证：创建、列表、越权编辑/删除、导入副本、图片引用计数。
 * 它不能替代微信开发者工具中的真实云环境联调。
 */
const path = require('path')
const Module = require('module')

const state = {
  openid: '',
  collections: {
    recipes: []
  },
  deletedFiles: []
}

let sequence = 0
function nextId() {
  sequence += 1
  return `id_${String(sequence).padStart(6, '0')}`
}

function clone(value) {
  return structuredClone(value)
}

function isOperator(value) {
  return value && typeof value === 'object' && value.__op
}

function isRegExpValue(value) {
  return value && typeof value === 'object' && value.__regexp
}

function matchesCondition(value, condition) {
  if (isOperator(condition)) {
    if (condition.__op === 'neq') return value !== condition.value
    throw new Error(`unsupported operator ${condition.__op}`)
  }
  if (isRegExpValue(condition)) {
    return new RegExp(condition.__regexp, condition.__options || '').test(String(value || ''))
  }
  return value === condition
}

function matchesDoc(doc, where) {
  return Object.keys(where || {}).every((key) => matchesCondition(doc[key], where[key]))
}

function projectDoc(doc, projection) {
  if (!projection) return clone(doc)
  const result = {}
  Object.keys(projection).forEach((key) => {
    if (projection[key] && Object.prototype.hasOwnProperty.call(doc, key)) {
      result[key] = clone(doc[key])
    }
  })
  if (!Object.prototype.hasOwnProperty.call(result, '_id') && doc._id) {
    result._id = doc._id
  }
  return result
}

class Query {
  constructor(name, conditions) {
    this.name = name
    this.conditions = conditions || {}
    this.sortField = null
    this.sortDirection = 'asc'
    this.skipCount = 0
    this.limitCount = Infinity
    this.projection = null
  }

  where(condition) {
    this.conditions = { ...this.conditions, ...condition }
    return this
  }

  orderBy(field, direction) {
    this.sortField = field
    this.sortDirection = direction
    return this
  }

  skip(count) {
    this.skipCount = count
    return this
  }

  limit(count) {
    this.limitCount = count
    return this
  }

  field(projection) {
    this.projection = projection
    return this
  }

  _docs() {
    const docs = (state.collections[this.name] || []).filter((doc) => matchesDoc(doc, this.conditions))
    if (this.sortField) {
      const factor = this.sortDirection === 'desc' ? -1 : 1
      docs.sort((a, b) => {
        const left = a[this.sortField]
        const right = b[this.sortField]
        if (left === right) return 0
        return left > right ? factor : -factor
      })
    }
    return docs
  }

  async get() {
    return {
      data: this._docs()
        .slice(this.skipCount, this.skipCount + this.limitCount)
        .map((doc) => projectDoc(doc, this.projection))
    }
  }

  async count() {
    return { total: this._docs().length }
  }

  async update({ data }) {
    const docs = this._docs()
    docs.forEach((doc) => Object.assign(doc, clone(data)))
    return { stats: { updated: docs.length } }
  }

  async remove() {
    const docs = this._docs()
    const ids = new Set(docs.map((doc) => doc._id))
    state.collections[this.name] = state.collections[this.name].filter((doc) => !ids.has(doc._id))
    return { stats: { removed: docs.length } }
  }
}

class Collection extends Query {
  constructor(name) {
    super(name, {})
  }

  doc(id) {
    const name = this.name
    return {
      async get() {
        const doc = (state.collections[name] || []).find((item) => item._id === id)
        if (!doc) {
          const error = new Error('document not found')
          error.errCode = -1
          throw error
        }
        return { data: clone(doc) }
      },
      async update({ data }) {
        const doc = (state.collections[name] || []).find((item) => item._id === id)
        if (!doc) return { stats: { updated: 0 } }
        Object.assign(doc, clone(data))
        return { stats: { updated: 1 } }
      },
      async remove() {
        const before = (state.collections[name] || []).length
        state.collections[name] = (state.collections[name] || []).filter((item) => item._id !== id)
        return { stats: { removed: before - state.collections[name].length } }
      }
    }
  }

  async add({ data }) {
    const id = nextId()
    const doc = { _id: id, ...clone(data) }
    state.collections[this.name].push(doc)
    return { _id: id }
  }
}

const mockCloud = {
  DYNAMIC_CURRENT_ENV: 'mock-env',
  init() {},
  getWXContext() {
    return { OPENID: state.openid, APPID: 'wx-mock' }
  },
  database() {
    return {
      collection(name) {
        if (!state.collections[name]) state.collections[name] = []
        return new Collection(name)
      },
      command: {
        neq(value) {
          return { __op: 'neq', value }
        }
      },
      serverDate() {
        return new Date()
      },
      RegExp({ regexp, options }) {
        return { __regexp: regexp, __options: options || '' }
      }
    }
  },
  async deleteFile({ fileList }) {
    state.deletedFiles.push(...fileList)
    return { fileList: fileList.map((fileID) => ({ fileID, status: 0 })) }
  }
}

// 拦截 wx-server-sdk，让云函数直接使用内存实现
const originalLoad = Module._load
Module._load = function load(request, parent, isMain) {
  if (request === 'wx-server-sdk') return mockCloud
  return originalLoad.call(this, request, parent, isMain)
}

function loadFunction(name) {
  return require(path.resolve(__dirname, '..', 'cloudfunctions', name, 'index.js'))
}

async function invoke(name, openid, event) {
  state.openid = openid
  return loadFunction(name).main(event || {}, {})
}

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`)
}

async function main() {
  const userA = 'openid_user_a'
  const userB = 'openid_user_b'
  const imageID = 'cloud://mock-env/recipe-images/a/dish.jpg'

  // A 创建菜谱；客户端伪造的 _openid 必须被忽略
  const created = await invoke('saveRecipe', userA, {
    title: '番茄炒蛋',
    imageFileID: imageID,
    description: '酸甜下饭',
    category: '家常菜',
    cookTime: 15,
    difficulty: '简单',
    ingredients: ['番茄 2 个', '鸡蛋 3 个'],
    steps: ['番茄切块', '鸡蛋炒熟', '一起翻炒'],
    _openid: userB
  })
  assert(created.success, 'create should succeed')
  const sourceId = created.data.id
  const sourceDoc = state.collections.recipes.find((item) => item._id === sourceId)
  assert(sourceDoc._openid === userA, 'server must override client _openid with current user')

  const mineA = await invoke('listRecipes', userA, { scope: 'mine', keyword: '番茄' })
  assert(mineA.success && mineA.data.list.length === 1, 'A should see own recipe')

  const discoverA = await invoke('listRecipes', userA, { scope: 'discover' })
  assert(discoverA.success && discoverA.data.list.length === 0, 'discover excludes own recipe')

  const detailB = await invoke('getRecipe', userB, { id: sourceId })
  assert(detailB.success && detailB.data.isOwner === false, 'B sees detail as non-owner')

  const forbiddenUpdate = await invoke('saveRecipe', userB, {
    id: sourceId,
    title: '被篡改',
    ingredients: ['x'],
    steps: ['y']
  })
  assert(!forbiddenUpdate.success && forbiddenUpdate.code === 'FORBIDDEN', 'B cannot update A recipe')

  const forbiddenDelete = await invoke('deleteRecipe', userB, { id: sourceId })
  assert(!forbiddenDelete.success && forbiddenDelete.code === 'FORBIDDEN', 'B cannot delete A recipe')

  // B 导入 A 的菜谱
  const imported = await invoke('importRecipe', userB, { id: sourceId })
  assert(imported.success, 'B can import A recipe')
  const copyId = imported.data.id
  assert(copyId !== sourceId, 'import creates a new document')
  const copyDoc = state.collections.recipes.find((item) => item._id === copyId)
  assert(copyDoc._openid === userB, 'copy is owned by B')
  assert(copyDoc.sourceRecipeId === sourceId, 'copy records source id')
  assert(copyDoc.imageFileID === imageID, 'copy shares immutable image file id')
  assert(sourceDoc.title === '番茄炒蛋', 'import does not modify source')

  // B 修改副本，不影响 A
  const updatedCopy = await invoke('saveRecipe', userB, {
    id: copyId,
    title: 'B 的番茄炒蛋',
    imageFileID: imageID,
    description: copyDoc.description,
    category: copyDoc.category,
    cookTime: 20,
    difficulty: '中等',
    ingredients: ['番茄 3 个'],
    steps: ['B 的做法']
  })
  assert(updatedCopy.success, 'B can update copy')
  assert(sourceDoc.title === '番茄炒蛋' && sourceDoc.cookTime === 15, 'copy edit does not affect source')

  // 导入自己的菜谱应被拒绝
  const importOwn = await invoke('importRecipe', userA, { id: sourceId })
  assert(!importOwn.success && importOwn.code === 'CANNOT_IMPORT_OWN', 'cannot import own recipe')

  // 正则特殊字符不能导致查询报错
  const searchSpecial = await invoke('listRecipes', userB, { scope: 'discover', keyword: '.*[' })
  assert(searchSpecial.success, 'special regex characters are escaped')

  // 删除原菜谱：副本仍引用图片，因此图片文件不能删除
  const deleteSource = await invoke('deleteRecipe', userA, { id: sourceId })
  assert(deleteSource.success, 'A can delete own recipe')
  assert(!state.deletedFiles.includes(imageID), 'image must be kept while copy references it')

  // 删除副本后，图片无引用，才真正删除
  const deleteCopy = await invoke('deleteRecipe', userB, { id: copyId })
  assert(deleteCopy.success, 'B can delete own copy')
  assert(state.deletedFiles.includes(imageID), 'image is deleted after last reference removed')

  // 不能删除已删除的记录
  const deleteAgain = await invoke('deleteRecipe', userB, { id: copyId })
  assert(!deleteAgain.success && deleteAgain.code === 'NOT_FOUND', 'deleted recipe is not found')

  // 腾讯云 TC3 签名格式校验（不调用真实 ASR，不需要密钥）
  const speechFunction = loadFunction('speechToText')
  const signed = speechFunction._internal.buildAuthorization(
    'AKID_TEST',
    'SECRET_TEST',
    1551113065,
    '{"SubServiceType":2}',
    'ap-shanghai'
  )
  assert(
    /^TC3-HMAC-SHA256 Credential=AKID_TEST\/2019-02-25\/asr\/tc3_request, SignedHeaders=content-type;host, Signature=[a-f0-9]{64}$/.test(
      signed.authorization
    ),
    'TC3 authorization header should be well formed'
  )
  assert(
    signed.authorization.endsWith(
      'Signature=77d4f05c9427fa5327eae9e1ab1548e479d435131372cf1e3ac04ac4f1f5dbdd'
    ),
    'TC3 signature should match the independently computed test vector'
  )

  console.log('PASS: 云函数业务逻辑测试全部通过')
  console.log(`- 创建/列表/搜索/详情`)
  console.log(`- 越权编辑/删除被拒绝`)
  console.log(`- 导入生成独立副本，原菜谱不受影响`)
  console.log(`- 图片引用计数：有副本时保留，最后引用删除后才清理`)
  console.log(`- speechToText 的 TC3 签名格式与固定测试向量校验通过`)
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
