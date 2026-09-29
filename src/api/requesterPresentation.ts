import type { RequesterTicket, SessionState, TicketStatus } from '@/types';
export const requesterStatus: Record<TicketStatus, string> = {
  new: 'Sent to IT', assigned: 'With IT', waiting: 'Needs your reply', needs_review: 'IT is reviewing your reply', resolved: 'Resolved',
};
export function requestGroups(tickets: RequesterTicket[]) {
  const ordered = [...tickets].sort((a,b) => Date.parse(b.lastActivityAt ?? b.createdAt) - Date.parse(a.lastActivityAt ?? a.createdAt) || a.id.localeCompare(b.id));
  return [
    { id: 'reply', title: 'Needs your reply', hint: 'IT is waiting for your response.', tickets: ordered.filter(t => t.status === 'waiting') },
    { id: 'with-it', title: 'With IT', hint: 'Your request is with the team. No reply needed right now.', tickets: ordered.filter(t => ['new','assigned','needs_review'].includes(t.status)) },
    { id: 'resolved', title: 'Resolved', hint: 'Completed requests, here for reference.', tickets: ordered.filter(t => t.status === 'resolved') },
  ];
}
export function handoffConfirmation(session: Pick<SessionState, 'attempts' | 'facts'>) {
  if (session.attempts.length) return "IT will receive what Resolve learned and the steps you've already tried, so you shouldn't need to repeat yourself.";
  if (session.facts.length) return 'IT will receive your answers and issue details so they can pick up from here.';
  return 'IT will receive your issue details so they can help you from here.';
}
