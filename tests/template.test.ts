import { describe, expect, it } from "vitest";
import { waitText } from "@/lib/template";

describe("waitText", () => {
  it("says seconds under a minute and a half", () => {
    expect(waitText(1)).toBe("1 second");
    expect(waitText(30)).toBe("30 seconds");
    expect(waitText(89)).toBe("89 seconds");
  });

  it("says whole minutes, rounded up, under an hour and a half", () => {
    expect(waitText(90)).toBe("2 minutes");
    expect(waitText(600)).toBe("10 minutes");
    expect(waitText(3600)).toBe("60 minutes");
  });

  it("says hours from an hour and a half", () => {
    expect(waitText(5400)).toBe("2 hours");
    expect(waitText(86400)).toBe("24 hours");
  });
});
