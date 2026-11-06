const auth = require('../../utils/auth')
const { toastError } = require('../../utils/cloud')

Page({
  data: {
    loading: false,
    redirect: '/pages/index/index',
    errorMessage: ''
  },

  onLoad(options) {
    let redirect = ''
    if (options && options.redirect) {
      try {
        redirect = decodeURIComponent(options.redirect)
      } catch (err) {
        redirect = ''
      }
    }
    if (auth.isSafeRedirect(redirect)) {
      this.setData({ redirect })
    }

    // 已经登录过则直接进入目标页，避免每次冷启动都停留登录页
    if (auth.getCachedOpenid()) {
      this.enterApp()
    }
  },

  async handleLogin() {
    if (this.data.loading) return
    this.setData({ loading: true, errorMessage: '' })
    try {
      await auth.login()
      this.setData({ loading: false })
      this.enterApp()
    } catch (err) {
      console.error('[login]', err)
      this.setData({
        loading: false,
        errorMessage: err.message || '登录失败，请稍后重试'
      })
      toastError(err, '登录失败，请稍后重试')
    }
  },

  enterApp() {
    if (this.entered) return
    this.entered = true
    const target = auth.isSafeRedirect(this.data.redirect)
      ? this.data.redirect
      : '/pages/index/index'
    wx.reLaunch({ url: target })
  },

  retry() {
    this.handleLogin()
  }
})
