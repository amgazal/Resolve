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
      ["Reconnect to the network", "Turn Wi-Fi off, wait five seconds, then turn it back on and rejoin the same network."],
      ["Renew your network configuration", "In network settings, renew the DHCP lease. This asks the router for fresh address and DNS details."],
      ["Test another browser", "Open a different browser and load two unrelated sites. This separates a browser problem from a network one."],
    ],
  },
  vpn: {
    title: "A VPN or security tool is most likely intercepting your traffic.",
    short: "VPN conflict", node: "VPN / filtering", priority: "medium",
    steps: [
      ["Disconnect the VPN", "Quit the VPN client entirely rather than just disconnecting, then reload a page."],
      ["Pause web filtering", "Temporarily pause any security or content-filtering tool installed recently."],
      ["Reload two different sites", "If both load now, the tool is the cause and needs a configuration change."],
    ],
  },
  upstream: {
    title: "The fault looks upstream — the router or the line itself, not your device.",
    short: "Router / ISP", node: "Upstream fault", priority: "high",
    steps: [
      ["Power cycle the router", "Unplug it at the wall for thirty seconds, plug it back in, and wait two minutes for the lights to settle."],
      ["Check the provider's status page", "Look for a reported outage in your area before troubleshooting further."],
      ["Reconnect and test", "Rejoin the network and load a site on two devices."],
    ],
  },
  no_join: {
    title: "Your device isn't successfully joining the network.",
    short: "Join failure", node: "Association failure", priority: "medium",
    steps: [
      ["Toggle Wi-Fi off and on", "A clean radio restart clears most temporary association failures."],
      ["Forget the network, then rejoin", "Remove the saved network and enter the password again from scratch."],
      ["Move closer to the access point", "Stand within sight of the router and try once more to rule out signal strength."],
    ],
  },
  site: {
    title: "This looks specific to one site, not to your connection.",
    short: "Site-specific", node: "Single site", priority: "low",
    steps: [
      ["Check whether the site is down for everyone", "Load it on your phone using mobile data instead of Wi-Fi."],
      ["Clear cached data for that site", "Old cached files are the usual cause when one site misbehaves."],
      ["Open it in a private window", "This bypasses extensions and cached sessions."],
    ],
  },
  mfa: {
    title: "Your verification step is failing, not your password.",
    short: "MFA issue", node: "MFA failure", priority: "high",
    steps: [
      ["Check your device clock", "Set date and time to update automatically. Codes fail when the clock drifts by more than a minute."],
      ["Request a fresh code", "Let the current code expire, generate a new one, and enter it immediately."],
      ["Try a backup method", "Use a backup code or a second registered device if you have one."],
    ],
  },
  locked: {
    title: "The account is locked and needs an administrator to release it.",
    short: "Account lockout", node: "Lockout", priority: "high",
    steps: [
      ["Wait fifteen minutes", "Many lockouts release automatically. Don't attempt sign-in during this window — retries extend the lock."],
      ["Try once, carefully", "One deliberate attempt after the wait. If it fails, this needs an administrator."],
    ],
  },
  stale: {
    title: "An old password is still cached somewhere on your device.",
    short: "Stale credentials", node: "Cached credentials", priority: "medium",
    steps: [
      ["Sign out of the app completely", "Quit it entirely rather than closing the window."],
      ["Remove the saved password", "Delete the stored entry from your keychain or credential manager."],
      ["Sign back in with the new password", "Type it rather than pasting, so you can confirm what's being sent."],
    ],
  },
  reset: {
    title: "This looks like a password or directory sync problem.",
    short: "Password failure", node: "Credential failure", priority: "medium",
    steps: [
      ["Reset from the self-service portal", "Use the password reset page rather than changing it inside the app."],
      ["Confirm on a second device", "Sign in somewhere else to check whether the new password works at all."],
      ["Retry on the original device", "If it works elsewhere but not here, the problem is local to this machine."],
    ],
  },
  install: {
    title: "The installer isn't completing successfully.",
    short: "Install failure", node: "Install failure", priority: "low",
    steps: [
      ["Restart, then install once", "A restart clears file locks left behind by a previous attempt."],
      ["Check available disk space", "Installers fail quietly when space runs low mid-write."],
      ["Note the exact error text", "Copy the wording of any error. It's the fastest route to a match in our records."],
    ],
  },
  perm: {
    title: "Permissions are blocking the install.",
    short: "Permissions blocked", node: "Permission block", priority: "medium",
    steps: [
      ["Confirm the prompt you saw", "Note whether it asked for an admin password or refused outright."],
      ["Check the managed software portal", "Approved apps often install without admin rights from your company portal."],
    ],
  },
  crash: {
    title: "The app is failing during use rather than at startup.",
    short: "Runtime crash", node: "Runtime crash", priority: "medium",
    steps: [
      ["Note what you were doing", "Crashes that repeat on the same action are far quicker to fix."],
      ["Restart the app and repeat that action", "Confirm whether it's reproducible."],
      ["Install pending updates", "Check for an update to the app and to the operating system."],
    ],
  },
  regression: {
    title: "It worked before, so something changed recently.",
    short: "Update regression", node: "Recent regression", priority: "medium",
    steps: [
      ["Check recent updates", "Look at what was installed in the last week, for the app and the system."],
      ["Restart the device", "Half-applied updates finish on restart."],
      ["Launch once more", "If it still fails, we'll pass the update history to a technician."],
    ],
  },
  noboot: {
    title: "The device isn't starting properly — this needs hands-on attention.",
    short: "Boot failure", node: "Boot failure", priority: "high",
    steps: [
      ["Hold the power button for ten seconds", "Force it fully off, wait, then press power once."],
      ["Connect a known-good charger", "Leave it plugged in for fifteen minutes before trying again."],
    ],
  },
  perf: {
    title: "The device is running out of headroom.",
    short: "Performance", node: "Resource pressure", priority: "low",
    steps: [
      ["Restart the device", "It clears memory pressure and stuck background processes."],
      ["Close what you aren't using", "Browser tabs and background apps are the usual culprits."],
      ["Check free disk space", "Performance degrades sharply below ten percent free."],
    ],
  },
  display: {
    title: "This points to the display path — cable, port, or driver.",
    short: "Display fault", node: "Display path", priority: "medium",
    steps: [
      ["Reseat the cable at both ends", "Unplug and firmly reconnect at the device and at the monitor."],
      ["Try a different port or cable", "This separates a port fault from a cable fault."],
    ],
  },
  peripheral: {
    title: "An accessory isn't being detected.",
    short: "Peripheral", node: "Device not detected", priority: "low",
    steps: [
      ["Try a different port", "Move it to another port directly on the device, not through a hub."],
      ["Test the accessory elsewhere", "Plug it into another machine to find out which side is at fault."],
    ],
  },
  missing: {
    title: "The printer isn't mapped to this device.",
    short: "Printer not mapped", node: "Not mapped", priority: "low",
    steps: [
      ["Confirm you're on the office network", "Network printers are invisible over VPN or guest Wi-Fi."],
      ["Add the printer again", "Open printer settings and add it from the list of available printers."],
    ],
  },
  stuck: {
    title: "The print queue is stalled.",
    short: "Stuck queue", node: "Queue stalled", priority: "medium",
    steps: [
      ["Clear every job in the queue", "Delete all pending jobs rather than retrying them."],
      ["Restart the printer", "Power it off at the plug for thirty seconds."],
      ["Send one short test page", "One page only, so the queue doesn't refill if it fails."],
    ],
  },
  driver: {
    title: "Jobs are being accepted and then dropped — usually a driver problem.",
    short: "Driver issue", node: "Driver fault", priority: "medium",
    steps: [
      ["Remove and re-add the printer", "This pulls a fresh driver rather than reusing the broken one."],
      ["Print a test page", "Use the test page in printer settings rather than a real document."],
    ],
  },
  general: {
    title: "We've captured enough detail — this one needs a person to look at it.",
    short: "Needs triage", node: "Manual triage", priority: "medium",
    steps: [
      ["Restart the device", "Worth ruling out before a technician picks this up."],
      ["Repeat the action and note the wording", "Any error text, however small, narrows this down fast."],
    ],
  },
  widespread: {
    title: "Several people are affected, so this is likely service-side.",
    short: "Possible outage", node: "Service-side", priority: "high",
    steps: [
      ["Check the service status page", "Confirm whether an outage is already reported."],
      ["Confirm with a colleague", "Note who else is affected and when it started for them."],
    ],
  },
};
