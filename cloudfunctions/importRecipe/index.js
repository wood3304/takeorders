// 云函数：importRecipe
// 作用：把别人的菜谱复制成当前用户的一份独立副本。
// 重要：
//   1. 原菜谱完全不做修改；
//   2. 新记录的 _openid 强制使用当前 OPENID，客户端无法指定；
//   3. 新记录拥有自己的 _id、createdAt、updatedAt，可以自由编辑删除；
//   4. 图片复用同一个不可变 cloud fileID，删除时按引用计数清理，
//      因此副本与原菜谱在数据上互不影响，也不会出现图片被误删。
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const RECIPES = 'recipes'
const MAX_INGREDIENTS = 30
const MAX_STEPS = 30
const MAX_INGREDIENT_LENGTH = 100
const MAX_STEP_LENGTH = 500

function ok(data) {
  return { success: true, data }
}

function fail(code, message) {
  return { success: false, code, message }
}

function isValidId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id)
}

function safeText(value, maxLength) {
  return typeof value === 'string' ? value.slice(0, maxLength) : ''
}

function copyStringArray(value, maxItems, maxLength) {
  if (!Array.isArray(value)) return []
  return value
    .slice(0, maxItems)
    .map((item) => (typeof item === 'string' ? item.slice(0, maxLength) : ''))
    .filter((item) => !!item)
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return fail('UNAUTHORIZED', '请先登录')

  const sourceId = event && typeof event.id === 'string' ? event.id.trim() : ''
  if (!isValidId(sourceId)) return fail('INVALID_INPUT', '菜谱 ID 不合法')

  try {
    let source
    try {
      const result = await db.collection(RECIPES).doc(sourceId).get()
      source = result && result.data
    } catch (err) {
      return fail('NOT_FOUND', '原菜谱不存在或已被删除')
    }

    if (!source) return fail('NOT_FOUND', '原菜谱不存在或已被删除')
    if (source._openid === OPENID) {
      return fail('CANNOT_IMPORT_OWN', '这是你自己的菜谱，无需导入')
    }

    const ingredients = copyStringArray(
      source.ingredients,
      MAX_INGREDIENTS,
      MAX_INGREDIENT_LENGTH
    )
    const steps = copyStringArray(source.steps, MAX_STEPS, MAX_STEP_LENGTH)
    if (!ingredients.length || !steps.length) {
      return fail('INVALID_SOURCE', '原菜谱内容不完整，暂时无法导入')
    }

    const difficulty = ['简单', '中等', '困难'].indexOf(source.difficulty) >= 0
      ? source.difficulty
      : ''

    // 只复制菜谱内容字段，不复制原记录的 _id/_openid/时间戳等身份元数据
    const copyData = {
      _openid: OPENID,
      title: safeText(source.title, 40) || '未命名菜谱',
      imageFileID: safeText(source.imageFileID, 1024),
      description: safeText(source.description, 300),
      category: safeText(source.category, 20),
      cookTime: Math.max(0, Math.min(600, Math.round(Number(source.cookTime) || 0))),
      difficulty,
      ingredients,
      steps,
      ingredientCount: ingredients.length,
      stepCount: steps.length,
      sourceRecipeId: source._id,
      schemaVersion: 1,
      createdAt: db.serverDate(),
      updatedAt: db.serverDate()
    }

    const addResult = await db.collection(RECIPES).add({ data: copyData })

    return ok({
      id: addResult._id,
      title: copyData.title,
      sourceRecipeId: source._id
    })
  } catch (err) {
    console.error('[importRecipe]', err)
    return fail('INTERNAL', '菜谱导入失败，请稍后重试')
  }
}
