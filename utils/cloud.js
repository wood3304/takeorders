// 云函数调用统一封装
// 云函数返回约定：
//   成功：{ success: true, data: ... }
//   失败：{ success: false, code: 'XXX', message: '...' }

function isFunctionMissing(err) {
  const text = `${(err && err.errMsg) || ''} ${(err && err.message) || ''}`
  return /FUNCTION_NOT_FOUND|FunctionName|function not found|云函数.*不存在/i.test(text)
}

function normalizeError(err) {
  const wrapped = err instanceof Error ? err : new Error((err && err.errMsg) || '请求失败')
  if (wrapped.code) return wrapped
  if (isFunctionMissing(err)) {
    wrapped.message = '云函数未部署，请先在开发者工具中上传并部署对应云函数'
    wrapped.code = 'FUNCTION_NOT_FOUND'
    return wrapped
  }
  const raw = `${(err && err.errMsg) || ''} ${(err && err.message) || ''}`
  if (/cloud.*init|env.*not found|环境不存在|env check/i.test(raw)) {
    wrapped.message = '云开发环境未初始化，请检查环境配置'
    wrapped.code = 'CLOUD_ENV_ERROR'
  }
  return wrapped
}

/**
 * 调用云函数
 * @param {string} name 云函数名
 * @param {object} data 参数
 * @param {object} options { loadingText, mask }
 * @returns {Promise<any>} 解包后的 data
 */
async function callFunction(name, data, options) {
  const opts = options || {}
  if (opts.loadingText) {
    wx.showLoading({ title: opts.loadingText, mask: opts.mask !== false })
  }

  try {
    const res = await wx.cloud.callFunction({
      name,
      data: data || {}
    })
    const payload = res && res.result
    if (!payload || payload.success !== true) {
      const error = new Error((payload && payload.message) || '服务暂时不可用，请稍后重试')
      error.code = (payload && payload.code) || 'BIZ_ERROR'
      error.details = payload && payload.details
      throw error
    }
    return payload.data
  } catch (err) {
    throw normalizeError(err)
  } finally {
    if (opts.loadingText) {
      wx.hideLoading()
    }
  }
}

function toastError(err, fallback) {
  const message = (err && (err.message || err.errMsg)) || fallback || '操作失败，请稍后重试'
  // toast 文案过长会被截断，这里控制在一个适合阅读的长度
  wx.showToast({
    title: String(message).slice(0, 42),
    icon: 'none',
    duration: 2600
  })
}

function modalError(title, content) {
  wx.showModal({
    title: title || '提示',
    content: content || '操作失败，请稍后重试',
    showCancel: false
  })
}

module.exports = {
  callFunction,
  toastError,
  modalError
}
