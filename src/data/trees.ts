/**
 * Seed trees.
 *
 * After seeding, these are database rows and this file is no longer read
 * by the running app — admins edit trees through the editor instead.
 * It stays as version-controlled starting content, and as the fixture the
 * in-memory adapter runs on.
 *
 * Option target: "node:<key>" continues the tree, "dx:<key>" ends it.
 * There is no third option, which is why a tree cannot dead-end.
 */

export type OptionSeed = [label: string, factValue: string, target: string];
export type NodeSeed = [question: string, factLabel: string, shortLabel: string, options: OptionSeed[]];

export interface TreeSeed {
  rootLabel: string;
  root: string;
  nodes: Record<string, NodeSeed>;
}

export const TREES: Record<string, TreeSeed> = {
  wifi: {
    rootLabel: "Wi-Fi issue",
    root: "connected",
    nodes: {
      connected: ["Does your device show as connected to the network?", "Connection", "Connected?", [
        ["Yes", "Connected", "node:others"],
        ["No", "Not connected", "dx:no_join"],
        ["Not sure", "Unclear", "node:others"],
      ]],
      others: ["Can other devices connect to this same network?", "Other devices", "Other devices work?", [
        ["Yes", "Working", "node:scope"],
        ["No", "Also failing", "dx:upstream"],
        ["Not sure", "Unknown", "node:scope"],
      ]],
      scope: ["Is every website failing, or only certain ones?", "Browser", "All websites affected?", [
        ["All of them", "All sites affected", "node:changes"],
        ["Only some", "One site affected", "dx:site"],
        ["Not sure", "Unclear", "node:changes"],
      ]],
      changes: ["Has anything changed recently — a VPN, new security software, or network settings?", "Recent changes", "Recent changes?", [
        ["VPN or security tool", "VPN / filtering active", "dx:vpn"],
        ["Nothing changed", "None reported", "dx:dns"],
        ["Not sure", "None reported", "dx:dns"],
      ]],
    },
  },

  login: {
    rootLabel: "Login issue",
    root: "symptom",
    nodes: {
      symptom: ["What happens when you try to sign in?", "Sign-in result", "What fails?", [
        ["My password is rejected", "Credentials rejected", "node:changed"],
        ["The verification code won't work", "MFA step fails", "dx:mfa"],
        ["It says the account is locked", "Account locked", "dx:locked"],
      ]],
      changed: ["Have you changed your password in the last few days?", "Password change", "Recent password change?", [
        ["Yes", "Changed recently", "dx:stale"],
        ["No", "No change", "dx:reset"],
        ["Not sure", "Unknown", "dx:reset"],
      ]],
    },
  },

  software: {
    rootLabel: "Software issue",
    root: "when",
    nodes: {
      when: ["When does the problem happen?", "Failure point", "When does it fail?", [
        ["While installing", "During install", "node:perms"],
        ["When launching", "On launch", "node:worked"],
        ["While using it", "During use", "dx:crash"],
      ]],
      perms: ["Did it ask for an administrator password, or show a permissions error?", "Permissions", "Permission prompt?", [
        ["Yes", "Blocked by permissions", "dx:perm"],
        ["No", "No prompt", "dx:install"],
        ["Not sure", "Unknown", "dx:install"],
      ]],
      worked: ["Did this app work before?", "Previously working", "Worked before?", [
        ["Yes", "Yes — recent regression", "dx:regression"],
        ["No, never", "Never worked here", "dx:install"],
        ["Not sure", "Unknown", "dx:install"],
      ]],
    },
  },

  hardware: {
    rootLabel: "Hardware issue",
    root: "power",
    nodes: {
      power: ["Does the device power on and reach the desktop?", "Power", "Powers on?", [
        ["Yes", "Boots normally", "node:symptom"],
        ["No", "Does not boot", "dx:noboot"],
        ["It starts, then stops", "Boot loop", "dx:noboot"],
      ]],
      symptom: ["What's the main symptom?", "Symptom", "Main symptom?", [
        ["Very slow or freezing", "Performance", "dx:perf"],
        ["Display problem", "Display", "dx:display"],
        ["An accessory isn't detected", "Peripheral", "dx:peripheral"],
      ]],
    },
  },

  printing: {
    rootLabel: "Printing issue",
    root: "listed",
    nodes: {
      listed: ["Does the printer appear in your list of printers?", "Printer visible", "Printer listed?", [
        ["Yes", "Listed", "node:queue"],
        ["No", "Not listed", "dx:missing"],
        ["Not sure", "Unknown", "dx:missing"],
      ]],
      queue: ["Do jobs sit in the queue without printing?", "Queue", "Jobs stuck?", [
        ["Yes, they pile up", "Jobs stuck", "dx:stuck"],
        ["No, they vanish", "Jobs disappear", "dx:driver"],
        ["Not sure", "Unknown", "dx:stuck"],
      ]],
    },
  },

  other: {
    rootLabel: "Reported issue",
    root: "blocking",
    nodes: {
      blocking: ["Is this stopping you from working right now?", "Impact", "Blocking work?", [
        ["Yes", "Blocking", "node:scope"],
        ["No, it's an annoyance", "Not blocking", "node:scope"],
      ]],
      scope: ["Is anyone else affected?", "Scope", "Who's affected?", [
        ["Just me", "Single user", "dx:general"],
        ["Others too", "Multiple users", "dx:widespread"],
        ["Not sure", "Unknown", "dx:general"],
      ]],
    },
  },
};
