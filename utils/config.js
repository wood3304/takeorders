// 小程序端配置
module.exports = {
  // 不填则使用当前小程序的默认云开发环境；多环境时填写环境 ID，例如：
  // CLOUD_ENV: 'cloud1-xxxxxxxxxxxx',
  CLOUD_ENV: '',

  // 列表分页大小，需与云函数 listRecipes 的 MAX_PAGE_SIZE 保持一致
  PAGE_SIZE: 12,

  // openid 本地缓存键。该缓存只用于展示和快速进入，
  // 所有写操作仍由云函数根据 getWXContext().OPENID 校验。
  OPENID_STORAGE_KEY: 'recipe_openid',

  // 编辑页的常用分类
  CATEGORIES: ['家常菜', '快手菜', '汤羹', '主食', '甜点', '凉菜', '其他'],

  // 难度选项，第一项表示未设置
  DIFFICULTIES: ['未设置', '简单', '中等', '困难']
}
