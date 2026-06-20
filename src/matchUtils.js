export const statusLabel = (status) => {
  const map = {
    FINISHED: { label: 'FT', cls: 'status-ft' },
    IN_PLAY: { label: 'LIVE', cls: 'status-live' },
    PAUSED: { label: 'HT', cls: 'status-live' },
    TIMED: { label: 'Upcoming', cls: 'status-upcoming' },
    SCHEDULED: { label: 'Scheduled', cls: 'status-upcoming' },
  };
  return map[status] || { label: status, cls: '' };
};

export const formatDate = (dateStr) => {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};
