# Pitch Studio

**English** | [简体中文](README.zh-CN.md)

A local-first voice practice tool for the web and Android, with real-time pitch tracking, audio visualizations, recording, and an 88-key reference piano.

Hold a note, see how it moves, and compare it with a piano reference. Explore the frequencies in your voice, review a recording, or save a session to pick up where you left off. Audio is processed on your device, with no account, backend, or cloud audio service required.

The web app uses React, TypeScript, Vite, Web Audio, and Canvas 2D. The independent [native Android app](android/README.md) uses Kotlin and Jetpack Compose, runs offline on Android 10+, and exchanges `.pitchsession` files with the web app. Both interfaces and their documentation are available in English and Simplified Chinese.

Use the language selector in the web header or the language icon in the Android toolbar to switch between **English** and **简体中文**. English is the default; your choice is saved on the device. Switching updates the interface and chart exports immediately while keeping the current recording, playback position, and display settings.

## What you can do

- **Practice your pitch.** See the detected note, frequency, cents offset, and input level. The pitch trace follows your voice across a two-octave viewport.
- **Explore your sound.** Switch between a frequency spectrum, a scrolling spectrogram, and a waveform with a separate millisecond detail view.
- **Sing along with a piano.** Play any of 88 keys, from A0 to C8. Your target note and detected note are highlighted separately.
- **Record and review.** Capture up to 30 minutes, browse the shared timeline, and seek through a recording by clicking a time-based chart.
- **Keep your work.** Export WAV audio, PNG charts, or a complete session that can be reopened on either platform.

## Run the web app

Install Node.js 22.12 or later, then run these commands from the repository root:

```sh
npm ci
npm run dev
```

Open <http://127.0.0.1:5173/>. On Windows, you can also double-click `Start-Pitch-Studio.cmd`. The development server uses port 5173 and does not silently switch ports if it is occupied.

1. Choose **Start microphone** for live analysis without recording audio, or **Start recording** to begin a new recording at `00:00`.
2. Allow microphone access, then speak or hold a note. Switch views to inspect your sound.
3. Play a piano key to set a target and sing along. Headphones keep the reference sound out of the microphone.
4. Choose **Stop microphone** to end capture and release the device. Results remain available for review and export.

**Open session** loads a `.pitchsession` without microphone access. Before replacing an unsaved session, the app offers **Save and continue**, **Discard and continue**, or **Cancel**. Save a complete session before refreshing or closing the page; the web app does not automatically store sessions in a browser database.

To build and preview the production bundle:

```sh
npm run build
npm run preview
```

The preview runs at <http://127.0.0.1:4173/>. You can serve `dist/` from an HTTPS static host; include `capture-worklet.js` and the `piano/` sample directory. Microphone access requires localhost or HTTPS. A plain HTTP address on your local network generally will not work.

## Timeline, playback, and exports

The pitch trace, spectrogram, and continuous waveform overview share a time range. Their horizontal axis shows `mm:ss` from the start of the session.

- The default window is 30 seconds. Choose 10 seconds, 1 minute, 5 minutes, or the full session instead.
- Charts fill from left to right, then scroll. Drag the waveform navigator, use its slider, or scroll horizontally to browse history. **Go live** resumes automatic time following.
- **Freeze display** pauses the charts while capture and analysis continue. After capture stops, the audio player supports play, pause, and seeking. Clicking a time-based chart moves the shared yellow playback cursor. Historical audio cannot play during capture.
- The waveform view includes a continuous amplitude overview and a 5/10/20/50 ms detail view with 1×/2×/4×/8× visual zoom. The detail view shows the latest captured snapshot, not the playback position; hover values report the original sample amplitude.

| Export           | Contents                                                                                                                                                                                                                           |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Download WAV** | 48 kHz, mono, signed 16-bit PCM. A 30-minute recording is exactly 172,800,044 bytes, including the 44-byte header.                                                                                                                 |
| **Save PNG**     | A 1600 × 1240 image with the pitch trace, selected analysis view, time labels, and units. Spectrograms include a color scale. Time-based charts support the visible range or full session; the spectrum uses the current snapshot. |
| **Save session** | A `.pitchsession` file containing audio when recorded, analysis history, capture and display settings, and the final live snapshot.                                                                                                |

Only **Save session** clears the unsaved-session state: WAV and PNG exports cannot restore the complete analysis. Analysis-only sessions can also be saved and reopened. Invalid, oversized, or unsupported imports leave the current session intact.

## Pitch and analysis views

**Pitch tracking.** The web pitch chart is 560 px tall and spans two octaves, with 25 labeled semitone lines and emphasized C notes. It starts at C3–C5. During capture, a valid pitch moves the range to follow your voice. After a manual adjustment, the next valid pitch resumes following; silence, dragging, and a frozen display preserve the chosen range. During review or playback, a manual adjustment stays in place. Drag vertically, scroll, use the range slider or arrow buttons, or focus the chart and use the arrow keys for semitones and Page Up/Down for octaves. Range changes do not affect capture or the time window.

Sessions preserve the selected range and playback-follow preference; older files use automatic positioning. Starting capture resumes live pitch following. PNG exports use the current two-octave range, label its endpoints, and omit pitches outside it.

**Spectrum.** A logarithmic 50–8000 Hz view shows frequency peaks and harmonic guides when a reliable fundamental is detected. It always shows the live or final snapshot.

**Spectrogram.** A time/frequency heatmap stores 512 logarithmic frequency bands as 8-bit intensities, with a −100 to −15 dB scale. Gaps in analysis remain visible when reviewing or hovering over history.

**Reference piano.** The keyboard has 52 white keys and 36 black keys, covering A0–C8 with A4 = 440 Hz. It scrolls horizontally on narrow screens. Reference audio uses a separate output and is not routed directly into analysis, although speakers can feed it back through the air.

The app supports microphone selection, canceling a pending permission request, retrying errors, and retaining received audio after a device disconnects. The web interface supports keyboard navigation and narrow screens.

## Audio processing and limits

- `src/audio/session.ts` manages a 48 kHz session. The browser converts device input to this rate and routes mono audio to capture and analysis.
- `public/capture-worklet.js` collects continuous PCM on the audio thread, sends a recording block every second, and computes waveform envelopes every 10 ms. Stopping flushes the final partial block. Duration comes from the actual sample count; capture stops at 86,400,000 samples without overwriting the beginning.
- A 4096-sample window feeds Pitchy's McLeod pitch detector; a separate 8192-point FFT supplies the spectrum. Pitch requires at least −60 dBFS RMS and 0.9 clarity. The strongest FFT peak is not assumed to be the fundamental.
- Analysis runs roughly 30 times per second, timestamped with `AudioContext.currentTime` relative to the worklet start. Missing analysis is not filled in. Suspending the audio context also pauses its clock; a blocked main thread can leave analysis gaps while the audio thread keeps recording.
- Full analysis frames are retained for about 10 seconds, capped at 360 frames. Long-term history stores pitch, level, and 512-byte spectrum columns in blocks of 256 frames. Waveform envelopes use multiresolution extrema. Rendering queries only the visible range and limits point counts to the canvas width.
- A 30-minute WAV is about 173 MB, with roughly 29 MB of spectrogram history plus envelopes, playback, and export overhead. Audio is not converted to Base64. Files are processed locally; memory use and responsiveness depend on the device and browser.
- Level readings are digital dBFS, and spectrum values describe the digital signal, not calibrated dB SPL. Pitch detection is intended for one person speaking or singing, not polyphonic transcription.
- The app requests echo cancellation, noise suppression, and automatic gain control off, and displays the browser's reported settings. Device firmware may still process the input.

There is no system-audio capture, exercise scoring, chord recognition, or desktop installer.

## Session format v1

The format uses little-endian integers and floating-point values. Files are limited to 256 MiB, with a UTF-8 JSON manifest of at most 64 KiB.

| Order      | Contents                                                                                                                                            |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bytes 0–7  | ASCII `PITCHS01`                                                                                                                                    |
| Bytes 8–11 | `uint32` manifest length in bytes                                                                                                                   |
| JSON       | `version: 1`, name, creation time, duration, sample rate, recording flag, capture/display settings, four block lengths, and final-snapshot metadata |
| Block 0    | History frames, 536 bytes each: `float64` time; four `float32` values for Hz, clarity, RMS dBFS, and peak; 512 `uint8` spectrum values              |
| Block 1    | Envelopes, 16 bytes each: `float64` time and `float32` minimum/maximum                                                                              |
| Block 2    | Complete PCM WAV, or an empty block for an analysis-only session                                                                                    |
| Block 3    | Final snapshot: 4096 `float32` waveform samples and 4096 `float32` FFT dB values; empty if no snapshot exists                                       |

Imports validate the version, total and block lengths, WAV header and sample count, monotonic timestamps, numeric values, and duration. Imported files are treated as data. Sessions do not store the full history of instantaneous FFT snapshots, and arbitrary WAV/MP3 files cannot be imported for reanalysis.

## Development and validation

```sh
npm test
npm run test:browser
```

Browser tests require locally installed Chrome and Edge. They use synthetic audio connected to the real Web Audio pipeline; the production UI has no test-source controls. Tests cover pitch detection, harmonics, silence, noise, history lookup, analysis gaps, envelopes, final PCM flushing, sample limits, file validation, navigation, playback, exports, errors, and unsaved-session replacement.

Long-running tests are opt-in:

```sh
npm run test:recording-soak
npm run test:soak
```

`test:recording-soak` builds the app and records in Chrome against the production preview for at least 30 real minutes. It logs analysis rate and memory every 30 seconds, then checks automatic stopping, WAV export, session reopening, and late-session playback. Artifacts go to `.local/recording-soak/`. `test:soak` runs a 10-minute analysis check in both browsers.

See [VALIDATION.md](VALIDATION.md) for recorded results and limitations. Synthetic audio tests do not establish real-microphone accuracy, vowel tracking, or end-to-end latency. Android build and device-test instructions are in [android/README.md](android/README.md).

| Area                                   | Files                                                         |
| -------------------------------------- | ------------------------------------------------------------- |
| Page state and pitch viewport          | `src/App.tsx`, `src/audio/pitch-viewport.ts`, `src/style.css` |
| Shared time charts and PNG export      | `src/components/Timeline.tsx`                                 |
| Live spectrum and millisecond waveform | `src/components/Charts.tsx`                                   |
| History and binary session files       | `src/audio/history.ts`, `src/audio/archive.ts`                |
| Piano playback                         | `src/components/Piano.tsx`, `src/audio/piano.ts`              |

Run `npm run format` to format the web source, tests, configuration, and root README.

## Credits

Piano samples come from [Salamander Grand Piano](https://github.com/Tonejs/audio/tree/master/salamander), a Yamaha C5 recorded by Alexander Holm and licensed under CC BY 3.0. The 30 bundled MP3 files total about 2 MB and require no external audio service at runtime. Samples load on first use and are cached; neighboring notes are shifted by at most one semitone. Playback uses one velocity layer, natural decay with a fade-out within four seconds, up to eight voices, and an eight-sample decode cache. It does not reproduce the full library's 16 velocity layers, pedals, or resonance modeling.

See [sample attribution](public/piano/salamander/ATTRIBUTION.txt), [source checksums](public/piano/salamander/source.json), and [Android third-party notices](android/THIRD_PARTY_NOTICES.md) for sources and license details. The Android pitch detector is adapted from Pitchy and retains its MIT notice.
