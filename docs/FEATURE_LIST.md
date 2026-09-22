# better-lol-chat — Feature list

Unofficial post-game chat improvements. One product name, two packages:

- **Client Package** — Pengu plugin that changes Riot's existing screen. Source folder is still `pengu-plugin/better-postgame-chat/` until that directory is renamed.
- **Standalone App** — separate window. Same name. "Plus" stays the premium tier inside this app, not a second product name.

Status tracks implementation.

## Shipped (Pengu prototype)

- [x] Replace Riot IDs with champion names in post-game chat
- [x] Color messages by team (ally/self cyan, enemy red)
- [x] Hide “joined the lobby” / system join rows
- [x] Keep chat open on click-outside / blur (vs vanilla collapse)
- [x] Repurpose `.chat-toggle-button` to collapse/expand the full chat window
- [x] Local gold credit line when post-game chat loads: `better-lol-chat by wryguy`

## Planned — client (Pengu)

### Name display mode
- [ ] **Toggle champion names ↔ player names**
  User can switch the post-game chat name column between:
  - **Champion** (current default) — e.g. `Jinx`
  - **Player** — Riot ID as Riot shows it, e.g. `Name#TAG`
  Prefer a small control on/near the chat chrome (not buried in settings). Remember last choice for the session at minimum; persist across games if easy.

### Readability
- [ ] Champion icons next to names
- [ ] Optional timestamps on messages
- [ ] Message spacing / readability polish
- [ ] Hide or simplify leave-room rows the same way joins are hidden
- [ ] More robust identity mapping if eog/PUUID fields change

The client plugin stays useful on its own. Do not paywall champion names, team colors, or basic readability.

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
