const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')

const size = 256
const pixels = Buffer.alloc(size * (1 + size * 4))

function insideRoundedSquare(x, y) {
  const edge = 12
  const radius = 64
  const nearestX = Math.max(edge + radius, Math.min(size - edge - radius, x))
  const nearestY = Math.max(edge + radius, Math.min(size - edge - radius, y))
  return Math.hypot(x - nearestX, y - nearestY) <= radius
}

for (let y = 0; y < size; y += 1) {
  const row = y * (1 + size * 4)
  pixels[row] = 0
  for (let x = 0; x < size; x += 1) {
    const offset = row + 1 + x * 4
    if (!insideRoundedSquare(x, y)) continue

    const gradient = (x + y) / (size * 2)
    pixels[offset] = Math.round(255)
    pixels[offset + 1] = Math.round(138 + (95 - 138) * gradient)
    pixels[offset + 2] = Math.round(128 + (115 - 128) * gradient)
    pixels[offset + 3] = 255

    const onWave = [98, 138, 178].some((baseline) => {
      if (x < 56 || x > 220) return false
      const waveY = baseline + Math.sin(((x - 56) / 44) * Math.PI) * 9
      return Math.abs(y - waveY) <= 8
    })
    if (onWave) {
      pixels[offset] = 8
      pixels[offset + 1] = 18
      pixels[offset + 2] = 31
    }
  }
}

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  }
  return value >>> 0
})

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii')
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])))
  return Buffer.concat([length, typeBuffer, data, checksum])
}

const header = Buffer.alloc(13)
header.writeUInt32BE(size, 0)
header.writeUInt32BE(size, 4)
header[8] = 8
header[9] = 6

const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', header),
  chunk('IDAT', zlib.deflateSync(pixels, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
])

const icoHeader = Buffer.alloc(22)
icoHeader.writeUInt16LE(0, 0)
icoHeader.writeUInt16LE(1, 2)
icoHeader.writeUInt16LE(1, 4)
icoHeader[6] = 0
icoHeader[7] = 0
icoHeader[8] = 0
icoHeader[9] = 0
icoHeader.writeUInt16LE(1, 10)
icoHeader.writeUInt16LE(32, 12)
icoHeader.writeUInt32LE(png.length, 14)
icoHeader.writeUInt32LE(22, 18)

const assets = path.join(__dirname, '..', 'assets')
fs.writeFileSync(path.join(assets, 'icon.png'), png)
fs.writeFileSync(path.join(assets, 'icon.ico'), Buffer.concat([icoHeader, png]))
console.log(`Ícones gerados (${png.length} bytes PNG).`)
