/**
 * 图标生成脚本
 * 将 resources/icon.svg 转换为打包所需的 PNG 和 ICO 文件
 * 运行方式：node scripts/generate-icons.mjs
 */
import sharp from 'sharp'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const svgPath = path.join(root, 'resources', 'icon.svg')
const svgBuffer = fs.readFileSync(svgPath)

// 生成 512x512 PNG（electron-builder 主图标）
await sharp(svgBuffer)
  .resize(512, 512)
  .png()
  .toFile(path.join(root, 'resources', 'icon.png'))

console.log('✅ icon.png (512x512) 生成成功')

// 生成 256x256 PNG（ICO 的基础层）
const ico256 = await sharp(svgBuffer).resize(256, 256).png().toBuffer()

// 生成 32x32 PNG（托盘图标）
await sharp(svgBuffer)
  .resize(32, 32)
  .png()
  .toFile(path.join(root, 'resources', 'tray-icon.png'))

console.log('✅ tray-icon.png (32x32) 生成成功')

// 手动拼接 ICO 文件（包含 16/32/48/256 四个尺寸）
// ICO 格式说明：文件头 + 目录表 + 图像数据
async function buildIco() {
  const sizes = [16, 32, 48, 256]
  const images = await Promise.all(
    sizes.map(s => sharp(svgBuffer).resize(s, s).png().toBuffer())
  )

  // ICO 文件头（6字节）
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)          // 保留，必须为0
  header.writeUInt16LE(1, 2)          // 类型：1=ICO
  header.writeUInt16LE(sizes.length, 4) // 图像数量

  // 每个图像目录条目（16字节）
  const dirEntrySize = 16
  const dataOffset = 6 + dirEntrySize * sizes.length
  const dirs = []
  const datas = []
  let offset = dataOffset

  for (let i = 0; i < sizes.length; i++) {
    const s = sizes[i]
    const data = images[i]
    const dir = Buffer.alloc(dirEntrySize)
    dir.writeUInt8(s === 256 ? 0 : s, 0)   // 宽度（256用0表示）
    dir.writeUInt8(s === 256 ? 0 : s, 1)   // 高度
    dir.writeUInt8(0, 2)                    // 色板数量（0=无限制）
    dir.writeUInt8(0, 3)                    // 保留
    dir.writeUInt16LE(1, 4)                 // 色平面数
    dir.writeUInt16LE(32, 6)                // 位深度
    dir.writeUInt32LE(data.length, 8)       // 数据大小
    dir.writeUInt32LE(offset, 12)           // 数据偏移
    dirs.push(dir)
    datas.push(data)
    offset += data.length
  }

  const icoBuffer = Buffer.concat([header, ...dirs, ...datas])
  fs.writeFileSync(path.join(root, 'resources', 'icon.ico'), icoBuffer)
  console.log('✅ icon.ico (16/32/48/256px) 生成成功')
}

await buildIco()
console.log('\n🎉 所有图标文件已生成到 resources/ 目录')
