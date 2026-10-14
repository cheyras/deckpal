import type { Request, Response } from 'express';
import { PLAYBOOK_INDEX_TEXT, PLAYBOOK_NAMES, PLAYBOOK_TEXT } from '@deckpal/agent-tools';

/**
 * `GET /playbooks` (public, cacheable): DeckPal's step-by-step guides for AI agents, the same texts the `playbook` tool
 * returns (agent-tools playbooks/texts.ts). JSON for the page that shows them (deckpal.app/skill); `?format=markdown`
 * for one Markdown document, the pointer skill's fallback for a client without the tool, which a plain fetch can read
 * (the page itself needs JavaScript; Astra, #344).
 */
export function playbooksHandler(req: Request, res: Response): void {
  res.set('Cache-Control', 'public, max-age=300');
  if (req.query.format === 'markdown') {
    res.type('text/markdown; charset=utf-8').send(`${[PLAYBOOK_INDEX_TEXT, ...PLAYBOOK_NAMES.map((name) => PLAYBOOK_TEXT[name])].join('\n\n---\n\n')}\n`);
    return;
  }
  res.json({ index: PLAYBOOK_INDEX_TEXT, playbooks: PLAYBOOK_NAMES.map((name) => ({ name, text: PLAYBOOK_TEXT[name] })) });
}
