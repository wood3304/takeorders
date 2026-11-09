const auth = require('../../utils/auth')
const config = require('../../utils/config')
const { callFunction, toastError, modalError } = require('../../utils/cloud')
const recorder = require('../../utils/recorder')

const MAX_INGREDIENTS = 30
const MAX_STEPS = 30
const MAX_INGREDIENT_LENGTH = 100
const MAX_STEP_LENGTH = 500
const MAX_IMAGE_BYTES = 8 * 1024 * 1024

function getExtension(path) {
  const match = /\.([a-zA-Z0-9]+)(?:\?|$)/.exec(path || '')
  const ext = match ? match[1].toLowerCase() : 'jpg'
  return ['jpg', 'jpeg', 'png', 'webp', 'gif'].indexOf(ext) >= 0 ? ext : 'jpg'
}

function pickImage() {
  return new Promise((resolve, reject) => {
    if (wx.chooseMedia) {
      wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        sizeType: ['compressed'],
        success(res) {
          const file = res.tempFiles && res.tempFiles[0]
          if (!file || !file.tempFilePath) {
            reject(new Error('没有选择图片'))
            return
          }
          resolve({ path: file.tempFilePath, size: file.size || 0 })
        },
        fail: reject
      })
      return
    }

    if (wx.chooseImage) {
      wx.chooseImage({
        count: 1,
        sourceType: ['album', 'camera'],
        sizeType: ['compressed'],
        success(res) {
          const path = res.tempFilePaths && res.tempFilePaths[0]
          if (!path) {
            reject(new Error('没有选择图片'))
            return
          }
          const file = (res.tempFiles && res.tempFiles[0]) || {}
          resolve({ path, size: file.size || 0 })
        },
        fail: reject
      })
      return
    }

    reject(new Error('当前微信版本不支持选择图片'))
  })
}

Page({
  data: {
    id: '',
    isEdit: false,
    loading: false,
    loadError: '',
    saving: false,
    form: {
      title: '',
      description: '',
      category: '',
      cookTime: '',
      difficulty: '',
      imageFileID: '',
      imageUrl: '',
      imageTempPath: '',
      ingredients: [''],
      steps: ['']
    },
    categories: config.CATEGORIES,
    difficulties: config.DIFFICULTIES,
    difficultyIndex: 0,
    voiceStatus: 'idle', // idle | recording | processing
    voiceActive: false,
    voiceTargetType: '',
    voiceTargetIndex: -1,
    voicePreview: '',
    showPrivacy: false,
    privacyContractName: '《用户隐私保护指引》'
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
    const currentPath = id
      ? `/pages/edit/edit?id=${encodeURIComponent(id)}`
      : '/pages/edit/edit'
    if (!auth.requireLogin(currentPath)) return

    this.setData({
      id,
      isEdit: !!id,
      loading: !!id
    })
    wx.setNavigationBarTitle({ title: id ? '编辑菜谱' : '新建菜谱' })

    if (id) this.loadRecipe()
  },

  onShow() {
    this.pageHidden = false
  },

  onHide() {
    this.pageHidden = true
    this.stopVoiceForLeave()
  },

  onUnload() {
    this.unloaded = true
    this.stopVoiceForLeave()
    recorder.release()
    if (this.voiceStopTimer) clearTimeout(this.voiceStopTimer)
  },

  async loadRecipe() {
    try {
      const data = await callFunction('getRecipe', { id: this.data.id })
      if (this.unloaded) return

      // 再次在客户端做一次提示；真正的写权限仍由云函数强制校验
      if (!data.isOwner) {
        this.setData({
          loading: false,
          loadError: '这道菜谱属于其他用户，只能查看或导入，不能编辑'
        })
        wx.showModal({
          title: '无法编辑',
          content: '这道菜谱属于其他用户。你可以回到详情页查看，或导入一份自己的副本。',
          showCancel: false,
          success: () => this.goBack()
        })
        return
      }

      const ingredients = Array.isArray(data.ingredients) && data.ingredients.length
        ? data.ingredients.slice(0, MAX_INGREDIENTS)
        : ['']
      const steps = Array.isArray(data.steps) && data.steps.length
        ? data.steps.slice(0, MAX_STEPS)
        : ['']
      const difficultyIndex = Math.max(0, config.DIFFICULTIES.indexOf(data.difficulty || ''))

      this.setData({
        loading: false,
        loadError: '',
        difficultyIndex,
        form: {
          title: data.title || '',
          description: data.description || '',
          category: data.category || '',
          cookTime: data.cookTime ? String(data.cookTime) : '',
          difficulty: data.difficulty || '',
          imageFileID: data.imageFileID || '',
          imageUrl: data.imageUrl || '',
          imageTempPath: '',
          ingredients,
          steps
        }
      })
    } catch (err) {
      console.error('[loadRecipe]', err)
      this.setData({
        loading: false,
        loadError: err.message || '菜谱加载失败'
      })
    }
  },

  retryLoad() {
    this.setData({ loading: true, loadError: '' })
    this.loadRecipe()
  },

  goBack() {
    const pages = getCurrentPages()
    if (pages.length > 1) {
      wx.navigateBack()
    } else {
      wx.reLaunch({ url: '/pages/index/index' })
    }
  },

  // ---------------- 隐私授权 ----------------
  /**
   * 在调用麦克风/相册/相机等隐私接口前检查隐私协议。
   * 如果用户还没同意，展示编辑页内的隐私弹窗；
   * 弹窗里的 <button open-type="agreePrivacyAuthorization"> 会完成微信侧授权。
   */
  ensurePrivacyAuthorization() {
    if (typeof wx.getPrivacySetting !== 'function') {
      return Promise.resolve()
    }
    return new Promise((resolve, reject) => {
      wx.getPrivacySetting({
        success: (res) => {
          console.info('[privacy] setting', {
            needAuthorization: !!res.needAuthorization,
            privacyContractName: res.privacyContractName || ''
          })
          if (!res.needAuthorization) {
            resolve()
            return
          }
          this.privacyResolve = resolve
          this.privacyReject = reject
          this.setData({
            showPrivacy: true,
            privacyContractName: res.privacyContractName || '《用户隐私保护指引》'
          })
        },
        fail: (err) => {
          console.warn('[privacy] getPrivacySetting failed', err)
          // 查询失败不阻断主流程，让真实隐私接口给出最终错误
          resolve()
        }
      })
    })
  },

  onAgreePrivacy() {
    const resolve = this.privacyResolve
    this.privacyResolve = null
    this.privacyReject = null
    this.setData({ showPrivacy: false })
    if (resolve) resolve()
  },

  onRejectPrivacy() {
    const reject = this.privacyReject
    this.privacyResolve = null
    this.privacyReject = null
    this.setData({ showPrivacy: false })
    if (reject) {
      const error = new Error('需要同意用户隐私保护指引后才能使用语音或选择图片')
      error.code = 'PRIVACY_REJECTED'
      reject(error)
    }
  },

  openPrivacyContract() {
    if (typeof wx.openPrivacyContract !== 'function') {
      wx.showToast({ title: '请升级微信后查看隐私协议', icon: 'none' })
      return
    }
    wx.openPrivacyContract({
      fail: (err) => {
        console.warn('[privacy] openPrivacyContract failed', err)
        wx.showToast({ title: '隐私协议暂时无法打开', icon: 'none' })
      }
    })
  },

  // ---------------- 基础字段 ----------------
  onTitleInput(event) {
    this.setData({ 'form.title': event.detail.value })
  },

  onDescriptionInput(event) {
    this.setData({ 'form.description': event.detail.value })
  },

  onCategoryInput(event) {
    this.setData({ 'form.category': event.detail.value })
  },

  selectCategory(event) {
    const value = event.currentTarget.dataset.value || ''
    const next = this.data.form.category === value ? '' : value
    this.setData({ 'form.category': next })
  },

  onCookTimeInput(event) {
    const value = String(event.detail.value || '').replace(/[^\d]/g, '').slice(0, 3)
    this.setData({ 'form.cookTime': value })
  },

  onDifficultyChange(event) {
    const index = Number(event.detail.value)
    const difficulty = index > 0 ? config.DIFFICULTIES[index] : ''
    this.setData({
      difficultyIndex: index,
      'form.difficulty': difficulty
    })
  },

  // ---------------- 图片 ----------------
  async chooseImage() {
    if (this.data.saving) return
    try {
      await this.ensurePrivacyAuthorization()
    } catch (err) {
      this.handleSpeechError(err)
      return
    }
    try {
      const file = await pickImage()
      if (file.size && file.size > MAX_IMAGE_BYTES) {
        wx.showToast({ title: '图片不能超过 8MB', icon: 'none' })
        return
      }
      this.setData({ 'form.imageTempPath': file.path })
    } catch (err) {
      const message = (err && err.errMsg) || ''
      if (!/cancel/i.test(message)) {
        toastError(err, '选择图片失败')
      }
    }
  },

  async previewImage() {
    let url = this.data.form.imageTempPath || this.data.form.imageUrl
    try {
      if (!url && this.data.form.imageFileID) {
        const res = await wx.cloud.getTempFileURL({ fileList: [this.data.form.imageFileID] })
        const item = res.fileList && res.fileList[0]
        url = item && item.tempFileURL
      }
      if (url) {
        wx.previewImage({ current: url, urls: [url] })
      }
    } catch (err) {
      console.warn('[previewImage]', err)
    }
  },

  removeImage() {
    if (this.data.saving) return
    this.setData({
      'form.imageTempPath': '',
      'form.imageUrl': '',
      'form.imageFileID': ''
    })
  },

  async uploadImage(tempPath) {
    const openid = auth.getCachedOpenid()
    if (!openid) {
      auth.requireLogin(auth.getCurrentRouteWithQuery() || '/pages/edit/edit')
      throw new Error('登录状态已失效，请重新登录')
    }
    const ext = getExtension(tempPath)
    const random = Math.random().toString(36).slice(2, 8)
    const cloudPath = `recipe-images/${openid}/${Date.now()}-${random}.${ext}`
    const res = await wx.cloud.uploadFile({
      cloudPath,
      filePath: tempPath
    })
    if (!res.fileID) throw new Error('图片上传失败')
    return res.fileID
  },

  async deleteUploadedFile(fileID) {
    if (!fileID) return
    try {
      await wx.cloud.deleteFile({ fileList: [fileID] })
    } catch (err) {
      console.warn('[deleteUploadedFile]', err)
    }
  },

  // ---------------- 原材料 ----------------
  onIngredientInput(event) {
    const index = Number(event.currentTarget.dataset.index)
    this.setData({
      [`form.ingredients[${index}]`]: event.detail.value
    })
  },

  addIngredient() {
    if (this.guardVoiceLock()) return
    const list = this.data.form.ingredients.slice()
    if (list.length >= MAX_INGREDIENTS) {
      wx.showToast({ title: `最多 ${MAX_INGREDIENTS} 条原材料`, icon: 'none' })
      return
    }
    list.push('')
    this.setData({ 'form.ingredients': list })
  },

  removeIngredient(event) {
    if (this.guardVoiceLock()) return
    const index = Number(event.currentTarget.dataset.index)
    const list = this.data.form.ingredients.slice()
    if (!list.length) return
    if (list.length === 1) {
      list[0] = ''
    } else {
      list.splice(index, 1)
    }
    this.setData({ 'form.ingredients': list })
  },

  // ---------------- 制作步骤 ----------------
  onStepInput(event) {
    const index = Number(event.currentTarget.dataset.index)
    this.setData({
      [`form.steps[${index}]`]: event.detail.value
    })
  },

  addStep() {
    if (this.guardVoiceLock()) return
    const list = this.data.form.steps.slice()
    if (list.length >= MAX_STEPS) {
      wx.showToast({ title: `最多 ${MAX_STEPS} 个步骤`, icon: 'none' })
      return
    }
    list.push('')
    this.setData({ 'form.steps': list })
  },

  removeStep(event) {
    if (this.guardVoiceLock()) return
    const index = Number(event.currentTarget.dataset.index)
    const list = this.data.form.steps.slice()
    if (!list.length) return
    if (list.length === 1) {
      list[0] = ''
    } else {
      list.splice(index, 1)
    }
    this.setData({ 'form.steps': list })
  },

  moveStep(event) {
    if (this.guardVoiceLock()) return
    const index = Number(event.currentTarget.dataset.index)
    const direction = Number(event.currentTarget.dataset.dir)
    const list = this.data.form.steps.slice()
    const target = index + direction
    if (target < 0 || target >= list.length) return

    const current = list[index]
    list[index] = list[target]
    list[target] = current
    this.setData({ 'form.steps': list })
  },

  // ---------------- 语音输入 ----------------
  // 录音 -> 上传临时音频 -> speechToText 云函数 -> 腾讯云一句话识别 -> 回填文字
  guardVoiceLock() {
    if (this.data.voiceStatus === 'recording' || this.data.voiceStatus === 'processing') {
      wx.showToast({ title: '请先结束当前语音输入', icon: 'none' })
      return true
    }
    return false
  },

  async toggleVoice(event) {
    if (this.data.saving) return
    const type = event.currentTarget.dataset.type
    const index = Number(event.currentTarget.dataset.index)
    if (!type || Number.isNaN(index)) return
    console.info('[voice] tap', {
      type,
      index,
      status: this.data.voiceStatus,
      saving: this.data.saving,
      pageHidden: !!this.pageHidden
    })

    if (this.data.voiceStatus === 'recording') {
      if (this.data.voiceTargetType === type && this.data.voiceTargetIndex === index) {
        this.stopVoice()
      } else {
        wx.showToast({ title: '请先结束当前语音输入', icon: 'none' })
      }
      return
    }
    if (this.data.voiceStatus === 'processing') {
      wx.showToast({ title: '正在识别，请稍候', icon: 'none' })
      return
    }
    if (this.voiceStarting) return

    try {
      await this.ensurePrivacyAuthorization()
    } catch (err) {
      console.warn('[voice] privacy authorization failed', err)
      this.handleSpeechError(err)
      return
    }

    try {
      recorder.checkAvailable()
    } catch (err) {
      this.handleSpeechError(err)
      return
    }

    this.voiceStarting = true
    try {
      await recorder.ensureRecordPermission()
      console.info('[voice] record permission granted')
    } catch (err) {
      this.voiceStarting = false
      console.error('[voice] record permission failed', err)
      this.handleSpeechError(err)
      return
    }
    this.voiceStarting = false
    if (this.unloaded || this.data.saving || this.pageHidden) {
      console.warn('[voice] skip start', {
        unloaded: !!this.unloaded,
        saving: this.data.saving,
        pageHidden: !!this.pageHidden
      })
      return
    }

    // 每次录音/识别一个 jobId，页面隐藏、超时或新录音后旧任务自动作废
    const jobId = (this.voiceJobId || 0) + 1
    this.voiceJobId = jobId
    this.voiceTarget = { type, index }
    this.setData({
      voiceStatus: 'recording',
      voiceActive: true,
      voiceTargetType: type,
      voiceTargetIndex: index,
      voicePreview: '正在录音，点击“结束”即可识别'
    })

    try {
      recorder.start({
        onStart: () => {
          if (jobId !== this.voiceJobId || this.unloaded) return
          console.info('[voice] recording started', { jobId, type, index })
          this.setData({ voicePreview: '正在录音，再点一次麦克风结束' })
        },
        onStop: (res) => this.handleRecordingStop(res, jobId),
        onError: (res) => this.handleRecorderError(res, jobId)
      })
    } catch (err) {
      console.error('[voice] recorder start failed', err)
      this.voiceJobId = jobId + 1
      this.voiceTarget = null
      this.resetVoice()
      this.handleSpeechError(err)
    }
  },

  stopVoice() {
    if (this.data.voiceStatus !== 'recording') return
    const jobId = this.voiceJobId
    console.info('[voice] stop requested', { jobId })
    this.setData({
      voiceStatus: 'processing',
      voicePreview: '正在识别，请稍候…'
    })
    this.startRecognitionTimeout(jobId)
    recorder.stop()
  },

  startRecognitionTimeout(jobId) {
    if (this.voiceStopTimer) clearTimeout(this.voiceStopTimer)
    this.voiceStopTimer = setTimeout(() => {
      if (jobId !== this.voiceJobId) return
      this.voiceJobId = (this.voiceJobId || 0) + 1
      this.voiceTarget = null
      this.resetVoice()
      wx.showToast({ title: '识别超时，请重试', icon: 'none' })
    }, 40000)
  },

  async handleRecordingStop(res, jobId) {
    if (this.voiceStopTimer) {
      clearTimeout(this.voiceStopTimer)
      this.voiceStopTimer = null
    }
    if (jobId !== this.voiceJobId) return

    const target = this.voiceTarget
    if (!target) {
      this.resetVoice()
      return
    }

    const tempFilePath = res && res.tempFilePath
    console.info('[voice] recording result', {
      jobId,
      duration: res && res.duration,
      fileSize: res && res.fileSize,
      hasTempFile: !!tempFilePath
    })
    if (!tempFilePath) {
      this.handleRecorderError({ errMsg: '未获取到录音文件，请重试' }, jobId)
      return
    }
    if (res.fileSize && res.fileSize > 3 * 1024 * 1024) {
      this.voiceJobId = (this.voiceJobId || 0) + 1
      this.voiceTarget = null
      this.resetVoice()
      wx.showToast({ title: '录音文件过大，请缩短语音', icon: 'none' })
      return
    }

    this.setData({
      voiceStatus: 'processing',
      voicePreview: '正在识别，请稍候…'
    })
    this.startRecognitionTimeout(jobId)

    let fileID = ''
    try {
      console.info('[voice] uploading audio')
      fileID = await this.uploadVoice(tempFilePath)
      console.info('[voice] audio uploaded')
      if (jobId !== this.voiceJobId) return

      console.info('[voice] calling speechToText', {
        duration: Number(res.duration) || 0
      })
      const data = await callFunction('speechToText', {
        fileID,
        format: 'mp3',
        duration: Number(res.duration) || 0
      })
      console.info('[voice] speechToText returned', {
        textLength: ((data && data.text) || '').length,
        requestId: data && data.requestId
      })
      if (jobId !== this.voiceJobId) return

      const text = ((data && data.text) || '').trim()
      if (!text) {
        wx.showToast({ title: '没有听清，请再说一遍', icon: 'none' })
        return
      }
      this.appendVoiceText(target, text)
    } catch (err) {
      if (jobId !== this.voiceJobId) return
      console.error('[voice] recognize failed', err)
      this.handleVoiceServiceError(err)
    } finally {
      if (jobId === this.voiceJobId) {
        this.voiceTarget = null
        this.resetVoice()
      }
      // 清理失败也不阻塞 UI；云函数侧同样会删除临时音频
      if (fileID) this.deleteVoiceFile(fileID)
    }
  },

  appendVoiceText(target, text) {
    const isIngredient = target.type === 'ingredients'
    const field = isIngredient ? 'ingredients' : 'steps'
    const maxLength = isIngredient ? MAX_INGREDIENT_LENGTH : MAX_STEP_LENGTH
    const list = (this.data.form[field] || []).slice()
    if (target.index < 0 || target.index >= list.length) return

    const current = list[target.index] || ''
    // 已有内容时自动补一个逗号，识别结果更接近自然语言
    const separator = current && !/[，。；、,.!?！？\s]$/.test(current) ? '，' : ''
    const combined = `${current}${separator}${text}`
    if (combined.length > maxLength) {
      wx.showToast({ title: `内容超过 ${maxLength} 字，已截断`, icon: 'none' })
    }
    list[target.index] = combined.slice(0, maxLength)
    this.setData({ [`form.${field}`]: list })
  },

  handleRecorderError(res, jobId) {
    if (jobId !== this.voiceJobId) return
    console.error('[voice] recorder error callback', res)
    if (this.voiceStopTimer) {
      clearTimeout(this.voiceStopTimer)
      this.voiceStopTimer = null
    }
    this.voiceJobId = (this.voiceJobId || 0) + 1
    this.voiceTarget = null
    this.resetVoice()
    const message = (res && (res.errMsg || res.message)) || '录音失败，请重试'
    if (/privacy|banned|隐私/i.test(message)) {
      this.handleSpeechError({ code: 'PRIVACY_NOT_CONFIGURED', message })
      return
    }
    if (/auth|permission|授权|权限/i.test(message)) {
      this.handleSpeechError({ code: 'RECORD_DENIED', message })
      return
    }
    wx.showToast({ title: String(message).slice(0, 42), icon: 'none' })
  },

  handleSpeechError(err) {
    const code = err && err.code
    const message = (err && err.message) || '语音输入不可用'
    if (code === 'PRIVACY_REJECTED') {
      wx.showToast({ title: '需要同意隐私保护指引后使用', icon: 'none' })
      return
    }
    if (code === 'PRIVACY_NOT_CONFIGURED') {
      wx.showModal({
        title: '隐私接口未配置',
        content: '这不是手机权限问题，而是小程序后台「用户隐私保护指引」未配置或未发布。\n\n请到：小程序后台 → 设置 → 服务内容声明 → 用户隐私保护指引，声明麦克风、相册、摄像头用途，保存并发布后再重新编译。\n\n在配置完成前，仍可继续用键盘输入。',
        showCancel: false,
        confirmText: '知道了'
      })
      return
    }
    if (code === 'RECORD_DENIED') {
      wx.showModal({
        title: '需要麦克风权限',
        content: '开启录音权限后才能使用语音输入。你也可以继续用键盘输入。\n\n如果手机权限已开启仍然失败，请检查小程序后台的“用户隐私保护指引”是否声明了麦克风。',
        confirmText: '去设置',
        confirmColor: '#E2603B',
        success: (modal) => {
          if (modal.confirm) wx.openSetting({})
        }
      })
      return
    }
    if (code === 'RECORDER_UNAVAILABLE' || code === 'RECORDER_ERROR') {
      modalError('无法使用录音', message)
      return
    }
    wx.showToast({ title: String(message).slice(0, 42), icon: 'none' })
  },

  handleVoiceServiceError(err) {
    const code = err && err.code
    if (code === 'ASR_NOT_CONFIGURED') {
      modalError(
        '语音识别未配置',
        '请在云开发控制台为 speechToText 云函数配置环境变量 TENCENT_SECRET_ID 和 TENCENT_SECRET_KEY，并重新部署云函数。\n\n也可以直接使用手机输入法键盘上的麦克风输入。'
      )
      return
    }
    if (code === 'ASR_AUDIO_TOO_LARGE' || code === 'ASR_AUDIO_INVALID') {
      wx.showToast({ title: (err && err.message) || '录音格式不正确', icon: 'none' })
      return
    }
    if (code === 'UPLOAD_FAILED') {
      wx.showToast({ title: '录音上传失败，请检查网络或存储权限', icon: 'none' })
      return
    }
    toastError(err, '语音识别失败，请重试')
  },

  resetVoice() {
    if (this.voiceStopTimer) {
      clearTimeout(this.voiceStopTimer)
      this.voiceStopTimer = null
    }
    this.setData({
      voiceStatus: 'idle',
      voiceActive: false,
      voiceTargetType: '',
      voiceTargetIndex: -1,
      voicePreview: ''
    })
  },

  async uploadVoice(tempFilePath) {
    const openid = auth.getCachedOpenid()
    if (!openid) {
      auth.requireLogin(auth.getCurrentRouteWithQuery() || '/pages/edit/edit')
      const error = new Error('登录状态已失效，请重新登录')
      error.code = 'UNAUTHORIZED'
      throw error
    }
    const random = Math.random().toString(36).slice(2, 8)
    const cloudPath = `voice-temp/${openid}/${Date.now()}-${random}.mp3`
    try {
      const res = await wx.cloud.uploadFile({
        cloudPath,
        filePath: tempFilePath
      })
      if (!res.fileID) throw new Error('empty fileID')
      return res.fileID
    } catch (err) {
      console.error('[voice] upload failed', err)
      const error = new Error('录音上传失败，请检查网络或存储权限')
      error.code = 'UPLOAD_FAILED'
      throw error
    }
  },

  async deleteVoiceFile(fileID) {
    if (!fileID) return
    try {
      await wx.cloud.deleteFile({ fileList: [fileID] })
    } catch (err) {
      console.warn('[deleteVoiceFile]', err)
    }
  },

  stopVoiceForLeave() {
    if (this.data.voiceStatus === 'idle' && !this.voiceTarget) return
    // 让正在进行的录音/识别任务失效，避免回填到已经离开的页面
    this.voiceJobId = (this.voiceJobId || 0) + 1
    this.voiceTarget = null
    try {
      recorder.stop()
    } catch (err) {
      console.warn('[recorder stop]', err)
    }
    this.resetVoice()
  },

  // ---------------- 保存 ----------------
  validateForm() {
    const form = this.data.form
    const title = (form.title || '').trim()
    const description = (form.description || '').trim()
    const category = (form.category || '').trim()
    const ingredients = (form.ingredients || []).map((item) => (item || '').trim()).filter(Boolean)
    const steps = (form.steps || []).map((item) => (item || '').trim()).filter(Boolean)
    const cookTime = form.cookTime === '' ? 0 : Number(form.cookTime)

    if (!title) return { error: '请填写菜品名称' }
    if (title.length > 40) return { error: '菜品名称不能超过 40 个字' }
    if (description.length > 300) return { error: '菜品简介不能超过 300 个字' }
    if (category.length > 20) return { error: '分类不能超过 20 个字' }
    if (!Number.isFinite(cookTime) || cookTime < 0 || cookTime > 600) {
      return { error: '耗时请填写 0 - 600 之间的分钟数' }
    }
    if (!ingredients.length) return { error: '至少填写一条原材料' }
    if (!steps.length) return { error: '至少填写一个制作步骤' }
    if (ingredients.length > MAX_INGREDIENTS) return { error: `原材料最多 ${MAX_INGREDIENTS} 条` }
    if (steps.length > MAX_STEPS) return { error: `制作步骤最多 ${MAX_STEPS} 个` }
    if (ingredients.some((item) => item.length > MAX_INGREDIENT_LENGTH)) {
      return { error: `单条原材料不能超过 ${MAX_INGREDIENT_LENGTH} 字` }
    }
    if (steps.some((item) => item.length > MAX_STEP_LENGTH)) {
      return { error: `单个步骤不能超过 ${MAX_STEP_LENGTH} 字` }
    }

    return {
      data: {
        title,
        description,
        category,
        cookTime,
        difficulty: form.difficulty || '',
        ingredients,
        steps
      }
    }
  },

  async save() {
    if (this.data.saving) return
    if (this.data.voiceStatus !== 'idle') {
      wx.showToast({ title: '请先结束语音输入', icon: 'none' })
      return
    }

    const checked = this.validateForm()
    if (checked.error) {
      wx.showToast({ title: checked.error, icon: 'none' })
      return
    }

    const payload = checked.data
    let imageFileID = this.data.form.imageFileID || ''
    let uploadedFileID = ''
    this.setData({ saving: true })

    try {
      if (this.data.form.imageTempPath) {
        wx.showLoading({ title: '上传图片…', mask: true })
        try {
          uploadedFileID = await this.uploadImage(this.data.form.imageTempPath)
          imageFileID = uploadedFileID
        } catch (err) {
          const wrapped = new Error('图片上传失败，请检查网络后重试')
          wrapped.code = 'UPLOAD_FAILED'
          throw wrapped
        }
      }

      wx.showLoading({ title: '保存菜谱…', mask: true })
      const result = await callFunction('saveRecipe', {
        ...payload,
        id: this.data.isEdit ? this.data.id : '',
        imageFileID
      })

      getApp().markRecipesDirty()
      wx.hideLoading()
      wx.showToast({ title: this.data.isEdit ? '已保存' : '创建成功', icon: 'success' })
      this.afterSave(result.id)
    } catch (err) {
      wx.hideLoading()
      // 只有在云函数明确返回“未写入”的业务错误时才清理刚上传的图片。
      // 网络超时可能是“服务端已保存但响应丢失”，此时删除图片反而会造成菜谱图片丢失。
      const safeDeleteCodes = [
        'INVALID_INPUT',
        'FORBIDDEN',
        'NOT_FOUND',
        'UNAUTHORIZED',
        'FUNCTION_NOT_FOUND',
        'CLOUD_ENV_ERROR',
        'COLLECTION_MISSING',
        'UPLOAD_FAILED'
      ]
      if (uploadedFileID && safeDeleteCodes.indexOf(err.code) >= 0) {
        await this.deleteUploadedFile(uploadedFileID)
      }
      console.error('[saveRecipe]', err)
      toastError(err, '保存失败，请稍后重试')
      this.setData({ saving: false })
    }
  },

  afterSave(id) {
    this.setData({ saving: false })
    if (!id) {
      this.goBack()
      return
    }

    if (!this.data.isEdit) {
      wx.redirectTo({
        url: `/pages/detail/detail?id=${encodeURIComponent(id)}`
      })
      return
    }

    const pages = getCurrentPages()
    if (pages.length > 1) {
      wx.navigateBack()
    } else {
      wx.redirectTo({
        url: `/pages/detail/detail?id=${encodeURIComponent(id)}`
      })
    }
  },

  cancel() {
    if (this.data.saving) return
    this.stopVoiceForLeave()
    const form = this.data.form
    const hasDraft = !!(
      form.title ||
      form.description ||
      form.category ||
      form.imageFileID ||
      form.imageTempPath ||
      form.ingredients.some((item) => !!item) ||
      form.steps.some((item) => !!item)
    )

    if (!this.data.isEdit && !hasDraft) {
      this.goBack()
      return
    }

    wx.showModal({
      title: '放弃编辑？',
      content: '当前填写的内容还没有保存，返回后将丢失。',
      confirmText: '放弃',
      confirmColor: '#C84B3A',
      success: (modal) => {
        if (modal.confirm) this.goBack()
      }
    })
  }
})
