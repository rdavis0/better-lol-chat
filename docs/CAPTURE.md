# Captures to validate the chat docs

- [x] Connected message list — [`docs/fixtures/messages.html`](fixtures/messages.html) (2026-09-23). Captured with the plugin running, so names are already champions and leave rows already use `.blc-system-name`.
- [x] Matching LCU messages — [`docs/fixtures/postgame-messages.json`](fixtures/postgame-messages.json)
- [x] Client dialog style references — [`docs/fixtures/client-exit-dialog.html`](fixtures/client-exit-dialog.html), [`docs/fixtures/client-privacy-notice.html`](fixtures/client-privacy-notice.html) (patch 16.19)
- [ ] Update dialog live check: where the client mounts `.dialog-confirm`, and the markup of the frame's close button (run `/dialog` first)

Do this on a post-game screen while the chat session is still connected. An expired frame only shows `.messages.disconnected` and cannot confirm the row markup. `docs/fixtures/postgame-screen.html` is not a substitute: its iframe is empty.

Save the results under `docs/fixtures/`. The full client page and another inject into an expired frame are not needed.

## 1. Connected message list

Open DevTools on the post-game screen (`Ctrl+Shift+I`), with chat expanded and a few real lines visible. Paste:

```javascript
(() => {
  const room = document.querySelector('lol-social-chat-room[type="postGame"]');
  const iframe = room?.querySelector('iframe#embedded-messages-frame, iframe');
  const doc = iframe?.contentDocument || iframe?.contentWindow?.document;
  const messages = doc?.querySelector('.messages');
  if (!messages) {
    console.warn('[BLC CAPTURE] no .messages node. Connect post-game chat and expand it, then run this again.');
    return;
  }
  const html = messages.outerHTML;
  console.log('[BLC CAPTURE] messages html length', html.length);
  console.log(html);
  copy?.(html);
  return html;
})();
```

If `copy` ran, paste the clipboard into `docs/fixtures/messages.html`. Otherwise right-click the logged string and copy that.

A short stretch is enough. It should include one of each, when the game actually produced them:

- a `.mine` chat line
- a `.my-team` chat line
- an `.other-team` chat line
- a “joined the lobby” row
- a “left the lobby” row
- a celebration row, if one is on screen

## 2. Matching LCU messages

Same screen, same DevTools console. This is the API list for that room, so each DOM row can be tied to `type`, `body`, `fromId`, `fromPuuid`, and `fromSummonerId`.

```javascript
(async () => {
  const convos = await fetch('/lol-chat/v1/conversations').then((r) => r.json());
  const post = (Array.isArray(convos) ? convos : []).find((c) => c.type === 'postGame');
  if (!post?.id) {
    console.warn('[BLC CAPTURE] no postGame conversation');
    return;
  }
  const messages = await fetch(
    '/lol-chat/v1/conversations/' + encodeURIComponent(post.id) + '/messages',
  ).then((r) => r.json());
  const payload = { conversation: post, messages };
  console.log('[BLC CAPTURE] LCU messages', messages?.length, payload);
  copy?.(JSON.stringify(payload, null, 2));
  return payload;
})();
```

Save the JSON as `docs/fixtures/postgame-messages.json`.

Same-champion games (One for All, a blind-pick mirror) do not need their own capture unless the Summoner's Rift end-of-game block is missing a second player with the same `championId`.
