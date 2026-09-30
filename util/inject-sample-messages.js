/**
 * Inject a post-game chat sample into the messages iframe.
 *
 * With the plugin loaded, either of these works on the post-game scoreboard:
 *   Enter /sample or /demo in the client chat box (the line is not sent)
 *   window.__blcInjectSampleMessages() in dev tools console
 *
 * Re-running replaces the previous sample. Clear with:
 *   window.__blcClearSampleMessages()
 *
 * Pasting this file does the same call. Rows use the client template, not a
 * finished label. The plugin maps scoreboard names, then name style, icons,
 * and team colors apply the same way they do for live chat. This does not
 * send messages.
 */
if (typeof window.__blcInjectSampleMessages === 'function') {
  window.__blcInjectSampleMessages();
} else {
  console.warn(
    '[BLC SAMPLE] reload the plugin, then call window.__blcInjectSampleMessages()',
  );
}
