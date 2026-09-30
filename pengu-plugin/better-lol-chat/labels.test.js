import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  buildMessageLog,
  championLabel,
  formatClock,
  formatStamp,
  takeChatStamp,
  takeLeaveStamp,
} from './labels.js';

test('formatClock uses a 12-hour clock', () => {
  assert.equal(formatClock(new Date(2026, 8, 23, 0, 5)), '12:05 AM');
  assert.equal(formatClock(new Date(2026, 8, 23, 12, 0)), '12:00 PM');
  assert.equal(formatClock(new Date(2026, 8, 23, 15, 7)), '3:07 PM');
  assert.equal(formatClock(new Date('nope')), '');
  assert.equal(formatStamp(''), '');
  assert.equal(formatStamp('not-a-date'), '');
});

test('championLabel leaves a unique champion alone', () => {
  const roster = [
    { championName: 'Jhin', gameName: 'Chaotic Fiasco', tagLine: 'NA1' },
    { championName: 'Lux', gameName: 'poongman', tagLine: 'NA1' },
  ];
  assert.equal(championLabel(roster[0], roster), 'Jhin');
});

test('championLabel splits a ditto on game name, then tag', () => {
  const roster = [
    { championName: 'Jinx', gameName: 'Alpha', tagLine: 'NA1' },
    { championName: 'Jinx', gameName: 'Beta', tagLine: 'NA1' },
    { championName: 'Lux', gameName: 'Alpha', tagLine: 'NA1' },
    { championName: 'Lux', gameName: 'Alpha', tagLine: 'EUW' },
  ];
  assert.equal(championLabel(roster[0], roster), 'Jinx · Alpha');
  assert.equal(championLabel(roster[1], roster), 'Jinx · Beta');
  assert.equal(championLabel(roster[2], roster), 'Lux · Alpha#NA1');
  assert.equal(championLabel(roster[3], roster), 'Lux · Alpha#EUW');
  assert.equal(championLabel({ championName: '' }, roster), '');
});

test('chat stamps follow body and puuid in order', () => {
  const log = buildMessageLog([
    { type: 'system', body: 'joined_room', timestamp: '2026-09-23T07:12:16.998Z', fromPuuid: 'a' },
    { type: 'groupchat', body: 'gg', timestamp: '2026-09-23T07:14:00.000Z', fromPuuid: 'a' },
    { type: 'groupchat', body: 'gg', timestamp: '2026-09-23T07:14:30.000Z', fromPuuid: 'b' },
    { type: 'groupchat', body: 'gg', timestamp: '2026-09-23T07:15:00.000Z', fromPuuid: 'a' },
    { type: 'system', body: 'left_room', timestamp: '2026-09-23T07:16:00.000Z', fromPuuid: 'b', fromSummonerId: 9 },
    { type: 'celebration', body: 'honor', timestamp: '2026-09-23T07:16:30.000Z' },
  ]);
  assert.equal(log.filter((entry) => entry.kind === 'chat').length, 3);
  assert.equal(log.filter((entry) => entry.kind === 'leave').length, 1);

  const used = new Set();
  const first = takeChatStamp(log, used, 'gg', 'b');
  const second = takeChatStamp(log, used, 'gg', 'a');
  const third = takeChatStamp(log, used, 'gg', 'a');
  assert.equal(first, formatStamp('2026-09-23T07:14:30.000Z'));
  assert.equal(second, formatStamp('2026-09-23T07:14:00.000Z'));
  assert.equal(third, formatStamp('2026-09-23T07:15:00.000Z'));
  assert.equal(takeChatStamp(log, used, 'gg', 'a'), '');
  const leftAt = formatStamp('2026-09-23T07:16:00.000Z');
  assert.equal(takeLeaveStamp(log, new Set(), { puuid: '', summonerId: 9 }), leftAt);
  assert.equal(takeLeaveStamp(log, used, { puuid: 'b', summonerId: 0 }), leftAt);
  assert.equal(takeLeaveStamp(log, used, { puuid: '', summonerId: 9 }), '');
  assert.equal(takeLeaveStamp(log, new Set(), { puuid: 'missing', summonerId: 0 }), '');
});

test('fixture groupchat lines become a timestamp log', () => {
  const payload = JSON.parse(
    readFileSync(new URL('../../docs/fixtures/postgame-messages.json', import.meta.url)),
  );
  const log = buildMessageLog(payload.messages);
  const chats = log.filter((entry) => entry.kind === 'chat');
  const leaves = log.filter((entry) => entry.kind === 'leave');
  assert.ok(chats.length > 0);
  assert.ok(leaves.length > 0);
  assert.ok(chats.some((entry) => entry.body === 'gg tho was fun' && entry.time));
  assert.ok(chats.every((entry) => entry.puuid && entry.time));
});
