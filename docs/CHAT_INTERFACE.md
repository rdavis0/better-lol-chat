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

While open on the scoreboard, the room is stretched with `blc-stretched`. Its top lines up with the first visible `.scoreboard-team-container`. Width and bottom stay where vanilla put them. The iframe fills the height above the input. Numbers are measured, not hardcoded, and recomputed on resize.

## Messages iframe

The host export’s iframe is empty. Rows are rendered inside `iframe#embedded-messages-frame` from this client template (`lol-social-chat-room`, patch line of `rcp-fe-lol-social`):

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

Only one of `.system-message` or `.chat-message` is present. A row is a system row when the message is not a chat message. Confirmed rendered HTML from the live iframe:

```html
<div class="message-box my-team">
  <div class="system-message">
    <span>⁦⁦Chaotic Fiasco⁩ #⁦NA1⁩⁩ joined the lobby</span>
  </div>
</div>

<div class="message-box other-team">
  <div class="system-message">
    <span>⁦⁦Ezreal bot⁩ #⁦BOT⁩⁩ joined the lobby</span>
  </div>
</div>

<div class="message-box mine">
  <div class="chat-message">
    <div class="message-name">⁦⁦Chaotic Fiasco⁩ #⁦NA1⁩⁩</div>
    <span class="message"> : </span>
    <span class="message">afaewf</span>
  </div>
</div>
```

Inject sample rows into `iframe.contentDocument.querySelector('.messages')`. An expired or disconnected session still has that node (`class="messages disconnected"`) and the frame stylesheet. The chat socket does not need to be connected. Do not append to the iframe `body`: it is `display: flex; flex-wrap: wrap`, so rows sit side by side, and the 12px font, line-height, and padding (`5px 7px 7px 10px`) are on `.messages`, not on `body`. If `.messages` is missing, create one and append it to `body`. Re-running should remove the previous sample nodes from that same parent.

### Chat line

- `.message-name` is one node. Its text is the Riot ID, not the champion. The plugin rewrites that text only when it matches a mapped alias (`Name#TAG` or the game name before `#`). Putting a champion name in `.message-name` skips the rewrite; team color still applies from the row class.
- The colon is its own `<span class="message">:</span>`. The body is a second `<span class="message">` whose text is the LCU `body`. Do not combine them.
- There is no space text node between the name and the colon. The body span’s text does not include a leading colon.



### System line

- One `<span>` inside `.system-message`. No `.message-name`.
- LCU `type: "system"` and `body: "joined_room"` render as `{displayName} joined the lobby`. `body: "left_room"` renders as `{displayName} left the lobby`. The body field is the localization key, not the sentence.
- Join rows are hidden by adding `blc-hide-join` on the `.message-box` when the span text matches `joined the lobby` or `joined the room`. Leave rows stay. The leave sentence must remain one span so the name can be split off: after bidi marks are stripped, it is `Name #TAG left the lobby`. The name becomes `<span class="blc-system-name">Champion</span>` and the rest of the text stays gray.
- `type: "celebration"` also uses `.system-message > span`. Its text is the celebration body itself (for example `Name earned an S+ on Ekko`), and the span may have class `celebration`.



### Display name

Rendered names wrap the game name and tag in left-to-right isolates:

```text
U+2066 U+2066 {gameName} U+2069 # U+2066 {tagLine} U+2069 U+2069
```

Example: `⁦⁦Chaotic Fiasco⁩ #⁦NA1⁩⁩`. Strip `U+200E`, `U+200F`, `U+202A–U+202E`, and `U+2066–U+2069` before comparing. Sample rows can omit the marks; the plugin strips them when present.

### Team class

Set the class on `.message-box`. The client picks it from `message.fromId === me.id` (mine), otherwise `fromSummonerId` against the end-of-game roster (my-team or other-team). A sample row only needs the class:


| Row class     | Who          | Color     |
| ------------- | ------------ | --------- |
| `.my-team`    | Allies       | `#16cae5` |
| `.other-team` | Enemies      | `#be1e37` |
| `.mine`       | Local player | `#c89b3c` |


Name and both `.message` spans take that color. `.message-name` is bold. Leave-row `.blc-system-name` uses the muted mix (ally `#70abab`, enemy `#ab6f6e`, you `#ae9b70`).

LCU groupchat messages often have `fromSummonerId: 0` and `fromPuuid` / `fromId` set to the sender puuid. System `joined_room` / `left_room` messages carry both `fromPuuid` and `fromSummonerId`.

### Credit

`#blc-credit` is appended to the iframe `<html>`, not inside the scrolling message list. It is `position: fixed` at the top of the frame so it does not scroll away. Text: `better-lol-chat by wryguy`. Gold `#ffd700` on `#0e0638`. Font family, size, and line-height are copied from a `.chat-message` / `.message` node. Class `blc-credit-hidden` hides it when chat is minimized (`focused-chat-box` absent, or our collapse flag).

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

Console prefix: `[better-postgame-chat]`.