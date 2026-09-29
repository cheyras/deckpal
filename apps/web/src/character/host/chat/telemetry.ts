export const TELEMETRY_EVENT_CAP = 2_000
export const TELEMETRY_BATCH_CAP = 200
export const TELEMETRY_BYTE_CAP = 512 * 1024

export type TelemetryKind = 'animation' | 'browser_tool' | 'notice' | 'error' | 'timing' | 'approval_ui'

export type TelemetryEvent = {
  seq: number
  at: string
  kind: TelemetryKind
  payload: Record<string, unknown>
}

export type TelemetryBatch = {
  conversationId: string
  seq: number
  batch: number
  events: Omit<TelemetryEvent, 'seq'>[]
}

type Sender = (batch: TelemetryBatch) => Promise<unknown>

export type TelemetrySharingOverride = 'shared' | 'declined' | 'stopped' | undefined

/** A conversation-local refusal always wins; an explicit share can enable one chat. */
export function shouldEnableTelemetry(shareAll: boolean, override: TelemetrySharingOverride): boolean {
  if (override === 'declined' || override === 'stopped') return false
  return override === 'shared' || shareAll
}

function byteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}

/**
 * One recorder belongs to one conversation. It is deliberately ignorant of React so
 * consent, caps, and retry ordering can be proved without mounting the chat.
 */
export class ConversationTelemetry {
  private events: TelemetryEvent[] = []
  private shared = false
  private nextBatch = 0
  private flushing: Promise<void> | null = null
  dropped = 0

  constructor(
    readonly conversationId: string,
    private readonly send: Sender,
    private readonly now: () => Date = () => new Date(),
  ) {}

  get buffered(): number {
    return this.events.length
  }

  record(seq: number, kind: TelemetryKind, payload: Record<string, unknown>): void {
    this.events.push({ seq, kind, payload, at: this.now().toISOString() })
    if (this.events.length > TELEMETRY_EVENT_CAP) {
      this.events.splice(0, this.events.length - TELEMETRY_EVENT_CAP)
      this.dropped++
    }
  }

  async share(): Promise<void> {
    this.shared = true
    await this.flush()
  }

  stopSharing(): void {
    this.shared = false
  }

  /** Called after each leg. Before consent it is an intentional no-op. */
  flush(): Promise<void> {
    if (!this.shared) return Promise.resolve()
    if (this.flushing) return this.flushing
    this.flushing = this.drain().finally(() => {
      this.flushing = null
    })
    return this.flushing
  }

  private async drain(): Promise<void> {
    while (this.shared && this.events.length) {
      const seq = this.events[0].seq
      const selected: TelemetryEvent[] = []
      for (const event of this.events) {
        if (event.seq !== seq || selected.length >= TELEMETRY_BATCH_CAP) break
        const candidate = [...selected, event].map(({ seq: _seq, ...rest }) => rest)
        if (byteLength(candidate) > TELEMETRY_BYTE_CAP) break
        selected.push(event)
      }

      // An individual over-limit event cannot be sent legally. Drop it instead
      // of silently truncating content without the hash required by the contract.
      if (!selected.length) {
        this.events.shift()
        this.dropped++
        continue
      }

      const events = selected.map(({ seq: _seq, ...event }) => event)
      try {
        await this.send({ conversationId: this.conversationId, seq, batch: this.nextBatch, events })
      } catch {
        return
      }
      this.events.splice(0, selected.length)
      this.nextBatch++
    }
  }
}
