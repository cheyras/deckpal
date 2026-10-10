/* Landing page copy: the single source for the React page, the prerender,
 * llms.txt and the JSON-LD. Strings and plain data only.
 *
 * House rules for anyone editing this file:
 *  - No em dashes, no arrows, sentence case headings.
 *  - Demo content (chat answers, previews, parsed logs) is illustrative and lives
 *    only inside demos that carry `exampleLabel`.
 *  - DeckPal is not an AI: the visitor brings theirs. Say "your AI".
 *  - Compatibility claims come from `connect.table`, which records the date it was
 *    checked and whether we have tested the app ourselves. Only Claude is tested
 *    end to end; every other row is what that app's own docs say.
 *  - Never mention: the card scanner, Deck-E, DeckPal credits. ("Trade Credits"
 *    is Pokémon TCG Live's own currency and is fine.)
 */

export type FaqItem = { id: string; q: string; a: string }
export type ChatLine = { who: 'you' | 'ai'; text: string; card?: 'deck' | 'cart' }
export type AskScript = { q: string; turns: readonly ChatLine[] }
export type LoopStep = { id: StageId; title: string; body: string }
export type StageId = 'plan' | 'playtest' | 'tune' | 'build'

export type CompatRow = {
  app: string
  /** One-word cells for the landing's at-a-glance chart. */
  freeShort: string
  changeShort: string
  /** Free-plan cell, as written. */
  free: string
  freeOk: boolean
  lowest: string
  /** Can it change DeckPal data, as written. */
  change: string
  changeOk: boolean
  notes: string
  /** We have connected this app to DeckPal and used it ourselves. */
  tested: boolean
}

const MCP_URL = 'https://deckpal.app/mcp'
const CLAUDE_CODE_CMD = 'claude mcp add --transport http deckpal https://deckpal.app/mcp'
const COMPAT_CHECKED = 'October 2, 2026'

const FAQ: readonly FaqItem[] = [
  {
    id: 'new-player',
    q: "I've never played but want to learn. Is this for me?",
    a: "Yes. Ask your AI what a card does, what a deck is trying to do, and what you'd need to build one. With DeckPal, you now have a capable wingman to help you get your first solid deck built in record time.",
  },
  {
    id: 'best-deck',
    q: 'Will it just hand me the best deck and call it done?',
    a: "Your AI can do research and start from a known winning list if you ask. But it works from your cards, your ideas, and your results, so the deck you end up with is yours. Get as creative as you'd like!",
  },
  {
    id: 'few-cards',
    q: "What if I don't have that many cards yet?",
    a: "You don't need physical cards to get started with your first build. PTCG Live is free to play and starts you with decks to learn on. We recommend playtesting there, logging your battles, and only buying singles once they've really earned their place in your deck.",
  },
  {
    id: 'cost',
    q: 'What does it cost?',
    a: "DeckPal runs on a pay-what-you-want monthly subscription. $0 a month is a real option. Connect the AI subscription you're already paying for. If DeckPal has earned your support, you can choose to raise your monthly payment anytime. We can't wait to see what you build!",
  },
  {
    id: 'which-ai',
    q: 'Which AI works with it?',
    a: "Claude and Mistral work on their free plans. Gemini, Perplexity and ChatGPT need a paid plan, and ChatGPT's personal plans may limit connectors to reading your data. The table above has the details.",
  },
  {
    id: 'private',
    q: 'Is my collection private?',
    a: 'Yes. Your collection, decks, lists and battle logs are private to your account.',
  },
]

const LLMS_TXT = [
  '# DeckPal',
  '',
  '> DeckPal is an AI deck-building companion for the Pokémon TCG. It keeps track of your collection, decks and battle logs, and connects them to the AI app you already use (Claude, and other apps that support custom MCP connectors) at ' +
    MCP_URL +
    ', so your AI can plan a deck with you, read how your PTCG Live games went, suggest changes, and build a TCGplayer cart for the cards you are missing. Open source (AGPL-3.0). Pay-what-you-want monthly subscription; $0 a month is an option.',
  '',
  '## Connect an AI app',
  '- [MCP endpoint](' +
    MCP_URL +
    '): remote Streamable HTTP, OAuth 2.1 with PKCE and dynamic client registration, 26 tools (15 read, 11 write), Read only option at consent',
  '- Claude: add a custom connector with the URL ' + MCP_URL + ' (works on the free plan, one custom connector)',
  '- Claude Code: ' + CLAUDE_CODE_CMD,
  '- Other apps: compatibility by plan is on the home page, last checked ' + COMPAT_CHECKED,
  '',
  '## What the tools cover',
  '- Collection: collection_summary, collection_log, collection_value, log_cards, set_progress',
  '- Catalog and prices: search_cards, get_card, card_price_history',
  '- Decks: decks, save_deck, delete_deck, check_deck, deck_odds, deck_strategy, deck_history',
  '- Battle logs: battle_logs, add_battle_log, edit_battle_log, delete_battle_log',
  '- Lists and shopping: lists, edit_list, delete_list, set_cart',
  '- Safety: health, mutation_history, revert',
  '',
  '## Product',
  '- [Home](https://deckpal.app/): the loop (plan, playtest, tune, build), compatibility table and FAQ',
  '- [Browse the catalog](https://deckpal.app/series): no account needed',
  '- [Source code](https://github.com/cheyras/deckpal): AGPL-3.0, self-hostable',
  '- [Privacy](https://deckpal.app/privacy)',
].join('\n')

export const COPY = {
  meta: {
    title: 'AI Deck Builder for the Pokémon TCG | DeckPal',
    description:
      'Plan, playtest and tune Pokémon TCG decks with the AI you already use. It knows your whole collection. Pay what you want, $0 included.',
    ogTitle: 'DeckPal: plan, playtest and tune your Pokémon TCG decks with AI',
    ogDescription:
      'Connect your AI to your cards, decks and PTCG Live battle logs. Then work on the deck together and show up to league night confident.',
  },

  nav: {
    links: [
      { href: '#loop', label: 'How it works' },
      { href: '#ask', label: 'Ask it anything' },
      { href: '#connect', label: 'Connect' },
      { href: '#open-source', label: 'Open source' },
      { href: '#faq', label: 'FAQ' },
    ],
    signIn: 'Sign in',
    cta: 'Start free',
    github: 'DeckPal on GitHub',
    menu: 'Menu',
    openApp: 'Open DeckPal',
  },

  exampleLabel: 'Example',
  exampleLong: 'Example answers, not a live AI',

  hero: {
    eyebrow: 'AI deck-building for Pokémon TCG',
    headlineA: 'Plan it. Playtest it. Tune it.',
    headlineB: 'All with an AI that knows your whole collection.',
    body: [
      'Now your favorite AI knows your cards, your decks, and how your matches went. Then it works on the deck with you, so you can build something creative, make it strong, and show up to league night confident.',
      "Building a great deck is hard. Don't fly solo. Build your next league winner with DeckPal.",
    ],
    ctaPrimary: 'Start free',
    ctaBrowse: 'Browse the catalog',
    ctaBrowseNote: 'no account needed',
    price: 'Pay-what-you-want monthly subscription. $0/month is an option.',
    // `{cards}` and `{sets}` are filled from the live catalog.
    trust: '{cards} English cards across {sets} sets, with prices updated daily',
    photoAlt:
      "A league-night table from the player's seat: Mega Chandelure ex in the active spot, Litwick, Lampent, Duskull and Dusclops on the bench.",
    demoLabel: 'An example chat with an AI connected to DeckPal',
    connected: 'DeckPal connected',
    pause: 'Pause the example chat',
    play: 'Play the example chat',
    // One conversation that runs the whole loop, each task to its end. Every
    // reply states only what the tools return (save_deck, decks testhand,
    // add_battle_log, deck versions, set_cart). `card` adds a result card.
    chat: [
      { who: 'you', text: 'I want to build around Mega Chandelure ex. What can I make from my binder?' },
      {
        who: 'ai',
        text: 'You already own 4 Litwick, 3 Lampent and 2 Duskull. I paired Mega Chandelure ex with Dusknoir and saved a first draft.',
        card: 'deck',
      },
      { who: 'you', text: 'Draw me an opening hand.' },
      {
        who: 'ai',
        text: "Litwick, Duskull, Buddy-Buddy Poffin, Ultra Ball, Rare Candy, Lillie's Determination and a Psychic Energy. Two Basics, so no mulligan.",
      },
      { who: 'you', text: 'I played three games on PTCG Live. Here are the logs.' },
      {
        who: 'ai',
        text: 'Logged all three under v1: 2 wins and 1 loss. You lost to Dragapult ex after Mega Chandelure ex came online on turn 4.',
      },
      { who: 'you', text: 'What should I change?' },
      {
        who: 'ai',
        text: 'The loss came from a slow start. Try a fourth Lampent in place of a Pokémon Catcher, so you can evolve without Rare Candy. Save it as v2?',
      },
      { who: 'you', text: 'Yes, save it.' },
      { who: 'ai', text: 'Saved v2. v1 keeps its record of 2 wins and 1 loss, so we can compare after your next games.' },
      { who: 'you', text: "It's winning. What do I need to build it for real?" },
      { who: 'ai', text: 'You own 48 of the 60. I made a TCGplayer cart for the other 12 at the cheapest printings.', card: 'cart' },
    ] as readonly ChatLine[],
    deck: {
      name: 'Mega Chandelure ex / Dusknoir',
      meta: '60 cards · Standard',
      owned: 'You own 48 of 60',
      legal: 'Legal in Standard',
    },
    cart: {
      title: 'TCGplayer cart',
      meta: '12 cards · cheapest printings',
      action: 'You check out on TCGplayer',
    },
  },

  works: {
    lead: 'Plugs into the AI you already use',
    apps: ['Claude', 'ChatGPT', 'Gemini', 'Grok', 'Perplexity', 'Mistral'],
    link: 'See what works on which plan',
    disclaimer: 'DeckPal is not affiliated with or endorsed by any of these companies.',
  },

  loop: {
    eyebrow: 'The DeckPal loop',
    headline: 'Plan. Playtest. Tune. Build.',
    body: 'Great decks take a few rounds to get right. DeckPal makes the process faster and more fun than ever. You and your AI work on the list together, test it, and improve it from your own actual logged results. By the time you build the real thing, every card is there for a real reason.',
    steps: [
      { id: 'plan', title: 'Plan', body: 'Bring a wild idea, a card you love, or a winning list. Your AI researches and saves a first draft.' },
      { id: 'playtest', title: 'Playtest', body: 'Take the list to PTCG Live and play it for real. Every game gives you something to learn from.' },
      { id: 'tune', title: 'Tune', body: 'Paste in a battle log or tell your AI how it went. Ask what\'s losing, then swap in a fix.' },
      { id: 'build', title: 'Build', body: "When you're confident in it, DeckPal shows which singles you're missing and exports a TCGplayer cart." },
    ] as readonly LoopStep[],
    loopLabel: 'Repeat until it wins',
    diagramLabel:
      'Plan, Playtest and Tune form a loop you repeat. Build leaves the loop when the deck is ready.',
    stageNav: 'Where you are in the loop',
  },

  plan: {
    eyebrow: 'Plan',
    headline: 'Make the deck you actually want to play, then make it solid.',
    body: [
      "Copying a pro's list card for card works until you want to know why it works. Start from your binder, a card you want to build around, or a list that's winning events, and shape it into something that fits how you play.",
      "Your AI handles the research that usually eats your weekend. It checks what's winning right now, folds in your ideas, points out blind spots, and saves the deck to DeckPal already knowing what you own. Got a store-bought deck? List the cards and ask what you'd change.",
      "Paste a PTCG Live decklist in, and export one back out when you're ready to playtest. Legality is checked for Standard, Expanded, Gym Leader Challenge and Unlimited.",
    ],
    photoAlt: 'A binder of Pitch Black cards open on a wooden desk at home, seen from above, beside a deck box, sleeves and a phone.',
    tabsLabel: 'Ways to start a deck',
    tabs: [
      {
        id: 'binder',
        label: 'Start from my binder',
        ask: 'What could I build from what I own?',
        summary:
          'You own most of a Mega Chandelure ex deck already: 4 Litwick, 3 Lampent and 2 Duskull. I saved a draft that uses them. 12 cards are missing.',
      },
      {
        id: 'card',
        label: 'Start from a card',
        ask: 'Build around Mega Chandelure ex.',
        summary:
          "Binding Flame raises your opponent's Retreat Cost, and Phantom Maze does 50 more damage for each point of it. Dusknoir finishes what Phantom Maze leaves. Draft saved.",
      },
      {
        id: 'list',
        label: 'Start from a winning list',
        ask: 'Here is a list that placed this weekend. Make it mine.',
        summary:
          'All 60 lines matched and the list is legal in Standard. You own 41 of the 60. Want me to look for swaps from your binder for the rest?',
      },
    ],
    builder: {
      title: 'Mega Chandelure ex / Dusknoir',
      format: 'Standard',
      owned: 'Owned',
      missing: 'Missing',
      legal: 'Legal in Standard',
    },
  },

  playtest: {
    eyebrow: 'Playtest',
    headline: 'Find out how it actually plays.',
    body: [
      'A list on paper is a guess. Export it from DeckPal, import it into PTCG Live, and play a few games to see what it really does. Does it set up on time? Does that one-of ever show up? Is the energy count right?',
      "Casual Standard on PTCG Live is built for low-stakes testing, and you can craft cards you don't own with Trade Credits earned through play. Want a faster first look? DeckPal can draw an opening hand so you can see how the deck starts before you load a game.",
    ],
    photoAlt: 'A sleeved deck with Mega Chandelure ex on top, beside an open deck box and a closed laptop under a desk lamp at night.',
    draw: 'Draw an opening hand',
    redraw: 'Shuffle and draw again',
    handLabel: 'Opening hand',
    sampleTag: 'Sample deck',
    deckLabel: 'From the sample deck: Mega Chandelure ex / Dusknoir',
    basics: (n: number) => (n === 1 ? '1 Basic Pokémon in hand' : `${n} Basic Pokémon in hand`),
    mulligan: 'No Basic Pokémon. That is a mulligan: shuffle and draw again.',
    supporter: (n: number) => (n === 0 ? 'No Supporter yet' : n === 1 ? '1 Supporter' : `${n} Supporters`),
    energy: (n: number) => (n === 1 ? '1 Energy' : `${n} Energy`),
  },

  tune: {
    eyebrow: 'Tune',
    headline: 'Improve the deck. Improve your piloting.',
    quote: 'Like having a coach who knows the game cold and has watched all your matches.',
    body: [
      'Paste in a battle log straight from PTCG Live and your AI reads it for you. Or skip the paste and tell it how the match went, and it records the result, the matchup, and what went wrong.',
      "After a few games, ask what's losing. Your AI can suggest changes to the deck and to how you're piloting it. The answer comes from your own results, so every swap has a reason behind it. Keep getting steamrolled by a certain deck? Your AI can help you find a precise tech to swap in.",
    ],
    photoAlt: 'A deck laid out in rows on a playmat at home, a few cards pulled aside, a phone nearby.',
    modesLabel: 'How to log a game',
    modePaste: 'Paste a log',
    modeTell: 'Tell it',
    pasteHint: 'Battle log from PTCG Live',
    tellMessage: 'Lost to Dragapult again. Chandelure came online too late, I only got it up on turn 4.',
    logged: 'Logged under v2',
    fields: {
      result: 'Result',
      opponent: 'Opponent deck',
      turns: 'Turns',
      prizes: 'Prizes',
      matchup: 'Matchup',
      notes: 'Notes',
    },
    parsed: {
      result: 'Loss',
      opponent: 'Dragapult ex',
      turns: '9',
      prizes: '4 of 6 taken',
      notes: 'Slow setup. Mega Chandelure ex came online on turn 4.',
    },
  },

  build: {
    eyebrow: 'Build',
    headline: 'Fill the gaps, then build the real thing.',
    body: [
      'Once a deck has earned its spot in your bag, DeckPal shows which cards you already own, which you\'re missing, and what the gaps cost. Then it builds a TCGplayer cart with just those cards in it. You pick printing and condition, and you check out on TCGplayer.',
      "Your AI defaults to the cheapest printing of each card, so you aren't paying Special Illustration Rare prices for a card that plays the same. Prefer to shop around? Ask your AI to research current listings elsewhere.",
    ],
    photoAlt: 'Singles in toploaders spilling from a padded mailer on a kitchen counter, beside a phone.',
    listTitle: 'Missing from Mega Chandelure ex / Dusknoir',
    exampleTag: 'Example account',
    total: 'Cart total',
    printingLabel: 'Mega Chandelure ex printing',
    printingNote: 'All three play the same.',
    cartButton: 'Open TCGplayer cart',
    cartNote: 'You check out on TCGplayer.',
    priceNote: 'TCGplayer market prices, updated daily.',
  },

  ask: {
    eyebrow: 'Ask it anything',
    headline: 'Any question you can think of.',
    body: 'Your AI can see your whole collection, every deck you\'ve saved, and every match you\'ve logged, so the questions can get as specific as you like.',
    photoAlt: 'A hand of seven sleeved cards held up at home, a lamp and a couch behind.',
    pause: 'Pause the examples',
    play: 'Play the examples',
    promptsLabel: 'Example questions',
    you: 'You',
    ai: 'Your AI',
    cta: 'Start free and ask your own',
    // Each example runs to the end of a task, the way a real chat would. Replies
    // say only what the tools return (log_cards' preview, save_deck, smart
    // lists, set_cart, deck versions). Order is play order.
    prompts: [
      {
        q: 'Add Mega Chandelure ex from Pitch Black to my collection.',
        turns: [
          { who: 'ai', text: 'There are three printings in Pitch Black: Double Rare, Ultra Rare, and Special Illustration Rare. Which one did you pull?' },
          { who: 'you', text: 'The Special Illustration Rare!' },
          { who: 'ai', text: 'Nice pull. Before I save: Mega Chandelure ex, Pitch Black 115, from 0 owned to 1. Go ahead?' },
          { who: 'you', text: 'Yes.' },
          { who: 'ai', text: 'Saved. It is now your most valuable card, at about $38.' },
        ],
      },
      {
        q: 'I keep losing against Dragapult. What swaps would help?',
        turns: [
          { who: 'ai', text: 'Looking at your last few games against it, the losses mostly come from slow starts. Here are three swaps to test on PTCG Live: a fourth Lampent for a Pokémon Catcher, a fifth Buddy-Buddy Poffin for a Switch, and a third Night Stretcher for an Air Balloon.' },
          { who: 'you', text: 'Save those as a new version.' },
          { who: 'ai', text: 'Saved v3. v2 keeps its record, so after a few games we can see whether the swaps helped.' },
        ],
      },
      {
        q: 'I want to build around Mega Chandelure ex. What would make it work?',
        turns: [
          { who: 'ai', text: "Its Ability raises your opponent's Retreat Cost, and Phantom Maze does 50 more damage for each point of it. Pair it with cards that keep a heavy Pokémon stuck in the Active Spot. Want me to draft a list from what you own?" },
          { who: 'you', text: 'Do it.' },
          { who: 'ai', text: 'Saved Mega Chandelure ex / Dusknoir. It is legal in Standard and you own 48 of the 60 cards.' },
        ],
      },
      {
        q: 'What are my top 10 most valuable cards?',
        turns: [
          { who: 'ai', text: 'Your most valuable card is a Special Illustration Rare at about $38. The top 10 add up to about $112.' },
          { who: 'you', text: 'Make a for-sale list of the ones I have extras of.' },
          { who: 'ai', text: 'Made "For sale" with the 4 you own two or more of. Together they are worth about $46.' },
        ],
      },
      {
        q: 'How close am I to finishing Surging Sparks?',
        turns: [
          { who: 'ai', text: 'You have 148 of the 191 cards. The 43 you are missing cost about $61, and 30 of them are commons and uncommons.' },
          { who: 'you', text: 'Make a list of the missing ones under $1.' },
          { who: 'ai', text: 'Made "Surging Sparks under $1" with 31 cards. It ticks each one off as you add it to your collection.' },
        ],
      },
      {
        q: 'Build me the most chaotic meme deck you can from my binder. It should still win a game or two.',
        turns: [
          { who: 'ai', text: "Challenge accepted. I found a Wailord ex deck that only needs 3 cards you don't own. It should win a game or two." },
          { who: 'you', text: 'Save it as Big Whale Energy.' },
          { who: 'ai', text: 'Saved Big Whale Energy. It is legal in Standard. Want an opening hand to see how it starts?' },
        ],
      },
      {
        q: 'Which cards should I think about sending in for grading?',
        turns: [
          { who: 'ai', text: 'Three of your cards are worth more than $25 raw. Grading usually pays off only for clean, well-centered copies, so check those three first.' },
          { who: 'you', text: 'Put them on a list so I can check them tonight.' },
          { who: 'ai', text: 'Made "Grading candidates" with all three, most valuable first.' },
        ],
      },
      {
        q: 'Which of my decks has the best record?',
        turns: [
          { who: 'ai', text: 'Toolbox Slowking, at 19 wins and 13 losses across three versions.' },
          { who: 'you', text: 'Which version did best?' },
          { who: 'ai', text: 'v1, at 12 wins and 6 losses. v3 is 5 and 5 so far, so the latest change has not helped yet.' },
        ],
      },
      {
        q: 'What does this deck still need, and what will it cost?',
        turns: [
          { who: 'ai', text: '12 cards: 3 Mega Chandelure ex, 2 Dusknoir, 2 Dusclops, 3 Rare Candy, a Duskull and a Lumiose City.' },
          { who: 'you', text: 'Build me the cart.' },
          { who: 'ai', text: 'Your TCGplayer cart is ready with those 12 at the cheapest printings. You pick condition and check out on TCGplayer.' },
        ],
      },
      {
        q: "I'm brand new. What could I build from my binder?",
        turns: [
          { who: 'ai', text: 'Welcome! Your binder already has the start of two decks: one around Mega Chandelure ex and one around Wailord ex.' },
          { who: 'you', text: 'Which one is easier to learn?' },
          { who: 'ai', text: 'Mega Chandelure ex. It wants one big attacker in the Active Spot, and you own 48 of its 60 cards. I saved it so you can try it on PTCG Live.' },
        ],
      },
    ] as readonly AskScript[],
  },

  jobs: {
    eyebrow: 'Hands-on',
    headline: 'Give it a job.',
    body: 'Your AI can make changes in DeckPal for you, not just answer questions. Most changes are previewed before anything is saved.',
    items: [
      'Build and save decks, including from a pasted PTCG Live list.',
      'Log your battles with its own notes on what went right and wrong.',
      'Write detailed strategy guides for each deck and update them as your logs come in.',
      'Add a whole stack of cards to your collection from a pasted or voice-dictated list.',
      'Make lists like a wishlist, a trade pile, a for-sale pile, or every card you\'re missing from a set under $5.',
      'Build a TCGplayer cart for whatever a deck is missing, or research current listings elsewhere.',
    ],
    demo: {
      ask: 'Add the Mega Chandelure ex I just pulled. It is the Double Rare.',
      previewTitle: 'Preview, nothing saved yet',
      line: 'Mega Chandelure ex',
      lineMeta: 'Pitch Black 038 · Holofoil',
      approve: 'Approve',
      approved: 'Saved',
      undo: 'Most changes can be reverted later.',
      ownedNow: 'Owned: 1',
      ownedWillBe: 'Owned: 0, will be 1',
      again: 'Try it again',
      collection: 'Cards in collection',
      before: 1284,
    },
  },

  more: {
    eyebrow: 'And more',
    headline: 'What else can DeckPal do?',
    pause: 'Pause the carousel',
    play: 'Play the carousel',
    prev: 'Previous',
    next: 'Next',
    cells: {
      prices: {
        title: 'Prices',
        body: 'Prices from TCGplayer and Cardmarket for every printing, synced daily, with history. Ask your AI what your collection is worth and what moved this month.',
        chartLabel: 'Collection value over six months',
      },
      progress: {
        title: 'Set progress',
        body: 'Track any set against the goal you choose and watch it fill. Ask how close you are to finishing and what the rest would cost.',
        ringLabel: 'Pitch Black progress',
      },
      collection: {
        title: 'Collection tracking',
        body: 'A reverse holo and a holo are different cards, so each printing counts on its own. Your AI can add a whole stack at once.',
      },
      lists: {
        title: 'Lists',
        body: 'Wishlists, trade piles, for-sale piles. Describe what you want and your AI makes the list.',
      },
      binders: {
        title: 'Binders',
        body: 'Page through any set or list as binder pages, or fill a Pokédex binder one species at a time.',
      },
      versions: {
        title: 'Version history',
        body: 'Once a version has games logged, your next edit starts a new version, with a diff from the last. Reverting adds a version and deletes nothing.',
      },
      records: {
        title: 'Records by version',
        body: 'Games file under the version you played, so you and your AI can see whether a change helped.',
      },
    },
  },

  founder: {
    eyebrow: 'Open source',
    headline: 'Built in the open.',
    body: 'The whole project is on GitHub. Read it, fork it, or run it yourself. Your collection stays private until you share something.',
    // The owner's own note. Empty until they write it; the page renders none.
    note: [] as readonly string[],
    signature: '',
    photoAlt: "DeckPal's code on GitHub: the repository's Code tab, 869 commits.",
    repoCta: 'See the code on GitHub',
    license: 'AGPL-3.0',
    licenseLabel: 'License',
    commits: '869',
    commitsLabel: 'Commits',
    prs: '195',
    prsLabel: 'Pull requests merged',
    asOf: 'As of October 2026',
  },

  connect: {
    eyebrow: 'Connect',
    headline: 'Works with the AI you already use.',
    body: "DeckPal connects to Claude, ChatGPT, and other AI apps that support custom connectors. Add it once, approve it once, and you're set in about two minutes. You choose whether your AI can only read your data or read and change it, and you can disconnect any time.",
    steps: [
      { title: 'Connect', body: 'Add DeckPal as a custom connector in your AI app.' },
      { title: 'Approve', body: 'Sign in to DeckPal and choose what your AI may do.' },
      { title: 'Ask', body: 'Start a chat and ask about your cards, decks or last game.' },
    ],
    learnMore: 'Learn more about connecting',
    learnMoreHref: '/connect',
    summaryLabel: 'Which AI apps work, at a glance',
    summaryFree: 'Free plan',
    summaryChange: 'Can make changes',
    summaryNote: `Plans change often. Last checked ${COMPAT_CHECKED}.`,
    mcpUrl: MCP_URL,
    copy: 'Copy',
    copied: 'Copied',
    addClaude: 'Open Claude connectors',
    addChatgpt: 'Open ChatGPT settings',
    // Checked 2026-10-03: claude.ai moved connectors to Customize; ChatGPT's
    // connector URL now lands on its Plugins settings.
    addClaudeHref: 'https://claude.ai/customize/connectors',
    addChatgptHref: 'https://chatgpt.com/settings/plugins-settings',
    trust: ['Read only or read and change: you choose when you approve.', 'Disconnect any time in Profile, then Agent access.'],
    disclaimer: 'DeckPal is not affiliated with or endorsed by any of these companies.',
    claudeCode: CLAUDE_CODE_CMD,
    claudeCodeLabel: 'Claude Code',
    finePrint:
      'Compatibility varies by AI app and plan. Claude and Mistral let you add a custom connector on their free plans. ChatGPT, Perplexity and Gemini need a paid plan, and some apps limit what a connector can do. Last checked October 2, 2026. Plans change often, so confirm in your app\'s settings before you start.',
    checked: `Last checked ${COMPAT_CHECKED}`,
    filtersLabel: 'Filter the table',
    filterFree: 'Free plans only',
    filterChange: 'Can make changes',
    columns: {
      app: 'AI app',
      free: 'Free plan',
      lowest: 'Lowest plan that works',
      change: 'Can it change your DeckPal data?',
      notes: 'Notes',
    },
    testedYes: 'Tested with DeckPal',
    testedNo: "From the app's docs. Not yet tested with DeckPal.",
    showNotes: 'Notes',
    noRows: 'No app matches both filters.',
    // Order is the owner's: Claude, ChatGPT, Gemini, Grok, Perplexity, Mistral.
    table: [
      {
        app: 'Claude',
        freeShort: 'Yes',
        changeShort: 'Yes',
        free: 'Yes, one connector',
        freeOk: true,
        lowest: 'Free',
        change: 'Yes',
        changeOk: true,
        notes: 'Web and desktop. Use on mobile once added.',
        tested: true,
      },
      {
        app: 'ChatGPT',
        freeShort: 'No',
        changeShort: 'Some plans',
        free: 'No',
        freeOk: false,
        lowest: 'Plus or Pro',
        change:
          "Read-only on Pro per OpenAI's help center. Plus unclear. Read and change on Business, Enterprise and Edu.",
        changeOk: false,
        notes: 'Web only. Developer Mode required.',
        tested: false,
      },
      {
        app: 'Gemini',
        freeShort: 'No',
        changeShort: 'Yes',
        free: 'No',
        freeOk: false,
        lowest: 'Google AI Pro',
        change: 'Yes, with confirmation',
        changeOk: true,
        notes: 'Personal account, US, 18+, English only. Add on web, use on mobile.',
        tested: false,
      },
      {
        app: 'Grok',
        freeShort: 'Yes',
        changeShort: 'Unclear',
        free: 'Yes, per xAI docs',
        freeOk: true,
        lowest: 'Free',
        change: 'Not documented',
        changeOk: false,
        notes: '',
        tested: false,
      },
      {
        app: 'Perplexity',
        freeShort: 'No',
        changeShort: 'Yes',
        free: 'No',
        freeOk: false,
        lowest: 'Pro',
        change: 'Yes, with approval prompts',
        changeOk: true,
        notes: '',
        tested: false,
      },
      {
        app: 'Mistral (Vibe Work)',
        freeShort: 'Yes',
        changeShort: 'Yes',
        free: 'Yes',
        freeOk: true,
        lowest: 'Free',
        change: 'Yes, with approval prompts',
        changeOk: true,
        notes: '',
        tested: false,
      },
    ] as readonly CompatRow[],
  },

  // The /connect help page: the detail the landing's Connect section links to.
  connectPage: {
    title: 'Connect your AI to DeckPal',
    metaTitle: 'Connect your AI to DeckPal | DeckPal',
    metaDescription:
      'Add DeckPal to Claude, ChatGPT or another AI app as a custom connector in about two minutes: the connector URL, the steps for each app, and which plans work.',
    lead: 'DeckPal plugs into AI apps as a custom connector, sometimes called an MCP server. Adding it takes about two minutes, and you can remove it any time.',
    back: 'Back to DeckPal',
    sections: {
      need: {
        title: 'What you need',
        items: [
          'A DeckPal account. Pay what you want, $0 included.',
          "An AI app that supports custom connectors. Claude's free plan does; most other apps need a paid plan. The table below has the details.",
        ],
      },
      url: {
        title: 'The connector URL',
        body: 'Every app asks for the same address:',
      },
      claude: {
        title: 'Add it to Claude',
        steps: [
          'In Claude, open Customize, then Connectors.',
          'Choose Add, then add a custom connector.',
          'Name it DeckPal and paste the connector URL.',
          'Choose Connect, sign in to DeckPal, and approve.',
        ],
        note: 'Works on the web and the desktop app. Once added, it is there on mobile too.',
      },
      chatgpt: {
        title: 'Add it to ChatGPT',
        steps: [
          'Custom connectors in ChatGPT need Developer Mode, which is on paid plans and on the web only.',
          'In Settings, turn on Developer Mode, then create a connector with the connector URL. ChatGPT may call it an app or a plugin.',
          'Sign in to DeckPal and approve.',
        ],
        note: "OpenAI's help center says personal plans may limit connectors to reading your data. We haven't tested ChatGPT ourselves yet.",
      },
      others: {
        title: 'Other AI apps',
        body: "Gemini, Grok, Perplexity and Mistral also take custom connectors on some plans. Look for custom connectors or MCP in the app's settings and use the same URL. The table below shows what each app's own docs say.",
      },
      claudeCode: {
        title: 'Claude Code',
        body: 'Run this once in a terminal:',
      },
      access: {
        title: 'Read only, or read and change',
        body: 'You choose when you approve. Read only gives your AI the 15 tools that look things up. Read and change adds the 11 that edit your collection, decks, lists and battle logs. Most changes are previewed before they are saved, most can be reverted later, and you can disconnect any time in Profile, then Agent access.',
      },
      tools: {
        title: 'What your AI can do',
        groups: [
          { name: 'Collection', tools: 'collection_summary, collection_log, collection_value, log_cards, set_progress' },
          { name: 'Catalog and prices', tools: 'search_cards, get_card, card_price_history' },
          { name: 'Decks', tools: 'decks, save_deck, delete_deck, check_deck, deck_odds, deck_strategy, deck_history' },
          { name: 'Battle logs', tools: 'battle_logs, add_battle_log, edit_battle_log, delete_battle_log' },
          { name: 'Lists and shopping', tools: 'lists, edit_list, delete_list, set_cart' },
          { name: 'Safety', tools: 'health, mutation_history, revert' },
        ],
      },
      compat: {
        title: 'Which apps work on which plan',
      },
      trouble: {
        title: "If it doesn't connect",
        items: [
          'Check that you pasted the whole URL, https://deckpal.app/mcp.',
          'If the app asks for a client ID or secret, leave them empty. DeckPal registers the app for you when it connects.',
          'If it signs you in to the wrong DeckPal account, sign out of DeckPal in that browser and connect again.',
        ],
      },
    },
  },

  faq: {
    eyebrow: 'Questions',
    headline: 'Questions, answered.',
    items: FAQ,
  },

  closing: {
    headline: 'Got a deck idea? Make it real.',
    body: "Connect your AI, paste in a list or describe your idea, and start on something that's yours. Whether you want a fun deck for league night or a list built to win, DeckPal's in your corner.",
    primary: 'Start free',
    secondary: 'Browse the catalog',
    microline: 'No credit card. Nothing to install.',
    photoAlt: 'A long league table at night, playmats and cards in a row.',
  },

  seo: {
    jsonLdDescription:
      'DeckPal is an AI deck-building companion for the Pokémon TCG. It tracks your collection by printing, your decks and your PTCG Live battle logs, and connects them to the AI app you already use over MCP so your AI can plan, playtest and tune decks with you and build a TCGplayer cart for missing cards. Open source (AGPL-3.0); pay-what-you-want monthly subscription with $0 accepted.',
    jsonLdFeatureList: [
      'Connect Claude or another AI app to your own collection over MCP',
      'Deck builder with Pokémon TCG Live import and export and legality checks for Standard, Expanded, Gym Leader Challenge and Unlimited',
      'Battle log parsing with a record per deck version',
      'Missing-card lists with a TCGplayer cart at the cheapest printing',
      'Per-printing collection tracking, set progress and daily prices',
    ],
    jsonLdOfferDescription: 'Pay-what-you-want monthly subscription. $0 a month is an option.',
    llmsTxt: LLMS_TXT,
  },
} as const
