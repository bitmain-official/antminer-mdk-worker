'use strict'

const test = require('brittle')
const zlib = require('node:zlib')
const {
  HEADER_SIZE,
  ITEM_SIZE,
  isCombinedContainer,
  parseContainerItems,
  selectContainerImage
} = require('../../lib/utils/firmware-container')

function writeU32 (buf, offset, value) {
  buf.writeUInt32LE(value >>> 0, offset)
}

function buildItem (fields, dataOffset, dataSize) {
  const item = Buffer.alloc(ITEM_SIZE)
  const put = (offset, str, lenOffset) => {
    item[lenOffset] = Math.min(Buffer.byteLength(str), 64)
    item.write(str, offset, 'latin1')
  }
  put(4, fields.name, 0)
  put(68, fields.chipModel, 1)
  put(100, fields.ctrlBoardModel, 2)
  put(132, fields.minerModel, 3)
  writeU32(item, 164, dataOffset)
  writeU32(item, 168, dataSize)
  return item
}

// header + two item descriptors + two padded images
function buildContainer (items, images) {
  const itemSize = ITEM_SIZE
  const dataOffset = HEADER_SIZE + items.length * itemSize
  let cursor = dataOffset
  const descriptors = items.map((fields, i) => {
    const image = images[i]
    const descriptor = buildItem(fields, cursor, image.length)
    cursor += image.length
    return descriptor
  })
  const body = Buffer.concat([...descriptors, ...images])
  const header = Buffer.alloc(HEADER_SIZE)
  writeU32(header, 8, HEADER_SIZE) // hdrSize
  writeU32(header, 12, items.length)
  writeU32(header, 16, itemSize)
  writeU32(header, 20, dataOffset)
  const container = Buffer.concat([header, body])
  // ground truth: CRC32 over the whole file with the stored-CRC field zeroed
  const copy = Buffer.from(container)
  copy.fill(0, 24, 28)
  writeU32(container, 24, zlib.crc32(copy))
  return container
}

const FIELDS_A = {
  name: 'S21_imgA',
  chipModel: 'chipA',
  ctrlBoardModel: 'AMLCtrl_A3HB70XXX',
  minerModel: 'S21'
}
const FIELDS_B = {
  name: 'S21pro_imgB',
  chipModel: 'chipB',
  ctrlBoardModel: 'AMLCtrl_A3HB707XX',
  minerModel: 'S21pro'
}

test('container - detects a valid N-in-1 container and parses its items', (t) => {
  const container = buildContainer(
    [FIELDS_A, FIELDS_B],
    [Buffer.alloc(1024, 0xAA), Buffer.alloc(512, 0xBB)]
  )
  t.is(isCombinedContainer(container), true)
  const items = parseContainerItems(container)
  t.is(items.length, 2)
  t.alike(items[0], { ...FIELDS_A, dataOffset: HEADER_SIZE + 2 * ITEM_SIZE, dataSize: 1024 })
  t.alike(items[1], { ...FIELDS_B, dataOffset: HEADER_SIZE + 2 * ITEM_SIZE + 1024, dataSize: 512 })
})

test('container - a plain firmware image is not detected as a container', (t) => {
  const plain = Buffer.alloc(32 * 1024, 0x11)
  t.is(isCombinedContainer(plain), false)
  // zeroed CRC field alone means "not a container"
  const truncated = containerWithZeroCrc()
  t.is(isCombinedContainer(truncated), false)

  function containerWithZeroCrc () {
    const container = buildContainer([FIELDS_A], [Buffer.alloc(64)])
    writeU32(container, 24, 0)
    return container
  }
})

test('container - a corrupted CRC does not pass as a container', (t) => {
  const container = buildContainer([FIELDS_A], [Buffer.alloc(64)])
  container[40] ^= 0xFF
  t.is(isCombinedContainer(container), false)
})

test('container - oversized item table or out-of-range image returns null', (t) => {
  const container = buildContainer([FIELDS_A], [Buffer.alloc(64)])
  // itemCount beyond the buffer
  writeU32(container, 12, 64)
  t.is(parseContainerItems(container), null)

  const badOffset = buildContainer([FIELDS_A], [Buffer.alloc(64)])
  const itemBase = HEADER_SIZE
  writeU32(badOffset, itemBase + 164, 1 << 30) // dataOffset far past EOF
  t.is(parseContainerItems(badOffset), null)
})

test('container - selection matches product type and control board subtype', (t) => {
  const items = parseContainerItems(buildContainer(
    [FIELDS_A, FIELDS_B],
    [Buffer.alloc(16, 0xAA), Buffer.alloc(16, 0xBB)]
  ))
  const a = selectContainerImage(items, 'S21', 'AMLCtrl_A3HB70XXX')
  t.is(a.name, 'S21_imgA')
  const b = selectContainerImage(items, 'S21pro', 'AMLCtrl_A3HB707XX')
  t.is(b.name, 'S21pro_imgB')
  t.is(selectContainerImage(items, 'S21', 'unknown-board'), null)
  t.is(selectContainerImage(items, 'S19', 'AMLCtrl_A3HB70XXX'), null)
})

test('container - BHB42XXX devices accept any miner model', (t) => {
  const items = parseContainerItems(buildContainer(
    [FIELDS_A, FIELDS_B],
    [Buffer.alloc(16, 0xAA), Buffer.alloc(16, 0xBB)]
  ))
  const match = selectContainerImage(items, 'Antminer BHB42XXX', 'AMLCtrl_A3HB707XX')
  t.is(match.name, 'S21pro_imgB')
})
