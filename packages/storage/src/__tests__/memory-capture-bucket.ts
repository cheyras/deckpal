// An in-memory CaptureBucket for the capture tests. Not a test file itself
// (the runner globs `*.test.ts`), and not exported from the package.
import { md5Hex, type CaptureBucket, type CaptureObject, type CapturePrefix } from '../capture-store.js';
import type { StoredObject } from '../object-store.js';

export interface MemoryBucket extends CaptureBucket {
  objects: Map<string, CaptureObject>;
  calls: string[];
  /** Fault injection: return a replacement result, throw, or undefined to proceed. */
  hooks: {
    read?: (path: string) => CaptureObject | null | undefined | Promise<CaptureObject | null | undefined>;
    write?: (path: string, bytes: Buffer) => Buffer | undefined;
    remove?: (path: string) => void;
    list?: (prefix: CapturePrefix, listed: StoredObject[]) => StoredObject[] | undefined;
  };
}

export function memoryBucket(name: string, initial: Record<string, string | Buffer> = {}): MemoryBucket {
  const objects = new Map<string, CaptureObject>();
  for (const [path, value] of Object.entries(initial)) {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
    objects.set(path, { bytes, contentType: path.endsWith('.json') ? 'application/json' : 'image/png' });
  }
  const calls: string[] = [];
  const hooks: MemoryBucket['hooks'] = {};
  const bucket: MemoryBucket = {
    name,
    objects,
    calls,
    hooks,
    async list(prefix) {
      calls.push(`list ${prefix}`);
      const listed = [...objects.entries()]
        .filter(([path]) => path.startsWith(`${prefix}/`))
        .map(([path, o]) => ({
          path,
          byteSize: o.bytes.length,
          contentType: o.contentType,
          etag: md5Hex(o.bytes),
          cacheControl: null,
        }));
      return hooks.list?.(prefix, listed) ?? listed;
    },
    async read(path) {
      calls.push(`read ${path}`);
      const hooked = await hooks.read?.(path);
      if (hooked !== undefined) return hooked;
      const o = objects.get(path);
      return o ? { bytes: Buffer.from(o.bytes), contentType: o.contentType } : null;
    },
    async stat(path) {
      calls.push(`stat ${path}`);
      const o = objects.get(path);
      return o ? { byteSize: o.bytes.length } : null;
    },
    async write(path, bytes, contentType, mode) {
      calls.push(`write ${path} ${mode}`);
      if (mode === 'create' && objects.has(path)) return 'exists';
      const stored = hooks.write?.(path, bytes) ?? bytes;
      objects.set(path, { bytes: Buffer.from(stored), contentType });
      return 'written';
    },
    async remove(path) {
      calls.push(`remove ${path}`);
      hooks.remove?.(path);
      return objects.delete(path);
    },
  };
  return bucket;
}

export function text(bucket: MemoryBucket, path: string): string | undefined {
  return bucket.objects.get(path)?.bytes.toString('utf8');
}
