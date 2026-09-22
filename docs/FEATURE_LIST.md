# better-postgame-chat — Feature list

Unofficial Pengu plugin for League post-game chat. Items here are product intent; status tracks implementation.

## Shipped (prototype)

- [x] Replace Riot IDs with champion names in post-game chat
- [x] Color messages by team (ally/self cyan, enemy red)
- [x] Hide “joined the lobby” / system join rows
- [x] Keep chat open on click-outside / blur (vs vanilla collapse)
- [x] Repurpose `.chat-toggle-button` to collapse/expand the full chat window

## Planned

### Name display mode
- [ ] **Toggle champion names ↔ player names**  
  User can switch the post-game chat name column between:
  - **Champion** (current default) — e.g. `Jinx`
  - **Player** — Riot ID as Riot shows it, e.g. `Name#TAG`  
  Prefer a small control on/near the chat chrome (not buried in settings). Remember last choice for the session at minimum; persist across games if easy.

### Follow-ups (not prioritized)

- [ ] Champion icons next to names
- [ ] Optional timestamps on messages
- [ ] Readability / spacing polish
- [ ] More robust identity mapping if eog/PUUID fields change
- [ ] Companion app (separate surface; see product plan when written)

## Notes

- Do not inject ads into the League client.
- Keep free client features useful on their own (no paywall on basic name/team UX).
