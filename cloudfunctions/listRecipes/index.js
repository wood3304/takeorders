// 云函数：listRecipes
// 作用：分页查询「我的菜谱」或「发现菜谱」，支持按菜名模糊搜索。
// 权限：只返回安全的展示字段，不把 _openid 暴露给客户端。
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command
const RECIPES = 'recipes'
const MAX_PAGE_SIZE = 20

function ok(data) {
  return { success: true, data }
}

function fail(code, message) {
  return { success: false, code, message }
}

function escapeRegExp(text) {
  // 防止用户输入 . * ( ) 等正则元字符影响查询
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function toMillis(value) {
  if (!value) return 0
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number') return value
  const time = Date.parse(value)
  return Number.isNaN(time) ? 0 : time
}

function safeText(value, maxLength) {
  return typeof value === 'string' ? value.slice(0, maxLength) : ''
}

function toListItem(doc, isOwner, imageUrlMap) {
  return {
    id: doc._id,
    title: safeText(doc.title, 80),
    imageFileID: safeText(doc.imageFileID, 1024),
    imageUrl: imageUrlMap[doc.imageFileID] || '',
    description: safeText(doc.description, 300),
    category: safeText(doc.category, 40),
    cookTime: Number(doc.cookTime) || 0,
    difficulty: safeText(doc.difficulty, 10),
    ingredientCount: Number(doc.ingredientCount) || 0,
    stepCount: Number(doc.stepCount) || 0,
    sourceRecipeId: safeText(doc.sourceRecipeId, 128),
    createdAt: toMillis(doc.createdAt),
    updatedAt: toMillis(doc.updatedAt),
    isOwner
  }
}

/**
 * 通过云函数管理端批量生成临时 HTTPS 图片地址。
 * 这样即使云存储设置为“仅创建者可读”，其他用户也能在列表里看到菜品图。
 */
async function buildImageUrlMap(docs) {
  const fileIDs = Array.from(
    new Set(
      docs
        .map((doc) => doc.imageFileID)
        .filter((fileID) => typeof fileID === 'string' && fileID.startsWith('cloud://'))
    )
  ).slice(0, 50)
  if (!fileIDs.length) return {}

  try {
    const result = await cloud.getTempFileURL({ fileList: fileIDs })
    const map = {}
    ;(result.fileList || []).forEach((item) => {
      if (item.fileID && item.tempFileURL) {
        map[item.fileID] = item.tempFileURL
      }
    })
    return map
  } catch (err) {
    console.warn('[listRecipes] getTempFileURL failed', err)
    return {}
  }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return fail('UNAUTHORIZED', '请先登录')

  try {
    const input = event || {}
    const scope = input.scope === 'discover' ? 'discover' : 'mine'
    const keyword = typeof input.keyword === 'string' ? input.keyword.trim().slice(0, 30) : ''
    const offset = Math.min(10000, Math.max(0, Number(input.offset) || 0))
    const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(input.limit) || 12))

    const where = {}
    if (scope === 'mine') {
      where._openid = OPENID
    } else {
      // 发现页只展示别人的菜谱；自己的菜谱在「我的菜谱」中管理
      where._openid = _.neq(OPENID)
    }
    if (keyword) {
      where.title = db.RegExp({
        regexp: escapeRegExp(keyword),
        options: 'i'
      })
    }

    // 多查一条用于判断是否还有下一页，避免额外 count 查询
    const result = await db
      .collection(RECIPES)
      .where(where)
      .orderBy('updatedAt', 'desc')
      .skip(offset)
      .limit(limit + 1)
      .field({
        _id: true,
        title: true,
        imageFileID: true,
        description: true,
        category: true,
        cookTime: true,
        difficulty: true,
        ingredientCount: true,
        stepCount: true,
        sourceRecipeId: true,
        createdAt: true,
        updatedAt: true
      })
      .get()

    const docs = result.data || []
    const hasMore = docs.length > limit
    const pageDocs = docs.slice(0, limit)
    const imageUrlMap = await buildImageUrlMap(pageDocs)
    // scope=mine 的记录一定属于当前用户；scope=discover 已排除当前用户
    const list = pageDocs.map((doc) => toListItem(doc, scope === 'mine', imageUrlMap))

    return ok({ list, hasMore })
  } catch (err) {
    console.error('[listRecipes]', err)
    const message = String((err && err.message) || '')
    if (/collection.*not exist|DATABASE_COLLECTION_NOT_EXIST/i.test(message)) {
      return fail('COLLECTION_MISSING', '请先在云开发控制台创建 recipes 集合')
    }
    return fail('INTERNAL', '菜谱列表加载失败，请稍后重试')
  }
}
