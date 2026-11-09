// 云函数：speechToText
// 作用：接收小程序录音文件 ID，调用腾讯云“一句话识别”转成文字。
//
// 为什么不用插件：
//   个人主体小程序无法申请“微信同声传译”插件，因此改为
//   wx.getRecorderManager 录音 -> 云存储临时文件 -> 本云函数 -> 腾讯云 ASR。
//
// 需要在云函数环境变量中配置：
//   TENCENT_SECRET_ID   腾讯云 API 密钥 SecretId
//   TENCENT_SECRET_KEY  腾讯云 API 密钥 SecretKey
//   TENCENT_ASR_REGION  可选，默认 ap-shanghai
//
// 腾讯云 ASR 一句话识别限制：音频不超过 60 秒、3MB。
// 本项目客户端录音限制为 55 秒。
const cloud = require('wx-server-sdk')
const https = require('https')
const crypto = require('crypto')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const ASR_HOST = 'asr.tencentcloudapi.com'
const ASR_SERVICE = 'asr'
const ASR_ACTION = 'SentenceRecognition'
const ASR_VERSION = '2019-06-14'
const CONTENT_TYPE = 'application/json; charset=utf-8'
const MAX_AUDIO_BYTES = 3 * 1024 * 1024
const ALLOWED_FORMATS = ['mp3', 'wav', 'm4a', 'aac', 'pcm', 'ogg-opus', 'speex', 'silk', 'amr']

function ok(data) {
  return { success: true, data }
}

function fail(code, message) {
  return { success: false, code, message }
}

function sha256Hex(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex')
}

function hmac(key, text) {
  return crypto.createHmac('sha256', key).update(text, 'utf8').digest()
}

/**
 * 生成腾讯云 API 3.0 的 TC3-HMAC-SHA256 签名。
 * 只签名必选的 content-type 和 host 两个头部，请求时保持完全一致。
 */
function buildAuthorization(secretId, secretKey, timestamp, payload, region) {
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10)
  const canonicalHeaders = `content-type:${CONTENT_TYPE}\nhost:${ASR_HOST}\n`
  const signedHeaders = 'content-type;host'
  const hashedPayload = sha256Hex(payload)
  const canonicalRequest = [
    'POST',
    '/',
    '',
    canonicalHeaders,
    signedHeaders,
    hashedPayload
  ].join('\n')

  const credentialScope = `${date}/${ASR_SERVICE}/tc3_request`
  const stringToSign = [
    'TC3-HMAC-SHA256',
    String(timestamp),
    credentialScope,
    sha256Hex(canonicalRequest)
  ].join('\n')

  const secretDate = hmac(`TC3${secretKey}`, date)
  const secretService = hmac(secretDate, ASR_SERVICE)
  const secretSigning = hmac(secretService, 'tc3_request')
  const signature = crypto
    .createHmac('sha256', secretSigning)
    .update(stringToSign, 'utf8')
    .digest('hex')

  return {
    authorization: `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    date,
    region
  }
}

function mapAsrError(code, message) {
  const map = {
    'FailedOperation.UserNotRegistered': '腾讯云语音识别服务未开通，请先在腾讯云控制台开通',
    'FailedOperation.ServiceIsolate': '腾讯云语音识别服务已停用，请检查账户状态',
    'FailedOperation.UserHasNoAmount': '腾讯云语音识别资源包已耗尽，请购买或开通后付费',
    'FailedOperation.UserHasNoFreeAmount': '腾讯云语音识别免费额度已耗尽，请购买资源包',
    'InvalidParameterValue.ErrorVoicedataTooLong': '录音超过 60 秒，请缩短语音',
    'InvalidParameterValue.ErrorInvalidVoicedata': '录音数据无效，请重新录制',
    'InvalidParameterValue.ErrorInvalidVoiceFormat': '录音格式不支持'
  }
  return map[code] || (message ? `语音识别失败：${message}` : '语音识别失败，请重试')
}

function requestAsr({ secretId, secretKey, region, audioBuffer, format }) {
  return new Promise((resolve, reject) => {
    const timestamp = Math.floor(Date.now() / 1000)
    const payload = JSON.stringify({
      ProjectId: 0,
      SubServiceType: 2,
      EngSerViceType: '16k_zh',
      SourceType: 1,
      VoiceFormat: format,
      Data: audioBuffer.toString('base64'),
      DataLen: audioBuffer.length,
      FilterDirty: 0,
      FilterModal: 1,
      FilterPunc: 0,
      ConvertNumMode: 1,
      WordInfo: 0
    })
    const { authorization } = buildAuthorization(
      secretId,
      secretKey,
      timestamp,
      payload,
      region
    )

    const request = https.request(
      {
        hostname: ASR_HOST,
        port: 443,
        path: '/',
        method: 'POST',
        headers: {
          Authorization: authorization,
          'Content-Type': CONTENT_TYPE,
          Host: ASR_HOST,
          'X-TC-Action': ASR_ACTION,
          'X-TC-Version': ASR_VERSION,
          'X-TC-Timestamp': String(timestamp),
          'X-TC-Region': region,
          'Content-Length': Buffer.byteLength(payload)
        }
      },
      (response) => {
        let raw = ''
        response.setEncoding('utf8')
        response.on('data', (chunk) => {
          raw += chunk
        })
        response.on('error', reject)
        response.on('end', () => {
          let parsed
          try {
            parsed = JSON.parse(raw)
          } catch (err) {
            reject(new Error('腾讯云 ASR 返回内容无法解析'))
            return
          }

          const result = parsed && parsed.Response
          if (!result) {
            reject(new Error('腾讯云 ASR 未返回有效结果'))
            return
          }
          if (result.Error) {
            const error = new Error(
              mapAsrError(result.Error.Code, result.Error.Message)
            )
            error.code = result.Error.Code
            error.requestId = result.RequestId
            reject(error)
            return
          }
          resolve({
            text: result.Result || '',
            requestId: result.RequestId || '',
            audioDuration: Number(result.AudioDuration) || 0
          })
        })
      }
    )

    request.setTimeout(15000, () => {
      request.destroy(new Error('腾讯云 ASR 请求超时'))
    })
    request.on('error', reject)
    request.write(payload)
    request.end()
  })
}

async function cleanupAudio(fileID) {
  try {
    await cloud.deleteFile({ fileList: [fileID] })
  } catch (err) {
    console.warn('[speechToText] cleanup audio failed', err)
  }
}

function isUserAudioFile(fileID, openid) {
  if (typeof fileID !== 'string' || !fileID.startsWith('cloud://')) return false
  const escapedOpenid = openid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(
    `^cloud://[^/]+/voice-temp/${escapedOpenid}/[A-Za-z0-9._-]+$`
  ).test(fileID)
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return fail('UNAUTHORIZED', '请先登录')

  const fileID = event && typeof event.fileID === 'string' ? event.fileID.trim() : ''
  const format = event && typeof event.format === 'string' ? event.format.toLowerCase() : 'mp3'
  const duration = Number(event && event.duration) || 0

  console.log('[speechToText] invoked', {
    hasOpenid: !!OPENID,
    hasFileID: !!fileID,
    format,
    duration
  })

  if (!isUserAudioFile(fileID, OPENID)) {
    console.warn('[speechToText] invalid audio path')
    return fail('AUDIO_INVALID', '录音文件地址不合法')
  }
  if (ALLOWED_FORMATS.indexOf(format) < 0) {
    await cleanupAudio(fileID)
    return fail('ASR_AUDIO_INVALID', '录音格式不支持')
  }
  if (duration > 60000) {
    await cleanupAudio(fileID)
    return fail('ASR_AUDIO_TOO_LARGE', '录音超过 60 秒，请缩短语音')
  }

  const secretId = (process.env.TENCENT_SECRET_ID || process.env.TENCENTCLOUD_SECRET_ID || '').trim()
  const secretKey = (process.env.TENCENT_SECRET_KEY || process.env.TENCENTCLOUD_SECRET_KEY || '').trim()
  const region = (process.env.TENCENT_ASR_REGION || '').trim() || 'ap-shanghai'

  if (!secretId || !secretKey) {
    console.warn('[speechToText] missing TENCENT_SECRET_ID / TENCENT_SECRET_KEY')
    await cleanupAudio(fileID)
    return fail(
      'ASR_NOT_CONFIGURED',
      '云函数未配置腾讯云密钥，请设置 TENCENT_SECRET_ID 和 TENCENT_SECRET_KEY'
    )
  }
  console.log('[speechToText] credentials present', {
    hasSecretId: true,
    hasSecretKey: true,
    region
  })

  try {
    const download = await cloud.downloadFile({ fileID })
    const rawAudio = download && download.fileContent
    if (!rawAudio || !rawAudio.length) {
      return fail('AUDIO_INVALID', '没有读取到录音文件')
    }
    const audioBuffer = Buffer.isBuffer(rawAudio) ? rawAudio : Buffer.from(rawAudio)
    if (audioBuffer.length > MAX_AUDIO_BYTES) {
      return fail('ASR_AUDIO_TOO_LARGE', '录音文件超过 3MB，请缩短语音')
    }

    console.log('[speechToText] calling Tencent ASR', {
      bytes: audioBuffer.length,
      format,
      region
    })
    const result = await requestAsr({
      secretId,
      secretKey,
      region,
      audioBuffer,
      format
    })
    console.log('[speechToText] success', {
      requestId: result.requestId,
      textLength: (result.text || '').length,
      audioDuration: result.audioDuration
    })

    return ok({
      text: (result.text || '').trim(),
      requestId: result.requestId,
      audioDuration: result.audioDuration
    })
  } catch (err) {
    console.error('[speechToText]', {
      code: err.code || '',
      requestId: err.requestId || '',
      message: (err && err.message) || String(err)
    })
    if (err.code && /^FailedOperation|^InvalidParameter/.test(err.code)) {
      return fail('ASR_FAILED', mapAsrError(err.code, err.message))
    }
    return fail('ASR_FAILED', err.message || '语音识别失败，请重试')
  } finally {
    // 音频只用于本次识别，无论成功失败都删除，避免占用云存储
    await cleanupAudio(fileID)
  }
}

// 供本地测试签名/请求构造使用，不影响云函数正常调用
exports._internal = {
  buildAuthorization,
  mapAsrError
}
