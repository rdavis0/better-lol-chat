# better-lol-chat — Feature list

Unofficial post-game chat improvements. One product name, two packages:

- **Client Package** — Pengu plugin that changes Riot's existing screen. Source folder is still `pengu-plugin/better-postgame-chat/` until that directory is renamed.
- **Standalone App** — separate window. Same name. "Plus" stays the premium tier inside this app, not a second product name.

Status tracks implementation.

## Shipped (Pengu prototype)

- [x] Replace Riot IDs with champion names in post-game chat
- [x] Color messages by team (allies cyan, enemies red, you gold)
- [x] Reclassify ally chat rows wrongly marked `.other-team` (groupchat `fromSummonerId` is often 0) using the eog roster
- [x] Hide “joined the lobby” rows
- [x] Keep “left the lobby” rows, with the champion name colored by team and the rest of the line gray
- [x] Keep chat open on click-outside / blur (vs vanilla collapse)
- [x] Repurpose `.chat-toggle-button` to collapse/expand the full chat window
- [x] Local gold credit line when post-game chat loads: `better-lol-chat by wryguy`
- [x] Champion icons in the scoreboard gap between items and the KDA column

## Planned — client (Pengu)

### Options
One gear on the chat chrome opens a small panel. Do not put five toggles on the bar itself. Every control is a toggle.

Persistence uses the League client’s `localStorage` under a namespaced key (for example `blc-settings`). On load, merge saved values over the defaults so an update that adds a toggle keeps prior choices and only fills new keys. Survives plugin updates. Cleared if the user uninstalls League or wipes client storage — acceptable. Do not write settings through `context.fs`.

- [ ] Gear control that opens / closes the options panel
- [ ] **Taller chat window** — current scoreboard stretch. Off leaves Riot’s height.
- [ ] **Replace player names with champion names** — current default on. Off shows the Riot ID (`Name#TAG`).
- [ ] **Show champion icons** next to chat names.
- [ ] **Colored message bodies** — tint ally / enemy / your `.message` text. Off leaves Riot’s body color (names can stay team-colored).
- [ ] **Custom colors** — pick name and body colors (ally / enemy / you). Defaults are the current CSS variables.
- [ ] **Stronger not-in-chat dim** — current scoreboard splash + gap-icon fade/grayscale. Off leaves Riot’s `opacity: .5` only.
- [ ] **Automatically open chat** — current keep-open behavior on the scoreboard. Off leaves Riot’s click-outside collapse.
- [ ] **Automatically focus chat** — put the caret in the input when chat opens. Do not use `textarea.focus()` until a capture shows a way that does not scroll the whole client.
- [ ] Load / save the toggle set via `localStorage` (merge with defaults on load)

### Pre-game chat
Not started. Post-game was the prototype because champion mapping comes from the end-of-game stats block, which does not exist in champ select or the lobby. Pre-game needs its own room type, its own player list (picks change during select), and a DOM capture before the same toggles can apply.

- [ ] Champion names, team colors, and champion icons in champ-select chat
- [ ] Same options as post-game, once that screen’s chat DOM is captured

### Readability
- [ ] Optional timestamps on messages
- [ ] Message spacing / readability polish
- [ ] More robust identity mapping if eog/PUUID fields change

The client plugin stays useful on its own. Do not paywall champion names, team colors, or basic readability.

### Arena
The chat row only has `mine`, `my-team`, and `other-team`. Every opponent shares `other-team`, so Arena teams are not distinguishable from the message class. Team id has to come from the end-of-game `teams[]` block.

- [ ] **Multi-team color coding**
  Give each Arena team its own name color. Your duo stays the ally color. The other duos do not all stay red.
- [ ] **Scoreboard team highlight**
  Mark each team on the Arena scoreboard with that same color.

### Same champion
- [ ] **Champion ditto**
  When one champion appears more than once (One for All, Arena duplicates, blind-pick mirrors), keep players mapped by puuid and summoner id. Disambiguate the chat label so two copies are not shown as the same person. Scoreboard icons must follow the player, not the champion name alone.

## Planned — companion app

Standalone desktop app (own window). These do not belong in the League client.

- [ ] Detect the `postGame` room and show messages live
- [ ] Send a message through the LCU conversation endpoint
- [ ] Resizable / detachable chat, including a larger or full-screen window
- [ ] Second-monitor support and always-on-top
- [ ] Persistent chat history after Riot destroys the room
- [ ] Search previous conversations
- [ ] Filter by game, player, champion, or date
- [ ] Friend chats alongside post-game chats
- [ ] Multiple chat tabs
- [ ] Custom themes and layouts
- [ ] Font size and message-density controls
- [ ] Timestamps and champion icons
- [ ] Copy / export conversations
- [ ] Notifications
- [ ] Manual quick-message buttons (user presses the button; the app sends that text)
- [ ] **Emoji input** (standalone app only)
- [ ] Translation
- [ ] Cloud sync of history and settings

### Premium companion tier

Free companion may include ads in its own window. Premium (subscription or one-time) can add:

- [ ] Remove ads
- [ ] Unlimited chat history
- [ ] Advanced search and filtering
- [ ] Extra themes and customization
- [ ] Multiple chat windows
- [ ] Cloud-synced history and settings
- [ ] Translation
- [ ] Custom macro sets
- [ ] Advanced notification options

## Planned — install and updates

Constraints:

- The Client Package runs inside the League client. It cannot raise its own permissions, and `context.fs` cannot write outside its plugin folder. Program Files is read-only from that process.
- Pengu only loads `index.js` from its `plugins` folder. A second, writable folder is not a plugin and is not reachable through `context.fs`.
- Updates are applied by the Standalone App (or the installer). For a Program Files install it starts a separate updater so Windows can show the elevation prompt, then asks for a League restart. One prompt per update, not from inside a game. A `%LOCALAPPDATA%` install can copy files with no prompt.
- The user still turns Pengu on once. A League patch that breaks Pengu is fixed by Pengu's own update.

- [ ] Bundle Pengu largely unchanged (portable zip, not a fork) and keep its license in the installer
- [ ] If Pengu is already installed, use that directory. Do not install a second copy
- [ ] If Pengu is missing, extract it to a user-writable folder (for example under `%LOCALAPPDATA%\better-lol-chat`), outside the League and Riot Client directories
- [ ] Copy the Client Package into that Pengu `plugins` folder
- [ ] Standalone App replaces plugin files, requesting elevation when the folder is under Program Files

## Notes

- Do not inject ads into the League client. Ads and premium stay in the companion window.
- Macros stay user-initiated. Do not auto-send on game end, auto-reply, or schedule chat.
- A public or monetized LCU product needs Riot's developer approval before release.
- Prefer bundling Pengu largely unchanged, and keep its license with any installer.
