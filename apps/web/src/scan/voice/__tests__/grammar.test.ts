// Run: node --import tsx --test src/scan/voice/__tests__/*.test.ts
//
// THE VOICE GRAMMAR, against what recognizers actually hand back.
//
// Every transcript below is either a measured one (iOS 18.6 Safari heard
// "reverse holo" as "reverse hollow"; recognizers give "double rear" for "double
// rare") or the same kind of slip on another word of this grammar. The parser is
// allowed to be wrong in one direction only: missing a command costs the reader
// a tap, acting on conversation costs them a card.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { parseAlternatives, parseUtterance, phonetic, tokenize, type VoiceCommand } from '../grammar'

const ROWS = [
  { id: 'r3', name: 'Venonat' },
  { id: 'r2', name: 'Charizard ex' },
  { id: 'r1', name: 'Exeggcute' },
]

function command(text: string): VoiceCommand | null {
  return parseUtterance(text, ROWS).command
}
function edit(text: string) {
  const c = command(text)
  assert.ok(c && c.kind === 'edit', `expected an edit from "${text}", got ${JSON.stringify(c)}`)
  return c
}

describe('normalisation', () => {
  it('drops apostrophes and accents the same way for names and speech', () => {
    assert.deepEqual(tokenize("That one's a Poké Ball"), ['that', 'ones', 'a', 'poke', 'ball'])
    assert.deepEqual(tokenize("Team Rocket's Mewtwo"), ['team', 'rockets', 'mewtwo'])
    assert.deepEqual(tokenize('1st edition x3'), ['first', 'edition', 'x', '3'])
  })
  it('folds the sound-alikes this grammar actually meets', () => {
    assert.equal(phonetic('hollow'), 'holo')
    assert.equal(phonetic('hollo'), 'holo')
    assert.equal(phonetic('whole'), 'hole')
  })
})

describe('printing', () => {
  it('hears the owner phrasing', () => {
    const c = edit("that one's a reverse holo")
    assert.equal(c.printing?.finish, 'reverse')
    assert.deepEqual(c.printing?.modifiers, [])
    assert.equal(c.target.kind, 'anchor')
    assert.equal(c.quantity, null)
  })

  it('survives the measured and likely mistranscriptions of "reverse holo"', () => {
    for (const heard of ['reverse hollow', 'Reverse hollow.', 'reverse hollo', 'reverse whole o', 'reverse polo', 'reverse hole', 'reverse holofoil', 'reverse hollow foil', 'reverse halo foil', 'reverse foil', 'reverse']) {
      assert.equal(edit(heard).printing?.finish, 'reverse', heard)
    }
  })

  it('hears holo and its spellings, but not a greeting', () => {
    for (const heard of ['holo', 'hollow', 'holofoil', 'hollow foil', "it's a holo", 'holo foil']) {
      assert.equal(edit(heard).printing?.finish, 'holo', heard)
    }
    // Four letters is too short to guess at: "hello" and "halo" are other words.
    assert.equal(command('hello'), null)
    assert.equal(command('halo'), null)
  })

  it('reads "not a holo" as the normal printing, the way collectors say it', () => {
    for (const heard of ['non holo', 'non hollow', 'not a holo', "it's not holo", 'normal', 'regular', 'nonholo']) {
      assert.equal(edit(heard).printing?.finish, 'normal', heard)
    }
  })

  it('refuses a negated printing instead of setting it', () => {
    assert.equal(command("that's not a reverse holo"), null)
    assert.equal(command('that is not first edition'), null)
    assert.equal(command("it's not poke ball"), null)
  })

  it('takes the last printing said, because corrections come after', () => {
    assert.equal(edit('holo no wait reverse holo').printing?.finish, 'reverse')
  })

  it('hears the modifiers that tell printings of one finish apart', () => {
    assert.deepEqual(edit('poke ball').printing?.modifiers, ['pokeball'])
    assert.deepEqual(edit('poke bowl reverse').printing?.modifiers, ['pokeball'])
    assert.deepEqual(edit('master ball pattern').printing?.modifiers, ['masterball'])
    assert.deepEqual(edit('first edition').printing?.modifiers, ['first-edition'])
    assert.deepEqual(edit('1st edition holo').printing?.modifiers, ['first-edition'])
    assert.deepEqual(edit('first addition').printing?.modifiers, ['first-edition'])
    assert.deepEqual(edit('shadow less').printing?.modifiers, ['shadowless'])
    assert.equal(edit('poke ball reverse holo').printing?.label, 'Poké Ball Reverse Holo')
  })

  it('does not know rarities, so "double rear" is not a command', () => {
    assert.equal(command('double rear'), null)
    assert.equal(command('double rare'), null)
  })
})

describe('quantity', () => {
  it('hears the frames people use', () => {
    const cases: [string, number][] = [
      ['two of those', 2], ['2 of them', 2], ['three copies', 3], ['times four', 4], ['x3', 3],
      ['make it five', 5], ['I have two of those', 2], ['two', 2], ['Two.', 2], ['twelve', 12],
      ['twenty two of those', 22], ['make it twenty two', 22], ['thirty', 30],
    ]
    for (const [heard, n] of cases) assert.equal(edit(heard).quantity, n, heard)
  })

  it('believes homophones of numbers only inside a frame', () => {
    assert.equal(edit('to of those').quantity, 2)
    assert.equal(edit('times for').quantity, 4)
    // "to" here is a preposition, and the printing is the whole request.
    const c = edit('change it to reverse holo')
    assert.equal(c.quantity, null)
    assert.equal(c.printing?.finish, 'reverse')
    assert.equal(command('to'), null)
  })

  it('takes a quantity and a printing from one breath', () => {
    const c = edit('two reverse holos')
    assert.equal(c.quantity, 2)
    assert.equal(c.printing?.finish, 'reverse')
    const d = edit("two of those and they're reverse hollow")
    assert.equal(d.quantity, 2)
    assert.equal(d.printing?.finish, 'reverse')
  })

  it('keeps "that one" and "the reverse one" out of the count', () => {
    assert.equal(edit("that one's a holo").quantity, null)
    assert.equal(edit('the reverse one').quantity, null)
    assert.equal(edit('just one').quantity, 1)
  })

  it('refuses counts it cannot mean, and the whole command with them', () => {
    assert.equal(command('zero'), null)
    assert.equal(command('500 of those'), null)
    assert.equal(command('0 reverse holos'), null)
    assert.equal(command('100 reverse holos'), null)
  })
})

describe('remove, undo, stop', () => {
  it('removes', () => {
    for (const heard of ['remove it', 'no, remove it', 'delete that', 'get rid of that one', 'removed', 'discard']) {
      assert.equal(command(heard)?.kind, 'remove', heard)
    }
  })

  it('undoes, and undo outranks everything said with it', () => {
    for (const heard of ['undo', 'undo that', 'cancel', 'never mind', 'nevermind', 'no undo', 'keep it', 'undue']) {
      assert.equal(command(heard)?.kind, 'undo', heard)
    }
    assert.equal(command('no no undo the remove')?.kind, 'undo')
  })

  it('never acts on anything said with a negation in it', () => {
    for (const heard of [
      'never remove that', "don't remove it", 'do not remove it', "don't undo",
      'do not make it two', 'do not change it to holo', 'not two, three of those',
      "I can't remove it", 'I cannot remove it', "won't be two", "didn't say remove",
    ]) {
      assert.equal(command(heard), null, heard)
    }
    // "No" starts a correction; it is not a negation.
    assert.equal(command('no, remove it')?.kind, 'remove')
  })

  it('stops listening on request', () => {
    assert.equal(command('stop listening')?.kind, 'stop')
  })

  it('holds undo and stop to the same bar: conversation never triggers them', () => {
    assert.equal(command('please keep it in the binder'), null)
    assert.equal(command('they told me to stop listening to music'), null)
    assert.equal(command('undo that')?.kind, 'undo')
  })
})

describe('targeting', () => {
  it('points at the anchor unless a card is named', () => {
    assert.deepEqual(edit('holo').target, { kind: 'anchor' })
    assert.deepEqual(command('remove it'), { kind: 'remove', target: { kind: 'anchor' } })
  })

  it('lets an explicit card name win', () => {
    assert.deepEqual(edit('the charizard is a holo').target, { kind: 'row', rowId: 'r2', name: 'Charizard ex' })
    assert.deepEqual(edit('charizard ex reverse holo').target, { kind: 'row', rowId: 'r2', name: 'Charizard ex' })
    assert.deepEqual(command('remove the exeggcute'), { kind: 'remove', target: { kind: 'row', rowId: 'r1', name: 'Exeggcute' } })
  })

  it('finds a name the recognizer spread over several words', () => {
    assert.deepEqual(edit('the char is hard is a reverse holo').target, { kind: 'row', rowId: 'r2', name: 'Charizard ex' })
  })

  it('matches short names exactly rather than falling back to "that one"', () => {
    const rows = [{ id: 'v', name: 'Venonat' }, { id: 'm', name: 'Mew' }]
    const c = parseUtterance('the mew is a holo', rows).command
    assert.ok(c?.kind === 'edit')
    assert.deepEqual(c.target, { kind: 'row', rowId: 'm', name: 'Mew' })
  })

  it('refuses a name it cannot find instead of changing the latest scan', () => {
    for (const heard of ['the pikachu is a holo', 'pikachu is a reverse holo', 'remove the pikachu', 'please remove pikachu now', 'remove that pikachu please']) {
      const parsed = parseUtterance(heard, ROWS)
      assert.equal(parsed.command, null, heard)
      assert.equal(parsed.unresolvedName, 'pikachu', heard)
    }
    // "the" before grammar is not a name.
    assert.equal(edit('the reverse holo').target.kind, 'anchor')
  })

  it('means the most recent scan when a name appears twice', () => {
    const rows = [{ id: 'new', name: 'Venonat' }, { id: 'old', name: 'Venonat' }]
    const c = parseUtterance('venonat is reverse', rows).command
    assert.ok(c?.kind === 'edit')
    assert.deepEqual(c.target, { kind: 'row', rowId: 'new', name: 'Venonat' })
  })
})

describe('chatter', () => {
  it('refuses conversation that happens to contain grammar words', () => {
    for (const heard of [
      'I still need to find a reverse holo of this',
      'hello how are you doing today',
      'oh man do you remember when we used to trade these',
      'this set has so many reverse holos in it',
      'okay next card',
      'um',
    ]) {
      assert.equal(command(heard), null, heard)
    }
  })

  it('needs every word explained before acting at all', () => {
    // One stray word is as likely a name we could not find as it is noise, and
    // guessing sends the change to a card nobody meant.
    assert.equal(command('it is a reverse holo for sure'), null)
    assert.equal(command('the charizard is a reverse holo for sure'), null)
    assert.equal(parseUtterance('the charizard ex is a reverse holo', ROWS).coverage, 1)
  })

  it('refuses questions, wishes and speculation about a card', () => {
    for (const heard of [
      'is this a reverse holo', 'Is that one a holo?', 'what is that one', 'I might remove the charizard',
      'do you have a reverse holo venonat', 'maybe two of those', 'that should be reverse holo', 'I need a reverse holo',
      'can I remove the charizard', 'do I remove the charizard', 'could you make it two', 'remove it?',
    ]) {
      assert.equal(command(heard), null, heard)
    }
  })

  it('does not mistake a near word for a hedge', () => {
    assert.equal(edit('right, two of those').quantity, 2)
  })

  it('refuses one utterance about two cards, or two instructions', () => {
    assert.equal(command('remove charizard ex, venonat is reverse holo'), null)
    assert.equal(parseUtterance('the charizard ex is a holo and remove the pikachu', ROWS).command, null)
    assert.equal(parseUtterance('remove it and make it two', ROWS).refused, 'two-commands')
  })

  it('accepts a command wrapped in the words people put around one', () => {
    for (const heard of ['I think that is a reverse hollow', 'okay so that one was actually a holo', 'yeah just remove it please']) {
      const parsed = parseUtterance(heard, ROWS)
      assert.ok(parsed.command, heard)
      assert.equal(parsed.coverage, 1, heard)
    }
  })
})

describe('alternatives', () => {
  it('prefers the guess that fits the grammar', () => {
    const best = parseAlternatives(['the verse', 'reverse hollow'], ROWS)
    assert.equal(best.heard, 'reverse hollow')
    assert.equal(best.command?.kind, 'edit')
  })
  it('never lets a lesser guess outvote an objection or an unfound name', () => {
    const negated = parseAlternatives(['do not remove it', 'remove it'], ROWS)
    assert.equal(negated.command, null)
    assert.equal(negated.refused, 'negation')
    assert.equal(parseAlternatives(['remove it', 'do not remove it'], ROWS).command, null)
    assert.equal(parseAlternatives(['should I remove it', 'remove it'], ROWS).refused, 'question')
    assert.equal(parseAlternatives(['is it a holo', 'it a holo'], ROWS).command, null)
    // A command that names its card is refused by a negation as well.
    assert.equal(parseUtterance("I can't remove charizard ex", ROWS).command, null)
    const missing = parseAlternatives(['remove that pikachu', 'remove that'], ROWS)
    assert.equal(missing.command, null)
    assert.equal(missing.unresolvedName, 'pikachu')
  })

  it('reports the first guess as heard when none parses', () => {
    const best = parseAlternatives(['nice weather', 'nice whether'], ROWS)
    assert.equal(best.command, null)
    assert.equal(best.heard, 'nice weather')
  })
})
