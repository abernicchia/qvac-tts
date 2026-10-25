import { writeFileSync } from 'node:fs'

const PCM_FORMAT = 1
const FLOAT_FORMAT = 3
const EXTENSIBLE_FORMAT = 0xfffe

/**
 * Read a WAV header and return the layout Chatterbox needs for voice cloning.
 * Chatterbox clones from a mono recording of at least 5 seconds.
 */
export function inspectWav(buffer) {
  if (buffer.length < 12 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Voice file must be a RIFF WAV.')
  }

  let format = 0
  let channels = 0
  let sampleRate = 0
  let bits = 0
  let blockAlign = 0
  let dataBytes = 0

  for (let offset = 12; offset + 8 <= buffer.length;) {
    const id = buffer.toString('ascii', offset, offset + 4)
    const size = buffer.readUInt32LE(offset + 4)
    const start = offset + 8
    if (start + size > buffer.length) {
      throw new Error('Voice WAV is truncated.')
    }

    if (id === 'fmt ') {
      if (size < 16) throw new Error('Voice WAV has an invalid format chunk.')
      format = buffer.readUInt16LE(start)
      channels = buffer.readUInt16LE(start + 2)
      sampleRate = buffer.readUInt32LE(start + 4)
      blockAlign = buffer.readUInt16LE(start + 12)
      bits = buffer.readUInt16LE(start + 14)
      if (format === EXTENSIBLE_FORMAT) {
        if (size < 40) throw new Error('Voice WAV has an incomplete extensible format chunk.')
        format = buffer.readUInt16LE(start + 24)
      }
    } else if (id === 'data') {
      dataBytes = size
    }

    offset = start + size + (size % 2)
  }

  if (!dataBytes || !sampleRate || !channels || !bits) {
    throw new Error('Voice WAV is missing audio data or format information.')
  }
  if (format !== PCM_FORMAT && format !== FLOAT_FORMAT) {
    throw new Error('Voice WAV must be PCM or IEEE float. Compressed formats are not supported.')
  }
  if (sampleRate < 8000 || sampleRate > 192000) {
    throw new Error('Voice WAV sample rate must be between 8000 and 192000 Hz.')
  }
  if (channels !== 1) {
    throw new Error('Voice WAV must be mono. Chatterbox clones from a single channel.')
  }
  if (blockAlign && dataBytes % blockAlign !== 0) {
    throw new Error('Voice WAV audio data does not end on a sample boundary.')
  }

  const bytesPerSample = bits / 8
  const durationSeconds = dataBytes / (channels * bytesPerSample * sampleRate)
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error('Voice WAV contains no audio.')
  }

  return { channels, sampleRate, bits, durationSeconds }
}

export function assertCloneableVoice(info) {
  if (info.durationSeconds < 5) {
    throw new Error(
      `Voice WAV is ${info.durationSeconds.toFixed(1)}s. Chatterbox needs at least 5 seconds of clean speech; 10–15 seconds clones most reliably.`
    )
  }
}

export function createWavHeader(dataLength, sampleRate) {
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + dataLength, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(dataLength, 40)
  return header
}

export function int16ArrayToBuffer(samples) {
  const buffer = Buffer.alloc(samples.length * 2)
  for (let i = 0; i < samples.length; i++) {
    const value = Math.max(-32768, Math.min(32767, Math.round(samples[i] ?? 0)))
    buffer.writeInt16LE(value, i * 2)
  }
  return buffer
}

export function writeWav(samples, sampleRate, filename) {
  if (!samples.length || samples.some((sample) => !Number.isFinite(sample))) {
    throw new Error('The model returned no usable audio.')
  }
  const audioData = int16ArrayToBuffer(samples)
  const wavFile = Buffer.concat([createWavHeader(audioData.length, sampleRate), audioData])
  writeFileSync(filename, wavFile)
}
