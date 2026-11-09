import { afterEach, describe, expect, it, vi } from "vitest";
import { opensFind, opensLink, pressedAlone, savesEdit, sendsMessage } from "./keyboard";

function pointer(coarse: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(pointer: coarse)" && coarse }));
}

const press = (key: string, init: KeyboardEventInit = {}) => new KeyboardEvent("keydown", { key, ...init });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sendsMessage", () => {
  it("sends on Enter and starts a new line on Shift+Enter with a physical keyboard", () => {
    pointer(false);
    expect(sendsMessage(press("Enter"))).toBe(true);
    expect(sendsMessage(press("Enter", { shiftKey: true }))).toBe(false);
  });

  it("starts a new line on Enter with a touch keyboard", () => {
    pointer(true);
    expect(sendsMessage(press("Enter"))).toBe(false);
  });

  it("starts a new paragraph on Enter while the formatting toolbar is open", () => {
    pointer(false);
    expect(sendsMessage(press("Enter"), { toolbarOpen: true })).toBe(false);
    expect(sendsMessage(press("Enter", { ctrlKey: true }), { toolbarOpen: true })).toBe(true);
  });

  it("sends on Cmd+Enter or Ctrl+Enter everywhere", () => {
    pointer(true);
    expect(sendsMessage(press("Enter", { metaKey: true }))).toBe(true);
    expect(sendsMessage(press("Enter", { ctrlKey: true }))).toBe(true);
  });

  it("leaves Enter to an input method that is still composing", () => {
    pointer(false);
    expect(sendsMessage(press("Enter", { isComposing: true }))).toBe(false);
    expect(sendsMessage(press("Enter", { isComposing: true, metaKey: true }))).toBe(false);
  });

  it("ignores other keys", () => {
    pointer(false);
    expect(sendsMessage(press("a"))).toBe(false);
  });
});

describe("opensLink", () => {
  it("is Ctrl+K or Cmd+K, as Lexxy's toolbar takes them", () => {
    expect(opensLink(press("k", { ctrlKey: true }))).toBe(true);
    expect(opensLink(press("k", { metaKey: true }))).toBe(true);
    expect(opensLink(press("K", { ctrlKey: true }))).toBe(true);
  });

  it("isn't K on its own or with other keys held", () => {
    expect(opensLink(press("k"))).toBe(false);
    expect(opensLink(press("k", { ctrlKey: true, metaKey: true }))).toBe(false);
    expect(opensLink(press("k", { ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(opensLink(press("k", { metaKey: true, altKey: true }))).toBe(false);
    expect(opensLink(press("j", { ctrlKey: true }))).toBe(false);
  });
});

describe("savesEdit", () => {
  it("is Ctrl+Enter or Cmd+Enter", () => {
    expect(savesEdit(press("Enter", { ctrlKey: true }))).toBe(true);
    expect(savesEdit(press("Enter", { metaKey: true }))).toBe(true);
  });

  it("isn't Enter on its own, with other keys held, or while an input method is composing", () => {
    expect(savesEdit(press("Enter"))).toBe(false);
    expect(savesEdit(press("Enter", { shiftKey: true }))).toBe(false);
    expect(savesEdit(press("Enter", { ctrlKey: true, metaKey: true }))).toBe(false);
    expect(savesEdit(press("Enter", { ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(savesEdit(press("Enter", { metaKey: true, altKey: true }))).toBe(false);
    expect(savesEdit(press("Enter", { ctrlKey: true, isComposing: true }))).toBe(false);
  });
});

describe("pressedAlone", () => {
  it("is the key with nothing held", () => {
    expect(pressedAlone(press("Escape"), "Escape")).toBe(true);
    expect(pressedAlone(press("ArrowUp"), "ArrowUp")).toBe(true);
  });

  it("isn't another key, the key with a modifier held, or one an input method is composing", () => {
    expect(pressedAlone(press("ArrowDown"), "ArrowUp")).toBe(false);
    for (const modifier of ["ctrlKey", "metaKey", "altKey", "shiftKey", "isComposing"]) {
      expect(pressedAlone(press("ArrowUp", { [modifier]: true }), "ArrowUp"), modifier).toBe(false);
    }
  });
});

describe("opensFind", () => {
  /** The keyboard of a device whose `navigator.platform` is `platform`. */
  const on = (platform: string) => vi.stubGlobal("navigator", { ...navigator, platform });

  it("takes Ctrl+F, in either case, but on Apple's devices", () => {
    on("Win32");
    expect(opensFind(press("f", { ctrlKey: true }))).toBe(true);
    expect(opensFind(press("F", { ctrlKey: true }))).toBe(true);
    expect(opensFind(press("f", { metaKey: true }))).toBe(false);
    on("Linux x86_64");
    expect(opensFind(press("f", { ctrlKey: true }))).toBe(true);
  });

  it("takes Cmd+F on a Mac, iPad or iPhone, where Ctrl+F moves the caret on in a field", () => {
    for (const platform of ["MacIntel", "iPad", "iPhone"]) {
      on(platform);
      expect(opensFind(press("f", { metaKey: true })), platform).toBe(true);
      expect(opensFind(press("f", { ctrlKey: true })), platform).toBe(false);
    }
  });

  it("leaves F with other modifiers, alone, or while an input method composes", () => {
    on("Win32");
    expect(opensFind(press("f"))).toBe(false);
    expect(opensFind(press("f", { ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(opensFind(press("f", { ctrlKey: true, altKey: true }))).toBe(false);
    expect(opensFind(press("f", { ctrlKey: true, metaKey: true }))).toBe(false);
    expect(opensFind(press("f", { ctrlKey: true, isComposing: true }))).toBe(false);
    expect(opensFind(press("g", { ctrlKey: true }))).toBe(false);
  });
});
