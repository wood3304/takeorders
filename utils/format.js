// 展示层格式化工具
function pad(value) {
  return value < 10 ? `0${value}` : `${value}`
}

function toTimestamp(value) {
  if (!value) return 0
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number') return value
  const time = Date.parse(value)
  return Number.isNaN(time) ? 0 : time
}

function formatRelativeTime(value) {
  const timestamp = toTimestamp(value)
  if (!timestamp) return ''
  const diff = Date.now() - timestamp
  if (diff < 60 * 1000) return '刚刚'
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)} 分钟前`
  if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 3600000)} 小时前`
  if (diff < 7 * 24 * 60 * 60 * 1000) return `${Math.floor(diff / 86400000)} 天前`
  const date = new Date(timestamp)
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}`
}

function formatDateTime(value) {
  const timestamp = toTimestamp(value)
  if (!timestamp) return ''
  const date = new Date(timestamp)
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}`
}

function formatCookTime(minutes) {
  const value = Number(minutes)
  if (!value || value <= 0) return ''
  if (value >= 60) {
    const hour = Math.floor(value / 60)
    const rest = value % 60
    return rest ? `${hour} 小时 ${rest} 分钟` : `${hour} 小时`
  }
  return `${value} 分钟`
}

function getGreeting() {
  const hour = new Date().getHours()
  if (hour < 6) return '夜深了'
  if (hour < 11) return '早上好'
  if (hour < 14) return '中午好'
  if (hour < 18) return '下午好'
  return '晚上好'
}

/**
 * 给云函数返回的列表项补充展示字段，避免在 WXML 中写复杂逻辑。
 */
function decorateRecipe(item) {
  if (!item) return null
  const cookTimeLabel = formatCookTime(item.cookTime)
  const difficulty = item.difficulty || ''
  let difficultyClass = ''
  if (difficulty === '简单') difficultyClass = 'easy'
  if (difficulty === '中等') difficultyClass = 'medium'
  if (difficulty === '困难') difficultyClass = 'hard'
  return {
    ...item,
    updatedLabel: formatRelativeTime(item.updatedAt),
    createdLabel: formatDateTime(item.createdAt),
    cookTimeLabel,
    difficultyLabel: difficulty,
    difficultyClass,
    ingredientCount: Number(item.ingredientCount) || 0,
    stepCount: Number(item.stepCount) || 0,
    categoryLabel: item.category || '未分类'
  }
}

module.exports = {
  toTimestamp,
  formatRelativeTime,
  formatDateTime,
  formatCookTime,
  getGreeting,
  decorateRecipe
}
