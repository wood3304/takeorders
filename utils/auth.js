// 登录与身份工具
// openid 由 login 云函数通过 cloud.getWXContext().OPENID 返回，
// 不能由客户端自行生成或传入，否则所有写操作都会在云函数侧被拒绝。
const config = require('./config')
const { callFunction } = require('./cloud')

let pendingLogin = null

function getCachedOpenid() {
  try {
    return wx.getStorageSync(config.OPENID_STORAGE_KEY) || ''
  } catch (err) {
    return ''
  }
}

function setCachedOpenid(openid) {
  try {
    wx.setStorageSync(config.OPENID_STORAGE_KEY, openid)
  } catch (err) {
    console.warn('[auth] 缓存 openid 失败', err)
  }
  try {
    const app = getApp()
    if (app && app.globalData) app.globalData.openid = openid
  } catch (err) {
    // getApp 在极少数初始化时序下可能不可用，忽略即可
  }
}

/**
 * 调用云函数获取当前微信用户的 openid。
 * 并发调用会复用同一个请求，避免重复打云函数。
 */
async function login() {
  if (pendingLogin) return pendingLogin

  pendingLogin = (async () => {
    const data = await callFunction('login')
    if (!data || !data.openid) {
      throw new Error('登录失败：未获取到用户身份')
    }
    setCachedOpenid(data.openid)
    return data.openid
  })()

  try {
    return await pendingLogin
  } finally {
    pendingLogin = null
  }
}

/**
 * 拼接当前页面路径（含参数），用于登录后跳回分享/详情页。
 */
function getCurrentRouteWithQuery() {
  const pages = getCurrentPages()
  const page = pages && pages[pages.length - 1]
  if (!page || !page.route) return ''
  const options = page.options || {}
  const query = Object.keys(options)
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(options[key])}`)
    .join('&')
  return `/${page.route}${query ? `?${query}` : ''}`
}

function isSafeRedirect(url) {
  return typeof url === 'string' && /^\/pages\/[a-zA-Z0-9/_-]+(\?[^#]*)?$/.test(url)
}

function redirectToLogin(redirect) {
  const target = isSafeRedirect(redirect) ? redirect : '/pages/index/index'
  wx.reLaunch({
    url: `/pages/login/login?redirect=${encodeURIComponent(target)}`
  })
}

/**
 * 页面 onLoad/onShow 时调用。如果没有本地身份则跳转登录页。
 * 真正的权限判断永远在云函数中，此方法只负责交互引导。
 */
function requireLogin(redirect) {
  if (getCachedOpenid()) return true
  redirectToLogin(redirect || getCurrentRouteWithQuery() || '/pages/index/index')
  return false
}

function maskOpenid(openid) {
  if (!openid) return '未登录'
  if (openid.length <= 8) return `${openid.slice(0, 2)}****`
  return `${openid.slice(0, 4)}****${openid.slice(-4)}`
}

module.exports = {
  login,
  getCachedOpenid,
  setCachedOpenid,
  requireLogin,
  redirectToLogin,
  getCurrentRouteWithQuery,
  isSafeRedirect,
  maskOpenid
}
