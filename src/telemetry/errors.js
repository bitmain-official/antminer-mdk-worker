'use strict'

const withDevice = require('../with-device')

module.exports = withDevice(async (device) => {
  const [warnings, summary] = await Promise.all([
    device.fetchDeviceData(device.getWarnings),
    device.fetchDeviceData(device.getSummary)
  ])
  const sectionErrors = summary.status_sections
    .filter((section) => section.status === 'e')
    .map((section) => ({
      code: `status.${section.type}`,
      name: `status.${section.type}`,
      message: section.msg || `status section ${section.type} reports an error (code ${section.code})`,
      cause: section.msg,
      suggestion: '',
      timestamp: ''
    }))
  return [...warnings, ...sectionErrors]
})
