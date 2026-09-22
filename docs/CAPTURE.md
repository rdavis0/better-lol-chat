# Captures to validate the chat docs

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

## 3. Arena, when you play one

The message row only has `mine`, `my-team`, and `other-team`. An Arena dump is what shows whether each duo has its own id.

On the Arena post-game screen, paste:

```javascript
(async () => {
  const eog = await fetch('/lol-end-of-game/v1/eog-stats-block').then((r) => r.json());
  const board = document.querySelector(
    '.cherry-scoreboard-root-content-container, .scoreboard-root-component, .scoreboard-team-container',
  );
  const payload = {
    eog,
    scoreboardHtml: board ? board.outerHTML : null,
  };
  console.log('[BLC CAPTURE] arena', payload);
  copy?.(JSON.stringify(payload, null, 2));
  return payload;
})();
```

Save that as `docs/fixtures/arena-eog.json`. If the scoreboard HTML is too large for the clipboard, log `payload.scoreboardHtml` on its own and save it as `docs/fixtures/arena-scoreboard.html`.

Same-champion games (One for All, Arena duplicates, a blind-pick mirror) do not need their own capture unless the Summoner's Rift end-of-game block is missing a second player with the same `championId`.
