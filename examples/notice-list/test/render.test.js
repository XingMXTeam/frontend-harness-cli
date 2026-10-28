import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderNoticeList } from '../src/notice-list.js';
import fixtures from '../fixtures.js';

test('ready: newest first, unread rows marked, badge shows the unread count', () => {
  const html = renderNoticeList(fixtures.ready);
  const ids = [...html.matchAll(/data-id="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids, ['n3', 'n2', 'n1']);
  assert.equal((html.match(/notice--unread/g) ?? []).length, 2);
  assert.match(html, /aria-label="2 unread">2</);
});

test('empty, loading and error are three different screens', () => {
  const empty = renderNoticeList(fixtures.empty);
  const loading = renderNoticeList(fixtures.loading);
  const error = renderNoticeList(fixtures.error);
  assert.match(empty, /No notices yet/);
  assert.match(empty, /data-action="refresh"/);
  assert.match(loading, /aria-busy="true"/);
  assert.match(loading, /role="status"/);
  assert.match(error, /role="alert"/);
  assert.match(error, /data-action="retry"/);
});

test('a failed load never renders as an empty list (RL-2)', () => {
  const error = renderNoticeList({ status: 'error', notices: [] });
  assert.doesNotMatch(error, /No notices yet/);
});

test('notice text is escaped (RL-1)', () => {
  const html = renderNoticeList({ status: 'ready', notices: [{ id: 'x', title: '<img src=x onerror=alert(1)>', createdAt: '2026-01-01T00:00:00Z', read: false }] });
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('actions are real buttons that do not submit forms', () => {
  for (const state of ['empty', 'error']) {
    assert.match(renderNoticeList(fixtures[state]), /<button type="button"/);
  }
});
