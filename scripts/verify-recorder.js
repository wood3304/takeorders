/* 录音封装回归测试：不依赖微信开发者工具，用 Mock 验证回调注册方式。 */
const assert = require('assert')

let startHandler = null
let stopHandler = null
let errorHandler = null
let startOptions = null
let stopCalled = false

const manager = {
  onStart(handler) {
    startHandler = handler
  },
  onStop(handler) {
    stopHandler = handler
  },
  onError(handler) {
    errorHandler = handler
  },
  start(options) {
    startOptions = options
  },
  stop() {
    stopCalled = true
  }
}

global.wx = {
  getRecorderManager() {
    return manager
  }
}

const recorder = require('../utils/recorder')

async function run() {
  recorder.checkAvailable()
  assert.strictEqual(typeof startHandler, 'function', 'onStart should be registered as a method')
  assert.strictEqual(typeof stopHandler, 'function', 'onStop should be registered as a method')
  assert.strictEqual(typeof errorHandler, 'function', 'onError should be registered as a method')

  let started = false
  let stopped = null
  recorder.start({
    onStart: () => {
      started = true
    },
    onStop: (res) => {
      stopped = res
    },
    onError: () => {}
  })

  assert.deepStrictEqual(startOptions, {
    duration: 55000,
    sampleRate: 16000,
    numberOfChannels: 1,
    encodeBitRate: 48000,
    format: 'mp3'
  })
  assert.strictEqual(recorder.isRecording(), true)

  startHandler({})
  assert.strictEqual(started, true, 'onStart callback should be delivered')

  recorder.stop()
  assert.strictEqual(stopCalled, true, 'manager.stop should be called')
  assert.strictEqual(recorder.isRecording(), false)

  stopHandler({ tempFilePath: 'wxfile://tmp/voice.mp3', duration: 1200, fileSize: 2048 })
  assert.strictEqual(stopped && stopped.tempFilePath, 'wxfile://tmp/voice.mp3')

  // release 只清空当前页面处理器，不能覆盖原生注册方法
  recorder.release()
  assert.strictEqual(typeof manager.onStart, 'function')
  assert.strictEqual(typeof manager.onStop, 'function')
  assert.strictEqual(typeof manager.onError, 'function')

  console.log('PASS: 录音回调注册测试通过')
  console.log('- onStart/onStop/onError 使用注册方法，而不是属性赋值')
  console.log('- 录音参数为 55s / 16k / 48kbps / mp3')
  console.log('- release 不会破坏后续页面的录音回调')
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
