import { describe, it, expect } from 'vitest';
import { requestGroups, requesterStatus, handoffConfirmation } from './requesterPresentation';
import { stepGuidance } from '@/data/guidance';
import type { RequesterTicket, TicketStatus } from '@/types';
const ticket = (status: TicketStatus, id = status): RequesterTicket => ({ id, reference: id, subject: id, status, categoryLabel: 'Test', createdAt: '2026-01-01T00:00:00Z' });
describe('requester action presentation', () => {
  it('groups every status by who acts next', () => {
    const groups = requestGroups(['new','assigned','waiting','needs_review','resolved'].map(s => ticket(s as TicketStatus)));
    expect(groups[0]!.tickets.map(t => t.status)).toEqual(['waiting']);
    expect(groups[1]!.tickets.map(t => t.status).sort()).toEqual(['assigned','needs_review','new']);
    expect(groups[2]!.tickets.map(t => t.status)).toEqual(['resolved']);
    expect(requesterStatus.needs_review).toBe('IT is reviewing your reply');
  });
  it('sorts public activity within groups without mutating the original list', () => {
    const old = ticket('waiting'), recent = { ...ticket('waiting', 'new' as TicketStatus), lastActivityAt: '2026-02-01T00:00:00Z' };
    const input = [old, recent]; expect(requestGroups(input)[0]!.tickets[0]).toBe(recent); expect(input[0]).toBe(old);
  });
  it('describes attempted, skipped, and early handoffs truthfully', () => {
    expect(handoffConfirmation({ attempts: [{ stepId: '1', title: 'One', outcome: 'failed' }, { stepId: '2', title: 'Two', outcome: 'failed' }], facts: [] })).toContain('steps');
    const skipped = handoffConfirmation({ attempts: [], facts: [{ label: 'Impact', value: 'Blocked' }] });
    expect(skipped).toContain('answers'); expect(skipped).not.toMatch(/tried|turning/);
    expect(handoffConfirmation({ attempts: [], facts: [] })).toContain('issue details');
  });
});
describe('platform guidance', () => {
  it.each([['Windows','Time & language'],['macOS','System Settings'],['iOS','Set Automatically'],['Android','System → Date & time']])('shows only %s clock guidance', (os, path) => {
    const text = stepGuidance('mfa', { id: '1', title: 'Clock', detail: '', position: 1 }, os);
    expect(text).toContain(path);
    if (os !== 'Windows') expect(text).not.toContain('Time & language');
    if (os !== 'macOS') expect(text).not.toContain('System Settings');
  });
  it('preserves unknown authored steps and directs error wording to the IT note', () => {
    const step = { id: '1', title: 'Custom', detail: 'Organization-specific instructions.', position: 3 };
    expect(stepGuidance('custom', step, 'macOS')).toBe(step.detail);
    expect(stepGuidance('install', step, 'macOS')).toContain('Additional note for IT');
  });
});
