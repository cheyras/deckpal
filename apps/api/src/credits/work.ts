/** Model work is allowed only after accounting durably marks provider invocation.
 * Multiple deep fallback legs share this reservation; a replayed HTTP request
 * cannot obtain it again. The SQL refund itself is also idempotent. */
export function creditWork(start: () => Promise<void>, refund: () => Promise<void>, signal: AbortSignal) {
  let started = false;
  let starting: Promise<void> | undefined;
  return {
    start: async () => {
      if (started) return;
      if (signal.aborted) throw new Error('Operation cancelled before provider invocation');
      starting ??= start().then(() => { started = true; });
      await starting;
    },
    refund: async () => {
      if (!started) await refund();
    },
  };
}
