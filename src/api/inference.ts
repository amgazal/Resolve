import type { Catalog } from "@/types";

export interface DescriptionSuggestions {
  categorySlug?: string;
  device?: string;
  operatingSystem?: string;
}

const has = (text: string, pattern: RegExp) => pattern.test(text);

export function inferDescription(text: string): DescriptionSuggestions {
  const value = text.toLocaleLowerCase();
  const suggestion: DescriptionSuggestions = {};

  if (has(value, /\bwi[ -]?fi\b|\binternet\b|\bnetwork\b/)) suggestion.categorySlug = "wifi";
  else if (has(value, /\bpassword\b|\blog ?in\b|\bsign[ -]?in\b|\bmfa\b|\bverification code\b|\blocked out\b/)) suggestion.categorySlug = "login";
  else if (has(value, /\bprinter\b|\bprinting\b|\bprint queue\b/)) suggestion.categorySlug = "printing";
  else if (has(value, /\binstall(?:er|ation)?\b|\bapp crashes?\b|\bsoftware\b|\bapplication\b/)) suggestion.categorySlug = "software";
  else if (has(value, /\bscreen\b|\bkeyboard\b|\bmouse\b|\bbattery\b|\bcharger\b|\bmonitor\b|\busb\b/)) suggestion.categorySlug = "hardware";

  if (has(value, /\bmacbook\b/)) {
    suggestion.device = "Laptop";
    suggestion.operatingSystem = "macOS";
  } else if (has(value, /\bwindows laptop\b|\blaptop\b.*\bwindows\b|\bwindows\b.*\blaptop\b/)) {
    suggestion.device = "Laptop";
    suggestion.operatingSystem = "Windows";
  } else if (has(value, /\biphone\b/)) {
    suggestion.device = "Phone";
    suggestion.operatingSystem = "iOS";
  } else if (has(value, /\bipad\b/)) {
    suggestion.device = "Tablet";
    suggestion.operatingSystem = "iOS";
  } else if (has(value, /\bandroid phone\b|\bandroid\b.*\bphone\b|\bphone\b.*\bandroid\b/)) {
    suggestion.device = "Phone";
    suggestion.operatingSystem = "Android";
  } else if (has(value, /\bandroid tablet\b|\btablet\b.*\bandroid\b|\bandroid\b.*\btablet\b/)) {
    suggestion.device = "Tablet";
    suggestion.operatingSystem = "Android";
  } else if (has(value, /\blinux laptop\b|\blaptop\b.*\blinux\b|\blinux\b.*\blaptop\b/)) {
    suggestion.device = "Laptop";
    suggestion.operatingSystem = "Linux";
  } else if (has(value, /\bwindows pc\b|\bpc\b/)) {
    suggestion.device = "Desktop";
    suggestion.operatingSystem = "Windows";
  } else if (has(value, /\bimac\b/)) {
    suggestion.device = "Desktop";
    suggestion.operatingSystem = "macOS";
  } else if (has(value, /\bmac\b/)) {
    suggestion.operatingSystem = "macOS";
  } else if (suggestion.categorySlug === "printing" && has(value, /\bprinter\b/)) {
    suggestion.device = "Printer";
  }

  return suggestion;
}

export function categoryForSuggestion(catalog: Catalog, slug?: string) {
  return slug ? catalog.categories.find((category) => category.slug === slug)?.id ?? null : null;
}