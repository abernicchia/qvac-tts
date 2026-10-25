# qvac-tts

Terminal app that clones a voice from a WAV recording and writes synthesized speech to a WAV file. It uses [QVAC Text-to-Speech](https://docs.qvac.tether.io/sdk/ai-capabilities/text-to-speech/) with Chatterbox. English is the default. Pass `--language` for the other Chatterbox languages, including Italian.

## Requirements

- Node.js 22.17 or newer
- Enough disk space for the Chatterbox models, downloaded on the first run
- A mono WAV of clean speech, at least 5 seconds (10–15 seconds clones best). On macOS you can easily record your voice using Voice Memos and reading this text "Remember the last time you watched the morning sun rise over a quiet street? The world was still sleeping, the air felt crisp, and everything felt possible." / "Fuori dalla finestra il cielo è di un azzurro intenso. Una tazza di caffè fumante è sul tavolo, mentre il profumo del pane fresco riempie tutta la stanza. È il momento perfetto per iniziare una nuova giornata con un sorriso." should be enough to generate about 15 seconds of audio. Then drag and drop the memo into a local folder to get a .m4a audio file and convert it into 24kHz 16bit WAV format using ffmpeg (brew install ffmpeg):
```bash
ffmpeg -i sample.m4a -ac 1 -ar 24000 -c:a pcm_s16le voice.wav
```


## Setup

```bash
npm install
```

## Usage

```bash
npm start -- --voice voice.wav --text "Hello from the cloned voice." --output hello.wav
npm start -- --voice voice.wav --language it --text "Ciao dalla voce clonata." --output ciao.wav
```

The same command is available as `node src/cli.js`. After `npm install`, `npx qvac-tts` works too.

```bash
node src/cli.js --voice voice.wav --text-file script.txt --output script.wav
node src/cli.js --voice voice.wav "Hello from the cloned voice."
echo "Hello from the cloned voice." | node src/cli.js --voice voice.wav --output hello.wav
```

`--language` sets the spoken language. The default is `en`, which uses the English model. Any other Chatterbox code (`it`, `es`, `fr`, `de`, and the rest listed by `--help`) uses the multilingual model. Japanese (`ja`) and Chinese (`zh`) also download a tokenizer on the first run.

`--play` plays the result with `ffplay` (part of ffmpeg). Add `--cpu` to skip Metal.

The path of the written WAV is printed on stdout. Status messages go to stderr.
