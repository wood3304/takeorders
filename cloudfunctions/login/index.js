// 云函数：login
// 作用：返回当前微信用户在云开发中的唯一 OpenID。
// 客户端传入的任何身份字段都不可信，因此这里只认 cloud.getWXContext()。
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async () => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  if (!openid) {
    return {
      success: false,
      code: 'UNAUTHORIZED',
      message: '未获取到微信用户身份，请重新进入小程序'
    }
  }

  return {
    success: true,
    data: {
      openid,
      appid: wxContext.APPID || ''
    }
  }
}
