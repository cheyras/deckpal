// Keyboard layout probe for the iOS Simulator.
//
// A single JS expression, meant to be handed to wir.py:
//   python3 tools/ios-sim/wir.py eval --app safari '' @tools/ios-sim/keyboard_probe.js
//
// Run it AFTER the on-screen keyboard is already up (tap the field for real
// with the simulator MCP tool first -- see README.md; a script-triggered
// .focus() does not reliably raise the keyboard, since iOS gates it on a real
// touch). It reports the numbers that matter for "did the keyboard just push
// or crop something it shouldn't have": window.visualViewport (the part of
// the page actually visible above the keyboard), whether the document itself
// scrolled or became pannable, the focused element's own rect, and the
// rects of anything that looks like a dialog/sheet, its title and a header --
// because the 2026-09-23 investigation's bug was exactly a modal's sheet
// gaining scroll it should not have had once the keyboard came up.
//
// Returns a plain JSON-serializable object (see the trailing `return`).
(function () {
  function rectOf(el) {
    if (!el) return null;
    var r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height, top: r.top, bottom: r.bottom, right: r.right, left: r.left };
  }

  // First matching element for each selector, in order -- not "all modals",
  // just whichever one thing on screen looks like the dialog/title/header.
  function firstMatch(selectors) {
    for (var i = 0; i < selectors.length; i++) {
      var el = document.querySelector(selectors[i]);
      if (el) return { selector: selectors[i], rect: rectOf(el), text: (el.textContent || '').trim().slice(0, 80) };
    }
    return null;
  }

  var vv = window.visualViewport;
  var doc = document.documentElement;
  // No focused field falls back to document.body, not null -- excluded here (not just in the
  // output below) so activeRect is never the body's own rect. Left in, a tall page with nothing
  // focused reported focusedElementCoveredByKeyboard: true (the body "covered" by the keyboard)
  // even though activeElement correctly reported null right next to it.
  var active = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;

  var visualViewport = vv ? {
    width: vv.width, height: vv.height,
    offsetTop: vv.offsetTop, offsetLeft: vv.offsetLeft,
    pageTop: vv.pageTop, pageLeft: vv.pageLeft,
    scale: vv.scale,
  } : null;

  var activeRect = rectOf(active);
  // The gap between the layout viewport and the visual one is roughly the
  // keyboard's height (plus any toolbar the keyboard itself adds).
  var keyboardHeightEstimate = vv ? Math.max(0, window.innerHeight - vv.height) : null;
  // Root scrollability must be measured against the LAYOUT viewport
  // (window.innerHeight, which iOS Safari does not shrink for the keyboard),
  // never the visual one (vv.height, which always shrinks while the keyboard
  // is up). Comparing against vv.height instead reports every ordinary
  // keyboard appearance as "the document became pannable," even on a page
  // with no overflow bug at all (scrollHeight === clientHeight === innerHeight)
  // -- caught by Astra's review; see DECISIONS.md.
  var documentPannable = doc.scrollHeight > window.innerHeight + 1;

  return {
    activeElement: active ? {
      tag: active.tagName,
      id: active.id || null,
      name: active.getAttribute('name') || null,
      type: active.getAttribute('type') || null,
      rect: activeRect,
    } : null,
    visualViewport: visualViewport,
    window: { innerWidth: window.innerWidth, innerHeight: window.innerHeight },
    scrollY: window.scrollY,
    documentScrollHeight: doc.scrollHeight,
    documentPannable: documentPannable,
    keyboardHeightEstimate: keyboardHeightEstimate,
    dialog: firstMatch(['[role="dialog"]', 'dialog[open]', '.modal', '[data-modal]', '[data-sheet]']),
    title: firstMatch(['[role="dialog"] h1', '[role="dialog"] h2', 'dialog h2', 'h1']),
    header: firstMatch(['header', '[role="banner"]']),
    verdicts: {
      // The known 2026-09-23 bug: the document itself picks up scroll once
      // the keyboard is up, instead of only the modal's own content moving.
      documentScrolledWhileKeyboardUp: window.scrollY !== 0,
      documentBecamePannable: documentPannable,
      // Null (not false) when there is no visualViewport or no focused
      // element to compare -- "unknown" is a different answer than "no."
      focusedElementCoveredByKeyboard: (activeRect && vv) ? (activeRect.bottom > vv.height + vv.offsetTop) : null,
    },
  };
})()
