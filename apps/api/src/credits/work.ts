/** SQL authorizes and records each provider attempt before invoke() runs.
 * The synchronous latch is set exactly when entering the SDK invocation; an
 * authorization/persistence failure before that point leaves refund available.
 * Retries/fallbacks share the latch and retain the original flat reservation. */
export function creditWork(refund: () => Promise<void>, signal: AbortSignal) {
  let invoked = false;
  let compensate: (() => Promise<void>) | undefined;
  return {
    prepareRefund: (recover: () => Promise<void>) => { if (!invoked) compensate = recover; },
    invoke: <T>(provider: () => T): T => {
      if (signal.aborted) throw new DOMException('Operation cancelled before provider invocation', 'AbortError');
      invoked = true;
      compensate = undefined;
      return provider();
    },
    refund: async () => {
      if (!invoked) {
        // Also resolves a committed operation whose DB acknowledgement was lost.
        if (compensate) await compensate();
        await refund();
      }
    },
  };
}
