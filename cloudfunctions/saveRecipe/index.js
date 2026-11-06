// 云函数：saveRecipe
// 作用：新增或编辑菜谱。
// 权限核心：
//   1. 新增时 _openid 只取自 cloud.getWXContext()，客户端无法伪造；
//   2. 编辑时必须先确认原记录 _openid === 当前 OPENID；
//   3. 更新条件再次带上 _openid，双重保证非所有者无法修改。
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const RECIPES = 'recipes'
const MAX_INGREDIENTS = 30
const MAX_STEPS = 30
const MAX_INGREDIENT_LENGTH = 100
const MAX_STEP_LENGTH = 500
const IMAGE_PREFIX = 'cloud://'

function ok(data) {
  return { success: true, data }
}

function fail(code, message) {
  return { success: false, code, message }
}

function isValidId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id)
}

function trimText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeRecipe(event) {
  const title = trimText(event.title)
  const description = trimText(event.description)
  const category = trimText(event.category)
  const imageFileID = trimText(event.imageFileID)
  const difficulty = trimText(event.difficulty)

  if (!title) return { error: '请填写菜品名称' }
  if (title.length > 40) return { error: '菜品名称不能超过 40 个字' }
  if (description.length > 300) return { error: '菜品简介不能超过 300 个字' }
  if (category.length > 20) return { error: '分类不能超过 20 个字' }
  if (imageFileID && (!imageFileID.startsWith(IMAGE_PREFIX) || imageFileID.length > 1024)) {
    return { error: '图片地址不正确，请重新上传' }
  }
  if (difficulty && ['简单', '中等', '困难'].indexOf(difficulty) < 0) {
    return { error: '难度取值不正确' }
  }

  let cookTime = 0
  if (event.cookTime !== '' && event.cookTime !== null && event.cookTime !== undefined) {
    const value = Number(event.cookTime)
    if (!Number.isFinite(value) || value < 0 || value > 600) {
      return { error: '耗时请填写 0 - 600 之间的分钟数' }
    }
    cookTime = Math.round(value)
  }

  if (!Array.isArray(event.ingredients)) return { error: '原材料格式不正确' }
  if (!Array.isArray(event.steps)) return { error: '制作步骤格式不正确' }
  if (event.ingredients.length > MAX_INGREDIENTS) {
    return { error: `原材料最多 ${MAX_INGREDIENTS} 条` }
  }
  if (event.steps.length > MAX_STEPS) {
    return { error: `制作步骤最多 ${MAX_STEPS} 个` }
  }

  const ingredients = []
  for (const item of event.ingredients) {
    if (typeof item !== 'string') return { error: '原材料内容格式不正确' }
    const text = item.trim()
    if (!text) continue
    if (text.length > MAX_INGREDIENT_LENGTH) {
      return { error: `单条原材料不能超过 ${MAX_INGREDIENT_LENGTH} 字` }
    }
    ingredients.push(text)
  }

  const steps = []
  for (const item of event.steps) {
    if (typeof item !== 'string') return { error: '制作步骤内容格式不正确' }
    const text = item.trim()
    if (!text) continue
    if (text.length > MAX_STEP_LENGTH) {
      return { error: `单个步骤不能超过 ${MAX_STEP_LENGTH} 字` }
    }
    steps.push(text)
  }

  if (!ingredients.length) return { error: '至少填写一条原材料' }
  if (!steps.length) return { error: '至少填写一个制作步骤' }

  return {
    data: {
      title,
      description,
      category,
      cookTime,
      difficulty,
      imageFileID,
      ingredients,
      steps,
      ingredientCount: ingredients.length,
      stepCount: steps.length
    }
  }
}

/**
 * 图片按引用计数清理：
 * 导入菜谱会复用原图的 cloud fileID，只有没有任何菜谱再引用时才真正删除文件。
 */
async function cleanupImageIfUnused(fileID) {
  if (!fileID || !fileID.startsWith(IMAGE_PREFIX)) return
  try {
    const countResult = await db.collection(RECIPES).where({ imageFileID: fileID }).count()
    if ((countResult.total || 0) === 0) {
      await cloud.deleteFile({ fileList: [fileID] })
    }
  } catch (err) {
    // 图片清理失败不影响菜谱保存主流程
    console.warn('[cleanupImageIfUnused]', err)
  }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return fail('UNAUTHORIZED', '请先登录')

  const normalized = normalizeRecipe(event || {})
  if (normalized.error) return fail('INVALID_INPUT', normalized.error)
  const recipe = normalized.data
  const id = event && typeof event.id === 'string' ? event.id.trim() : ''

  try {
    if (!id) {
      const addResult = await db.collection(RECIPES).add({
        data: {
          ...recipe,
          _openid: OPENID,
          sourceRecipeId: null,
          schemaVersion: 1,
          createdAt: db.serverDate(),
          updatedAt: db.serverDate()
        }
      })
      return ok({ id: addResult._id })
    }

    if (!isValidId(id)) return fail('INVALID_INPUT', '菜谱 ID 不合法')

    let oldRecipe
    try {
      const oldResult = await db.collection(RECIPES).doc(id).get()
      oldRecipe = oldResult && oldResult.data
    } catch (err) {
      return fail('NOT_FOUND', '菜谱不存在或已被删除')
    }

    if (!oldRecipe) return fail('NOT_FOUND', '菜谱不存在或已被删除')
    if (oldRecipe._openid !== OPENID) {
      return fail('FORBIDDEN', '只能编辑自己创建的菜谱')
    }

    // 条件更新再次校验 _openid，防止检查与写入之间出现异常情况
    const updateResult = await db
      .collection(RECIPES)
      .where({ _id: id, _openid: OPENID })
      .update({
        data: {
          ...recipe,
          schemaVersion: 1,
          updatedAt: db.serverDate()
        }
      })

    if (!updateResult.stats || updateResult.stats.updated === 0) {
      return fail('FORBIDDEN', '没有权限修改这道菜谱')
    }

    if (oldRecipe.imageFileID && oldRecipe.imageFileID !== recipe.imageFileID) {
      await cleanupImageIfUnused(oldRecipe.imageFileID)
    }

    return ok({ id })
  } catch (err) {
    console.error('[saveRecipe]', err)
    return fail('INTERNAL', '菜谱保存失败，请稍后重试')
  }
}
