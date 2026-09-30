# Post-game chat interface

Reference for the League client DOM this plugin actually touches. The trimmed live export is `[docs/fixtures/postgame-screen.html](fixtures/postgame-screen.html)` (patch 16.18, 2026-09-22). Selectors below were confirmed there or in `rcp-fe-lol-postgame` / `rcp-fe-lol-social`. If a selector fails after a patch, re-check the live element before inventing a new one.

The plugin runs inside the client via Pengu. Host-page CSS is `style.css`. Message CSS is `frame.css`, injected as text into the messages iframe (`import frameCss from './frame.css?raw'`). A `<link>` does not work there.

## Two documents


| Surface         | Where                            | What lives there                                       |
| --------------- | -------------------------------- | ------------------------------------------------------ |
| Host page       | League client document           | Scoreboard, `lol-social-chat-room`, chat input, toggle |
| Messages iframe | `iframe#embedded-messages-frame` | Message rows, names, join/leave lines, credit          |


Host CSS does not apply inside the iframe. Do not call `textarea.focus()`. That scrolls the whole client.

## Chat room

```text
lol-social-chat-room[type="postGame"].scoreboard-v2
  .chat-box.focused-chat-box          open / fully expanded
    iframe#embedded-messages-frame
    lol-social-chat-input
      textarea.chat-input
      .chat-toggle-button
        .chat-placeholder-text        "Click or Enter to View" when collapsed
```

- `focused-chat-box` on `.chat-box` is vanilla’s open state. Removing it is the unfocused peek: a few recent lines, older lines clipped, background fading upward.
- The plugin keeps that class on while the Scoreboard tab is showing, so click-outside and blur do not collapse chat. It does this by rewriting the class only. It freezes `scrollTop` / `scrollLeft` around those writes.
- `.chat-toggle-button` is intercepted. Toggle-off removes `focused-chat-box` (vanilla peek). Toggle-on puts it back. Clicking the text field while collapsed also opens chat. The native input is kept.
- `can-hide-player-messages` is stripped so messages start visible. The room gets `blc-messages-unlocked`.
- Our collapsed flag is `blc-collapsed` on the room plus module state `windowCollapsed`.



## When chat is forced open

Post-game phases are `WaitingForStats`, `PreEndOfGame`, and `EndOfGame`.

Chat is forced open only when a `.scoreboard-team-container` is actually on screen (Scoreboard tab). On Progression that element is not showing, so the plugin leaves vanilla collapse alone. Switching back to Progression clears `focused-chat-box` once, then stops managing it.

While open on the scoreboard, the room is stretched with `blc-stretched`. Its top lines up with the top of `.scoreboard-header-component.is-player-team`. Width and bottom stay where vanilla put them. Each visible `.scoreboard-header-component` gets a leading flex child, `.blc-header-chat-gutter`, whose right edge lines up with the chat window. `.scoreboard-header-team-name` then has a 5px left margin. While shifted, `.scoreboard-header-content` drops Riot's fixed 500px width (inline, so it wins) and shrinks to its text. The header's own spacer absorbs that width, so `.scoreboard-column-icons-container` stays put. The iframe fills the height above the input. Numbers are measured, not hardcoded, and recomputed on resize.

## Messages iframe

The host export’s iframe is empty. The connected list is `[docs/fixtures/messages.html](fixtures/messages.html)`, paired with `[docs/fixtures/postgame-messages.json](fixtures/postgame-messages.json)` (2026-09-23). That HTML was captured while this plugin was running: chat names are already champion names, join rows have `blc-hide-join`, and leave rows already contain `.blc-system-name`.

Rows are rendered inside `iframe#embedded-messages-frame`. The list element is `<div class="messages" lang="en-US">`. Client template (`lol-social-chat-room`, `rcp-fe-lol-social`):

```html
<div class="messages" ref="messageContainer">
  <div class="message-box"
       class-mine="message.fromId === me.id"
       class-my-team="not me && end of game && same team as message.fromSummonerId"
       class-other-team="not me && end of game && not same team">
    <!-- system, celebration, or other non-chat -->
    <div class="system-message">
      <span chat-message="message"></span>
    </div>
    <!-- groupchat -->
    <div class="chat-message">
      <div class="message-name">{{displayName}}</div>
      <span class="message">:</span>
      <span class="message" chat-message="message"></span>
    </div>
  </div>
</div>
```

Only one of `.system-message` or `.chat-message` is present. A row is a system row when the message is not a chat message. Confirmed from the live iframe:

```html
<div class="messages" lang="en-US">
  <div class="message-box my-team blc-hide-join">
    <div class="system-message">
      <span>⁦⁦Name⁩ #⁦TAG⁩⁩ joined the lobby</span>
    </div>
  </div>
  <div class="message-box other-team">
    <div class="system-message">
      <span><span class="blc-system-name">Braum</span> left the lobby</span>
    </div>
  </div>
  <div class="message-box mine">
    <div class="chat-message">
      <div class="message-name">Jhin</div>
      <span class="message">:</span>
      <span class="message">gg tho was fun</span>
    </div>
  </div>
  <div class="message-box other-team">
    <div class="system-message">
      <span class="celebration">Everyone on your team honored a teammate! You got a little extra Honor progress this game.</span>
    </div>
  </div>
</div>
```

This capture has `.mine` and `.other-team` chat lines. `.my-team` appears on join and leave rows. No ally chat line was in the log.

Inject sample rows into `iframe.contentDocument.querySelector('.messages')`. An expired or disconnected session still has that node (`class="messages disconnected"`) and the frame stylesheet. The chat socket does not need to be connected. Do not append to the iframe `body`: it is `display: flex; flex-wrap: wrap`, so rows sit side by side, and the 12px font, line-height, and padding (`5px 7px 7px 10px`) are on `.messages`, not on `body`. If `.messages` is missing, create one and append it to `body`. Re-running should remove the previous sample nodes from that same parent.

### Chat line

- `.message-name` is one node. Before this plugin rewrites it, the text is the Riot ID. The plugin replaces that text only when it matches a mapped alias (`Name#TAG` or the game name before `#`). A champion name already in `.message-name` is left as-is. Team color still comes from the row class.
- With champion icons on, `.message-name` starts with `<img class="blc-champ-icon" alt="">`. The `src` is the roster portrait (`squarePortraitPath`, or `/lol-game-data/assets/v1/champion-icons/{id}.png`). Leave rows get the same image before `.blc-system-name`.
- The colon is its own `<span class="message">:</span>`. The text is `:`, with no spaces inside the span. The body is a second `<span class="message">` whose text is the LCU `body`.
- The client template leaves whitespace between those three nodes. Collapsed, that is one space before the colon and one space after it. Sample rows need those space text nodes. Without them the colon sits against the name.



### System line

- One `<span>` inside `.system-message`. No `.message-name`.
- LCU `type: "system"` and `body: "joined_room"` render as `{displayName} joined the lobby`. `body: "left_room"` renders as `{displayName} left the lobby`. The body field is the localization key, not the sentence.
- Join rows are hidden by adding `blc-hide-join` on the `.message-box` when the span text matches `joined the lobby` or `joined the room`. Leave rows stay. The leave sentence must remain one span so the name can be split off: after bidi marks are stripped, it is `Name #TAG left the lobby`. The name becomes `<span class="blc-system-name">Champion</span>` and the rest of the text stays gray.
- `type: "celebration"` uses the same `.system-message` wrapper. In this capture the span itself has class `celebration`, and its text is the LCU `body` (the honor sentence). `fromId`, `fromPuuid`, and `fromSummonerId` are empty. The row class was `other-team`.



### Display name

Rendered names wrap the game name and tag in left-to-right isolates:

```text
U+2066 U+2066 {gameName} U+2069 # U+2066 {tagLine} U+2069 U+2069
```

Example: `⁦⁦Chaotic Fiasco⁩ #⁦NA1⁩⁩`. Strip `U+200E`, `U+200F`, `U+202A–U+202E`, and `U+2066–U+2069` before comparing. Sample rows can omit the marks; the plugin strips them when present.

### Team class

The client sets the class on `.message-box` from `message.fromId === me.id` (mine), otherwise `fromSummonerId` against the end-of-game roster (my-team or other-team). Post-game `groupchat` messages often have `fromSummonerId: 0`, so allies are wrongly marked `.other-team`.

This plugin reclassifies each row from the eog roster (`player.ally`): match the speaker via Riot ID / leave text / unique champion name, then force `.my-team` or `.other-team`. `.mine` and celebration rows are left alone. A sample row only needs the correct class:


| Row class     | Who          | Name color | Message body |
| ------------- | ------------ | ---------- | ------------ |
| `.my-team`    | Allies       | `#16cae5`  | `#a1deed`    |
| `.other-team` | Enemies      | `#ff1a3e`  | `#e7c1c8`    |
| `.mine`       | Local player | `#fabe0a`  | `#bfb9a5`    |


Colors live as CSS variables on the iframe `:root` in `frame.css` (`--blc-name-ally`, `--blc-name-enemy`, `--blc-name-mine`, `--blc-message-ally`, `--blc-message-enemy`, `--blc-message-mine`, `--blc-leave-name`, `--blc-celebration`). Body colors apply while `.blc-tint-bodies` is on the iframe root. The options panel can change every name and body color.

Leave-row `.blc-system-name` inherits the system gray (`--blc-leave-name: inherit`). Celebration text uses `--blc-celebration` (`#a3862e`).

LCU `groupchat` messages in the 2026-09-23 capture use `fromSummonerId: 0`. `fromPuuid` is the bare puuid. `fromId` and `fromPid` are `{puuid}@{region}.pvp.net`. System `joined_room` / `left_room` messages use the bare puuid as `fromId` and a nonzero `fromSummonerId`. The post-game conversation id looks like `{gameId}-eog@lol-post-game.{region}.pvp.net`.

### Credit

`#blc-credit` is appended to the iframe `<html>`, not inside the scrolling message list. It is `position: fixed` at the top of the frame so it does not scroll away. Text comes from `CREDIT_TEXT` in `index.js` (currently `better-lol-chat by wryguy`). Gold `#ffd700` on `#0e0638`. Font family, size, and line-height are copied from a `.chat-message` / `.message` node. Class `blc-credit-hidden` hides it when chat is minimized (`focused-chat-box` absent, or our collapse flag). The gear on that line opens `#blc-options` on the host page.

Plugin version is the single `VERSION` constant in `index.js` (`X.X`). It is logged once on `load()` as `[better-lol-chat] vX.X` and shown on the update row in the options panel.

## Identity

Built when post-game starts, from:

- `/lol-summoner/v1/current-summoner`
- `/lol-end-of-game/v1/eog-stats-block` (`teams[].isPlayerTeam`, players with `puuid`, `summonerId`, `championId`, `riotId`)
- `/lol-game-data/assets/v1/champion-summary.json` (`id` → `name`, `squarePortraitPath`)
- `/lol-chat/v1/conversations` type `postGame`, then that conversation’s messages

`joined_room` system messages map `fromPuuid` to `fromSummonerId` when the end-of-game block is missing one of them. Displayed names match `Name#TAG`, or the game name before `#`.

Champion icons from that summary look like `/lol-game-data/assets/v1/champion-icons/222.png`. The client serves them. Use the path as an `<img src>`.

## Scoreboard rows

Relevant classes from the post-game screen (Summoner’s Rift row):

```text
.scoreboard-team-container
  .scoreboard-row-component.is-local-player.is-ally | .is-ally | (no team class = enemy)
    .scoreboard-row-content-container.centered-flex-box
      .scoreboard-row-player-details-container
        .scoreboard-row-player-name
          .player-name__game-name
        .scoreboard-row-champ-name
      .scoreboard-row-pike
      .scoreboard-row-items-container
        .postgame-player-item          filled slots, empty slots (background url "undefined"), .item-spacer
      .scoreboard-row-stat-display-component.INDIVIDUAL_KDA
        .scoreboard-row-stat-line-primary
      .scoreboard-row-stat-display-component.TOTAL_DAMAGE_DEALT_TO_CHAMPIONS
      .scoreboard-row-stat-display-component.GOLD_EARNED
      .scoreboard-updated-challenge-component
        img.scoreboard-updated-challenge-icon
```

Live row markup, with Ember noise removed: `[docs/fixtures/postgame-screen.html](fixtures/postgame-screen.html)`. That file keeps the local player, one ally, one enemy, and the post-game chat shell. The messages iframe in the export is empty.

The KDA column (`.INDIVIDUAL_KDA` / `.scoreboard-row-stat-line-primary`) is the scoreline immediately after the items. Challenge icons sit after gold, not between items and KDA.

`.blc-row-champ` is an absolutely positioned image centered between the last `.postgame-player-item` and `.INDIVIDUAL_KDA`. The items container is a fixed 235px box with the slots packed left, so that empty space is inside the container, flush with the KDA column. Its size matches the primary keystone holder (`.postgame-player-keystone-icon.circle-icon-holder`, 30px at the default client scale). It is recentered on the 250ms tick and on window `resize`. `pointer-events: none` so item tooltips still work.

Do not insert the icon as a flex child. That shifts the row.

## Plugin entry

Pengu calls `init(context)` then `load()`. `context.socket.observe(api, listener)` delivers `{ data, uri, eventType }`. Inside the client, `fetch('/lol-...')` needs no basic auth.

Console prefix: `[better-lol-chat]`. Version is logged once on load.
