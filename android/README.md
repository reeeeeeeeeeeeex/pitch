# Pitch Studio for Android

**English** | [简体中文](README.zh-CN.md) | [Web app](../README.md)

An offline voice practice app built with Kotlin and Jetpack Compose. Track your pitch, explore your voice in four analysis views, record a practice session, and sing along with an 88-key piano—all on your device.

Requires Android 10 (API 29) or later; compile/target SDK is 36. The app bundles samples from `public/piano/salamander/` and runs independently of the web app. Both platforms can open the same `.pitchsession` files. The interface supports English and Simplified Chinese.

The [main screen](docs/screenshots/main.png), [piano](docs/screenshots/piano.png), and [spectrogram export](docs/screenshots/export-spectrogram.png) show the English interface with synthetic test data.

## Install and use

Build the debug APK with `:app:assembleDebug`; the output is `app/build/outputs/apk/debug/app-debug.apk`. Copy it to your phone and open it with a file manager. If prompted, allow that file manager to install the APK. This is a development-signed build, with no account, network service, or app-store publishing configuration.

- Tap the language icon in the top toolbar to choose **English** or **简体中文**. English is the default, and the app remembers your choice. Switching updates the UI and subsequent PNG exports without interrupting capture or resetting the session, playback position, or display settings. Both languages are bundled for offline use.
- **Analyze only** captures analysis without keeping playable audio. **Start recording** also saves 48 kHz mono 16-bit PCM. Sessions stop automatically after 30 minutes.
- Capture runs only in the foreground. Locking the screen, going home, or switching apps ends capture and saves the results. Start a new capture when you return. Rotation does not stop capture. The screen stays awake during capture, but manually locking it still stops the session.
- **Pitch**, **Spectrogram**, **Waveform**, and **Spectrum** share the same time range where applicable. Drag horizontally to browse history and vertically to scroll the page. The pitch chart's side control adjusts its two-octave range. A steady live pitch resumes automatic range following; a frozen display or playback preserves a manual range.
- Choose a 10-second, 30-second, 1-minute, 5-minute, or full-session window. The waveform navigator browses history; **Go live** resumes time following. **Freeze display** pauses the display while capture continues.
- Tap charts for readings. After capture, tapping a time-based chart also seeks playback. The spectrum shows the live or final snapshot; full instantaneous FFT history is not stored. Spectrogram history keeps 512 bands.
- Open **Reference piano** for 88 keys from A0–C8, octave shortcuts, and horizontal scrolling. Purple marks the target note; green marks the detected note. Headphones help keep reference notes out of the microphone.
- Completed recordings and analyses appear under **More → Saved sessions**, where you can open, rename, or delete them. Export WAV, PNG, or a complete `.pitchsession` separately. Analysis-only sessions have no WAV.
- Since v1.0.1, playback boosts quiet recordings using a fixed gain based on the full-session peak: a −3 dBFS target, capped at 16× (about +24 dB). This also applies to old sessions. Silent and effectively silent recordings are not boosted, and loud recordings receive no additional gain. Original audio, session files, and analysis remain unchanged; exported WAV files retain their original level.
- Exports use the system file picker. PNG exports are 1600 × 1240 and include the pitch chart plus the selected analysis view, using either the visible time range or the full session. Exporting from the Pitch tab uses the most recently selected analysis view, initially Spectrogram.

Files stay on the device. The app requests neither internet access nor broad storage permission, and disables system backup and device transfer. Uninstalling removes in-app sessions, so export anything you want to keep. After an unexpected exit, recovery restores only the latest complete checkpoint and marks the session as interrupted.

Pitch detection is intended for one person speaking or singing, not multiple simultaneous voices. Levels describe the digital signal, not calibrated sound pressure. Real-microphone performance and end-to-end latency must be checked on the target phone.

## Build from source

You need the full repository, JDK 17, and the Android SDK. The first build downloads Gradle and Maven dependencies; the installed app works offline. The repository pins Gradle 8.13 with a SHA-256 checksum, AGP 8.13.2, Kotlin 2.2.21, and Compose BOM 2025.12.00.

```powershell
# sdkmanager is in the Android SDK's cmdline-tools directory.
sdkmanager "platforms;android-36" "build-tools;35.0.0" "platform-tools"

# Set JAVA_HOME to JDK 17 and ANDROID_HOME to your SDK directory.
# Alternatively, set sdk.dir in android/local.properties (not committed).
cd android
.\gradlew.bat :core:test :app:assembleDebug :app:lintDebug
```

On macOS/Linux, use `./gradlew`. In Android Studio, open `android/` and select JDK 17 for Gradle. Debug builds do not require a private release key. The wrapper, version configuration, and source are included; locally installed toolchains, emulators, and generated output belong in ignored directories or build caches.

## Architecture

| Area             | Files                                                         | Responsibility                                                                                                                               |
| ---------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Audio input      | `app/.../audio/AndroidPcmSource.kt`, `AudioEngine.kt`         | AudioRecord capture at 48 kHz PCM16; prefer UNPROCESSED and fall back to VOICE_RECOGNITION; disable controllable effects and report settings |
| Capture pipeline | `core/.../CapturePipeline.kt`                                 | Separate capture, writer, and analysis threads; continuous PCM on disk; analysis can skip stale frames without dropping recorded audio       |
| Analysis         | `core/.../AnalysisProcessor.kt`                               | 4096-sample McLeod pitch detection, a separate 8192-point FFT, level/clarity thresholds, and independent fundamental/peak estimates          |
| Sessions         | `core/.../SessionRepository.kt`                               | Chunked PCM, history, and envelope persistence; sample clock; checkpoint recovery; time indexes and multiresolution envelopes                |
| Interoperability | `core/.../SessionCodec.kt`                                    | Streaming `.pitchsession` v1 import/export with strict validation                                                                            |
| State            | `app/.../StudioViewModel.kt`                                  | StateFlow, visible data, following/freezing, playback cursor, and file operations                                                            |
| Playback         | `app/.../audio/RecordingPlayer.kt`, `core/.../PlaybackWav.kt` | Fixed session gain applied to PCM on demand; media volume controls; pause/seek without an extra audio copy                                   |
| Charts           | `app/.../ui/ChartRenderer.kt`                                 | Shared screen/PNG drawing, 25 semitone lines across two octaves, spectrum, spectrogram, envelopes, and millisecond snapshots                 |
| Piano            | `app/.../audio/PianoEngine.kt`, `ui/PianoReference.kt`        | Native MP3 decoding, AudioTrack mixing, up to eight voices, and an on-demand sample cache                                                    |

`...` stands for `src/main/java/app/pitchstudio/android` in the app module and `src/main/kotlin/app/pitchstudio/core` in core. The main screen does not load a full recording into memory. History reads cover only the visible range; full-session envelopes use multiresolution indexes.

## Session files and recovery

The app uses the `PITCHS01` v1 container documented in the [root README](../README.md#session-format-v1): an eight-byte signature, a four-byte JSON length, a UTF-8 manifest, and four binary blocks. Files are limited to 256 MiB and manifests to 64 KiB. Imports check the version, block lengths, WAV header, sample count, finite values, monotonic timestamps, and 30-minute limit. A failed import leaves the current session intact.

The optional `display.mobileView` extension stores the Android tab. `display.view` keeps one of the web-compatible values: `spectrum`, `spectrogram`, or `waveform`. The web app ignores the extension, so files can travel in either direction. Sessions without snapshots, analysis-only sessions, and a null target note are supported.

Local sessions live in `files/sessions/<UUID>/`, with `recording.wav` when recorded, `history.bin`, `envelopes.bin`, the final snapshot, and `meta.json`. Files flush every second with an atomic checkpoint. On recovery, data is truncated to the latest verifiable checkpoint. Duration comes from samples actually written. Low space or slow storage ends capture and retains the written portion without reporting it as a complete recording.

## Automated validation

```powershell
cd android
.\gradlew.bat :core:test :app:assembleDebug :app:assembleDebugAndroidTest :app:lintDebug

# Replace SERIAL with a test device listed by adb devices.
adb -s SERIAL install -r app/build/outputs/apk/debug/app-debug.apk
adb -s SERIAL install -r app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb -s SERIAL shell am instrument -w -e class app.pitchstudio.android.StudioTest,app.pitchstudio.android.PianoTest,app.pitchstudio.android.LayoutTest,app.pitchstudio.android.LifecycleTest,app.pitchstudio.android.DocumentPickerTest,app.pitchstudio.android.LanguageTest app.pitchstudio.android.test/androidx.test.runner.AndroidJUnitRunner

# Opt-in: this takes 30 real minutes, without accelerating the sample clock.
adb -s SERIAL shell am instrument -w -e class app.pitchstudio.android.RecordingSoakTest -e soak true app.pitchstudio.android.test/androidx.test.runner.AndroidJUnitRunner
adb -s SERIAL pull /sdcard/Android/data/app.pitchstudio.android/files/soak-results ../.local/android-validation/
```

The soak test feeds synthetic PCM at real-time speed through the production capture, analysis, and disk-writing pipeline. The source exists only in the test APK. It verifies exactly 86,400,000 samples, a 172,800,044-byte WAV, automatic stopping, history endpoints, and an identical WAV SHA-256 after session reimport. `StudioTest` separately exercises native AudioRecord start/stop on the emulator. These checks do not establish physical microphone or real-voice performance.

The interoperability check uses the actual web encoder/decoder and requires the repository's npm dependencies and Node.js 24:

```powershell
# From the repository root:
node android/scripts/web-interop.mjs
.\android\gradlew.bat -p android :core:test
node android/scripts/web-interop.mjs android/core/build/interop/android.pitchsession

# After pulling a completed soak-test session:
node android/scripts/check-soak.mjs .local/android-validation/soak-results/complete.pitchsession
```

See [VALIDATION.md](VALIDATION.md) for test sources, recorded results, device coverage, and remaining real-device checks.

## Credits and third-party licenses

The piano uses Salamander Grand Piano samples by Alexander Holm, licensed under CC BY 3.0. The build bundles all 30 MP3 files along with the upstream README, attribution, and source hashes. It does not download sounds at runtime. Playback uses one velocity layer, at most one semitone of pitch shifting, fades, and a four-second maximum reference note. Pedals and the full piano velocity response are not modeled.

The McLeod pitch-selection logic is adapted from Pitchy and retains its MIT license. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
