import { describe, expect, it } from "vitest";
import { linkify } from "./chat";

describe("linkify", () => {
  it("links only http(s) URLs and strips trailing punctuation", () => {
    expect(linkify("see https://example.com/a?b=1. ok")).toEqual([
      { text: "see " },
      { text: "https://example.com/a?b=1", href: "https://example.com/a?b=1" },
      { text: ". ok" },
    ]);
    expect(linkify("javascript:alert(1) and data:text/html,x")).toEqual([{ text: "javascript:alert(1) and data:text/html,x" }]);
    expect(linkify("")).toEqual([]);
  });
});
