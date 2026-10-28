import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sortNotices, unreadCount } from '../src/notice-list.js';

const list = [
  { id: 'a', createdAt: '2026-03-01T09:00:00Z', read: true },
  { id: 'b', createdAt: '2026-03-02T09:00:00Z', read: false },
  { id: 'c', createdAt: '2026-03-02T09:00:00Z', read: false },
  { id: 'd', createdAt: '2026-02-28T23:59:59Z', read: false },
];

test('newest first; ties keep input order', () => {
  assert.deepEqual(sortNotices(list).map((n) => n.id), ['b', 'c', 'a', 'd']);
});

test('sorting does not mutate the input', () => {
  const copy = structuredClone(list);
  sortNotices(list);
  assert.deepEqual(list, copy);
});

test('unread count', () => {
  assert.equal(unreadCount(list), 3);
  assert.equal(unreadCount([]), 0);
});
