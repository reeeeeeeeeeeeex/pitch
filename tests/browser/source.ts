import type { Page } from '@playwright/test';
export async function installAudioSource(page: Page, mode = 'harmonic') {
  await page.addInitScript(
    ({ mode }) => {
      const state = {
        mode,
        calls: 0,
        stopped: 0,
        closed: 0,
        samples: 0,
        pauseAnalysis: false,
        clockLog: [] as object[],
        streams: [] as MediaStream[],
        contexts: [] as AudioContext[],
        allContexts: [] as AudioContext[],
        constraints: null as MediaStreamConstraints | null,
        release: null as (() => void) | null,
        setMode: (_mode: string) => {},
      };
      Object.assign(window, { testAudio: state });
      const nativeInterval = window.setInterval.bind(window);
      window.setInterval = ((handler: TimerHandler, delay?: number, ...args: unknown[]) =>
        nativeInterval(
          typeof handler === 'function'
            ? () => {
                // Test-only scheduling interruption, without replacing audio samples or clocks.
                if (state.pauseAnalysis && delay && delay > 30 && delay < 34) return;
                handler(...args);
              }
            : handler,
          delay,
        )) as typeof window.setInterval;
      const NativeWorklet = window.AudioWorkletNode;
      window.AudioWorkletNode = class extends NativeWorklet {
        constructor(ctx: BaseAudioContext, name: string, options?: AudioWorkletNodeOptions) {
          super(ctx, name, options);
          this.port.addEventListener('message', ({ data }) => {
            if (data.type === 'started' || data.type === 'done' || data.type === 'envelope')
              state.clockLog.push({
                type: data.type,
                time: ctx.currentTime,
                samples: data.samples,
                origin: data.origin,
              });
          });
        }
      };
      const NativeContext = window.AudioContext;
      window.AudioContext = class extends NativeContext {
        constructor(options?: AudioContextOptions) {
          super(options);
          state.allContexts.push(this);
        }
      };
      const readTimeData = AnalyserNode.prototype.getFloatTimeDomainData;
      AnalyserNode.prototype.getFloatTimeDomainData = function (buffer) {
        state.samples++;
        return readTimeData.call(this, buffer);
      };
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
        configurable: true,
        value: async (constraints: MediaStreamConstraints) => {
          state.calls++;
          state.constraints = constraints;
          if (state.mode === 'denied') throw new DOMException('Test denial', 'NotAllowedError');
          if (state.mode === 'missing')
            throw new DOMException('Test missing device', 'NotFoundError');
          if (state.mode === 'busy') throw new DOMException('Test busy device', 'NotReadableError');
          const ctx = new AudioContext();
          state.contexts.push(ctx);
          await ctx.resume();
          const destination = ctx.createMediaStreamDestination();
          const sources: { oscillator: OscillatorNode; gain: GainNode }[] = [];
          for (const [harmonic, amplitude] of [
            [1, 0.2],
            [2, 0.6],
            [3, 0.1],
          ]) {
            const oscillator = ctx.createOscillator();
            const gain = ctx.createGain();
            oscillator.frequency.value = 220 * harmonic;
            gain.gain.value = state.mode === 'silence' ? 0 : amplitude;
            oscillator.connect(gain).connect(destination);
            oscillator.start();
            sources.push({ oscillator, gain });
          }
          state.setMode = (next: string) => {
            state.mode = next;
            sources.forEach(({ oscillator, gain }, index) => {
              oscillator.frequency.cancelScheduledValues(ctx.currentTime);
              oscillator.frequency.setValueAtTime(220 * (index + 1), ctx.currentTime);
              gain.gain.value = next === 'silence' ? 0 : [0.2, 0.6, 0.1][index];
              if (next === 'glide')
                oscillator.frequency.exponentialRampToValueAtTime(
                  440 * (index + 1),
                  ctx.currentTime + 3,
                );
            });
          };
          const stream = destination.stream;
          state.streams.push(stream);
          const track = stream.getAudioTracks()[0];
          const stop = track.stop.bind(track);
          let stopped = false;
          track.stop = () => {
            if (stopped) return;
            stopped = true;
            state.stopped++;
            sources.forEach(({ oscillator, gain }) => {
              oscillator.stop();
              oscillator.disconnect();
              gain.disconnect();
            });
            stop();
            void ctx.close().then(() => state.closed++);
          };
          if (state.mode === 'pending')
            await new Promise<void>((resolve) => {
              state.release = resolve;
            });
          return stream;
        },
      });
    },
    { mode },
  );
}
