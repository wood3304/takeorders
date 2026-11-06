// 云函数：deleteRecipe
// 作用：删除菜谱，但只允许菜谱所有者操作。
// 图片按引用计数清理：如果该图片仍被导入副本或其他菜谱引用，则保留文件。
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const RECIPES = 'recipes'
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

async function cleanupImageIfUnused(fileID) {
  if (!fileID || !fileID.startsWith(IMAGE_PREFIX)) return
  try {
    const countResult = await db.collection(RECIPES).where({ imageFileID: fileID }).count()
    if ((countResult.total || 0) === 0) {
      await cloud.deleteFile({ fileList: [fileID] })
    }
  } catch (err) {
    console.warn('[cleanupImageIfUnused]', err)
  }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return fail('UNAUTHORIZED', '请先登录')

  const id = event && typeof event.id === 'string' ? event.id.trim() : ''
  if (!isValidId(id)) return fail('INVALID_INPUT', '菜谱 ID 不合法')

  try {
    let doc
    try {
      const result = await db.collection(RECIPES).doc(id).get()
      doc = result && result.data
    } catch (err) {
      return fail('NOT_FOUND', '菜谱不存在或已被删除')
    }

    if (!doc) return fail('NOT_FOUND', '菜谱不存在或已被删除')
    if (doc._openid !== OPENID) {
      return fail('FORBIDDEN', '只能删除自己创建的菜谱')
    }

    const removeResult = await db.collection(RECIPES).doc(id).remove()
    if (!removeResult.stats || removeResult.stats.removed === 0) {
      return fail('NOT_FOUND', '菜谱不存在或已被删除')
    }

    await cleanupImageIfUnused(doc.imageFileID)
    return ok({ id })
  } catch (err) {
    console.error('[deleteRecipe]', err)
    return fail('INTERNAL', '菜谱删除失败，请稍后重试')
  }
}
