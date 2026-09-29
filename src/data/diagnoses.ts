import type { Priority } from "@/types";

export interface DiagnosisSeed {
  title: string;
  short: string;
  node: string;
  priority: Priority;
  steps: [string, string][];
}

/**
 * Written in the second person, plainly, because a person reads these
 * while something is broken and they are already annoyed.
 */
export const DIAGNOSES: Record<string, DiagnosisSeed> = {
  dns: {
    title: "This looks like a DNS or local network configuration issue.",
    short: "Likely DNS", node: "DNS / local config", priority: "medium",
    steps: [
      ["Reconnect to the network", "Open the Wi-Fi menu in your device’s settings. Turn Wi-Fi off for five seconds, then reconnect to the same network. Try the website again."],
      ["Renew your network configuration", "Open your network settings and disconnect, then reconnect the current connection. If you see Renew DHCP Lease in its details, use it. Try the website again; if the setting is unavailable, you can skip to IT."],
      ["Test another browser", "Open a different browser and load two unrelated sites. If they load there, add that result to Additional note for IT; this separates a browser problem from a network one."],
    ],
  },
  vpn: {
    title: "A VPN or security tool is most likely intercepting your traffic.",
    short: "VPN conflict", node: "VPN / filtering", priority: "medium",
    steps: [
      ["Disconnect the VPN", "Open your VPN app and choose Disconnect, if your organization permits it. Try a public website once, then reconnect the VPN. Add the result to the note for IT if the problem continues."],
      ["Check for a filtering message", "Look for a blocked-page message in your browser or security app. Keep protection enabled. Copy the tool’s name and the error into Additional note for IT on the review screen."],
      ["Reload two different sites", "In your browser, open two unrelated public websites. If either still fails, add which sites worked to Additional note for IT; this helps the team narrow down the connection problem."],
    ],
  },
  upstream: {
    title: "The fault looks upstream — the router or the line itself, not your device.",
    short: "Router / ISP", node: "Upstream fault", priority: "high",
    steps: [
      ["Power cycle the router", "Only for a router you manage at home: unplug its power for thirty seconds, reconnect it, and wait two minutes. Try the connection again. For shared office equipment, skip this step and ask IT."],
      ["Check the provider's status page", "Using mobile data or another working connection, open your provider’s official service-status page. If an outage is listed, add its time and area to Additional note for IT."],
      ["Reconnect and test", "Open Wi-Fi settings on two available devices, connect to the same network, and try the same website. Add which device worked to Additional note for IT if the issue continues."],
    ],
  },
  no_join: {
    title: "Your device isn't successfully joining the network.",
    short: "Join failure", node: "Association failure", priority: "medium",
    steps: [
      ["Toggle Wi-Fi off and on", "Open Settings and find Wi-Fi. Turn it off for five seconds, then turn it on and select your usual network. Check whether it connects."],
      ["Forget the network, then rejoin", "If you know the network password, open Wi-Fi settings, select the network’s details and choose Forget, then reconnect. Otherwise skip this step. Do not put the password in Resolve."],
      ["Move closer to the access point", "Stand within sight of the router and try once more to rule out signal strength."],
    ],
  },
  site: {
    title: "This looks specific to one site, not to your connection.",
    short: "Site-specific", node: "Single site", priority: "low",
    steps: [
      ["Check whether the site is down for everyone", "On your phone, turn off Wi-Fi briefly and open the same site using mobile data. Turn Wi-Fi back on afterward. If the site still fails, add that result to Additional note for IT."],
      ["Clear cached data for that site", "In your browser’s settings, search for site data, select only the affected site, and remove its stored data. This may sign you out of that site. Reopen it and try again."],
      ["Open it in a private window", "From your browser’s main menu, open a private or incognito window and visit the affected site. If it works there, add that result to Additional note for IT."],
    ],
  },
  mfa: {
    title: "Your verification step is failing, not your password.",
    short: "MFA issue", node: "MFA failure", priority: "high",
    steps: [
      ["Check your device clock", "Set date and time to update automatically. Codes fail when the clock drifts by more than a minute."],
      ["Request a fresh code", "At the service’s sign-in prompt, choose Resend code once if that option is offered. For an authenticator app, wait for the next code instead. Use only the newest code in the service’s verification field; do not repeatedly request codes."],
      ["Try a backup method", "At the sign-in prompt, look for Try another way. If already registered, choose another verification method or device, or use a saved recovery code there. If you have none, skip to IT. Never put passwords, verification codes, or recovery codes into Resolve."],
    ],
  },
  locked: {
    title: "The account is locked and needs an administrator to release it.",
    short: "Account lockout", node: "Lockout", priority: "high",
    steps: [
      ["Wait fifteen minutes", "Close the sign-in prompt and wait fifteen minutes without retrying. Then open it again. Some organizations require IT to unlock the account; waiting may not be enough."],
      ["Try once, carefully", "Return to the service’s sign-in page and try once after the wait. If it still says locked, paste that error into Additional note for IT. Never include your password or verification code."],
    ],
  },
  stale: {
    title: "An old password is still cached somewhere on your device.",
    short: "Stale credentials", node: "Cached credentials", priority: "medium",
    steps: [
      ["Sign out of the app completely", "Use the app’s account/profile menu to Sign out, then quit and reopen the app. Check whether it now asks you to sign in again."],
      ["Check the password being filled in", "If the browser fills an old password, clear the sign-in field and enter your current password directly in the service. Do not delete company-managed credentials; ask IT if the app keeps using an old one."],
      ["Sign back in with the new password", "At the service’s sign-in page, use your updated password or your trusted password manager. Check that you can reach the app. Never include the password or a verification code in Resolve."],
    ],
  },
  reset: {
    title: "This looks like a password or directory sync problem.",
    short: "Password failure", node: "Credential failure", priority: "medium",
    steps: [
      ["Reset from the self-service portal", "On your organization’s usual sign-in page, select Forgot password or the approved reset link. Follow the prompts there, then try signing in once. If you cannot reset it, tell IT which prompt stopped you, without sharing any codes."],
      ["Confirm on a second device", "If you have another trusted device, open the same service there and try the new password once. If the result differs, add that result to Additional note for IT; do not share the password."],
      ["Retry on the original device", "Reopen the sign-in page on the original device and try once. If only this device fails, tell IT in the additional note. Never paste passwords or verification codes into Resolve."],
    ],
  },
  install: {
    title: "The installer isn't completing successfully.",
    short: "Install failure", node: "Install failure", priority: "low",
    steps: [
      ["Restart, then install once", "Save your work, restart the device from its power menu, and open the approved installer once. Check whether installation completes; keep any error text for the note for IT."],
      ["Check available disk space", "Open device Settings and search for Storage. Check the available space against the installer’s requirement. If space is low, tell IT in the additional note rather than deleting files you do not recognize."],
      ["Note the exact error text", "Copy the exact error message. If the problem continues, paste it into Additional note for IT on the review screen before you send the request. An optional screenshot can help too."],
    ],
  },
  perm: {
    title: "Permissions are blocking the install.",
    short: "Permissions blocked", node: "Permission block", priority: "medium",
    steps: [
      ["Confirm the prompt you saw", "Read the installer’s prompt: does it ask for administrator approval or say access denied? Put that wording in Additional note for IT. Do not include a password or try to bypass approval."],
      ["Check the managed software portal", "Open your organization’s managed software app or portal, if you have one, and search for the app. Choose its approved Install action. If it is not listed, skip to IT rather than downloading an alternative."],
    ],
  },
  crash: {
    title: "The app is failing during use rather than at startup.",
    short: "Runtime crash", node: "Runtime crash", priority: "medium",
    steps: [
      ["Note what you were doing", "Recall the last action before the app closed, such as opening a file or selecting Print. Add the app name and action to Additional note for IT if it keeps happening."],
      ["Restart the app and repeat that action", "Reopen the app and try that action once with non-sensitive test content. If it closes again, record the error in Additional note for IT. Do not repeat an action that could lose work."],
      ["Install pending updates", "Check the app’s Help or Settings menu for Check for updates, and your device Settings for Software Update. Save work before installing approved updates, then retry the app. If updates are managed, ask IT."],
    ],
  },
  regression: {
    title: "It worked before, so something changed recently.",
    short: "Update regression", node: "Recent regression", priority: "medium",
    steps: [
      ["Check recent updates", "In the app’s About screen, note its version. In device Settings, look for update history. Add any recent change and its date to Additional note for IT; do not uninstall managed updates."],
      ["Restart the device", "Save your work and use Restart in the device’s power menu. After signing back in, reopen the affected app and check whether it works."],
      ["Launch once more", "Open the app once more. If it still fails, add any update names/dates you found and the current error to Additional note for IT; Resolve does not collect update history automatically."],
    ],
  },
  noboot: {
    title: "The device isn't starting properly — this needs hands-on attention.",
    short: "Boot failure", node: "Boot failure", priority: "high",
    steps: [
      ["Hold the power button for ten seconds", "If the device is frozen and not installing updates, hold its power button for ten seconds, release it, wait, then press once. Unsaved work may be lost. Check whether the startup screen appears."],
      ["Connect a known-good charger", "Connect a compatible, known-working charger to the device and a working socket. Wait fifteen minutes, then press power once. If no light or screen appears, tell IT in the note."],
    ],
  },
  perf: {
    title: "The device is running out of headroom.",
    short: "Performance", node: "Resource pressure", priority: "low",
    steps: [
      ["Restart the device", "Save your work and select Restart from the device’s power menu. Reopen only the app you need and check whether it responds normally."],
      ["Close what you aren't using", "Save your work, close unused browser tabs, and quit apps through their menus. Return to the slow app and try the action again."],
      ["Check free disk space", "Open device Settings and search for Storage. If available space is low, add the amount to Additional note for IT. Avoid deleting unfamiliar or company-managed files."],
    ],
  },
  display: {
    title: "This points to the display path — cable, port, or driver.",
    short: "Display fault", node: "Display path", priority: "medium",
    steps: [
      ["Reseat the cable at both ends", "Check the external display cable at the computer and monitor. Unplug and reconnect both ends, then choose the matching input on the monitor. Check whether the picture returns."],
      ["Try a different port or cable", "If available, connect the external monitor using a compatible spare cable or another display port. Check whether the picture returns; add the result to Additional note for IT."],
    ],
  },
  peripheral: {
    title: "An accessory isn't being detected.",
    short: "Peripheral", node: "Device not detected", priority: "low",
    steps: [
      ["Try a different port", "Safely eject storage devices first. Connect the accessory to another compatible port on the computer instead of a hub. Check whether it appears or works."],
      ["Test the accessory elsewhere", "If permitted, connect the accessory to another work device. Check whether it is detected there and add that result to Additional note for IT."],
    ],
  },
  missing: {
    title: "The printer isn't mapped to this device.",
    short: "Printer not mapped", node: "Not mapped", priority: "low",
    steps: [
      ["Confirm you're on the office network", "Open Wi-Fi/network settings and check the network name against your office’s approved network. Printer access may depend on your organization’s VPN setup; add your connection type to the note if you are unsure."],
      ["Add the printer again", "Open device Settings and search for Printers. Choose Add printer and select the intended office printer by name. If it is missing or asks for administrator approval, tell IT instead of choosing an unknown printer."],
    ],
  },
  stuck: {
    title: "The print queue is stalled.",
    short: "Stuck queue", node: "Queue stalled", priority: "medium",
    steps: [
      ["Clear your stuck print jobs", "Open Settings, search for Printers, select the affected printer and open its queue. Cancel only your own stuck jobs. If you cannot remove them, ask IT. Check whether the queue clears."],
      ["Restart the printer", "If you are allowed to manage this printer, use its power button to turn it off, wait thirty seconds, then turn it on. For a shared printer, check with IT first. Wait for Ready before trying again."],
      ["Send one short test page", "Use Print in a simple non-sensitive document and select just one page on the affected printer. Check whether it prints or remains in the queue; add the result to the note for IT."],
    ],
  },
  driver: {
    title: "Jobs are being accepted and then dropped — usually a driver problem.",
    short: "Driver issue", node: "Driver fault", priority: "medium",
    steps: [
      ["Remove and re-add the printer", "In Settings, search for Printers and note the affected printer’s name. Only if your organization allows it, remove that printer and add the same one again. If approval is required, skip to IT."],
      ["Print a test page", "In Settings, search for Printers, select the affected printer, and look for Print test page. If unavailable, print one non-sensitive page from a document. Add whether it prints or disappears from the queue to Additional note for IT."],
    ],
  },
  general: {
    title: "We've captured enough detail — this one needs a person to look at it.",
    short: "Needs triage", node: "Manual triage", priority: "medium",
    steps: [
      ["Restart the device", "Save your work, choose Restart from the device’s power menu, and try the action that caused the problem once more. If it still happens, IT can take it from here."],
      ["Repeat the action and note the wording", "Try the action once more if it is safe and will not lose work. Copy any error wording into Additional note for IT on the review screen, or add an optional screenshot. Do not include private credentials."],
    ],
  },
  widespread: {
    title: "Several people are affected, so this is likely service-side.",
    short: "Possible outage", node: "Service-side", priority: "high",
    steps: [
      ["Check the service status page", "Using another working connection if needed, open the service’s official status page. Add any reported incident and its time to Additional note for IT. If you do not know the page, skip to IT."],
      ["Confirm with a colleague", "Ask one colleague whether the same service is failing and when it started. Add how many people seem affected and the start time to Additional note for IT; personal details are not needed."],
    ],
  },
};
