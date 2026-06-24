import { createReadStream } from 'node:fs'

export function parseByteRangeHeader(rangeHeader, totalSizeBytes) {
  if (typeof rangeHeader !== 'string' || !rangeHeader.trim()) {
    return null
  }

  if (!rangeHeader.startsWith('bytes=')) {
    return { invalid: true }
  }

  if (!Number.isFinite(totalSizeBytes) || totalSizeBytes <= 0) {
    return { invalid: true }
  }

  const rawRanges = rangeHeader.slice('bytes='.length).split(',').map((value) => value.trim()).filter(Boolean)
  if (rawRanges.length !== 1) {
    return { invalid: true }
  }

  const [startPart = '', endPart = ''] = rawRanges[0].split('-', 2)
  if (!startPart && !endPart) {
    return { invalid: true }
  }

  if (!startPart) {
    const suffixLength = Number.parseInt(endPart, 10)
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
      return { invalid: true }
    }
    const clampedLength = Math.min(suffixLength, totalSizeBytes)
    return {
      start: totalSizeBytes - clampedLength,
      end: totalSizeBytes - 1,
    }
  }

  const start = Number.parseInt(startPart, 10)
  const end = endPart ? Number.parseInt(endPart, 10) : totalSizeBytes - 1
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= totalSizeBytes) {
    return { invalid: true }
  }

  return {
    start,
    end: Math.min(end, totalSizeBytes - 1),
  }
}

function sendRangeNotSatisfiable(res, totalSizeBytes, options = {}) {
  res.statusCode = 416
  res.setHeader('Accept-Ranges', 'bytes')
  res.setHeader('Content-Range', `bytes */${Math.max(0, totalSizeBytes)}`)
  res.setHeader('Cache-Control', options.cacheControl || 'no-store')
  if (typeof options.lastModifiedMs === 'number' && options.lastModifiedMs > 0) {
    res.setHeader('Last-Modified', new Date(options.lastModifiedMs).toUTCString())
  }
  res.end()
}

export async function sendFileStreamResponse(
  req,
  res,
  absolutePath,
  contentType,
  totalSizeBytes,
  options = {},
) {
  const range = parseByteRangeHeader(req.headers.range, totalSizeBytes)
  if (range && range.invalid === true) {
    sendRangeNotSatisfiable(res, totalSizeBytes, options)
    return
  }

  const start = range ? range.start : 0
  const end = range ? range.end : Math.max(totalSizeBytes - 1, 0)
  const contentLength = totalSizeBytes === 0 ? 0 : Math.max(0, end - start + 1)
  const statusCode = range ? 206 : 200

  res.statusCode = statusCode
  res.setHeader('Content-Type', contentType)
  res.setHeader('Accept-Ranges', 'bytes')
  res.setHeader('Content-Length', String(contentLength))
  res.setHeader('Cache-Control', options.cacheControl || 'no-store')
  if (typeof options.lastModifiedMs === 'number' && options.lastModifiedMs > 0) {
    res.setHeader('Last-Modified', new Date(options.lastModifiedMs).toUTCString())
  }
  if (range) {
    res.setHeader('Content-Range', `bytes ${start}-${end}/${totalSizeBytes}`)
  }

  if (totalSizeBytes === 0) {
    res.end()
    return
  }

  const stream = createReadStream(absolutePath, { start, end })
  await new Promise((resolve, reject) => {
    let settled = false

    const cleanup = () => {
      stream.off('error', handleError)
      res.off('error', handleError)
      res.off('close', handleClose)
      res.off('finish', handleFinish)
    }

    const settle = (callback) => (value) => {
      if (settled) return
      settled = true
      cleanup()
      callback(value)
    }

    const handleError = settle(reject)
    const handleFinish = settle(resolve)
    const handleClose = settle(() => {
      stream.destroy()
      resolve()
    })

    stream.on('error', handleError)
    res.on('error', handleError)
    res.on('close', handleClose)
    res.on('finish', handleFinish)
    stream.pipe(res)
  })
}
