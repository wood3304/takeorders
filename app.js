// app.js
const auth = require('./utils/auth')
const config = require('./utils/config')

App({
  globalData: {
    openid: '',
    cloudReady: false,
    // 数据版本号：任何新增、编辑、删除、导入后 +1。
    // 列表页和详情页各自记住自己看到的版本，切回页面时只在版本变化后刷新，
    // 这样详情页消费了刷新也不会导致来源列表页漏刷新。
    recipesVersion: 0
  },

  onLaunch() {
    if (!wx.cloud) {
      wx.showModal({
        title: '基础库版本过低',
        content: '请将微信开发者工具的基础库调整到 2.10.0 以上，并开通云开发。',
        showCancel: false
      })
      return
    }

    const initOptions = { traceUser: true }
    // 不填 CLOUD_ENV 时使用当前小程序的默认云环境；
    // 多环境项目可以在 utils/config.js 中指定环境 ID。
    if (config.CLOUD_ENV) {
      initOptions.env = config.CLOUD_ENV
    }

    try {
      wx.cloud.init(initOptions)
      this.globalData.cloudReady = true
      this.globalData.openid = auth.getCachedOpenid()
    } catch (err) {
      console.error('[cloud init]', err)
      wx.showModal({
        title: '云开发初始化失败',
        content: '请确认已开通云开发，并检查 utils/config.js 中的 CLOUD_ENV 配置。',
        showCancel: false
      })
    }
  },

  markRecipesDirty() {
    this.globalData.recipesVersion = (this.globalData.recipesVersion || 0) + 1
  }
})
