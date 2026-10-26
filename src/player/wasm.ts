import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { brotliDecompressSync } from 'node:zlib';

// The VSIX ships ONNX Runtime's WebAssembly brotli-packed (21 MB to 3 MB); it is unpacked once per ORT build.
export function inflateWasm(packedPath: string, dir: string): string {
  const packed = readFileSync(packedPath);
  const name = `ort-${createHash('sha256').update(packed).digest('hex').slice(0, 16)}.wasm`;
  const out = join(dir, name);
  if (existsSync(out)) return out;
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(dir))
    if (/^ort-[0-9a-f]{16}\.wasm$/.test(f)) rmSync(join(dir, f), { force: true });
  const tmp = `${out}.${process.pid}`;
  writeFileSync(tmp, brotliDecompressSync(packed));
  renameSync(tmp, out);
  return out;
}
