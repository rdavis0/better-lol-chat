import { showsSummoner, showsChampion } from './settings.js';
import { aliases, players } from './roster.js';

const JOIN_TEXT = /joined(\s+the)?\s+(room|lobby)/i;
const LEAVE_TEXT = /^(.*?)\s+(left(?:\s+the)?\s+(?:room|lobby))\s*$/i;
const JOIN_LINE = /^(.*?)\s+joined(?:\s+the)?\s+(?:room|lobby)\s*$/i;

export function isJoinNotice(text) {
  return JOIN_TEXT.test(String(text || ''));
}

export function stripBidi(s) {
  return String(s || '').replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '');
}

function riotIdParts(value) {
  const trimmed = stripBidi(value).trim();
  const hash = trimmed.indexOf('#');
  if (hash === -1) return { name: trimmed.toLowerCase(), tag: '' };
  return {
    name: trimmed.slice(0, hash).trim().toLowerCase(),
    tag: trimmed.slice(hash + 1).trim().toLowerCase(),
  };
}

export function matchAlias(text) {
  const trimmed = stripBidi(text).trim();
  if (!trimmed || JOIN_TEXT.test(trimmed)) return null;
  const lower = trimmed.toLowerCase();
  for (const entry of aliases()) {
    if (entry.name.toLowerCase() === lower) return entry;
  }
  const query = riotIdParts(trimmed);
  if (!query.name) return null;
  for (const entry of aliases()) {
    const alias = riotIdParts(entry.name);
    if (!alias.name || alias.name !== query.name) continue;
    if (query.tag && alias.tag && query.tag !== alias.tag) continue;
    return entry;
  }
  return null;
}

function summonerLabel(originalText) {
  return stripBidi(originalText).replace(/\s+/g, ' ').trim();
}

function paintChatName(el, original, champ) {
  if (!showsChampion() || !champ) {
    if (stripBidi(el.textContent) !== stripBidi(original)) el.textContent = original;
    return;
  }
  if (!showsSummoner()) {
    if (el.childElementCount || el.textContent !== champ) el.textContent = champ;
    return;
  }
  const summoner = summonerLabel(original);
  const champNote = `(${champ})`;
  const extra = el.querySelector(':scope > .blc-secondary-name');
  if (
    el.childNodes.length === 2 &&
    el.firstChild?.nodeType === 3 &&
    el.firstChild.textContent === summoner &&
    extra?.textContent === champNote
  ) {
    return;
  }
  const doc = el.ownerDocument;
  const span = doc.createElement('span');
  span.className = 'blc-secondary-name';
  span.textContent = champNote;
  el.replaceChildren(doc.createTextNode(summoner), span);
}

function rewriteNames(root) {
  const nameNodes = root.querySelectorAll?.('.message-box .message-name') || [];
  for (const el of nameNodes) {
    if (el.closest?.('.system-message')) continue;
    let original = el.dataset.blcOriginal;
    let champ = '';
    if (original != null) {
      champ = resolvePlayer(stripBidi(original).trim())?.championName || '';
    } else if (aliases().length) {
      const match = matchAlias(stripBidi(el.textContent || '').trim());
      if (!match) continue;
      original = el.textContent;
      el.dataset.blcOriginal = original;
      champ = match.player.championName || '';
    } else {
      continue;
    }
    paintChatName(el, original, champ);
  }
}

function parseLobbyLine(text) {
  const normalized = stripBidi(text).replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  const leave = normalized.match(LEAVE_TEXT);
  if (leave) return { kind: 'leave', name: leave[1].trim(), verb: leave[2] };
  const join = normalized.match(JOIN_LINE);
  if (join) return { kind: 'join', name: join[1].trim() };
  return null;
}

function fixTeamClasses(root) {
  if (!players().length && !aliases().length) return;

  const boxes = root.querySelectorAll?.('.message-box') || [];
  for (const box of boxes) {
    if (box.classList.contains('mine')) continue;
    if (box.querySelector?.('.celebration')) continue;

    const player = speakerForBox(box);
    if (!player) continue;

    const want = player.ally ? 'my-team' : 'other-team';
    const drop = player.ally ? 'other-team' : 'my-team';
    if (box.classList.contains(want) && !box.classList.contains(drop)) continue;
    box.classList.remove(drop);
    box.classList.add(want);
  }
}

function speakerForBox(box) {
  const nameEl = box.querySelector?.('.chat-message .message-name');
  if (nameEl) {
    const source = nameEl.dataset.blcOriginal ?? nameEl.textContent;
    return resolvePlayer(stripBidi(source || '').trim());
  }

  const span = box.querySelector?.('.system-message span');
  if (!span) return null;

  if (span.dataset?.blcOriginal) {
    const stored = parseLobbyLine(span.dataset.blcOriginal);
    if (stored) return resolvePlayer(stored.name);
  }

  const champEl = span.querySelector?.('.blc-system-name');
  if (champEl) {
    const fromChamp = resolvePlayer(stripBidi(champEl.textContent || '').trim());
    if (fromChamp) return fromChamp;
  }

  const parsed = parseLobbyLine(span.textContent || '');
  if (parsed) return resolvePlayer(parsed.name);
  return null;
}

function resolvePlayer(text) {
  const trimmed = stripBidi(text).trim();
  if (!trimmed) return null;

  const byAlias = matchAlias(trimmed);
  if (byAlias) return byAlias.player;

  const lower = trimmed.toLowerCase();
  let hit = null;
  for (const player of players()) {
    if (!player.championName || player.championName.toLowerCase() !== lower) continue;
    if (hit && hit !== player) return null;
    hit = player;
  }
  return hit;
}

function paintLeaveName(span, original, champ, verb, summonerName) {
  if (!showsChampion() || !champ) {
    if (stripBidi(span.textContent) !== stripBidi(original)) span.textContent = original;
    return;
  }
  const doc = span.ownerDocument;
  const nameEl = span.querySelector(':scope > .blc-system-name');
  if (!showsSummoner()) {
    const tail = span.childNodes[1];
    if (
      nameEl?.textContent === champ &&
      !span.querySelector(':scope > .blc-secondary-name') &&
      span.childNodes.length === 2 &&
      tail?.nodeType === 3 &&
      tail.textContent === ` ${verb}`
    ) {
      return;
    }
    const name = doc.createElement('span');
    name.className = 'blc-system-name';
    name.textContent = champ;
    span.replaceChildren(name, doc.createTextNode(` ${verb}`));
    return;
  }
  const summoner = summonerLabel(summonerName);
  const champNote = `(${champ})`;
  const extra = span.querySelector(':scope > .blc-secondary-name');
  const tail = span.childNodes[2];
  if (
    nameEl?.textContent === summoner &&
    extra?.textContent === champNote &&
    span.childNodes.length === 3 &&
    tail?.nodeType === 3 &&
    tail.textContent === ` ${verb}`
  ) {
    return;
  }
  const name = doc.createElement('span');
  name.className = 'blc-system-name';
  name.textContent = summoner;
  const champEl = doc.createElement('span');
  champEl.className = 'blc-secondary-name';
  champEl.textContent = champNote;
  span.replaceChildren(name, champEl, doc.createTextNode(` ${verb}`));
}

function rewriteLobbyMessages(root) {
  const spans = root.querySelectorAll?.('.system-message span') || [];
  for (const span of spans) {
    if (span.classList.contains('blc-system-name') || span.classList.contains('blc-secondary-name')) {
      continue;
    }
    const box = span.closest('.message-box');
    const text = stripBidi(span.textContent || '').replace(/\s+/g, ' ').trim();
    if (JOIN_TEXT.test(text)) {
      box?.classList.add('blc-hide-join');
      continue;
    }

    let original = span.dataset.blcOriginal;
    let parsed = null;
    if (original != null) {
      parsed = parseLobbyLine(original);
      if (parsed?.kind !== 'leave') continue;
    } else {
      parsed = parseLobbyLine(text);
      if (parsed?.kind !== 'leave') continue;
      if (!matchAlias(parsed.name)) continue;
      original = span.textContent;
      span.dataset.blcOriginal = original;
    }
    box?.classList.remove('blc-hide-join');
    const champ = matchAlias(parsed.name)?.player.championName || '';
    paintLeaveName(span, original, champ, parsed.verb, parsed.name);
  }
}

export function rewriteMessages(root) {
  rewriteNames(root);
  rewriteLobbyMessages(root);
  // Stored Riot IDs (data-blc-original) still match after the visible text
  // becomes a champion name. groupchat rows often ship with fromSummonerId 0,
  // so the client marks allies as other-team.
  fixTeamClasses(root);
}
