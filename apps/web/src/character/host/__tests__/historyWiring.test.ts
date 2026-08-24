/**
 * ══════════════════════════════════════════════════════════════════════════════
 * THE CHAT HISTORY IS ACTUALLY WIRED, AND ACTUALLY READ-ONLY.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Two jobs, and the first one is this repository's most repeated defect. Six
 * times in two days a component was built, tested, put in the gallery and never
 * mounted — `CardRows`, `onRemoveCard`, `resetDeckeEntitlement`, `DeckeFarewell`,
 * the `declined` phase, `DeckeNotice` — and the third of those meant Deck-E did
 * not appear at all for a signed-in reader. `historyState.ts` has 24 passing
 * tests that would all still pass if nothing on screen ever called it.
 *
 * The second job is the one failure this surface can have: somebody typing into
 * a transcript they are only reading. That is enforced by an ABSENCE — there is
 * no composer in the viewer — and an absence is exactly the kind of guarantee
 * that gets undone by a well-meaning edit, because adding a text box back looks
 * like a feature.
 *
 * SOURCE PINS. `DeckeChat.tsx` and the two new `.tsx` files reach
 * `import.meta.env` through their imports and cannot be loaded under
 * `node --import tsx --test` at all — which is why two bugs in the approval
 * round trip once shipped with a green suite.
 */
import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8')

const PANEL = read('../DeckeChat.tsx')
const MENU = read('../chat/HistoryMenu.tsx')
const VIEW = read('../chat/TranscriptView.tsx')
const TOOLROW = read('../chat/ToolRow.tsx')

/** Source with comment lines stripped, so a pin cannot be satisfied by prose. */
function code(src: string): string {
  return src
    .split('\n')
    .filter((l) => {
      const t = l.trimStart()
      return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*')
    })
    .join('\n')
}

// ─────────────────────────────────────────────────────────────────────────────
// IT IS MOUNTED
// ─────────────────────────────────────────────────────────────────────────────

test('the dropdown is in the header, to the right of the title', () => {
  assert.match(PANEL, /<HistoryMenu/, 'HistoryMenu is built and nothing mounts it')
  // Inside the `<header>`, not somewhere else that happens to compile. The
  // instruction was "to the right of the chat page title" and the header is the
  // only element that is the title's row.
  //
  // MUTATION HISTORY: this test came back GREEN when `<header` was renamed,
  // because `indexOf('<header')` matches any tag whose name STARTS with
  // "header". The bound is the closing tag now, which cannot be prefix-matched,
  // and the three positions are checked against each other rather than merely
  // being present — "in the header" was never the claim; "after the title and
  // before the ✕" was.
  const close = PANEL.indexOf('</header>')
  assert.ok(close > 0, 'the panel header could not be located')
  const header = PANEL.slice(PANEL.lastIndexOf('<header ', close), close)
  assert.ok(header.length > 0, 'the panel header could not be located')

  const title = header.indexOf('Deck-E')
  const menu = header.indexOf('<HistoryMenu')
  const shut = header.indexOf('aria-label="Close chat"')
  assert.ok(title >= 0, 'the title is no longer in this row')
  assert.ok(menu >= 0, 'the history control left the title row')
  assert.ok(shut >= 0, 'the close control left the title row')
  assert.ok(menu > title, 'the history control is no longer to the RIGHT of the title')
  assert.ok(menu < shut, 'the history control displaced the ✕ from the trailing edge')
})

test('picking a conversation actually opens one', () => {
  // The half that goes missing. A dropdown that lists forty conversations and
  // opens none of them looks completely correct in a screenshot.
  assert.match(PANEL, /onOpenConversation=\{setViewingId\}/, 'choosing a row no longer opens it')
  assert.match(PANEL, /<TranscriptPane\s+key=\{viewingId\}\s+id=\{viewingId\}/, 'the viewer is not mounted from the chosen id')
})

test('the viewer replaces the transcript rather than covering it', () => {
  // A modal over the conversation would put a record in front of a live turn
  // with two scroll containers fighting for the wheel — and would make the
  // composer merely covered rather than gone.
  assert.match(code(PANEL), /\{viewing \? \(/, 'the archive is no longer a branch of the column')
  assert.match(code(PANEL), /\) : \(\s*\n\s*<div\s*\n\s*ref=\{transcriptRef\}/, 'the live transcript is no longer the other branch')
})

test('the composer is GONE while a record is open, not disabled', () => {
  // THE ONE FAILURE THIS SURFACE CAN HAVE. A greyed box takes a keystroke and
  // explains afterwards; a box that is not there cannot. It is the same ruling
  // the owner already made for the spent-credit state, in the same slot.
  // MUTATION HISTORY: this came back GREEN when the slot's condition was
  // replaced with `false` — the exit bar was still in the source, still in the
  // right place in the ternary, and the composer came back on screen underneath
  // a record anyway. Pinning the shape of a branch says nothing about what
  // opens it, so the CONDITION is what is pinned now.
  const exit = code(PANEL).indexOf('<TranscriptExit')
  assert.ok(exit > 0, 'the exit bar is not mounted anywhere')
  const slot = code(PANEL).slice(exit)
  assert.match(slot, /^<TranscriptExit onBack=\{backToChat\} \/>\s*\n\s*\) : spent \? \(/,
    'the composer slot no longer branches on the archive BEFORE it branches on credit')
  const opener = code(PANEL).lastIndexOf('{viewing ? (', exit)
  assert.ok(opener > 0 && exit - opener < 900, 'the composer slot no longer opens on `viewing`')
  assert.doesNotMatch(code(VIEW), /<textarea|<input\b/, 'the transcript viewer grew an input')
  assert.doesNotMatch(code(VIEW), /<DeckeComposer/, 'the transcript viewer mounted a composer')
})

test('there is exactly one way the archive can be entered, and it clears on close', () => {
  const setters = (code(PANEL).match(/setViewingId\(/g) ?? []).length
  assert.ok(setters >= 3, `setViewingId has ${setters} call sites — the open, the close and the escape`)
  assert.match(code(PANEL), /if \(!open\) setViewingId\(null\)/,
    'reopening him would land back in a transcript somebody read yesterday')
})

test('Escape unwinds one layer at a time', () => {
  // Closing the whole panel from inside a transcript throws away the LIVE
  // conversation to dismiss a thing the reader opened two seconds ago.
  assert.match(code(PANEL), /if \(viewingRef\.current\) setViewingId\(null\)\s*\n\s*else onClose\(\)/,
    'Escape inside a record closes the whole chat again')
  // A ref, not the value: the listener is registered once per `open` and would
  // otherwise close over `viewing === false` forever.
  assert.match(code(PANEL), /viewingRef\.current = viewing/, 'the escape handler reads a stale `viewing`')
  // And the dropdown's own Escape has to run FIRST, which needs the capture
  // phase because the panel listens on `window`.
  assert.match(code(MENU), /addEventListener\('keydown', onKey, true\)/,
    'the dropdown no longer beats the panel to Escape, so Escape closes everything')
})

test('a record is never laid out as the new-chat screen', () => {
  // FOUND BY A GREEN MUTATION: nothing guarded this at all. `empty` is about the
  // LIVE conversation and stays true while a past one is open, so a five-turn
  // record opened before anyone had said anything would inherit the centred
  // no-transcript layout and be pinned to the middle of the pane — on desktop —
  // or shoved to the bottom on a phone.
  assert.match(code(PANEL), /!viewing && empty \? \(desktop \? 'justify-center' : 'justify-end'\) : ''/,
    'the archive can inherit the new-chat screen’s centring')
  assert.match(code(PANEL), /empty && desktop && !spent && !viewing \? \(/,
    'the new-chat openers can appear under a record')
})

test('“Jump to latest” never floats over a record', () => {
  // `atLatest` is measured from the LIVE scroller, which is unmounted while the
  // archive is open, so its last reading is stale and the button would scroll
  // something that is not on screen.
  assert.match(code(PANEL), /!viewing && !empty && !atLatest/, 'the jump control can appear over a transcript')
})

// ─────────────────────────────────────────────────────────────────────────────
// IT USES THE REAL COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

test('a past turn is drawn by the same components as a live one', () => {
  // A second rendering of a tool row drifts from the first within a release,
  // and then the history stops being a record of anything — it becomes a record
  // of what a different component thought the first one looked like.
  assert.match(VIEW, /import \{ ToolRow \} from '\.\/ToolRow'/, 'the viewer grew its own tool row')
  assert.match(VIEW, /import \{ ChatMarkdown \} from '\.\/ChatMarkdown'/, 'the viewer grew its own markdown renderer')
  assert.match(code(VIEW), /<ToolRow key=\{r\.id\} data=\{r\} \/>/, 'the rows are not rendered from the replayed data')
  assert.match(code(VIEW), /historyToolRows\(t\)/, 'the stored rows are no longer coerced through historyState')
  // NO `onRetry`. `canRetry` is already false for a record, but the prop is the
  // second lock and it is the one a reader can see.
  assert.doesNotMatch(code(VIEW), /<ToolRow[^>]*onRetry/, 'the viewer offered a retry for a turn that is over')
  // MUTATION HISTORY: `match(/decke-bubble/)` came back GREEN when the class was
  // stripped from HIS reply, because the reader's own bubble still carried it —
  // one occurrence satisfied a claim about two elements. BOTH bubbles are
  // checked now, by the token that distinguishes them.
  assert.match(code(VIEW), /decke-bubble rounded-\[14px\] bg-action-primary/, 'the reader’s own line stopped looking like the line it was')
  assert.match(code(VIEW), /decke-bubble decke-shift self-start/, 'a past reply stopped looking like the reply it was')
})

test('the tool row’s mark is a stated answer, not an inference', () => {
  // It was a nested ternary over the tone whose fall-through cases were "tick"
  // and "warning", so any tone nobody remembered to add drew one of those two by
  // accident. That is exactly how the tick on a refusal happened.
  assert.match(code(TOOLROW), /name=\{GLYPH_ICON\[a\.glyph\]\}/, 'the glyph went back to being inferred')
  assert.doesNotMatch(code(TOOLROW), /a\.tone === 'quiet' \? 'check'/, 'the inferring ternary is back')
})

// ─────────────────────────────────────────────────────────────────────────────
// THE BUILD STAMP IS ACTUALLY SHOWN
// ─────────────────────────────────────────────────────────────────────────────

test('every list row and every turn carries its build', () => {
  // *"Should probably have each chat transcript record say what was the latest
  // PR it's immediately after so we can easily spot regressions."* This is the
  // half of the ask that is easiest to build, test and then not render.
  assert.match(code(MENU), /buildStamp\(c\.buildPrMin, c\.buildPrMax\)/, 'a list row no longer shows its build')
  assert.match(code(MENU), /<BuildStampChip stamp=\{stamp\}/, 'the stamp is computed and not drawn')
  assert.match(code(VIEW), /turnStamp\(t\.buildPr\)/, 'a turn no longer shows the build it ran on')
  assert.match(code(VIEW), /<BuildStampChip stamp=\{stamp\} \/>/, 'the turn stamp is computed and not drawn')
})

test('the deploy rule is drawn where a deploy landed', () => {
  // The best thing in this feature and the easiest to leave unwired: the data
  // already knows, and nothing would look broken without it.
  assert.match(code(VIEW), /deployMarkers\(turns\)/, 'the deploy boundaries are no longer computed')
  assert.match(code(VIEW), /<DeployRule label=\{markers\[i\] as string\} \/>/, 'the deploy boundary is computed and not drawn')
})

test('nothing renders a build number that was never recorded', () => {
  // `#0`, `#null` and the word "unknown" are all number-shaped claims about a
  // build nobody deployed. The dash lives in one place and only one place.
  for (const [name, src] of [['HistoryMenu', MENU], ['TranscriptView', VIEW]] as const) {
    assert.doesNotMatch(code(src), /#\$\{[^}]*\?\?/, `${name} fell back to a substituted build number`)
    assert.doesNotMatch(code(src), /'#0'|"#0"/, `${name} renders #0`)
    assert.doesNotMatch(code(src), /[Uu]nknown build/, `${name} renders "unknown build"`)
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// DELETING
// ─────────────────────────────────────────────────────────────────────────────

test('deleting takes two presses', () => {
  // The RLS grants delete and deliberately withholds update: you may withdraw
  // your own words, you may not revise them. There is no soft delete, so a
  // single press on a small ✕ beside a title is not an acceptable gesture.
  assert.match(code(MENU), /onClick=\{onAskDelete\}/, 'the first press no longer merely asks')
  assert.match(code(MENU), /confirming \? \(/, 'the confirm state is gone, so one press deletes')
  assert.match(code(MENU), /onClick=\{onConfirmDelete\}/, 'nothing confirms the delete')
  assert.match(code(MENU), /onClick=\{onCancelDelete\}/, 'there is no way out of the confirm')
})

test('nothing is removed from the list until the server says it is gone', () => {
  // An optimistic removal is a claim that a write succeeded before it has —
  // X2, one surface along. The row says "Deleting…" through the round trip.
  const from = code(MENU).indexOf('const remove =')
  assert.ok(from > 0, 'the delete handler could not be located')
  const remove = code(MENU).slice(from, code(MENU).indexOf('.finally(', from))
  const thenAt = remove.indexOf('.then(')
  const filterAt = remove.indexOf('.filter((c) => c.id !== id)')
  assert.ok(filterAt > thenAt && thenAt > 0, 'the row is dropped before the delete has answered')
  assert.match(remove, /Deleting…|setDeleting\(id\)/, 'nothing tells the reader the delete is in flight')
  assert.match(code(MENU), /setRowError\(\{ id, message: errorLine\(e\) \}\)/, 'a failed delete says nothing')
})

test('no undo is offered, because there is none', () => {
  // A toast saying "Undo" that cannot undo is worse than no toast.
  for (const [name, src] of [['HistoryMenu', MENU], ['TranscriptView', VIEW]] as const) {
    assert.doesNotMatch(code(src), /\bUndo\b|\bRestore\b/, `${name} offers a recovery that does not exist`)
  }
})

test('a conversation deleted while it is open takes its viewer with it', () => {
  assert.match(code(PANEL), /onDeleted=\{\(id\) => setViewingId\(\(cur\) => \(cur === id \? null : cur\)\)\}/,
    'a deleted conversation would leave its transcript on screen')
  assert.match(code(MENU), /onDeleted\(id\)/, 'the panel is never told a conversation went away')
})

// ─────────────────────────────────────────────────────────────────────────────
// STATES, AND MOTION
// ─────────────────────────────────────────────────────────────────────────────

test('all three failure states exist and none of them looks like a bug', () => {
  assert.match(code(MENU), /No chats recorded yet\./, 'the empty state is gone')
  assert.match(code(MENU), /Couldn’t load your history\./, 'the list has no failure state')
  assert.match(code(MENU), /onClick=\{onRetryList\}/, 'the failed list offers no way to try again')
  assert.match(code(MENU), /onRetryList=\{\(\) => fetchList\(\)\}/, 'the list’s retry is not wired to a real refetch')
  // MUTATION HISTORY: `match(/state: 'gone'/)` came back GREEN when the state
  // was removed from the union, because the string still appeared elsewhere in
  // the file. What matters is not that the word exists — it is that the 404 is
  // ROUTED to it, which is one specific expression.
  //
  // AND IT PINNED THE DEFECT IN PLACE. This asserted `looksDeleted(message)`
  // verbatim — the prose match — so `isGone`, written to retire it, shipped as
  // dead code with a commit message describing a wiring that had not happened,
  // and correcting the call site would have FAILED the test that claims to
  // guard the behaviour. A pin written against today's implementation rather
  // than against the behaviour becomes an argument for not fixing it.
  assert.match(
    code(VIEW),
    /setLoad\(isGone\(e\) \? \{ state: 'gone' \} : \{ state: 'failed', message \}\)/,
    'a deleted conversation reads as a fault',
  )
  // The status is the fact; the prose is the fallback inside `isGone` and must
  // not be the thing the view reaches for.
  assert.doesNotMatch(code(VIEW), /looksDeleted\(/, 'the viewer is matching the server prose again')
  assert.match(code(VIEW), /This conversation was deleted\./, 'the deleted state says nothing')
  assert.match(code(VIEW), /onClick=\{onRetry\}/, 'a failed transcript offers no way to try again')
})

test('the list is refetched every time it opens', () => {
  // A cached list is wrong exactly when somebody opens it to check what just
  // happened, which is the main reason to open it at all.
  assert.match(code(MENU), /if \(!open\) return\s*\n\s*const ac = new AbortController\(\)/, 'the list is no longer refetched on open')
  assert.match(code(MENU), /return \(\) => ac\.abort\(\)/, 'an in-flight list request is no longer cancelled')
})

test('reduced motion ships with the motion, per element (X1)', () => {
  for (const [name, src] of [['HistoryMenu', MENU], ['TranscriptView', VIEW]] as const) {
    assert.doesNotMatch(src, /0\.01ms/, `${name} must not carry a blanket motion kill-switch`)
    // Every animation and transition in these two files, without exception.
    for (const m of code(src).matchAll(/(?<!motion-safe:)\b(animate-\[|transition-)/g)) {
      const at = m.index ?? 0
      const before = code(src).slice(Math.max(0, at - 12), at)
      assert.ok(
        before.endsWith('motion-safe:'),
        `${name}: "${code(src).slice(at, at + 40)}" animates regardless of the reader's preference`,
      )
    }
  }
})

test('the LIVE conversation reaches the list, and its row does not open', () => {
  // The live chat is genuinely in the history — turns are filed as they happen
  // — so without this the row you are sitting in looks like any other. It could
  // not be inferred: newest `updatedAt` is wrong with two tabs open, and
  // matching on title is wrong the moment two conversations start the same way.
  //
  // Through `code()` so a pin cannot be satisfied by a comment mentioning it.
  const hook = code(read('../useDeckeChat.ts'))
  const host = code(read('../DeckeHost.tsx'))
  // TWICE, and the count is the point. `conversationId: conversationRef.current`
  // appears once in the `recordTurn` call that FILES the turn and once in the
  // hook's RETURN that tells the list which conversation it is. The first
  // version of this pin matched either, so replacing the return with `null` came
  // back green — the recording call was still satisfying it.
  const uses = (hook.match(/conversationId: conversationRef\.current/g) ?? []).length
  assert.equal(uses, 2, `expected the id to be both recorded and returned, found ${uses} use(s)`)
  assert.match(host, /conversationId=\{chat\.conversationId\}/, 'the host stopped passing it')
  assert.match(code(PANEL), /liveId=\{conversationId \?\? null\}/, 'the panel stopped forwarding it')
  assert.match(code(MENU), /live=\{c\.id === liveId\}/, 'no row is ever marked live')
  // DISABLED, not hidden. Hiding it would make the list disagree with the
  // history it is showing; opening it would hand somebody a read-only record of
  // the conversation already on screen behind the menu.
  assert.match(code(MENU), /disabled=\{live && !viewing\}/, 'the live row is openable again')
})

test('a conversation has a BOUNDARY, and the transcript resets with the id', () => {
  // Before this, `conversationRef` was minted once per hook mount and never
  // reassigned — and `DeckeHost` is mounted at the router's root precisely so it
  // survives navigation, while `DeckeChat` returns null rather than unmounting.
  // Nothing cleared the transcript either. So "a conversation" was the lifetime
  // of the TAB, and a long session filed days of unrelated exchanges as one row.
  //
  // The ref's comment claimed the id "survives until the transcript is cleared",
  // describing a mechanism that did not exist.
  const hook = code(read('../useDeckeChat.ts'))
  assert.match(hook, /conversationRef\.current = newConversationId\(\)/, 'the id can no longer be rotated')
  assert.match(hook, /seqRef\.current = 0/, 'seq does not restart, so the unique constraint will collide')
  // THE PAIR IS THE RULE. Rotating the id while the old messages stay on screen
  // files one visible conversation as two; clearing the screen while keeping the
  // id files two as one. Either way the history stops describing the product.
  const fn = hook.slice(hook.indexOf('const newConversation'))
  const body = fn.slice(0, fn.indexOf('}, [])'))
  assert.match(body, /setMessages\(\[\]\)/, 'the transcript is not cleared with the id')
  assert.match(body, /abortRef\.current\?\.abort\(\)/, 'a turn in flight could land in the new conversation')

  // And it is reachable: exposed, threaded, and rendered as a control.
  assert.match(hook, /\n    newConversation,/, 'the hook stopped exposing it')
  assert.match(code(read('../DeckeHost.tsx')), /onNewChat=\{chat\.newConversation\}/, 'the host stopped wiring it')
  assert.match(code(PANEL), /onNewChat\?\.\(\)/, 'the panel stopped forwarding it')
  assert.match(code(MENU), /New chat/, 'there is no way to start one')
})

test('opening a new chat closes any record being read', () => {
  // A saved transcript left open onto a transcript that has just been emptied
  // shows a record with no way to tell it from the new blank conversation.
  assert.match(code(PANEL), /setViewingId\(null\)[\s\S]{0,120}onNewChat\?\.\(\)/, 'a record stays open across a reset')
})
