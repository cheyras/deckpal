/**
 * The serverless function is where mechanisms go to be quietly unplugged.
 *
 * `api/chat.mjs` cannot be imported here — it is a Vercel handler that reaches
 * for the environment at module scope — so these are SOURCE PINS. They exist
 * because a mutation proved they had to: replacing the computed
 * `readerNamedPrinting` with a hardcoded `true` at the call site broke NOTHING.
 * Every unit test around the mechanism kept passing while the mechanism itself
 * was bypassed, and the symptom would have been at the far end — the printing
 * picker silently never appearing again, which is the exact defect it closes.
 *
 * That is this repository's most repeated bug shape. `CardRows`, `onRemoveCard`
 * and `resetDeckeEntitlement` were all built and never wired; the last of them
 * meant Deck-E never appeared for a signed-in user.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { spokeAndSettled, textAfterLastLookup } from '../stopRule.js';
import { needsAnswerNudge } from '../turnGuards.js';

const SRC = readFileSync(fileURLToPath(new URL('../../../../../api/chat.mjs', import.meta.url)), 'utf8');

test('the printing witness is COMPUTED from the reader, not asserted', () => {
  assert.match(
    SRC,
    /readerNamedPrinting:\s*readerNamedPrinting\(latestUserText\(messages\)\)/,
    'readerNamedPrinting is no longer computed from the reader\'s own message',
  );
  // A literal here is the bypass, and it reads as harmless in a diff.
  assert.doesNotMatch(SRC, /readerNamedPrinting:\s*(true|false)\b/);
});

test('it reads the READER\'s message and skips his own', () => {
  // Deck-E says "Normal" constantly. If assistant turns counted, his own guess
  // would be the witness to his own guess, and the mechanism inverts itself.
  const fn = SRC.slice(SRC.indexOf('function latestUserText'));
  assert.match(fn.slice(0, 600), /role !== 'user'/, 'latestUserText no longer filters to the reader');
});

test('the helper is imported from the built module rather than reimplemented', () => {
  // A local copy would drift from the vocabulary and its tests the first time
  // somebody added a printing word.
  assert.match(SRC, /import \{ readerNamedPrinting \} from '\.\.\/apps\/api\/dist\/decke\/printingSaid\.js'/);
});

/**
 * Source with comment lines stripped, so a pin cannot be satisfied by prose.
 * Local rather than shared, matching `legWiring.test.ts`: a pin file that
 * imports its own reader from somewhere else can be satisfied by changing the
 * reader.
 */
function code(src: string): string {
  return src
    .split('\n')
    .filter((l: string) => {
      const t = l.trimStart();
      return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*');
    })
    .join('\n');
}

const CODE = code(SRC);

test('the empty-answer guard is called with ALL FIVE arguments', () => {
  // THE DEFECT THIS FILE EXISTS FOR, twice over. `needsAnswerNudge` shipped in
  // #138 called with three of five parameters. `completedToolNames` then
  // defaulted to `[]`, so the "any called tool that did not complete is
  // PENDING" carve-out matched every call and the guard returned false on every
  // reachable path. Its own unit tests pass all five and stayed green.
  assert.match(
    CODE,
    /needsAnswerNudge\(\s*answerAfterLookups,\s*calledToolNames,\s*CLIENT_SET,\s*completedToolNames,\s*SERVER_SET\s*\)/,
    'the empty-answer guard lost an argument again — it cannot fire without all five',
  );
  // And `completedToolNames` must be DERIVED from the turn's real events, not
  // handed a literal. That is the mutation this repo has been bitten by.
  assert.match(CODE, /const completedToolNames = guardEvents\s*\n?\s*\.filter\(/);
  assert.doesNotMatch(CODE, /needsAnswerNudge\([^)]*\[\]\s*\)/);
});

test('the flailing NOTE uses shouldFireFlailing; the BREAKER keeps the raw budget', () => {
  // `shouldFireFlailing` was imported and never called, so a turn that flailed
  // and then recovered into a substantive answer was still told it flailed —
  // a correction for something the model fixed.
  assert.match(CODE, /\}\s*else if \(shouldFireFlailing\(phases, answerText\)\)/);
  // The mid-flight breaker must stay on the bare predicate: it trips BEFORE any
  // answer exists, so it cannot consult one.
  assert.match(CODE, /stepCountIs|errorBudgetExceeded\(guardEvents\.map\(\(e\) => e\.phase\)\)/);
});

test('the promise detector is wired into the one-guard chain', () => {
  // "First, I'll grab your deck's battle logs … One sec." — and the turn ended.
  // The detector reads STEPS, not the joined answer text, because it has to
  // know whether anything ran after the last thing said.
  assert.match(CODE, /promisedWithoutActing\(turnSteps, CLIENT_SET, completedToolNames\)/);
  assert.match(CODE, /const turnSteps = steps\.map\(/);
  // One guard per turn: the note goes through the same single `guardFired`
  // budget and the same `text-delta`, never a second write.
  assert.match(CODE, /else if \(promised\)/);
});

test('the failing-tool ledger is rebuilt per request and handed to the data tools', () => {
  // The server keeps nothing between requests, so this can only come from the
  // replayed history — the same source, lifetime and argument as `declined`.
  // Plus the evidence of replies the browser's window dropped (SEC-04), so the
  // breaker stays conversation-wide after trimming.
  assert.match(CODE, /const failing = failingTools\(\[\.\.\.evidence, \.\.\.messages\]\)/);
  assert.match(CODE, /const retryRequested = readerAsksRetry\(latestUserText\(messages\)\)/);
  // Threaded in. A ledger that is built and not passed is this repository's
  // most repeated defect, and is exactly what happened to the two guards above.
  assert.match(CODE, /\n\s*failing,\r?\n\s*retryRequested,/);
  // The reader's OWN words are the only bypass — never the model's.
  assert.doesNotMatch(CODE, /readerAsksRetry\((?!latestUserText)/);
});

test('the redundant already-told injection is not wired into chat', () => {
  assert.doesNotMatch(CODE, /priorSummaries|const told\b/);
});

test('chat sends correlation into the server acceptance boundary before metering and model work', () => {
  assert.match(CODE, /conversationId, exchangeId, seq/);
  const begin = CODE.indexOf('usage = await beginAiRequest(');
  assert.ok(begin > 0);
  assert.ok(begin < CODE.indexOf('meter = await meterTurn('));
  assert.ok(begin < CODE.indexOf('model: observeUsageModel('));
  assert.match(CODE, /userId: user.id, conversationId, exchangeId, seq/);
});

test('the frozen policy version is the only flat-versus-metered chat gate', () => {
  assert.match(SRC, /import \{ isMetered \} from '\.\.\/apps\/api\/dist\/credits\/policy\.js'/);
  assert.match(CODE, /if \(isMetered\(quote\.policy\)\)/);
  assert.match(CODE, /beginMeteredCredits\(chatPool\(\), userId, usage\.id\)/);
  assert.match(CODE, /const result = await reserveCredits\(chatPool\(\), userId, tool, quote, spendKey, hash\)/);
  assert.ok(CODE.indexOf('if (isMetered(quote.policy))') < CODE.indexOf('const result = await reserveCredits('));
  assert.doesNotMatch(CODE, /DECKE_METERED|METERED_CREDITS_ENABLED/);
});

test('metered research uses the leg hold and never starts another reservation', () => {
  const research = CODE.slice(CODE.indexOf('if (toolCallId)'), CODE.indexOf('const result = await beginMeteredCredits'));
  assert.match(research, /if \(toolCallId\)/);
  assert.match(research, /allowed: true/);
  assert.doesNotMatch(research, /reserveCredits|beginMeteredCredits/);
});

test('a metered refusal is a credit refusal that offers the wallet, never "try again tomorrow"', () => {
  assert.match(CODE, /credits: !result\.allowed \|\| result\.mode === 'paid'/);
});

test('the model loop checks the durable cap and closes in Deck-E voice once', () => {
  assert.match(CODE, /async \(\) => \{\s*capReached = await meteredCapReached\(usage\)\s*return capReached/);
  assert.match(CODE, /id: 'metered-cap', delta: meteredCapText\(\)/);
  assert.match(SRC, /import \{ meteredCapText, outOfCreditsText \}/);
  assert.match(CODE, /capLineWritten = true/);
  // A reply that finished on its own is complete: no "as far as I can take it".
  assert.match(CODE, /capReached && !capLineWritten && steps\.at\(-1\)\?\.finishReason !== 'stop'/);
});

test('metered settlement remains after provider work and before improvement capture', () => {
  const finish = CODE.indexOf("finishAiRequest(usage, 'completed', meter.spent)");
  assert.ok(finish > CODE.indexOf('await meter.refund()'));
  assert.ok(finish < CODE.indexOf('recordImprovementWithDeadline(chatPool(),'));
});

test('metered admission exposes the minimum and the header preserves a decimal balance string', () => {
  assert.match(CODE, /needed: result\.needed \?\? \(result\.allowed \? undefined : quote\.policy\.legHoldMinCredits\)/);
  assert.match(CODE, /typeof meter\.balance === 'string'[\s\S]*String\(meter\.balance\) : '-1'/);
});

// ── THE METER-REFUSAL LEDGER ────────────────────────────────────────────────
//
// `meteredRefusals.ts` can be perfect and change nothing: the retry loop it
// closes lives in the serverless function, across HTTP legs, and both ends of
// the wiring are one line each. Unplugging either leaves the whole api suite
// green — which is precisely the mutation this file exists to catch.

test('the deep tier is given the turn\'s meter refusals, seeded from the replayed history', () => {
  assert.match(
    SRC,
    /import \{ seedMeteredRefusals \} from '\.\.\/apps\/api\/dist\/decke\/meteredRefusals\.js'/,
    'the ledger is no longer imported from the built module',
  );
  // SEEDED FROM `messages`. A bare `seedMeteredRefusals(null)` would be an
  // in-memory closure with a longer name: correct across the SDK's own steps,
  // blind to the browser's approval legs, which is where the bug was measured.
  assert.match(SRC, /const deepRefusals = seedMeteredRefusals\(messages\)/);
  assert.match(SRC, /refusals: deepRefusals/, 'buildDeepTools no longer receives the ledger');
});

test('the same ledger narrows activeTools, so a spent tier leaves the model\'s view', () => {
  assert.match(
    SRC,
    /activeTools: focusedTools\(allDeckeTools, stepNumber, \(n\) => deepRefusals\.unavailable\(n\) \|\| reflex\.hide\.includes\(n\)\)/,
    'prepareStep no longer removes a spent deep tier from activeTools',
  );
});

test('the model loop uses the post-lookup settling rule from the built module', () => {
  assert.match(
    SRC,
    /import \{ askedThisStep, askedThisTurn, askPendingInstruction, spokeAndSettled, textAfterLastLookup \} from '\.\.\/apps\/api\/dist\/decke\/stopRule\.js'/,
    'the shared stop rule is no longer imported',
  );
  // WITH the nudge ledger's landings: the step that answered a progress nudge
  // must never settle the turn (review, 2026-10-10 — a nudged "checking your
  // list next" plus a face was the whole reply).
  assert.match(CODE, /\(\{ steps \}\) => spokeAndSettled\(steps, progressNudges\.landings\)/);
  assert.doesNotMatch(CODE, /spokeAndSettled\(steps\)/, 'the stop rule lost the nudge landings');
});

// ── AN INTERIM LINE IS NOT AN ANSWER ────────────────────────────────────────
//
// The step-budget ("circles") and empty-answer guards used to treat text in
// ANY step as an answer, so one nudged or interim progress line switched both
// off. They now read only what was said after the last lookup — the rule the
// stop rule already used.

test('the circles and empty-answer guards read text after the last lookup, not every step', () => {
  assert.match(CODE, /const spoke = textAfterLastLookup\(steps\)\.trim\(\)\.length > 0\s*\n\s*if \(!capReached && !spoke && steps\.length >= MAX_STEPS\)/);
  assert.doesNotMatch(CODE, /const spoke = steps\.some\(/, 'the circles guard went back to counting any text');
  assert.match(CODE, /const answerAfterLookups = textAfterLastLookup\(steps\)/);
  assert.doesNotMatch(CODE, /needsAnswerNudge\(\s*answerText\b/, 'the empty-answer guard went back to counting interim lines');
});

test('composed as chat.mjs composes them: a progress line then silence is an unanswered turn', () => {
  const calls = (...names: string[]) => names.map((toolName) => ({ toolName }));
  // Three lookups, the nudged line with a fourth, then nothing.
  const line = 'Two losses to Dragapult so far — checking your list next.';
  const steps = [
    { text: '', toolCalls: calls('battle_logs') },
    { text: '', toolCalls: calls('deck_history') },
    { text: '', toolCalls: calls('decks') },
    { text: line, toolCalls: calls('decks') },
    { text: '', toolCalls: [] },
  ];
  const called = ['battle_logs', 'deck_history', 'decks', 'decks'];
  const none = new Set<string>();
  const everyText = steps.map((step) => step.text).join('\n');
  // The old reading: any text at all, so the guard stayed quiet.
  assert.equal(needsAnswerNudge(everyText, called, none, called, none), false);
  // The new one: nothing was said after the last lookup.
  assert.equal(needsAnswerNudge(textAfterLastLookup(steps), called, none, called, none), true);
  // And an answer after the last lookup still satisfies it.
  const answered = [...steps.slice(0, 4), { text: 'Cut one Iono for a Counter Catcher.', toolCalls: [] }];
  assert.equal(needsAnswerNudge(textAfterLastLookup(answered), called, none, called, none), false);
  // The stop rule agrees on what an answer is, and exempts the nudged step.
  assert.equal(spokeAndSettled([...steps.slice(0, 3), { text: line, toolCalls: calls('express') }], [3]), false);
});

test('prepareStep still delegates visibility and hard impossibilities to focusedTools', () => {
  assert.match(
    CODE,
    /activeTools: focusedTools\(allDeckeTools, stepNumber, \(n\) => deepRefusals\.unavailable\(n\) \|\| reflex\.hide\.includes\(n\)\)/,
  );
});

test('an untouched latest-message paste gets the bounded three-step logging backstop', () => {
  assert.match(SRC, /pasteBackstopNeeded,[\s\S]*PASTE_BACKSTOP_LINE,[\s\S]*pasteBackstopInstruction/);
  assert.match(
    CODE,
    /extractPastedLog\(latestUserMessage \? \[latestUserMessage\] : \[\]\) !== null/,
    'paste detection must inspect only the latest user message',
  );
  assert.match(CODE, /firstLegOfTurn: earlierTurnToolNames\.length === 0/);
  assert.match(CODE, /anyApprovalPending,/);
  assert.match(CODE, /corrective = 'add_battle_log'/);
  assert.match(CODE, /delta: pasteBackstop \? PASTE_BACKSTOP_LINE : CORRECTION_LINE/);
  assert.match(CODE, /pasteRecovery \? pasteBackstopInstruction\(\{ afterAsk: pasteAwaitingAnswer \}\) : correctiveInstruction\(corrective\)/);
  assert.match(CODE, /stopWhen: pasteRecovery \? stepCountIs\(3\) : stepCountIs\(1\)/);
  assert.match(CODE, /if \(!asked\) writer\.write\([^\n]*CORRECTION_FAILED_LINE/);
});

test('an ask raised over a paste DEFERS the backstop to the leg that answers it (S-a)', () => {
  // On the paste turn `askedReader` suppresses it; on the answer turn the paste
  // is no longer in the latest message. Without this the log could never land.
  assert.match(SRC, /pastedBeforeAnsweredAsk,\s*\} from '\.\.\/apps\/api\/dist\/decke\/pasteBackstop\.js'/);
  assert.match(CODE, /const pasteAwaitingAnswer = !pastedNow && pastedBeforeAnsweredAsk\(messages\)/);
  assert.match(CODE, /pasteBackstopNeeded\(\{\s*pastedInLatestUserMessage,\s*pastedBeforeAnsweredAsk: pasteAwaitingAnswer,/);
  // The answer leg routes with battle_log (the @pasted rule) and an audit-chosen
  // log correction there gets the same three-step recovery.
  assert.match(CODE, /pastedLog: pastedNow \|\| pasteAwaitingAnswer/);
  assert.match(CODE, /const auditPasteRecovery = fixable === 'add_battle_log' && \(pastedInLatestUserMessage \|\| pasteAwaitingAnswer\)/);
});

test('a pending approval blocks every corrective model leg', () => {
  // ai@7 approval parts are `{ type, approvalId, toolCall }`; the old wiring
  // read `content.toolCallId`, found nothing, and replayed a call with no result
  // into a corrective leg. convertToLanguageModelPrompt then rejected the leg
  // before the browser could render the original approval card (2026-10-10).
  assert.match(
    CODE,
    /const anyApprovalPending = steps\.some\([^;]+content\.type === 'tool-approval-request'/,
  );
  assert.match(CODE, /if \(fixable && !anyApprovalPending &&/);
  assert.match(CODE, /pasteBackstopNeeded\(\{[\s\S]*anyApprovalPending,/);
  assert.doesNotMatch(CODE, /content\.toolCallId/);
});

test('a valid ask card blocks the audit, its corrective leg and the paste backstop (S4)', () => {
  // An approval for a guessed log must never dock above "which deck was this?".
  // An ask from an earlier leg of this turn (S-b) counts: it is still open.
  assert.match(CODE, /const askedReader = askedThisTurn\(steps\) \|\| askedEarlierThisTurn/);
  assert.match(CODE, /const audit = calledToolNames\.some\(\(n\) => CLIENT_SET\.has\(n\)\) \|\| askedReader\s*\? null/);
  assert.match(CODE, /if \(fixable && !anyApprovalPending && !askedReader && steps\.length \+ correctionSteps <= MAX_STEPS\)/);
  assert.match(CODE, /pasteBackstopNeeded\(\{[\s\S]*turnTroubled,\s*askedReader,\s*\}\)/);
  // Computed from THIS request's steps before either decision reads it.
  assert.ok(CODE.indexOf('const askedReader = askedThisTurn(steps)') < CODE.indexOf('const audit = '));
});

test('a leg after an ask in the same turn finishes the approved work and ends (S-b)', () => {
  // The browser replays the ask beside a held write or a browser tool; the
  // reader's approval is consent for that write only, never an answer.
  assert.match(CODE, /const askedEarlierThisTurn = turnToolNames\(messages\)\.includes\('ask_user'\)/);
  assert.match(SRC, /import \{ askedThisStep, askedThisTurn, askPendingInstruction, spokeAndSettled \}/);
  // No new tool calls (the approved write itself runs before step 0)...
  assert.match(CODE, /\.\.\.\(askedEarlierThisTurn\s*\? \{ toolChoice: 'none' \}\s*: stepNumber === 0 && reflex\.force/);
  // ...one step, and told why.
  assert.match(CODE, /\(\) => askedEarlierThisTurn,/);
  assert.match(CODE, /instructions: instructionsFor\(choice, askedEarlierThisTurn \? askPendingInstruction\(\) : undefined\)/);
});

test('an audit-chosen battle-log correction gets the three-step pasted-log recovery', () => {
  assert.match(
    CODE,
    /const auditPasteRecovery = fixable === 'add_battle_log' && \(pastedInLatestUserMessage \|\| pasteAwaitingAnswer\)/,
  );
  assert.match(CODE, /const correctionSteps = auditPasteRecovery \? 3 : 1/);
  assert.match(CODE, /pasteRecovery = auditPasteRecovery/);
  // It is still an audit correction reader-side: only the true backstop gets
  // the backstop line. The wider instruction/step budget is model-side.
  assert.match(CODE, /delta: pasteBackstop \? PASTE_BACKSTOP_LINE : CORRECTION_LINE/);
});

// ── SEC-04: THE CONVERSATION IS BOUNDED BEFORE ANYTHING PAYS FOR IT ─────────
//
// `wireBounds.ts` can be perfect and bound nothing: the body is read, parsed,
// metered and converted here, and each of those is one line.

test('the body is read through the capped reader, and the uncapped one is gone', () => {
  assert.match(CODE, /await readBodyCapped\(req\)/, 'the handler no longer caps the body');
  assert.match(CODE, /if \(body === null\) \{\s*res\.statusCode = 413/, 'an oversized body no longer answers 413');
  assert.doesNotMatch(CODE, /for await \(const chunk of req\) chunks\.push\(chunk\)/, 'the uncapped reader came back');
});

test('the conversation is validated before any ledger, the meter or the model reads it', () => {
  const at = (s: string) => CODE.indexOf(s);
  const validate = at('const wire = validateWire(body?.messages)');
  assert.ok(validate > 0, 'validateWire is no longer called on the body');
  assert.match(CODE, /if \(!wire\.ok\) return json\(\{ error: wire\.error, code: wire\.code \}, wire\.status\)/);
  assert.match(CODE, /const messages = wire\.messages/, 'later code no longer reads the VALIDATED messages');
  for (const later of ['declinedCalls(messages', 'quote = await readPolicy(', 'usage = await beginAiRequest(', 'meter = await meterTurn(']) {
    assert.ok(validate < at(later), `${later} runs before the conversation is validated`);
  }
});

test('the model is shown the window, and the prompt the bounded page context', () => {
  assert.match(CODE, /convertToModelMessages\(stripPriorCommands\(windowForModel\(messages\)\.messages\)\)/);
  assert.match(CODE, /const route = boundedRoute\(body\?\.route\)/);
  assert.match(CODE, /const landmarks = boundedLandmarks\(body\?\.landmarks\)/);
  assert.doesNotMatch(CODE, /landmarks\.slice\(0, 40\)/, 'the old count-only slice is back');
});

test('the charge reference carries the exchange, so two new exchanges with the same window differ (Astra)', () => {
  // And the route echo — only when it is USED (a continuation leg), so a first
  // leg's identity cannot depend on a body field it ignores.
  assert.match(CODE, /chatChargeReference\(conversationId, messages, route, landmarks, \{ exchangeId, seq \}, echoed\)/);
  assert.ok(CODE.indexOf('const echoed = firstLeg ? null : readRouteEcho(body?.tierRoute)') < CODE.indexOf('reference = chatChargeReference('));
});

test('dropped replies\' evidence reaches the two ledgers and never the model', () => {
  assert.match(CODE, /const evidence = boundedEvidence\(body\?\.evidence\)/);
  // Read by the two ledgers and nothing else — in particular never spread into
  // what the model is shown.
  const reads = CODE.match(/\.\.\.evidence\b/g) ?? [];
  assert.equal(reads.length, 1, `evidence is read ${reads.length} times; only the failing ledger needs it`);
  assert.doesNotMatch(CODE, /windowForModel\([^)]*evidence/);
});

test('a credit refusal says whether the wallet is HELD, as a flag rather than prose', () => {
  // UXD-08: a held wallet was told to "Top up", on a page where purchases are
  // on hold. The body's sentence differed, but `held` can be true with a short
  // balance too (debt), so the browser needs the verdict itself to choose
  // between "Top up credits" and "Open credit wallet". `httpNotice.ts` reads it.
  assert.match(
    SRC,
    /credits: \{ balance: meter\.balance == null \? meter\.balance : Number\(meter\.balance\), needed: meter\.needed, held: meter\.held === true \}/,
    'the 429 body no longer carries `held` — a held wallet will be told to top up',
  );
});

// ── THE REFLEX READ ─────────────────────────────────────────────────────────
//
// `reflex.ts` can decide perfectly and change nothing: its three effects are
// three expressions in this file, each one easy to drop in an edit.

test('the reflex read runs after the meter, from the built module, with the turn\'s abort', () => {
  assert.match(SRC, /import \{ readReflex \} from '\.\.\/apps\/api\/dist\/decke\/reflex\.js'/);
  // Wrapped in runAiUsage so Jev's own model call is metered on this request.
  const read = CODE.indexOf('runAiUsage(usage, () => readReflex(messages, route, { key, signal: request.signal }))');
  assert.ok(read > 0, 'readReflex is no longer called with the validated messages, the key and the signal');
  // A Gateway call: nothing reaches the Gateway unpaid.
  assert.ok(CODE.indexOf('meter = await meterTurn(') < read, 'the reflex read runs before the meter');
  assert.ok(CODE.indexOf('if (!meter.allowed)') < read, 'the reflex read runs for a refused turn');
  assert.match(CODE, /const \[reflex, triage\] = await Promise\.all\(\[/);
});

test('triage is metered beside reflex and code chooses the conversation tier', () => {
  assert.match(SRC, /import \{ runTriage \} from '\.\.\/apps\/api\/dist\/decke\/triage\.js'/);
  assert.match(SRC, /import \{ answeringAsk, carriedFromHistory, continuationFloor, decideTier, quickRefusalRetry, raisedToStandard, resumesApproval \} from '\.\.\/apps\/api\/dist\/decke\/tiers\.js'/);
  assert.match(CODE, /runTriage\(\{[\s\S]*message: latestUserText\(messages\)[\s\S]*model: observeUsageModel\(gateway\(TRIAGE\.id\), meter\)/);
  assert.match(CODE, /answering: answeringAsk\(messages\)/);
  assert.match(CODE, /decision = decideTier\(\{ triage, carried: carriedFromHistory\(messages\), deepApproved: false, pastedLog: pastedNow \|\| pasteAwaitingAnswer \}\)/);
  // Deep stays behind a signed reader choice that does not exist on this branch.
  assert.doesNotMatch(CODE, /deepApproved: (?!false\b)/);
  assert.match(CODE, /const choice = TIERS\[decision\.tier\]/);
  assert.match(CODE, /console\.log\('\[deck-e\] route', JSON\.stringify\(\{/);
});

test('triage is advisory usage: its own operation key, and its failure never fails the request', () => {
  assert.match(SRC, /runAdvisoryUsage/);
  assert.match(CODE, /runAdvisoryUsage\(usage, 'triage', \(\) => runTriage\(\{/);
  assert.doesNotMatch(CODE, /runAiUsage\(usage, \(\) => runTriage/);
});

test('a pasted log in the latest message reaches decideTier (S6), read from that message only', () => {
  assert.match(CODE, /const pastedNow = extractPastedLog\(latestUserMessageForTriage \? \[latestUserMessageForTriage\] : \[\]\) !== null/);
  assert.match(CODE, /pasted: pastedNow,/);
  assert.match(CODE, /pastedLog: pastedNow/);
});

// ── ONE ROUTE PER TURN (S5) ─────────────────────────────────────────────────
//
// `routeEcho.ts` validates; these are the lines that make a continuation leg
// run on the model and guidance its first leg chose.

test('the echo is read from `tierRoute`, never from `route` (the page)', () => {
  assert.match(SRC, /import \{ ROUTE_ECHO_PART, decisionFromEcho, readRouteEcho, routeEchoFor \} from '\.\.\/apps\/api\/dist\/decke\/routeEcho\.js'/);
  assert.match(CODE, /readRouteEcho\(body\?\.tierRoute\)/);
  assert.doesNotMatch(CODE, /readRouteEcho\(body\?\.route\)/);
  assert.match(CODE, /const route = boundedRoute\(body\?\.route\)/, 'the page pathname must stay `route`');
});

test('a first leg triages and writes the transient route part; a continuation reuses a valid echo', () => {
  assert.match(CODE, /const firstLeg = turnToolNames\(messages\)\.length === 0/);
  // The echo is not even read on a first leg.
  assert.match(CODE, /const echoed = firstLeg \? null : readRouteEcho\(body\?\.tierRoute\)/);
  // Triage is SKIPPED, not merely overridden, when the echo is reused.
  assert.match(CODE, /echoed \? null : runAdvisoryUsage\(usage, 'triage'/);
  assert.match(CODE, /if \(echoed\) \{\s*decision = decisionFromEcho\(echoed\)/);
  // No echo on a continuation: re-triage, never below Standard.
  assert.match(CODE, /if \(!firstLeg\) decision = continuationFloor\(decision\)/);
  // Only a first leg emits, through the same transient writer pattern as the
  // other data-decke-* parts, before anything else on the stream.
  assert.match(CODE, /const routeEcho = firstLeg \? routeEchoFor\(decision\) : null/);
  assert.match(CODE, /writer\.write\(\{ type: ROUTE_ECHO_PART, data: routeEcho, transient: true \}\)/);
  const execute = CODE.indexOf('execute: async ({ writer }) => runAiUsage(usage');
  const write = CODE.indexOf('type: ROUTE_ECHO_PART');
  assert.ok(execute > 0 && write > execute, 'the route part is written inside the stream');
  assert.ok(write < CODE.indexOf('if (capReached) {'), 'the route part is the first thing written');
  // The route log line says when the echo was reused.
  assert.match(CODE, /triage: echoed \? 'echo' : triage\.source,/);
});

test('the selected pathway prompt is an instructions array with only stable regions cached', () => {
  assert.match(SRC, /import \{ buildCorePrompt, buildVolatileContext \} from '\.\.\/apps\/api\/dist\/decke\/prompt\.js'/);
  assert.match(SRC, /import \{ pathwayBlock \} from '\.\.\/apps\/api\/dist\/decke\/pathways\/index\.js'/);
  assert.match(CODE, /const corePrompt = buildCorePrompt\(\{/);
  assert.match(CODE, /const requestPathway = pathwayBlock\(decision\.pathways\)/);
  assert.match(CODE, /const volatileContext = buildVolatileContext\(\{ route, signedIn: true, landmarks \}\)/);
  assert.match(CODE, /const instructionsFor = \(choice, extra\) => \[/);
  assert.match(CODE, /systemMessage\(choice, corePrompt, true\)/);
  assert.match(CODE, /systemMessage\(choice, requestPathway, true\)/);
  assert.match(CODE, /systemMessage\(choice, volatileContext\)/);
  assert.match(CODE, /instructions: instructionsFor\(choice, askedEarlierThisTurn \? askPendingInstruction\(\) : undefined\)/);
  assert.match(CODE, /const cached = cacheConversation\(choice, messages\)/);
});

// ── PROGRESS BETWEEN BATCHES ────────────────────────────────────────────────
//
// `progressNudge.ts` can decide perfectly and change nothing: the nudge is a
// handful of expressions in this file — build the ledger, ask it, append the
// message, lift the SDK's system-message guard — and dropping any one of them
// leaves its unit tests green while Deck-E goes back to a silent minute.

test('the progress nudge is decided by the built module, per request, for Anthropic only', () => {
  assert.match(
    SRC,
    /import \{ createProgressNudges, progressNudgeMessage \} from '\.\.\/apps\/api\/dist\/decke\/progressNudge\.js'/,
  );
  // ONE ledger per request, created before the call that may be retried — a
  // ledger built inside `startConversation` would give the Standard retry its
  // own two nudges.
  const ledger = CODE.indexOf('const progressNudges = createProgressNudges()');
  assert.ok(ledger > 0, 'the per-request nudge ledger is gone');
  assert.ok(ledger < CODE.indexOf('const startConversation = (choice, effort) => streamText({'));
  assert.equal(CODE.match(/createProgressNudges\(\)/g)?.length, 1);
  // Asked with the call's REAL steps, and only for Anthropic.
  assert.match(CODE, /const nudge = !askedEarlierThisTurn && isAnthropic\(choice\) && progressNudges\.next\(steps\)/);
  assert.match(CODE, /prepareStep: \(\{ stepNumber, steps, messages \}\) => \{/);
  // And the SAME ledger tells the stop rule which step answered it, inside the
  // same streamText call.
  const start = CODE.slice(
    CODE.indexOf('const startConversation = (choice, effort) => streamText({'),
    CODE.indexOf('result = startConversation(choice, decision.effort)'),
  );
  assert.match(start, /stopWhen: \[[\s\S]*spokeAndSettled\(steps, progressNudges\.landings\)[\s\S]*prepareStep:/);
});

test('the nudge is appended AFTER the cache breakpoint, which stays on the newest non-system message', () => {
  // The order is the property: cache first, then append. Appending first would
  // either mark the nudge or — before cacheConversation learned to skip system
  // messages — move the breakpoint onto it.
  assert.match(CODE, /messages: nudge \? \[\.\.\.cached, progressNudgeMessage\(\)\] : cached/);
  const fn = CODE.slice(CODE.indexOf('function cacheConversation'), CODE.indexOf('const CLIENT_SET'));
  assert.match(fn, /const newest = messages\.findLastIndex\(\(message\) => message\.role !== 'system'\)/);
  assert.match(fn, /if \(index === newest\)/);
  assert.doesNotMatch(fn, /index === messages\.length - 1/, 'the breakpoint went back to the last message, nudge or not');
});

test('system messages are allowed in the conversation call only for Anthropic, and never in the corrective leg', () => {
  const start = CODE.slice(
    CODE.indexOf('const startConversation = (choice, effort) => streamText({'),
    CODE.indexOf('result = startConversation(choice, decision.effort)'),
  );
  assert.match(start, /allowSystemInMessages: isAnthropic\(choice\)/);
  assert.doesNotMatch(CODE, /allowSystemInMessages: true/);
  assert.equal(CODE.match(/allowSystemInMessages/g)?.length, 1);
  // The leg is built from step RESPONSE messages, which never hold the nudge.
  const leg = CODE.slice(CODE.indexOf('if (corrective) {'));
  assert.doesNotMatch(leg, /allowSystemInMessages|progressNudge/);
});

test('lifting the SDK guard does not hand the system role to the browser', () => {
  // `allowSystemInMessages` turns off ai@7's refusal of system messages in
  // `messages`. What stands between a reader and that role is the wire schema.
  const wire = readFileSync(fileURLToPath(new URL('../wireBounds.ts', import.meta.url)), 'utf8');
  assert.match(wire, /role: z\.enum\(\['user', 'assistant'\]\)/);
  assert.match(CODE, /convertToModelMessages\(stripPriorCommands\(windowForModel\(messages\)\.messages\)\)/);
});

test('only a VALID ask_user stops the loop, and a Quick refusal before any data tool retries once on Standard', () => {
  // S1: `hasToolCall` counts a call that failed its schema (`invalid: true`).
  assert.match(CODE, /\(\{ steps \}\) => askedThisStep\(steps\)/);
  assert.doesNotMatch(CODE, /hasToolCall\(/);
  // A near-miss ask is trimmed, not failed — ask_user reports its trims.
  assert.match(CODE, /const REPAIRABLE = new Set\(\['showScreen', 'ask_user'\]\)/);
  // The refusal retry no longer waits for "no text anywhere".
  assert.match(
    CODE,
    /if \(quickRefusalRetry\(\{\s*tier: decision\.tier,\s*finishReason: quickFinish,\s*steps: quickSteps,\s*isDataTool: \(name\) => !SERVER_SET\.has\(name\) && !CLIENT_SET\.has\(name\),\s*resumingApproval: resumesApproval\(preparedMessages\),\s*\}\)\) \{/,
  );
  assert.match(CODE, /const retry = startConversation\(TIERS\.standard, escalated\.effort\)/);
});

test('the refusal retry never re-runs an approved write, and moves the turn\'s echo to Standard (B1)', () => {
  // ai@7 executes approved calls from the incoming messages before step 0; a
  // second streamText over the same `preparedMessages` would execute them again.
  // `resumesApproval` reads the SAME model messages the retry would send.
  const retryBlock = CODE.slice(CODE.indexOf('if (quickRefusalRetry({'), CODE.indexOf('result = retry'));
  assert.match(retryBlock, /resumingApproval: resumesApproval\(preparedMessages\)/);
  assert.match(retryBlock, /const retry = startConversation\(TIERS\.standard, escalated\.effort\)/);
  // A second route part, written BEFORE the retry starts, so the browser's echo
  // (still Quick) is replaced and an approval the retry raises resumes on Standard.
  assert.match(retryBlock, /const escalated = raisedToStandard\(decision, 'retry:refusal'\)/);
  assert.match(retryBlock, /const escalatedEcho = routeEchoFor\(escalated\)/);
  assert.match(retryBlock, /writer\.write\(\{ type: ROUTE_ECHO_PART, data: escalatedEcho, transient: true \}\)/);
  assert.ok(retryBlock.indexOf('ROUTE_ECHO_PART') < retryBlock.indexOf('startConversation('));
  // `[deck-e] route` stays one line per request.
  assert.equal(CODE.match(/console\.log\('\[deck-e\] route',/g)?.length, 1);
});

test('only replayed approval denials reach the declined ledger', () => {
  assert.match(CODE, /const declined = declinedCalls\(messages\)/);
  assert.doesNotMatch(CODE, /reflex\.declines/);
});

test('a read collection change forces the first step, and only the first step', () => {
  assert.match(
    CODE,
    /stepNumber === 0 && reflex\.force[\s\S]*toolChoice: isAnthropic\(choice\) \? 'auto' : \{ type: 'tool', toolName: reflex\.force \}/,
    'prepareStep no longer keeps Anthropic adaptive while forcing other providers',
  );
});

// ── THE AFTER-TURN AUDIT ────────────────────────────────────────────────────
//
// `audit.ts` decides; these are the four lines that make its decision do
// anything, and the one that keeps a navigation handoff out of it.

test('the audit reads the turn\'s whole tool record, and a handoff is never audited', () => {
  assert.match(SRC, /from '\.\.\/apps\/api\/dist\/decke\/audit\.js'/);
  assert.match(CODE, /const audit = calledToolNames\.some\(\(n\) => CLIENT_SET\.has\(n\)\)( \|\| askedReader)?\s*\? null\s*: await auditTurn\(\{/);
  assert.match(
    CODE,
    /toolsRun: \[\.\.\.calledToolNames, \.\.\.guardEvents\.map\(\(e\) => e\.name\), \.\.\.turnToolNames\(messages\)\]/,
    'an approved write that ran at the start of this request would read as a phantom',
  );
});

test('only a correctable phantom within the step budget gets a corrective leg; the rest are admitted', () => {
  assert.match(CODE, /const fixable = audit\?\.phantom \? CORRECTIVE_TOOLS\[audit\.phantom\] : undefined/);
  assert.match(
    CODE,
    /if \(fixable && !anyApprovalPending && !askedReader && steps\.length \+ correctionSteps <= MAX_STEPS\) \{\s*corrective = fixable/,
  );
  assert.match(CODE, /\} else if \(phantoms\.length > 0 \|\| audit\?\.phantom\) \{/);
});

test('the corrective leg keeps Anthropic adaptive, signed and bounded to one audit step or three paste steps', () => {
  const leg = CODE.slice(CODE.indexOf('if (corrective) {'))
  assert.match(SRC, /buildDataTools, correctiveApplyTools, dataToolSummary/)
  assert.match(leg, /tools: correctiveApplyTools\(allDeckeTools, corrective\)/)
  assert.match(leg, /toolChoice: isAnthropic\(TIERS\.standard\) \? 'auto' : \{ type: 'tool', toolName: corrective \}/);
  assert.match(leg, /stopWhen: pasteRecovery \? stepCountIs\(3\) : stepCountIs\(1\)/);
  assert.match(leg, /experimental_toolApprovalSecret: process\.env\.DECKE_APPROVAL_SECRET/);
  assert.match(leg, /instructions: instructionsFor\(\s*TIERS\.standard,\s*pasteRecovery \? pasteBackstopInstruction\(\{ afterAsk: pasteAwaitingAnswer \}\) : correctiveInstruction\(corrective\),/);
  assert.match(leg, /model: observeUsageModel\(gateway\(TIERS\.standard\.id\), meter\)/, 'the leg must be metered like any step');
  assert.match(leg, /maxOutputTokens: budgetFor\(TIERS\.standard\)/);
});

test('both chat model calls pass the configured fallback through Gateway routing', () => {
  assert.match(CODE, /function chatProviderOptions\(choice, effort\)/)
  assert.match(CODE, /gateway:\s*\{ models:\s*\[choice\.fallback\] \}/)
  assert.match(CODE, /providerOptions: chatProviderOptions\(choice, effort\)/)
  assert.match(CODE, /providerOptions: chatProviderOptions\(TIERS\.standard, 'medium'\)/)
  // `effort` is a TOP-LEVEL Anthropic provider option (@ai-sdk/anthropic
  // anthropic-language-model-options.ts); nested inside `thinking` it is
  // stripped by the schema and the tier silently runs at the model default.
  assert.match(CODE, /anthropic: \{ effort, thinking: \{ type: 'adaptive' \} \}/)
})

test('Anthropic prompt caching, deck checks and the expanded step budget are wired', () => {
  assert.match(CODE, /const MAX_STEPS = 24/);
  assert.match(CODE, /providerOptions: ANTHROPIC_CACHE/);
  assert.match(CODE, /cacheControl: \{ type: 'ephemeral' \}/);
  // Through apps/api/dist, never '@deckpal/agent-tools' directly: the root
  // package does not declare it, so the deployed function could not load it.
  assert.match(CODE, /import \{ checkDeck \} from '\.\.\/apps\/api\/dist\/decke\/deckCheck\.js'/);
  assert.doesNotMatch(CODE, /from '@deckpal\/agent-tools'/);
  assert.match(CODE, /checkDeck: \(input\) => checkDeck\(toolCtx, input\)/);
  assert.match(CODE, /for \(const output of replayedToolOutputs\(messages\)\) grounding\.observe\(output\)/);
});

test('improvement capture receives identity, correlation and runs after usage finalization', () => {
  assert.match(SRC, /import \{ autoShareAndRecordLeg \} from '\.\.\/apps\/api\/dist\/decke\/improvement\.js'/)
  assert.match(CODE, /db: chatPool\(\),\s*userId: user\.id,\s*conversationId,/)
  assert.match(CODE, /requestId: usage\.id,\s*leg: 0,\s*payload,/)
  assert.ok(CODE.indexOf("finishAiRequest(usage, 'completed', meter.spent)") < CODE.indexOf('recordImprovementWithDeadline(chatPool(),'))
  assert.match(CODE, /autoShareAndRecordLeg\(db, record\)/)
  assert.match(CODE, /toolResult\.output/)
  assert.match(CODE, /createNarrationFilter\(\)/)
})
