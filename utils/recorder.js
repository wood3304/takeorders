// 微信原生录音封装
// 个人主体小程序无法使用“微信同声传译”插件，因此改用 wx.getRecorderManager：
//   录音 -> 云存储 -> speechToText 云函数调用腾讯云一句话识别 ASR -> 返回文字。
// 本文件只负责录音和权限，网络识别逻辑在 pages/edit/edit.js 中处理。
let manager = null
let activeHandlers = null
let recording = false

function noop() {}

function createRecorderError(message, code) {
  const error = new Error(message)
  error.code = code || 'RECORDER_ERROR'
  return error
}

function attachCallbacks() {
  if (!manager) return

  manager.onStart = (res) => {
    if (activeHandlers && typeof activeHandlers.onStart === 'function') {
      activeHandlers.onStart(res)
    }
  }
  manager.onStop = (res) => {
    recording = false
    const handlers = activeHandlers
    activeHandlers = null
    if (handlers && typeof handlers.onStop === 'function') {
      handlers.onStop(res)
    }
  }
  manager.onError = (res) => {
    recording = false
    const handlers = activeHandlers
    activeHandlers = null
    if (handlers && typeof handlers.onError === 'function') {
      handlers.onError(res)
    }
  }
}

function ensureManager() {
  if (manager) {
    attachCallbacks()
    return manager
  }
  if (typeof wx.getRecorderManager !== 'function') {
    throw createRecorderError(
      '当前微信版本不支持录音，请升级微信后重试',
      'RECORDER_UNAVAILABLE'
    )
  }
  manager = wx.getRecorderManager()
  attachCallbacks()
  return manager
}

/**
 * 申请录音权限。
 * 用户曾经拒绝过时，普通 authorize 不会再次弹窗，需要引导去设置页。
 */
function ensureRecordPermission() {
  return new Promise((resolve, reject) => {
    wx.getSetting({
      success(setting) {
        const authSetting = (setting && setting.authSetting) || {}
        const state = authSetting['scope.record']
        if (state === true) {
          resolve()
          return
        }
        if (state === false) {
          reject(createRecorderError('录音权限已被拒绝，请在设置中开启', 'RECORD_DENIED'))
          return
        }
        wx.authorize({
          scope: 'scope.record',
          success: () => resolve(),
          fail: () => {
            reject(createRecorderError('未获得录音权限，语音输入无法使用', 'RECORD_DENIED'))
          }
        })
      },
      fail() {
        reject(createRecorderError('无法读取权限设置，请稍后重试', 'PERMISSION_CHECK_FAILED'))
      }
    })
  })
}

function checkAvailable() {
  ensureManager()
  return true
}

/**
 * 开始录音。
 * 腾讯云一句话识别限制音频不超过 60 秒、3MB，这里录 55 秒并采用 16k / 48kbps mp3。
 */
function start(handlers) {
  const instance = ensureManager()
  activeHandlers = handlers || {}
  recording = true
  try {
    instance.start({
      duration: 55000,
      sampleRate: 16000,
      numberOfChannels: 1,
      encodeBitRate: 48000,
      format: 'mp3'
    })
  } catch (err) {
    activeHandlers = null
    recording = false
    throw createRecorderError('录音启动失败，请检查麦克风权限', 'RECORD_START_FAILED')
  }
}

function stop() {
  if (!manager || !recording) return
  recording = false
  try {
    manager.stop()
  } catch (err) {
    console.warn('[recorder] stop failed', err)
  }
}

function isRecording() {
  return recording
}

/**
 * 页面卸载时释放回调，避免上一次录音的 onStop 回填到新页面。
 */
function release() {
  if (!manager) {
    activeHandlers = null
    recording = false
    return
  }
  activeHandlers = null
  recording = false
  try {
    manager.stop()
  } catch (err) {
    console.warn('[recorder] release stop failed', err)
  }
  manager.onStart = noop
  manager.onStop = noop
  manager.onError = noop
}

module.exports = {
  checkAvailable,
  ensureRecordPermission,
  start,
  stop,
  isRecording,
  release
}
