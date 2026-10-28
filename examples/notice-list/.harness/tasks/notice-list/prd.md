# PRD — notice-list

## 1. Problem
Users miss time-sensitive notices (budget thresholds, invitations) because
they arrive in an unordered list with no read state.

## 2. Users and scenarios
Any signed-in user checking what changed since their last visit.

## 3. User stories
- As a user I want the newest notice first so that I see what just happened.
- As a user I want unread notices to stand out so that I know what is new.
- As a user I want to know when loading failed so that I can retry instead of assuming there is nothing.

## 4. Requirements
- REQ-1: Notices are listed newest first; unread notices are visually distinct; the unread count is shown.
- REQ-2: Loading, empty and error are distinct states; the error state offers retry and the empty state offers refresh.
- REQ-3: Notice text is displayed as text — markup in a title is never interpreted.

## 5. Non-functional requirements
- Renders 500 notices in one pass without blocking input for more than 50 ms on a mid-range laptop.
- Keyboard: every action is a focusable button.

## 6. What good looks like
- List: one notice per row, newest at the top; unread rows have a bold
  title and a small accent dot; the time is muted and right-aligned;
  12 px vertical rhythm between rows; long titles wrap, never clip.
- Empty: one sentence, "No notices yet.", and a Refresh button.
- Error: one sentence in the danger color and a Retry button; never the
  empty sentence.

## 7. Non-goals
Marking as read, pagination, opening a notice, real-time push.

## 8. Success measures
Unread notices opened within a day rises; no "I never saw it" reports.

## 9. Overview deltas
- Product: a "Notices" capability area (read-only list) now exists.
- Technical: none.
