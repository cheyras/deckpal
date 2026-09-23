import { z } from 'zod';
import type { ToolDefinition } from '@deckpal/agent-tools';
import type { ApprovalPreview } from './adapters/aisdk.js';

export const PREVIEW_CARD_CHANGES = 'preview_card_changes';

export const APPLY_LOG_CARDS_DESCRIPTION =
  'APPLY collection changes after the reader approves them. Use this when the reader asked to add, remove, or set card quantities. Calling it starts the server-verified approval flow; it never means preview-only.';

export const PREVIEW_CARD_CHANGES_DESCRIPTION =
  'PREVIEW hypothetical collection changes without writing. Use this only for explicit previews, what-if questions, or quantity checks. It is read-only and can never apply changes.';

export function conversationalLogSchema(def: ToolDefinition): z.ZodTypeAny {
  const schema = def.inputSchema;
  if (!(schema instanceof z.ZodObject) || !('dry_run' in schema.shape)) {
    throw new Error('log_cards must remain a Zod object with dry_run in the shared contract');
  }
  return schema.omit({ dry_run: true }).strict();
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
