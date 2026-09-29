import { describe, expect, it } from "vitest";
import { inferDescription } from "./inference";

describe("description suggestions", () => {
  it.each([
    ["my macbook won't connect to wifi", { categorySlug: "wifi", device: "Laptop", operatingSystem: "macOS" }],
    ["my verification code doesn't work on my iphone", { categorySlug: "login", device: "Phone", operatingSystem: "iOS" }],
    ["printer queue is stuck on my windows laptop", { categorySlug: "printing", device: "Laptop", operatingSystem: "Windows" }],
    ["an app crashes", { categorySlug: "software" }],
    ["my trackpad stopped clicking", { categorySlug: "hardware" }],
    ["my MacBook trackpad stopped clicking", { categorySlug: "hardware", device: "Laptop", operatingSystem: "macOS" }],
    ["my Windows laptop touchpad isn't working", { categorySlug: "hardware", device: "Laptop", operatingSystem: "Windows" }],
  ])("infers strong context from %s", (text, expected) => {
    expect(inferDescription(text)).toEqual(expected);
  });

  it("does not guess from vague language or accidental substrings", () => {
    expect(inferDescription("something isn't working")).toEqual({});
    expect(inferDescription("the networker app is slow")).toEqual({});
  });
});