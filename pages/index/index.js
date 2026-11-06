const auth = require('../../utils/auth')
const config = require('../../utils/config')
const format = require('../../utils/format')
const { callFunction, toastError } = require('../../utils/cloud')

Page({
  data: {
    mode: 'mine',
    keyword: '',
    searchPlaceholder: '搜索我的菜谱',
    openidMasked: '',
    greeting: '',
    list: [],
    offset: 0,
    hasMore: false,
    loading: true,
    loadingMore: false,
    firstLoaded: false,
    loadError: '',
    deletingId: '',
    skeletonItems: [1, 2, 3]
  },

  onLoad() {
    if (!auth.requireLogin('/pages/index/index')) {
      this.loginRedirected = true
      return
    }
    this.refreshUserInfo()
  },

  onShow() {
    if (!auth.getCachedOpenid()) {
      if (!this.loginRedirected) {
        this.loginRedirected = true
        auth.requireLogin(auth.getCurrentRouteWithQuery() || '/pages/index/index')
      }
      return
    }

    this.refreshUserInfo()
    const app = getApp()
    const version = app.globalData.recipesVersion || 0

    // 首次进入或数据版本变化（新建/编辑/删除/导入）时重新拉取
    if (!this.data.firstLoaded || this.listVersion !== version) {
      this.listVersion = version
      this.loadRecipes(true)
    }
  },

  onUnload() {
    if (this.searchTimer) clearTimeout(this.searchTimer)
    this.requestSeq = (this.requestSeq || 0) + 1
  },

  refreshUserInfo() {
    this.setData({
      openidMasked: auth.maskOpenid(auth.getCachedOpenid()),
      greeting: format.getGreeting()
    })
  },

  async loadRecipes(reset) {
    if (!auth.getCachedOpenid()) return
    if (!reset && (this.data.loading || this.data.loadingMore || !this.data.hasMore)) return

    const seq = (this.requestSeq || 0) + 1
    this.requestSeq = seq
    const mode = this.data.mode
    const offset = reset ? 0 : this.data.offset

    this.setData({
      loading: !!reset,
      loadingMore: !reset,
      loadError: reset ? '' : this.data.loadError
    })

    try {
      const data = await callFunction('listRecipes', {
        scope: mode === 'mine' ? 'mine' : 'discover',
        keyword: this.data.keyword.trim(),
        offset,
        limit: config.PAGE_SIZE
      })

      // 请求期间切换了 tab 或修改了搜索词，丢弃过期响应
      if (seq !== this.requestSeq) return

      const incoming = (data.list || []).map(format.decorateRecipe)
      const list = reset ? incoming : this.data.list.concat(incoming)
      this.setData({
        list,
        offset: offset + incoming.length,
        hasMore: !!data.hasMore,
        firstLoaded: true,
        loading: false,
        loadingMore: false,
        loadError: ''
      })
    } catch (err) {
      if (seq !== this.requestSeq) return
      console.error('[listRecipes]', err)
      this.setData({
        loading: false,
        loadingMore: false,
        loadError: err.message || '菜谱加载失败'
      })
      if (!reset || this.data.list.length) toastError(err, '菜谱加载失败')
    } finally {
      if (reset) wx.stopPullDownRefresh()
    }
  },

  onPullDownRefresh() {
    this.loadRecipes(true)
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loading && !this.data.loadingMore) {
      this.loadRecipes(false)
    }
  },

  switchMode(event) {
    const mode = event.currentTarget.dataset.mode
    if (!mode || mode === this.data.mode) return
    this.setData({
      mode,
      searchPlaceholder: mode === 'mine' ? '搜索我的菜谱' : '搜索大家的菜谱',
      list: [],
      offset: 0,
      hasMore: false,
      firstLoaded: false,
      loadError: ''
    })
    this.loadRecipes(true)
  },

  onKeywordInput(event) {
    const keyword = event.detail.value
    this.setData({ keyword })
    if (this.searchTimer) clearTimeout(this.searchTimer)
    this.searchTimer = setTimeout(() => {
      this.loadRecipes(true)
    }, 350)
  },

  onSearchConfirm() {
    if (this.searchTimer) clearTimeout(this.searchTimer)
    this.loadRecipes(true)
  },

  clearKeyword() {
    if (!this.data.keyword) return
    this.setData({ keyword: '' })
    if (this.searchTimer) clearTimeout(this.searchTimer)
    this.loadRecipes(true)
  },

  retryLoad() {
    this.loadRecipes(true)
  },

  openDetail(event) {
    const id = event.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({
      url: `/pages/detail/detail?id=${encodeURIComponent(id)}`
    })
  },

  createRecipe() {
    if (!auth.requireLogin('/pages/edit/edit')) return
    wx.navigateTo({ url: '/pages/edit/edit' })
  },

  editRecipe(event) {
    const id = event.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({
      url: `/pages/edit/edit?id=${encodeURIComponent(id)}`
    })
  },

  deleteRecipe(event) {
    const id = event.currentTarget.dataset.id
    const title = event.currentTarget.dataset.title || '这道菜谱'
    if (!id || this.data.deletingId) return

    wx.showModal({
      title: '删除菜谱',
      content: `确定删除「${title}」吗？删除后无法恢复。`,
      confirmText: '删除',
      confirmColor: '#C84B3A',
      success: async (modal) => {
        if (!modal.confirm) return
        this.setData({ deletingId: id })
        try {
          await callFunction('deleteRecipe', { id })
          const app = getApp()
          app.markRecipesDirty()
          this.listVersion = app.globalData.recipesVersion
          wx.showToast({ title: '已删除', icon: 'success' })
          // 重新拉取以补齐分页，避免列表出现空洞
          this.loadRecipes(true)
        } catch (err) {
          console.error('[deleteRecipe]', err)
          toastError(err, '删除失败')
        } finally {
          this.setData({ deletingId: '' })
        }
      }
    })
  },

  onShareAppMessage() {
    return {
      title: '我的私房菜谱',
      path: '/pages/index/index'
    }
  }
})
