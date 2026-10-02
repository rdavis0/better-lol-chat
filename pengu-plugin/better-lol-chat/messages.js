import { settings, showsSummoner, showsChampion } from './settings.js';
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

function iconPart(player) {
  return settings.showChatIcons && player?.iconPath ? { icon: player.iconPath } : null;
}

function partsMatch(el, parts) {
  const nodes = [...el.childNodes];
  if (nodes.length !== parts.length) return false;
  for (let i = 0; i < parts.length; i++) {
    const node = nodes[i];
    const part = parts[i];
    if (part.icon) {
      if (node.nodeType !== 1 || !node.classList.contains('blc-champ-icon')) return false;
      if (node.dataset.blcSrc !== part.icon) return false;
      continue;
    }
    if (part.parts) {
      if (node.nodeType !== 1 || !node.classList.contains(part.className)) return false;
      if (!partsMatch(node, part.parts)) return false;
      continue;
    }
    if (part.className) {
      if (node.nodeType !== 1 || !node.classList.contains(part.className)) return false;
      if (node.textContent !== part.text) return false;
      continue;
    }
    if (node.nodeType !== 3 || node.textContent !== part.text) return false;
  }
  return true;
}

function renderParts(doc, parts) {
  return parts.map((part) => {
    if (part.icon) {
      const img = doc.createElement('img');
      img.className = 'blc-champ-icon';
      img.alt = '';
      img.draggable = false;
      img.dataset.blcSrc = part.icon;
      img.src = part.icon;
      return img;
    }
    if (part.parts) {
      const span = doc.createElement('span');
      span.className = part.className;
      span.replaceChildren(...renderParts(doc, part.parts));
      return span;
    }
    if (part.className) {
      const span = doc.createElement('span');
      span.className = part.className;
      span.textContent = part.text;
      return span;
    }
    return doc.createTextNode(part.text);
  });
}

function paintParts(el, parts) {
  if (partsMatch(el, parts)) return;
  el.replaceChildren(...renderParts(el.ownerDocument, parts));
}

function textPart(text, className) {
  return className ? { className, text } : { text };
}

function nameParts(text, player, nameClass) {
  if (!showsChampion() || !player?.championName) return [textPart(text)];
  if (!showsSummoner()) return [textPart(player.championName, nameClass)];
  return [
    textPart(summonerLabel(text), nameClass),
    textPart(`(${player.championName})`, 'blc-secondary-name'),
  ];
}

function withIcon(icon, parts, wrapClass) {
  if (!icon) return parts;
  if (!wrapClass) return [icon, ...parts];
  return [{ className: wrapClass, parts: [icon, ...parts] }];
}

function paintChatName(el, original, player) {
  paintParts(el, withIcon(iconPart(player), nameParts(original, player)));
}

function rewriteNames(root) {
  const nameNodes = root.querySelectorAll?.('.message-box .message-name') || [];
  for (const el of nameNodes) {
    if (el.closest?.('.blc-injected')) continue;
    if (el.closest?.('.system-message')) continue;
    let original = el.dataset.blcOriginal;
    let player = null;
    if (original != null) {
      player = resolvePlayer(stripBidi(original).trim());
    } else if (aliases().length) {
      const match = matchAlias(stripBidi(el.textContent || '').trim());
      if (!match) continue;
      original = el.textContent;
      el.dataset.blcOriginal = original;
      player = match.player;
    } else {
      continue;
    }
    paintChatName(el, original, player);
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
    if (box.classList.contains('blc-injected')) continue;
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

function paintLeaveName(span, original, player, verb, summonerName) {
  const split = Boolean(showsChampion() && player?.championName);
  const parts = withIcon(
    iconPart(player),
    nameParts(split ? summonerName : original, player, 'blc-system-name'),
    split ? 'blc-leave-label' : '',
  );
  if (split) parts.push({ text: ` ${verb}` });
  paintParts(span, parts);
}

function rewriteLobbyMessages(root) {
  const spans = root.querySelectorAll?.('.system-message span') || [];
  for (const span of spans) {
    if (
      span.classList.contains('blc-system-name') ||
      span.classList.contains('blc-secondary-name') ||
      span.classList.contains('blc-leave-label')
    ) {
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
      if (!resolvePlayer(parsed.name)) continue;
      original = span.textContent;
      span.dataset.blcOriginal = original;
    }
    box?.classList.remove('blc-hide-join');
    paintLeaveName(span, original, resolvePlayer(parsed.name), parsed.verb, parsed.name);
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
