// 云函数：getRecipe
// 作用：获取单条菜谱详情。所有登录用户都可以查看，
// 返回值中只计算 isOwner，不暴露菜谱作者的 openid。
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const RECIPES = 'recipes'

function ok(data) {
  return { success: true, data }
}

function fail(code, message) {
  return { success: false, code, message }
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

function safeArray(value, maxItems, maxLength) {
  if (!Array.isArray(value)) return []
  return value
    .slice(0, maxItems)
    .map((item) => (typeof item === 'string' ? item.slice(0, maxLength) : ''))
    .filter(Boolean)
}

function isValidId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id)
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return fail('UNAUTHORIZED', '请先登录')

  const id = event && typeof event.id === 'string' ? event.id.trim() : ''
  if (!isValidId(id)) return fail('INVALID_INPUT', '菜谱 ID 不合法')

  try {
    const result = await db.collection(RECIPES).doc(id).get()
    const doc = result && result.data
    if (!doc) return fail('NOT_FOUND', '菜谱不存在或已被删除')

    return ok({
      id: doc._id,
      title: safeText(doc.title, 80),
      imageFileID: safeText(doc.imageFileID, 1024),
      description: safeText(doc.description, 300),
      category: safeText(doc.category, 40),
      cookTime: Number(doc.cookTime) || 0,
      difficulty: safeText(doc.difficulty, 10),
      ingredients: safeArray(doc.ingredients, 30, 100),
      steps: safeArray(doc.steps, 30, 500),
      ingredientCount: Number(doc.ingredientCount) || 0,
      stepCount: Number(doc.stepCount) || 0,
      sourceRecipeId: safeText(doc.sourceRecipeId, 128),
      createdAt: toMillis(doc.createdAt),
      updatedAt: toMillis(doc.updatedAt),
      isOwner: doc._openid === OPENID
    })
  } catch (err) {
    console.error('[getRecipe]', err)
    // doc.get() 在记录不存在时会抛出异常，这里统一按 404 处理，
    // 不把底层错误细节返回给客户端。
    return fail('NOT_FOUND', '菜谱不存在或已被删除')
  }
}
