# Grandma Storyteller

A warm grandmother tells you any book, bit by bit, like a bedtime story. You hear a piece in German and the same piece retold in English, with a pencil sketch for every part. No AI runs inside the app and no API key is needed: you prepare the texts and picture prompts in your normal Claude and ChatGPT chats, and the app makes each step short.

The app is a plain static website in `docs/`. There is nothing to build.

## Put it online (GitHub Pages)

1. Merge this branch into `main`.
2. On GitHub: **Settings, Pages, Build and deployment, Deploy from a branch**. Choose `main` and the folder `/docs`. Save.
3. After a minute the app is at `https://<your-user>.github.io/Storyteller/`.

To try it on your computer first: `python3 -m http.server 8000 --directory docs`, then open `http://localhost:8000`.

## First evening

1. Open the app. Grandma is dozing. Tap, press space, or (once the microphone is allowed) say hello.
2. **Books, Load the Momo sample** gives you three short parts to try at once.
3. She greets you, says where you are, and asks which language begins. Answer by voice or with the buttons.

## Every week (the batch workflow)

Set once, under **Set once**: copy the Claude instruction into a Claude Project that holds your book, and the ChatGPT instruction into a ChatGPT Project.

Texts:

1. **Texts**: choose the sequence size and how many sequences. The app knows where you are and writes the request. Copy it.
2. Paste it into Claude. Claude answers with one `.md` file.
3. Drop that file into the app (or paste the answer as text) and press **Save to my journey**.

Pictures:

1. **Make pictures**: copy the request for the next prompts, paste it into Claude, give the answer file to the app.
2. The app shows one prompt at a time, with arrows and a copy button.
3. Paste the prompt into ChatGPT. One prompt, one picture.
4. Copy the picture in ChatGPT, press Ctrl+V in the app, press **Save**.
5. **Saved pictures** shows the saved pictures. Each can be replaced or deleted.

## Using it

| | Voice | Button or key |
|---|---|---|
| Go on | "and then?", "go on", "hmm", "weiter" | And then? / right arrow |
| Pause | "stop", "wait" | big round button / space |
| Last sentence again | "again", "noch einmal" | Sentence / left arrow |
| This part again | "from the start" | Part again |
| Slower German | "slower", "langsamer" | Slow German |
| Free chat | **"Teatime"** | Teatime |
| Back to the book | **"Storytime"** | Storytime |
| Speech cloud, texts, word meanings | | Cloud (C), Texts (T), Meanings |

In the read-along panel, tap a line to hear the story from there.

While she tells, the picture is the stage and Grandma sits small beside it; when she speaks to you, she comes forward. German words that are also written on the picture glow in the speech cloud. The room follows your clock (morning, afternoon, evening, night), and the level of the quiet room sounds is set with a slider in Settings (all the way left is off). Words you tap for their meaning go into your word jar: in the tea room, press **My words**. At the end of a chapter she shows all its pictures together.

Grandma breathes, blinks at uneven moments, looks at the picture, at her book and at you, and lifts her eyebrows on a question. Firelight flickers in the room and throws her shadow on the wall, and her cat sleeps on the armrest and looks up when you speak.

**Contents** (the "Part 3 of 18" chip at the top) lists every part under the book's chapters, with its picture and a short description once it has been told. Tap a part to hear it. **Last one** makes the current part the last for tonight: Grandma finishes it, says good night and dozes off.

## Where things are saved

Choose in **Settings**:

- **This browser only** (default): nothing to set up, one device.
- **Your GitHub repository**: computer and phone stay in step. Needs a fine-grained personal access token for one repository with "Contents: Read and write". The token stays in your browser. Files go to their own branch (`library`), so saving never triggers a rebuild of the website.
- **A folder on your computer**: Chrome or Edge on a computer only.

Layout: `journeys/<book>/journey.json`, `progress.json`, `seq/0001.json`, `img/0001.jpg`, `batches/<date>-texts-0001-0015.md`. The book file itself is only read in your browser and is never uploaded by the app.

## Research: options and picks

### 1. Voices

| Option | For | Against |
|---|---|---|
| Voices of the browser and device (Web Speech API) | Free, instant, no download, word-by-word timing on many devices | Quality depends on browser and device; no truly elderly voice |
| Neural voices running in the browser (Piper, Kokoro) | Same voice everywhere | 20 to 90 MB download, slow on phones; Kokoro has no German; none is elderly either |
| Audio rendered beforehand by a voice-cloning or voice-design model | The only free way to a real grandmother timbre | A GPU or long waits, a separate tool, and it breaks "no AI inside" |
| Unofficial Microsoft "Read aloud" endpoint | Very good voices on every device | Unofficial, breaks without notice, against its terms |
| Paid APIs (ElevenLabs and others) | Best grandmother voices | Not free, need a key |

**Pick: the browser and device voices, chosen by a built-in ranking, with slower speed and slightly lower pitch for English.** In Settings every voice can be auditioned.

- **Computer, best:** Microsoft Edge. German: "Seraphina", "Katja" or "Amala" (Online, Natural), native voices from Germany, female. English: "Sonia" or "Libby" (UK). These are the best free voices I know of.
- **Computer, Chrome:** "Google Deutsch" (native, female, clear but flat) and "Google UK English Female".
- **iPhone, iPad, Mac:** download an Enhanced or Premium voice in the system settings (German: Anna or Petra; English: Serena or Kate). The default compact voices sound robotic.
- **Android:** the Google voices, native German, decent.

**Optional neural voices.** In Settings, Voices, the English list also offers **Kokoro** and the German list **Supertonic 3**. Both run inside the browser, free and without a key, in a background worker so the page stays responsive. Each needs one large download. Lines are made ahead of time, and Grandma's mouth follows the real sound. If a voice cannot load, a browser voice speaks instead.

Honest limits: none of these is a real old woman's voice. The grandmother feeling comes from how the text is written, the slow pace and the pauses. I could not listen to any voice in my build environment (it has no audio and no voices), so the ranking rests on known reputation, not on my ears. Please audition them in Settings.

### 2. Switch words and speech recognition

| Option | For | Against |
|---|---|---|
| Browser speech recognition (Web Speech API) | Free, no key, good with clear speech | Chrome, Edge, Safari only (not Firefox); usually needs internet; weaker in noise |
| Offline keyword spotting in the browser (Vosk and similar) | Works offline, good for a few fixed words | About 40 MB download, heavy on phones |
| Commercial wake-word engines | Most robust in noise | Need an account and key |

**Pick: browser speech recognition, with buttons that always do the same.** Switch words: **"Teatime"** (story to free chat) and **"Storytime"** (back). Both are single English words with clear, different first syllables, they are rare in normal talk, and Claude is told never to write them in a story.

Honest answer on noise: in a quiet room with a headset it should be reliable. In a noisy room, or with loudspeakers, expect misses. With loudspeakers the microphone also hears Grandma, so while she speaks she accepts only "Teatime", "Storytime", stop, repeat and slower, and ignores anything that matches her own sentence. A soft "hmm" is often not recognised as a word, so while she waits, any sound you make counts as "go on". I could only test the command logic, not real microphones.

### 3. Pictures, labels and arrows

A free image API is not good enough for this: free models misspell German labels and arrows. ChatGPT's image maker writes text far better. Its free plan allows only a few pictures a day, which fits a weekly rhythm of 5 or 6 if spread over two or three days.

**Pick: ChatGPT, with a prompt recipe that removes the reasons arrows go wrong.** The style is a richly detailed ink-and-watercolour storybook scene, full of people doing things, with 12 to 24 German words on small cream tags. The Claude instruction makes every picture prompt name each label together with its object and its position, keep each tag right next to its object, use one short arrow whose tip touches it, and close with a "LABEL CHECK" list that maps every label to its object. The ChatGPT instruction fixes the look of the picture and the tags, and adds a "fix labels" reply for redrawing only the labels. A part that covers several pages becomes one continuous panorama, not a divided collage.

### 4. How a new book gets prepared

**Pick: the app reads the book in your browser** (PDF via pdf.js, or a text file), splits it into sentences with page numbers, and from then on knows your position. A request names each sequence by number, pages and its first and last words, so Claude cannot cut in the wrong place. For scanned PDFs without text the app falls back to page numbers. Optionally the request can carry the book text itself, which is the most reliable when Claude has trouble finding pages in a long book. Claude answers with one text file in a simple marked format; the app checks it and shows what it found before saving.

### 5. Can GitHub Pages do all of this?

**Yes.** Pages serves the app; saving goes from your browser straight to the GitHub API with your token, or into a local folder. No server of mine is involved. Two things to know: free Pages needs a public repository, and the saved texts and pictures are derived from a book, so **use a separate private repository for the library** (the token can point at any repository).

## What does not fit together

- **Free and a true grandmother voice.** Not available today. Suggestion: start with Edge voices; if the voice matters more than "free", a paid voice or a locally rendered cloned voice is the upgrade.
- **Free chat and no AI.** A real open conversation needs a model. The tea room therefore answers from what Claude prepared with each part (a recap, who is doing what, word meanings) plus a set of warm small-talk lines. For anything else she says so, and a button copies your question with the story so far, ready for Claude. Desktop Chrome's built-in on-device model can be switched on in Settings as an experiment (free, no key); I could not test it.
- **"Just start speaking" on first open.** Browsers do not let a page talk before one tap or key press. After that, voice works.
- **A public repository and a copyrighted book.** The Momo PDF currently sits in this repository. If the repository is public, please remove it; the app never needs it there.
- **Free ChatGPT and many pictures.** A few per day only.

## What I tested, and what I could not

Tested automatically in a real browser: the batch format, cutting the real Momo PDF into sequences, requests, importing, the alternating order, saving and resuming the place, repeat, read-along, word meanings from the batch, both rooms and the switch words, picture paste and the Images view, saving to GitHub (against a simulated GitHub API) and picking the journey up on a second device, and the phone layout.

Not tested: how the voices sound, real microphones, the local-folder option (it needs a real folder dialog), the real GitHub API with a real token, the online dictionary fallback, and Chrome's built-in AI.

Unit tests: `node --test tests/format.test.mjs`
