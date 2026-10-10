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
    /needsAnswerNudge\(\s*answerText,\s*calledToolNames,\s*CLIENT_SET,\s*completedToolNames,\s*SERVER_SET\s*\)/,
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
    /import \{ askedThisStep, askedThisTurn, spokeAndSettled \} from '\.\.\/apps\/api\/dist\/decke\/stopRule\.js'/,
    'the shared stop rule is no longer imported',
  );
  assert.match(CODE, /\(\{ steps \}\) => spokeAndSettled\(steps\)/);
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
  assert.match(CODE, /pasteRecovery \? pasteBackstopInstruction\(\) : correctiveInstruction\(corrective\)/);
  assert.match(CODE, /stopWhen: pasteRecovery \? stepCountIs\(3\) : stepCountIs\(1\)/);
  assert.match(CODE, /if \(!asked\) writer\.write\([^\n]*CORRECTION_FAILED_LINE/);
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
  assert.match(CODE, /const askedReader = askedThisTurn\(steps\)/);
  assert.match(CODE, /const audit = calledToolNames\.some\(\(n\) => CLIENT_SET\.has\(n\)\) \|\| askedReader\s*\? null/);
  assert.match(CODE, /if \(fixable && !anyApprovalPending && !askedReader && steps\.length \+ correctionSteps <= MAX_STEPS\)/);
  assert.match(CODE, /pasteBackstopNeeded\(\{[\s\S]*turnTroubled,\s*askedReader,\s*\}\)/);
  // Computed from THIS request's steps before either decision reads it.
  assert.ok(CODE.indexOf('const askedReader = askedThisTurn(steps)') < CODE.indexOf('const audit = '));
});

test('an audit-chosen battle-log correction gets the three-step pasted-log recovery', () => {
  assert.match(
    CODE,
    /const auditPasteRecovery = fixable === 'add_battle_log' && pastedInLatestUserMessage/,
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
  // And the validated route echo, which chooses the model the leg runs on.
  assert.match(CODE, /chatChargeReference\(conversationId, messages, route, landmarks, \{ exchangeId, seq \}, tierRoute\)/);
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
  assert.match(SRC, /import \{ answeringAsk, carriedFromHistory, continuationFloor, decideTier, quickRefusalRetry \} from '\.\.\/apps\/api\/dist\/decke\/tiers\.js'/);
  assert.match(CODE, /runTriage\(\{[\s\S]*message: latestUserText\(messages\)[\s\S]*model: observeUsageModel\(gateway\(TRIAGE\.id\), meter\)/);
  assert.match(CODE, /answering: answeringAsk\(messages\)/);
  assert.match(CODE, /decision = decideTier\(\{ triage, carried: carriedFromHistory\(messages\), deepApproved: false, pastedLog: pastedNow \}\)/);
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
  assert.match(CODE, /const tierRoute = readRouteEcho\(body\?\.tierRoute\)/);
  assert.doesNotMatch(CODE, /readRouteEcho\(body\?\.route\)/);
  assert.match(CODE, /const route = boundedRoute\(body\?\.route\)/, 'the page pathname must stay `route`');
});

test('a first leg triages and writes the transient route part; a continuation reuses a valid echo', () => {
  assert.match(CODE, /const firstLeg = turnToolNames\(messages\)\.length === 0/);
  assert.match(CODE, /const echoed = firstLeg \? null : tierRoute/);
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
  assert.match(CODE, /instructions: instructionsFor\(choice\)/);
  assert.match(CODE, /messages: cacheConversation\(choice, messages\)/);
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
    /if \(quickRefusalRetry\(\{\s*tier: decision\.tier,\s*finishReason: quickFinish,\s*steps: quickSteps,\s*isDataTool: \(name\) => !SERVER_SET\.has\(name\) && !CLIENT_SET\.has\(name\),\s*\}\)\) \{/,
  );
  assert.match(CODE, /const retry = startConversation\(TIERS\.standard, 'medium'\)/);
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
  assert.match(leg, /instructions: instructionsFor\(\s*TIERS\.standard,\s*pasteRecovery \? pasteBackstopInstruction\(\) : correctiveInstruction\(corrective\),/);
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
