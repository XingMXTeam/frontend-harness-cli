export default {
  ready: {
    status: 'ready',
    notices: [
      { id: 'n1', title: 'Your export is ready to download', createdAt: '2026-03-01T09:30:00Z', read: true },
      { id: 'n2', title: 'Budget for "Spring campaign" reached 80%', createdAt: '2026-03-02T08:00:00Z', read: false },
      { id: 'n3', title: 'A teammate invited you to the analytics workspace', createdAt: '2026-03-02T11:15:00Z', read: false },
    ],
  },
  empty: { status: 'ready', notices: [] },
  loading: { status: 'loading' },
  error: { status: 'error' },
};
