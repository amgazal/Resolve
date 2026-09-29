import type { Step } from '@/types';
import { DIAGNOSES } from './diagnoses';
// Built-in diagnosis keys + ordered step positions are stable catalog identities.
// This presentation overlay does not rewrite historical database wording or attempts.
// Unknown authored diagnoses keep their stored instructions.
const clockPaths: Record<string, string> = {
  Windows: 'Settings → Time & language → Date & time. Turn on Set time automatically.',
  macOS: 'System Settings → General → Date & Time. Turn on Set time and date automatically.',
  iOS: 'Settings → General → Date & Time. Turn on Set Automatically.',
  Android: 'Settings → System → Date & time. Turn on automatic time. Wording may vary by manufacturer; search Settings for date and time if needed.',
  Linux: 'Open your system Settings and search for Date & Time. Turn on Automatic Date & Time if available; wording varies by desktop.',
};
export function stepGuidance(key: string, step: Step, os: string | null) {
  if (key === 'mfa' && step.position === 1) return `${clockPaths[os ?? ''] ?? 'Open the device’s Settings and search for Date & Time. Choose automatic date and time if available.'} Then return to the sign-in prompt and try the next code. If the setting is managed or unavailable, ask IT. If your authenticator is on another device, check that device’s clock too.`;
  return DIAGNOSES[key]?.steps[step.position - 1]?.[1] ?? step.detail;
}
export const authenticationDiagnoses = new Set(['mfa','locked','stale','reset']);

export function stepTitle(key: string, step: Step) { return DIAGNOSES[key]?.steps[step.position - 1]?.[0] ?? step.title; }
