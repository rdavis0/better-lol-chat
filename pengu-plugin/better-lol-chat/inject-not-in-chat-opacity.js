/**
 * Override the vanilla not-in-chat scoreboard dim for live testing.
 *
 * Vanilla rule (rcp-fe-lol-postgame.css):
 *   .scoreboard-row-component.not-in-chat
 *     .scoreboard-row-player-details-container
 *     .scoreboard-row-skin-background { opacity: .5 }
 *
 * Paste into League DevTools on the post-game screen (host document, not
 * the messages iframe). Then:
 *   window.__blcSetNotInChatOpacity(0.75)
 *   window.__blcSetNotInChatOpacity(1)     // fully bright
 *   window.__blcClearNotInChatOpacity()
 */
(function blcInjectNotInChatOpacity() {
  const STYLE_ID = 'blc-not-in-chat-opacity';
  const DEFAULT = 0.3;

  function ensureStyle() {
    let el = document.getElementById(STYLE_ID);
    if (!el) {
      el = document.createElement('style');
      el.id = STYLE_ID;
      document.documentElement.appendChild(el);
    }
    return el;
  }

  function apply(opacity) {
    const value = Number(opacity);
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      console.warn('[BLC] opacity must be 0..1, got', opacity);
      return;
    }

    ensureStyle().textContent = [
      '.scoreboard-row-component.not-in-chat',
      '  .scoreboard-row-player-details-container',
      '  .scoreboard-row-skin-background,',
      '.scoreboard-row-component.not-in-chat',
      '  .scoreboard-row-player-details-container',
      '  .scoreboard-row-skin-background-strawberry,',
      '.scoreboard-row-component.not-in-chat',
      '  .scoreboard-row-player-details-container',
      '  .scoreboard-row-skin-background-jade,',
      '.scoreboard-row-component.not-in-chat > .blc-row-champ,',
      '.strawberry-scoreboard-row-component.not-in-chat > .blc-row-champ,',
      '.jade-scoreboard-row-component.not-in-chat > .blc-row-champ {',
      '  opacity: ' + value + ';',
      '}',
    ].join('\n');

    const hits = document.querySelectorAll(
      '.scoreboard-row-component.not-in-chat .scoreboard-row-skin-background, .not-in-chat > .blc-row-champ',
    );
    console.log(
      '[BLC] not-in-chat skin opacity →',
      value,
      '(' + hits.length + ' row(s) matched)',
    );
  }

  function clear() {
    document.getElementById(STYLE_ID)?.remove();
    console.log('[BLC] not-in-chat opacity override cleared');
  }

  window.__blcSetNotInChatOpacity = apply;
  window.__blcClearNotInChatOpacity = clear;
  apply(DEFAULT);
})();
