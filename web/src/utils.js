// 通用工具

// 图片校验：仅允许常见位图格式（拒绝 SVG 等可执行内容），大小上限 500KB
// （data URL 约膨胀 1.37 倍，500KB 图片 ≈ 690KB 字符串，低于后端 700000 上限）
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
const MAX_IMAGE_SIZE = 500 * 1024

export function checkImage(file) {
  if (!file) return { ok: false, error: '请选择图片文件' }
  if (!IMAGE_TYPES.includes(file.type)) return { ok: false, error: '仅支持 PNG / JPG / WebP / GIF 图片' }
  if (file.size > MAX_IMAGE_SIZE) return { ok: false, error: '图片最大 500KB' }
  return { ok: true }
}

export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const rd = new FileReader()
    rd.onload = () => resolve(rd.result)
    rd.onerror = reject
    rd.readAsDataURL(file)
  })
}
