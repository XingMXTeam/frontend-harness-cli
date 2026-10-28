/**
 * Notice list — the example feature. Pure functions: data in, HTML out,
 * so every state is testable without a browser and capturable with one.
 */

/** Newest first by ISO `createdAt`; ties keep their input order. */
export function sortNotices(list) {
  return list
    .map((n, i) => ({ n, i }))
    .sort((a, b) => (a.n.createdAt < b.n.createdAt ? 1 : a.n.createdAt > b.n.createdAt ? -1 : a.i - b.i))
    .map(({ n }) => n);
}

export function unreadCount(list) {
  return list.filter((n) => !n.read).length;
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

function formatDate(iso, locale) {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(iso));
}

function row(n, locale) {
  const cls = n.read ? 'notice' : 'notice notice--unread';
  return `<li class="${cls}" data-id="${escapeHtml(n.id)}">`
    + `${n.read ? '' : '<span class="notice__dot" aria-hidden="true"></span>'}`
    + `<h3 class="notice__title">${escapeHtml(n.title)}</h3>`
    + `<time class="notice__time" datetime="${escapeHtml(n.createdAt)}">${escapeHtml(formatDate(n.createdAt, locale))}</time>`
    + '</li>';
}

/**
 * view.status: 'loading' | 'error' | 'ready'.
 * A failed load is never shown as an empty list (vision RL-2).
 */
export function renderNoticeList(view, { locale = 'en-US' } = {}) {
  if (view.status === 'loading') {
    return '<section class="notices" aria-busy="true"><p class="notices__loading" role="status">Loading notices…</p></section>';
  }
  if (view.status === 'error') {
    return '<section class="notices"><p class="notices__error" role="alert">Couldn\'t load notices. '
      + '<button type="button" class="notices__action" data-action="retry">Retry</button></p></section>';
  }
  const notices = sortNotices(view.notices ?? []);
  if (notices.length === 0) {
    return '<section class="notices"><p class="notices__empty">No notices yet. '
      + '<button type="button" class="notices__action" data-action="refresh">Refresh</button></p></section>';
  }
  const unread = unreadCount(notices);
  const badge = unread ? `<span class="notices__badge" aria-label="${unread} unread">${unread}</span>` : '';
  return `<section class="notices"><h2 class="notices__heading">Notices ${badge}</h2>`
    + `<ul class="notices__list">${notices.map((n) => row(n, locale)).join('')}</ul></section>`;
}
