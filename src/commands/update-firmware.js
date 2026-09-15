'use strict'

const commandResult = require('./command-result')
const { decodeFirmwarePayload } = require('../../lib/utils/firmware-payload')
const { isCombinedContainer, parseContainerItems, selectContainerImage } = require('../../lib/utils/firmware-container')
const withDevice = require('../with-device')

module.exports = withDevice(async (device, params) => {
  const source = decodeFirmwarePayload(params?.firmware, device.conf?.maxFirmwareSize)

  // N-in-1 containers bundle one image per control board: only the slice for
  // this device's board may be flashed. Plain images upload whole.
  let image = source
  if (isCombinedContainer(source.content)) {
    const items = parseContainerItems(source.content)
    const version = await device.fetchDeviceData(device.getVersion)
    const item = selectContainerImage(items, version.productType, version.subtype)
    if (!item) throw new Error('ERR_FIRMWARE_NO_MATCHING_IMAGE')
    image = {
      content: source.content.subarray(item.dataOffset, item.dataOffset + item.dataSize),
      // item names carry the container's extension (e.g. '...S21++).bmu');
      // replace it instead of appending a second one
      filename: `${(item.name || 'firmware').replace(/\.[^.]+$/, '')}.bin`
    }
  }

  const result = commandResult(await device.updateFirmware(image.content, image.filename))
  return {
    ...result,
    filename: source.filename,
    sourceSize: source.size,
    sourceSha256: source.sha256
  }
})
