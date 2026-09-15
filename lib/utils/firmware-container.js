'use strict'

const zlib = require('node:zlib')

// Bitmain "N-in-1" firmware containers bundle one image per control-board
// type. Layout: 36-byte header, then a table of fixed-size item descriptors,
// then the image data. All integers are little-endian u32.
//
//   header: magic(4) version(4) hdrSize(4) itemCount(4) itemSize(4)
//           dataOffset(4) crc32(4) reserve(8)
//   item:   nameLen(1) chipModelLen(1) ctrlBoardModelLen(1) minerModelLen(1)
//           name(64) chipModel(32) ctrlBoardModel(32) minerModel(32)
//           dataOffset(4) dataSize(4)
//
// A container carries a whole-file CRC32 at header bytes 24-28, computed over
// the entire file with those four bytes zeroed (not skipped); plain
// single-board images have no such CRC. Detection mirrors the stock web UI
// (update.js checkHeader).
const HEADER_SIZE = 36
const ITEM_SIZE = 172
const ZERO_FOUR = Buffer.alloc(4)

function readFixedString (buf, start, len) {
  const count = Math.min(len, buf.length - start)
  let out = ''
  for (let i = 0; i < count; i++) out += String.fromCharCode(buf[start + i])
  return out
}

function isCombinedContainer (content) {
  if (!Buffer.isBuffer(content) || content.length < HEADER_SIZE) return false
  const stored = content.readUInt32LE(24)
  if (stored === 0) return false
  const crc = zlib.crc32(content.subarray(28),
    zlib.crc32(ZERO_FOUR, zlib.crc32(content.subarray(0, 24))))
  return crc === stored && crc !== 0
}

// Returns the item descriptors, or null when the table does not fit the buffer.
function parseContainerItems (content) {
  if (!Buffer.isBuffer(content) || content.length < HEADER_SIZE) return null
  const itemCount = content.readUInt32LE(12)
  const itemSize = content.readUInt32LE(16)
  if (itemCount === 0 || itemCount > 64 || itemSize < ITEM_SIZE) return null
  if (HEADER_SIZE + itemCount * itemSize > content.length) return null

  const items = []
  for (let i = 0; i < itemCount; i++) {
    const base = HEADER_SIZE + i * itemSize
    const item = content.subarray(base, base + itemSize)
    const dataOffset = item.readUInt32LE(164)
    const dataSize = item.readUInt32LE(168)
    if (dataOffset + dataSize > content.length) return null
    items.push({
      name: readFixedString(item, 4, item[0]),
      chipModel: readFixedString(item, 68, item[1]),
      ctrlBoardModel: readFixedString(item, 100, item[2]),
      minerModel: readFixedString(item, 132, item[3]),
      dataOffset,
      dataSize
    })
  }
  return items
}

// Mirrors the stock web UI: match the item whose MinerModel equals the device
// product type (an "Antminer BHB42XXX" device accepts any model) and whose
// CtrlBoardModel equals the device subtype.
function selectContainerImage (items, productType, subtype) {
  if (!Array.isArray(items) || !productType) return null
  const wildcard = productType === 'Antminer BHB42XXX'
  return items.find((item) =>
    (wildcard || item.minerModel === productType) && item.ctrlBoardModel === subtype
  ) || null
}

module.exports = { HEADER_SIZE, ITEM_SIZE, isCombinedContainer, parseContainerItems, selectContainerImage }
