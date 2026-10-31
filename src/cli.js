#!/usr/bin/env node
import { mkdirSync, readFileSync, statSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { inspectWav, assertCloneableVoice, writeWav } from './wav.js'

const CHATTERBOX_SAMPLE_RATE = 24000
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const HELP = `qvac-tts — write synthesized speech to a WAV, optionally cloning a voice

Usage:
  qvac-tts --text <sentence> [--output <file.wav>]
  qvac-tts --voice <file.wav> --text <sentence> [--output <file.wav>]
  qvac-tts --voice <file.wav> --text-file <file.txt> [--output <file.wav>]
  qvac-tts <sentence> [--output <file.wav>]

Options:
  -v, --voice <file.wav>      Optional reference recording to clone. Mono WAV, at least
                              5 seconds of clean speech (10–15 seconds works best).
                              When omitted, the model's built-in default voice is used.
  -t, --text <sentence>       Text to speak.
  -f, --text-file <file>      Read the text to speak from a UTF-8 file.
  -o, --output <file.wav>     Output WAV. Default: tts-output.wav
  -l, --language <code>       Language of the spoken text. Default: en.
                              en uses the English model. Any other Chatterbox code uses
                              the multilingual model: es, fr, de, it, ja, pt, nl, pl, tr,
                              sv, da, fi, no, el, ms, sw, ar, ko, he, ru, zh, hi.
                              ja and zh also download a tokenizer on the first run.
      --cpu                   Run on CPU. The default uses the GPU (Metal on macOS,
                              Vulkan on Linux and Windows).
      --threads <n>           Worker threads. Default: 8
      --play                  Play the WAV with ffplay after saving it.
  -h, --help                  Show this help.

The first run downloads the Chatterbox models for the chosen language from the QVAC registry.
Text can also be piped on stdin when --text, --text-file, and extra arguments are omitted.
`

function selectChatterbox(language, sdk) {
  const code = language.toLowerCase()
  if (!sdk.TTS_CHATTERBOX_LANGUAGES.includes(code)) {
    throw new Error(
      `Unsupported language "${language}". Chatterbox languages: ${sdk.TTS_CHATTERBOX_LANGUAGES.join(', ')}.`
    )
  }

  if (code === 'en') {
    return {
      label: 'Chatterbox (English)',
      modelSrc: sdk.TTS_T3_TURBO_EN_CHATTERBOX_Q8_0,
      extraConfig: {
        language: 'en',
        s3genModelSrc: sdk.TTS_S3GEN_EN_CHATTERBOX.src
      }
    }
  }

  const extraConfig = {
    language: code,
    s3genModelSrc: sdk.TTS_S3GEN_MULTILINGUAL_CHATTERBOX_Q8_0.src
  }
  if (code === 'ja') extraConfig.mecabDictSrc = sdk.TTS_MECAB_IPADIC_CHATTERBOX.src
  if (code === 'zh') extraConfig.cangjieTsvSrc = sdk.TTS_CANGJIE_ZH_CHATTERBOX.src

  return {
    label: `Chatterbox (${code})`,
    modelSrc: sdk.TTS_T3_MULTILINGUAL_CHATTERBOX_Q8_0,
    extraConfig
  }
}

function fail(message) {
  console.error(`✖ ${message}`)
  process.exitCode = 1
}

function printHelp() {
  process.stdout.write(HELP)
}

function parseCli(argv) {
  try {
    return parseArgs({
      args: argv,
      options: {
        voice: { type: 'string', short: 'v' },
        text: { type: 'string', short: 't' },
        'text-file': { type: 'string', short: 'f' },
        output: { type: 'string', short: 'o', default: 'tts-output.wav' },
        language: { type: 'string', short: 'l', default: 'en' },
        cpu: { type: 'boolean', default: false },
        threads: { type: 'string', default: '8' },
        play: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false }
      },
      allowPositionals: true,
      strict: true
    })
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error))
    printHelp()
    return null
  }
}

function readVoice(voicePath) {
  let info
  try {
    info = statSync(voicePath)
  } catch {
    throw new Error(`Voice file not found: ${voicePath}`)
  }
  if (!info.isFile()) throw new Error(`Voice path is not a file: ${voicePath}`)
  return readFileSync(voicePath)
}

async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

async function resolveText(values, positionals) {
  const sources = [values.text, values['text-file'], positionals.length ? 'args' : undefined].filter(Boolean)
  if (sources.length > 1) {
    throw new Error('Pass the sentence with only one of --text, --text-file, or trailing arguments.')
  }
  if (values['text-file']) {
    const textPath = resolve(values['text-file'])
    try {
      return readFileSync(textPath, 'utf8')
    } catch {
      throw new Error(`Text file not found: ${textPath}`)
    }
  }
  if (values.text) return values.text
  if (positionals.length) return positionals.join(' ')
  if (process.stdin.isTTY) {
    throw new Error('Pass the sentence with --text, --text-file, trailing arguments, or stdin.')
  }
  return readStdin()
}

function reportDownload(progress) {
  if (typeof progress.percentage !== 'number') return
  const mb = (n) => (Number(n) / 1e6).toFixed(1)
  const line = `▸ Downloading ${progress.percentage.toFixed(0)}% (${mb(progress.downloaded)}/${mb(progress.total)} MB)`
  process.stderr.write(process.stderr.isTTY ? `\r${line}` : `${line}\n`)
  if (progress.percentage >= 100) process.stderr.write('\n')
}

function playWav(filename) {
  const result = spawnSync('ffplay', ['-hide_banner', '-loglevel', 'error', '-autoexit', '-nodisp', filename], {
    stdio: 'inherit'
  })
  if (result.error) {
    const missing = result.error.code === 'ENOENT'
    throw new Error(missing ? 'ffplay was not found. Install ffmpeg, then retry with --play.' : result.error.message)
  }
  if (result.status !== 0) {
    throw new Error(`ffplay exited with code ${result.status}`)
  }
}

async function main() {
  const parsed = parseCli(process.argv.slice(2))
  if (!parsed || process.exitCode) return
  const { values, positionals } = parsed
  if (values.help) {
    printHelp()
    return
  }

  const threads = Number(values.threads)
  if (!Number.isInteger(threads) || threads < 1) {
    fail('--threads must be a positive integer.')
    return
  }

  // Without --voice, Chatterbox keeps the voice baked into the model.
  const voicePath = values.voice ? resolve(values.voice) : undefined
  const outputPath = resolve(values.output)
  let text
  try {
    if (voicePath) {
      const voice = inspectWav(readVoice(voicePath))
      assertCloneableVoice(voice)
      console.error(
        `▸ Voice: ${voicePath} (${voice.durationSeconds.toFixed(1)}s, ${voice.sampleRate} Hz, ${voice.bits}-bit mono)`
      )
    } else {
      console.error('▸ Voice: default (built into the model)')
    }
    text = (await resolveText(values, positionals)).trim()
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error))
    return
  }
  if (!text) {
    fail('The text to speak is empty.')
    return
  }

  if (!process.env.QVAC_CONFIG_PATH) {
    process.env.QVAC_CONFIG_PATH = join(packageRoot, 'qvac.config.json')
  }

  let loadModel
  let textToSpeech
  let unloadModel
  let cancel
  let close
  let sdk
  try {
    sdk = await import('@qvac/sdk')
    ;({ loadModel, textToSpeech, unloadModel, cancel, close } = sdk)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    fail(
      message.includes("Cannot find package '@qvac/sdk'")
        ? 'Cannot find @qvac/sdk. From this project directory, run npm install.'
        : message
    )
    return
  }

  let modelId
  let requestId
  let interrupted = false

  const stop = async (signalExitCode) => {
    if (interrupted) return
    interrupted = true
    console.error('\n▸ Stopping synthesis...')
    try {
      if (requestId) await cancel({ requestId })
    } catch {
      // The run may already have finished.
    }
    try {
      if (modelId) await unloadModel({ modelId })
    } catch {
      // Unload is best-effort during interruption.
    }
    try {
      await close()
    } catch {
      // Worker shutdown is best-effort during interruption.
    }
    process.exit(signalExitCode)
  }
  process.on('SIGINT', () => {
    void stop(130)
  })
  process.on('SIGTERM', () => {
    void stop(143)
  })

  try {
    const selection = selectChatterbox(values.language, sdk)
    console.error(`▸ Loading ${selection.label}. The first run downloads the model.`)
    modelId = await loadModel({
      modelSrc: selection.modelSrc,
      modelConfig: {
        ttsEngine: 'chatterbox',
        // Omit the reference recording so the model uses its built-in voice.
        ...(voicePath ? { referenceAudioSrc: voicePath } : {}),
        streamChunkTokens: 25,
        streamFirstChunkTokens: 10,
        cfmSteps: 1,
        threads,
        useGPU: !values.cpu,
        ...selection.extraConfig
      },
      onProgress: reportDownload
    })
    console.error(`▸ Model loaded: ${modelId}`)
    console.error('▸ Synthesizing speech...')

    const started = Date.now()
    const result = textToSpeech({
      modelId,
      text,
      inputType: 'text',
      stream: false
    })
    requestId = result.requestId

    const samples = await result.buffer
    const sampleRate = (await result.sampleRate) ?? CHATTERBOX_SAMPLE_RATE
    const stats = await result.stats
    const stopReason = await result.stopReason
    if (interrupted || stopReason === 'cancelled') return
    if (!(await result.done)) throw new Error('Synthesis did not complete.')

    mkdirSync(dirname(outputPath), { recursive: true })
    writeWav(samples, sampleRate, outputPath)
    const seconds = samples.length / sampleRate
    const elapsed = ((Date.now() - started) / 1000).toFixed(1)
    const factor = typeof stats?.realTimeFactor === 'number' ? `, realtime factor ${stats.realTimeFactor.toFixed(2)}` : ''
    console.error(`▸ Saved ${outputPath}: ${sampleRate} Hz, ${seconds.toFixed(2)}s of audio in ${elapsed}s${factor}`)
    process.stdout.write(`${outputPath}\n`)

    if (values.play) {
      console.error('▸ Playing audio...')
      playWav(outputPath)
    }
  } catch (error) {
    if (!interrupted) fail(error instanceof Error ? error.message : String(error))
  } finally {
    if (!interrupted && modelId) {
      try {
        await unloadModel({ modelId })
        console.error('▸ Model unloaded')
      } catch (error) {
        console.error('✖ Failed to unload the model:', error instanceof Error ? error.message : error)
        process.exitCode = 1
      }
    }
    if (!interrupted) {
      try {
        await close()
      } catch (error) {
        console.error('✖ Failed to close the SDK:', error instanceof Error ? error.message : error)
        process.exitCode = 1
      }
    }
  }
}

await main()
