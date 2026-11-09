/** Phones and tablets: their on-screen keyboards have no Shift+Enter. */
export const hasTouchKeyboard = () => matchMedia("(pointer: coarse)").matches;

/** Whether the keyboard is an Apple device's, whose shortcuts take Cmd where others take Ctrl. */
const appleKeyboard = () => /Mac|iPhone|iPad|iPod/.test(navigator.platform);

/**
 * Cmd+F on a Mac, iPad or iPhone, or Ctrl+F elsewhere, which opens the search box, as it opens Slack's,
 * and the browser's own find from inside it. A Mac's Ctrl+F moves the caret on in a field, so it stays
 * the field's.
 */
export function opensFind(event: KeyboardEvent): boolean {
  if (event.key.toLowerCase() !== "f" || event.altKey || event.shiftKey || event.isComposing) return false;
  return appleKeyboard() ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
}

/** Ctrl+K, or Cmd+K on a Mac, which opens the Link field of Lexxy's toolbar (its `data-hotkey="cmd+k ctrl+k"`). */
export function opensLink(event: KeyboardEvent): boolean {
  return event.key.toLowerCase() === "k" && event.ctrlKey !== event.metaKey && !event.altKey && !event.shiftKey;
}

/**
 * Whether a keypress in a message's editor should send it, as Campfire's composer_controller.js decides:
 * Enter sends and Shift+Enter starts a new line, except on touch screens, where Enter has to start the
 * new line and the Send button sends, and while the formatting toolbar is open, when Enter starts a new
 * paragraph. Cmd/Ctrl+Enter sends everywhere.
 *
 * Campfire treats any touch-capable device that way, and doesn't send on Cmd/Ctrl+Enter there either;
 * this checks the primary pointer instead, so a laptop with a touchscreen still sends on Enter.
 */
export function sendsMessage(event: KeyboardEvent, { toolbarOpen = false } = {}): boolean {
  if (event.key !== "Enter" || event.isComposing) return false;
  if (event.metaKey || event.ctrlKey) return true;
  return !event.shiftKey && !toolbarOpen && !hasTouchKeyboard();
}

/**
 * Ctrl+Enter, or Cmd+Enter on a Mac, which saves a message's edit, as Campfire's edit form takes them
 * (messages/edit.html.erb, `keydown.ctrl+enter` and `keydown.meta+enter`): with no other modifier held.
 */
export function savesEdit(event: KeyboardEvent): boolean {
  return event.key === "Enter" && !event.isComposing && event.ctrlKey !== event.metaKey && !event.altKey && !event.shiftKey;
}

/** Whether `key` was pressed with no modifier held, as Stimulus's key filters such as `keydown.esc` take it. */
export function pressedAlone(event: KeyboardEvent, key: string): boolean {
  return event.key === key && !event.isComposing && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;
}
