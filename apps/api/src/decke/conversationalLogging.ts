import { z } from 'zod';
import { asSchema, jsonSchema, type Schema } from 'ai';
import type { ToolDefinition } from '@deckpal/agent-tools';
import type { ApprovalPreview } from './adapters/aisdk.js';

export const PREVIEW_CARD_CHANGES = 'preview_card_changes';

export const APPLY_LOG_CARDS_DESCRIPTION =
  'APPLY collection changes after the reader approves them. Use this when the reader asked to add, remove, or set card quantities. Calling it starts the server-verified approval flow; it never means preview-only.';

export const PREVIEW_CARD_CHANGES_DESCRIPTION =
  'PREVIEW hypothetical collection changes without writing. Use this only for explicit previews, what-if questions, or quantity checks. It is read-only and can never apply changes.';

export function conversationalLogSchema(def: ToolDefinition): z.ZodObject<any> {
  const schema = def.inputSchema;
  if (!(schema instanceof z.ZodObject) || !('dry_run' in schema.shape)) {
    throw new Error('log_cards must remain a Zod object with dry_run in the shared contract');
  }
  return schema.omit({ dry_run: true }).strict();
}

/**
 * Advertise only the current APPLY shape while accepting one pre-split wire
 * shape during SDK replay. `safeParse` intentionally remains the advertised
 * current-shape check; the SDK uses `validate` for runtime input validation.
 */
export function conversationalApplyLogSchema(
  def: ToolDefinition,
): Schema<unknown> & Pick<z.ZodObject<any>, 'shape' | 'safeParse'> {
  const current = conversationalLogSchema(def);
  const legacy = current.extend({ dry_run: z.literal(false) }).strict();
  const runtime = z.union([current, legacy]);
  const sdkSchema = jsonSchema(asSchema(current).jsonSchema, {
    validate: (value: unknown) => {
      const parsed = runtime.safeParse(value);
      return parsed.success
        ? { success: true as const, value }
        : { success: false as const, error: parsed.error };
    },
  });
  return Object.assign(sdkSchema, {
    shape: current.shape,
    safeParse: current.safeParse.bind(current),
  }) as unknown as Schema<unknown> & Pick<z.ZodObject<any>, 'shape' | 'safeParse'>;
}

function record(input: unknown): Record<string, unknown> {
  return input !== null && typeof input === 'object' && !Array.isArray(input)
    ? { ...(input as Record<string, unknown>) }
    : {};
}

/** Server-owned normalization. Any injected dry_run is discarded before forcing intent. */
export function applyLogInput(input: unknown): Record<string, unknown> {
  const out = record(input);
  delete out.dry_run;
  return { ...out, dry_run: false };
}

/** The alias is read-only even if an unvalidated caller injects dry_run:false. */
export function previewLogInput(input: unknown): Record<string, unknown> {
  const out = record(input);
  delete out.dry_run;
  return { ...out, dry_run: true };
}

export function exposedLogInput(input: unknown): Record<string, unknown> {
  const out = record(input);
  delete out.dry_run;
  return out;
}

/**
 * A preflight may raise consent only when every row is actionable.
 * Candidate-bearing ambiguous printing rows remain actionable because the
 * existing approval picker resolves them by denying the held call and applying
 * the reader's corrected batch. Unresolvable/skipped rows fail closed.
 */
export function approvalEligible(preview: ApprovalPreview): boolean {
  return (
    preview.ok &&
    preview.editable &&
    preview.rows.length > 0 &&
    preview.skipped.length === 0
  );
}
