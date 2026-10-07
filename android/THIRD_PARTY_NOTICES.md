# Third-party notices

## Pitchy

McLeod pitch-selection logic in `core/AnalysisProcessor.kt` is adapted from [Pitchy](https://github.com/ianprime0509/pitchy), Copyright 2018–2021 Ian Johnson, MIT. The FFT implementation is local Kotlin code; the autocorrelation/NSDF/key-maximum selection follows Pitchy. The complete upstream MIT notice is included in `core/src/main/resources/PITCHY_LICENSE.txt` and packaged with the application.

## Salamander Grand Piano

Samples by Alexander Holm, Yamaha C5, licensed under [Creative Commons Attribution 3.0 Unported](https://creativecommons.org/licenses/by/3.0/). The 30 MP3s are copied unchanged from the pinned [Tone.js audio distribution](https://github.com/Tonejs/audio/tree/efd8296360f9526e379bfbe5c1698ff54d6a1d34/salamander). Original instrument: [Salamander Grand Piano V3](https://archive.org/details/SalamanderGrandPianoV3).

The Android build copies `../public/piano/salamander/`, including `ATTRIBUTION.txt`, the upstream `README`, and `source.json` with URLs and SHA-256 hashes. Playback uses a single velocity layer, up to four seconds per decoded sample, linear interpolation for adjacent semitones, output gain and a short release. It does not claim the full instrument's 16 velocity layers. No endorsement is implied.

## Build and UI libraries

AndroidX / Jetpack Compose, Kotlin, kotlinx.coroutines, Gson and Gradle retain their upstream licenses and notices in the distributed dependencies. No remote font, analytics SDK, or runtime network dependency is used.
