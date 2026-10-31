# qvac-tts

Terminal app that writes synthesized speech to a WAV file. It uses a local model [QVAC Text-to-Speech](https://docs.qvac.tether.io/sdk/ai-capabilities/text-to-speech/) with Chatterbox. Omit `--voice` to use the model's built-in default voice, or pass a WAV recording to clone one. English is the default. Pass `--language` for the other Chatterbox languages, including Italian.

## Requirements

- Node.js 22.17 or newer
- Enough disk space for the Chatterbox models, downloaded on the first run
- To clone a voice: a mono WAV of clean speech, at least 5 seconds (10–15 seconds clones best). This is not required for the default voice.

### Recording a sample on macOS

1. Open Voice Memos and read one of these scripts. Either is long enough for about 15 seconds of audio.

   **English**

   > Remember the last time you watched the morning sun rise over a quiet street? The world was still sleeping, the air felt crisp, and everything felt possible.

   **Italian**

   > Fuori dalla finestra il cielo è di un azzurro intenso. Una tazza di caffè fumante è sul tavolo, mentre il profumo del pane fresco riempie tutta la stanza. È il momento perfetto per iniziare una nuova giornata con un sorriso.

2. Drag the memo into a folder to save it as a `.m4a` file.
3. Convert it to 24 kHz, 16-bit mono WAV with ffmpeg (`brew install ffmpeg`):

```bash
ffmpeg -i sample.m4a -ac 1 -ar 24000 -c:a pcm_s16le voice.wav
```


## Setup

```bash
npm install
```

## Usage

```bash
npm start -- --text "Hello from the default voice." --output hello.wav
npm start -- --voice voice.wav --text "Hello from the cloned voice." --output cloned.wav
npm start -- --language it --text "Ciao dalla voce predefinita." --output ciao.wav
```

The same command is available as `node src/cli.js`. After `npm install`, `npx qvac-tts` works too.

```bash
node src/cli.js --text-file script.txt --output script.wav
node src/cli.js --voice voice.wav "Hello from the cloned voice."
echo "Hello from the default voice." | node src/cli.js --output hello.wav
```

`--language` sets the spoken language. The default is `en`, which uses the English model. Any other Chatterbox code (`it`, `es`, `fr`, `de`, and the rest listed by `--help`) uses the multilingual model. Japanese (`ja`) and Chinese (`zh`) also download a tokenizer on the first run.

`--play` plays the result with `ffplay` (part of ffmpeg). Add `--cpu` to skip Metal.

The path of the written WAV is printed on stdout. Status messages go to stderr.
