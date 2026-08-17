/** Seed content. Once seeded, the app reads categories from the database. */

export interface CategorySeed {
  slug: string;
  label: string;
  shortLabel: string;
  icon: string;
  hint: string;
}

export const CATEGORIES: CategorySeed[] = [
  { slug: "wifi",     label: "Wi-Fi & Network",   shortLabel: "Wi-Fi",    icon: "wifi",    hint: "No internet, drop-outs, slow speeds" },
  { slug: "login",    label: "Login & Account",   shortLabel: "Login",    icon: "lock",    hint: "Passwords, codes, locked out" },
  { slug: "software", label: "Software",          shortLabel: "Software", icon: "window",  hint: "Apps, installs, crashes" },
  { slug: "hardware", label: "Device & Hardware", shortLabel: "Hardware", icon: "laptop",  hint: "Won't start, slow, accessories" },
  { slug: "printing", label: "Printing",          shortLabel: "Printing", icon: "printer", hint: "Queues, drivers, missing printers" },
  { slug: "other",    label: "Something else",    shortLabel: "Other",    icon: "dots",    hint: "Not sure where this fits" },
];

export const DEVICES = ["Laptop", "Desktop", "Phone", "Tablet", "Printer", "Other"];
export const SYSTEMS = ["macOS", "Windows", "iOS", "Android", "Linux", "Not sure"];
