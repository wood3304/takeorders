const auth = require('../../utils/auth')
const format = require('../../utils/format')
const { callFunction, toastError } = require('../../utils/cloud')

Page({
  data: {
    id: '',
    recipe: null,
    loading: true,
    loaded: false,
    error: '',
    isOwner: false,
    importing: false,
    deleting: false
  },

  onLoad(options) {
    let id = ''
    if (options && options.id) {
      try {
        id = decodeURIComponent(options.id)
      } catch (err) {
        id = options.id
      }
    }
    if (!id) {
      this.setData({ loading: false, error: '没有找到这道菜谱' })
      return
    }

    const currentPath = `/pages/detail/detail?id=${encodeURIComponent(id)}`
    if (!auth.requireLogin(currentPath)) return
    this.setData({ id })
  },

  onShow() {
    if (!this.data.id) return
    if (!auth.getCachedOpenid()) {
      const path = `/pages/detail/detail?id=${encodeURIComponent(this.data.id)}`
      auth.requireLogin(path)
      return
    }

    const app = getApp()
    const version = app.globalData.recipesVersion || 0

    // 首次进入或数据版本变化（编辑返回、导入后跳转）时重新拉取
    if (!this.data.loaded || this.detailVersion !== version) {
      this.detailVersion = version
      this.loadRecipe()
    }
  },

  onUnload() {
    // 让未完成的详情请求失效，避免页面卸载后继续 setData
    this.requestSeq = (this.requestSeq || 0) + 1
    this.unloaded = true
    if (this.navTimer) {
      clearTimeout(this.navTimer)
      this.navTimer = null
    }
  },

  async loadRecipe() {
    const seq = (this.requestSeq || 0) + 1
    this.requestSeq = seq
    const showFullLoading = !this.data.recipe
    if (showFullLoading) this.setData({ loading: true, error: '' })

    try {
      const data = await callFunction('getRecipe', { id: this.data.id })
      if (seq !== this.requestSeq) return

      const recipe = format.decorateRecipe(data)
      recipe.ingredients = (data.ingredients || []).filter((item) => !!item)
      recipe.steps = (data.steps || []).filter((item) => !!item)
      recipe.ingredientCount = recipe.ingredients.length
      recipe.stepCount = recipe.steps.length
      recipe.createdLabel = format.formatDateTime(data.createdAt)

      this.setData({
        recipe,
        isOwner: !!data.isOwner,
        loading: false,
        loaded: true,
        error: ''
      })
      wx.setNavigationBarTitle({ title: recipe.title || '菜谱详情' })
    } catch (err) {
      if (seq !== this.requestSeq) return
      console.error('[getRecipe]', err)
      this.setData({
        loading: false,
        loaded: true,
        error: err.code === 'NOT_FOUND' ? '这道菜谱可能已经被删除' : (err.message || '菜谱加载失败')
      })
    }
  },

  retryLoad() {
    this.loadRecipe()
  },

  editRecipe() {
    if (!this.data.isOwner) return
    wx.navigateTo({
      url: `/pages/edit/edit?id=${encodeURIComponent(this.data.id)}`
    })
  },

  deleteRecipe() {
    if (!this.data.isOwner || this.data.deleting) return
    const title = this.data.recipe ? this.data.recipe.title : '这道菜谱'
    wx.showModal({
      title: '删除菜谱',
      content: `确定删除「${title}」吗？删除后无法恢复。`,
      confirmText: '删除',
      confirmColor: '#C84B3A',
      success: async (modal) => {
        if (!modal.confirm) return
        this.setData({ deleting: true })
        try {
          await callFunction('deleteRecipe', { id: this.data.id })
          getApp().markRecipesDirty()
          wx.showToast({ title: '已删除', icon: 'success' })
          this.navTimer = setTimeout(() => {
            if (this.unloaded) return
            const pages = getCurrentPages()
            if (pages.length > 1) {
              wx.navigateBack()
            } else {
              wx.reLaunch({ url: '/pages/index/index' })
            }
          }, 450)
        } catch (err) {
          console.error('[deleteRecipe]', err)
          toastError(err, '删除失败')
          this.setData({ deleting: false })
        }
      }
    })
  },

  importRecipe() {
    if (this.data.isOwner || this.data.importing || !this.data.recipe) return
    wx.showModal({
      title: '导入这道菜谱',
      content: '将复制一份新的菜谱到「我的菜谱」，你可以自由编辑；原菜谱不会被修改。',
      confirmText: '导入',
      confirmColor: '#E2603B',
      success: async (modal) => {
        if (!modal.confirm) return
        this.setData({ importing: true })
        wx.showLoading({ title: '正在复制…', mask: true })
        try {
          const data = await callFunction('importRecipe', { id: this.data.id })
          getApp().markRecipesDirty()
          wx.hideLoading()
          wx.showToast({ title: '导入成功', icon: 'success' })
          this.navTimer = setTimeout(() => {
            if (this.unloaded) return
            wx.redirectTo({
              url: `/pages/detail/detail?id=${encodeURIComponent(data.id)}`
            })
          }, 450)
        } catch (err) {
          wx.hideLoading()
          console.error('[importRecipe]', err)
          toastError(err, '导入失败')
          this.setData({ importing: false })
        }
      }
    })
  },

  onShareAppMessage() {
    const recipe = this.data.recipe
    return {
      title: recipe ? `${recipe.title} · 私房菜谱` : '私房菜谱',
      path: `/pages/detail/detail?id=${encodeURIComponent(this.data.id)}`
    }
  },

  onShareTimeline() {
    const recipe = this.data.recipe
    return {
      title: recipe ? `${recipe.title} · 私房菜谱` : '私房菜谱',
      query: `id=${encodeURIComponent(this.data.id)}`
    }
  }
})
