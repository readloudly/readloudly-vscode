import { KokoroTTS, env } from 'kokoro-js';

const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
let tts: Promise<KokoroTTS> | undefined;

// The GPU through WebGPU when the editor has one, otherwise the CPU through WebAssembly; text never leaves the machine.
async function load(wasmPaths: string, progress: (note: string) => void) {
  env.wasmPaths = wasmPaths;
  const report = (p: { status: string; file?: string; progress?: number }) =>
    p.status === 'progress' &&
    p.file?.endsWith('.onnx') &&
    progress(`Downloading the Kokoro voice model, ${Math.round(p.progress ?? 0)}%`);
  const gpu = await (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu
    ?.requestAdapter()
    .catch(() => null);
  if (gpu) {
    try {
      return await KokoroTTS.from_pretrained(MODEL, {
        dtype: 'fp32',
        device: 'webgpu',
        progress_callback: report,
      });
    } catch (e) {
      console.warn('Kokoro on WebGPU failed, using the CPU', e);
    }
  }
  return KokoroTTS.from_pretrained(MODEL, {
    dtype: 'q8',
    device: 'wasm',
    progress_callback: report,
  });
}

export async function generate(
  text: string,
  voice: string,
  speed: number,
  wasmPaths: string,
  progress: (note: string) => void
) {
  tts ??= load(wasmPaths, progress).catch((e) => {
    tts = undefined;
    throw e;
  });
  const audio = await (await tts).generate(text, { voice: voice as 'af_heart', speed });
  return { samples: audio.audio, rate: audio.sampling_rate };
}
