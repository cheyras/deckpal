// PDF.js 6 uses this Node 22 API, while the API test job runs on Node 20.
if (!('withResolvers' in Promise)) {
  Object.defineProperty(Promise, 'withResolvers', {
    value: function <T>() {
      let resolve!: (value: T | PromiseLike<T>) => void;
      let reject!: (reason?: unknown) => void;
      const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
      return { promise, resolve, reject };
    },
  });
}

if (!('transferToFixedLength' in ArrayBuffer.prototype)) {
  Object.defineProperty(ArrayBuffer.prototype, 'transferToFixedLength', {
    value: function (this: ArrayBuffer, newByteLength = this.byteLength) {
      const result = new ArrayBuffer(newByteLength);
      new Uint8Array(result).set(new Uint8Array(this, 0, Math.min(this.byteLength, newByteLength)));
      structuredClone(this, { transfer: [this] });
      return result;
    },
  });
}

export { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
