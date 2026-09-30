/** Pure chat-label and timestamp matching. No DOM. */

export function formatClock(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  let hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const suffix = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `${hours}:${minutes} ${suffix}`;
}

export function formatStamp(iso) {
  if (!iso) return '';
  return formatClock(new Date(iso));
}

function normBody(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Champion-only labels collide when a champion is picked twice.
 * Append the game name, and the tag when that game name collides too.
 */
export function championLabel(player, roster) {
  const name = player?.championName || '';
  if (!name) return '';
  const same = (roster || []).filter(
    (entry) => entry?.championName && entry.championName.toLowerCase() === name.toLowerCase(),
  );
  if (same.length < 2) return name;
  const game = String(player.gameName || '').trim();
  const gameClash = same.filter((entry) => String(entry.gameName || '').trim() === game).length > 1;
  if (game && !gameClash) return `${name} · ${game}`;
  const tag = String(player.tagLine || '').trim();
  if (game && tag) return `${name} · ${game}#${tag}`;
  return game ? `${name} · ${game}` : name;
}

export function buildMessageLog(messages) {
  const next = [];
  for (const msg of messages || []) {
    const time = formatStamp(msg?.timestamp);
    if (!time) continue;
    if (msg?.type === 'groupchat') {
      next.push({
        kind: 'chat',
        body: normBody(msg.body),
        time,
        puuid: msg.fromPuuid ? String(msg.fromPuuid) : '',
      });
      continue;
    }
    if (msg?.type === 'system' && String(msg.body) === 'left_room') {
      next.push({
        kind: 'leave',
        time,
        puuid: msg.fromPuuid ? String(msg.fromPuuid) : '',
        summonerId:
          msg.fromSummonerId != null && msg.fromSummonerId !== '' ? String(msg.fromSummonerId) : '',
      });
    }
  }
  return next;
}

/** Walk the log in order. Same body from different people stays on the matching puuid. */
export function takeChatStamp(log, used, body, puuid) {
  const want = normBody(body);
  const who = puuid ? String(puuid) : '';
  for (let i = 0; i < (log || []).length; i++) {
    if (used.has(i)) continue;
    const entry = log[i];
    if (entry.kind !== 'chat' || entry.body !== want) continue;
    if (who && entry.puuid && entry.puuid !== who) continue;
    used.add(i);
    return entry.time || '';
  }
  return '';
}

/** First unused leave line for this player. `used` is shared with chat stamps. */
export function takeLeaveStamp(log, used, player) {
  if (!player) return '';
  const puuid = player.puuid ? String(player.puuid) : '';
  const summonerId =
    player.summonerId != null && Number(player.summonerId) !== 0 ? String(player.summonerId) : '';
  for (let i = 0; i < (log || []).length; i++) {
    if (used?.has(i)) continue;
    const entry = log[i];
    if (entry.kind !== 'leave') continue;
    const byPuuid = puuid && entry.puuid && entry.puuid === puuid;
    const bySummoner =
      summonerId && entry.summonerId && entry.summonerId !== '0' && entry.summonerId === summonerId;
    if (!byPuuid && !bySummoner) continue;
    used?.add(i);
    return entry.time || '';
  }
  return '';
}
