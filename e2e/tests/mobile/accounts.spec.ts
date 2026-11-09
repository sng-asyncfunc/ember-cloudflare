import type { Locator, Page } from "@playwright/test";
import type { Account, BotAnswer, Bots, BotSettings, WorkspaceServerFrame } from "@ember/protocol";
import { fakeTurnstile, isolateRoom, listing, openRoom, signInAs, signInAsAdministrator, TURNSTILE_WIDGET, useOwnAddress, WORKSPACE_SOCKET } from "../../fixtures";
import { auditScreen, settle } from "./audits";
import { expect, hasDrawerLayout, SWITCHES, test } from "./fixtures";

/** A name as long as the server takes, with a run that only breaks anywhere. */
const LONG_NAME = "The-Analytical-Engine-Appreciation-Society-of-Greater-Marylebone-and-the-Surrounding-Districts";
/** A tagline as long as the server takes, in everyday words. */
const LONGEST_TAGLINE = "Engines and tea for every soul";

/** Which of the workspace socket's frames reach the page. */
type Passes = (frame: WorkspaceServerFrame) => boolean;

/**
 * Shows `page` the workspace as `change` makes it wherever the server says what it is, its socket's
 * welcome included, without changing the test server's, which every other test shows. Its socket takes
 * over from any the page routed before, such as `isolateRoom`'s, so it passes on just what `passes` does.
 */
async function changeTheWorkspace(page: Page, change: (account: Account) => Account, passes: Passes = () => true): Promise<void> {
  const changed = <T extends { account: Account }>(body: T): T => ({ ...body, account: change(body.account) });
  for (const path of ["**/api/bootstrap", "**/api/account"]) {
    await page.route(path, async (route) => {
      const response = await route.fetch();
      if (!response.ok()) return route.fulfill({ response });
      await route.fulfill({ response, json: changed(await response.json()) });
    });
  }
  await page.routeWebSocket(WORKSPACE_SOCKET, (ws) => {
    const server = ws.connectToServer();
    server.onMessage((message) => {
      const frame = JSON.parse(String(message));
      if (passes(frame)) ws.send(JSON.stringify("account" in frame ? changed(frame) : frame));
    });
  });
}

const nameTheWorkspaceLong = (page: Page) => changeTheWorkspace(page, (account) => ({ ...account, name: LONG_NAME }));
const showTranslationButtons = (page: Page, passes?: Passes) => changeTheWorkspace(page, (account) => ({ ...account, hideTranslationButtons: false }), passes);

test("an administrator's workspace settings, with a long name, fit the phone", async ({ page, screenIsFine }) => {
  await useOwnAddress(page);
  await nameTheWorkspaceLong(page);
  await page.goto("/account/edit");
  await signInAsAdministrator(page);
  await expect(page.getByRole("textbox", { name: "Community name" })).toHaveValue(LONG_NAME);
  await screenIsFine({ denseTargets: [SWITCHES] });

  // Back in a room, the conversations under it, where the name wraps.
  await page.getByRole("link", { name: "Go Back" }).tap();
  if (hasDrawerLayout(page)) await page.getByRole("button", { name: "Open conversations" }).tap();
  await expect(page.getByRole("heading", { level: 2, name: LONG_NAME })).toBeVisible();
  await screenIsFine({ denseTargets: [SWITCHES] });
});

test("an administrator's people list, with Delete by everyone else, fits the phone", async ({ page, session, screenIsFine }) => {
  await useOwnAddress(page);
  await page.goto("/account/edit#membership-settings");
  await signInAsAdministrator(page);
  const remove = page.getByRole("region", { name: "Membership" }).getByRole("button", { name: `Delete ${session.user.name}` }).first();
  await remove.scrollIntoViewIfNeeded();
  await expect(remove).toBeInViewport();
  await screenIsFine({ denseTargets: [SWITCHES] });
});

test("an administrator's ways to join, with Open's sign-up link, fit the phone", async ({ page, screenIsFine }) => {
  await useOwnAddress(page);
  await changeTheWorkspace(page, (account) => ({ ...account, openSignUp: true }));
  await page.goto("/account/edit#membership-settings");
  await signInAsAdministrator(page);
  const open = page.getByRole("region", { name: "Open", exact: true });
  await open.scrollIntoViewIfNeeded();
  await expect(open.getByRole("textbox", { name: "Share so anyone can sign up" })).toBeInViewport();
  await screenIsFine({ denseTargets: [SWITCHES] });

  await open.getByRole("button", { name: "Set up Turnstile" }).scrollIntoViewIfNeeded();
  await screenIsFine({ denseTargets: [SWITCHES] });
});

test("an administrator's Set up Turnstile, with the widget's check, fits the phone", async ({ page, screenIsFine }) => {
  await useOwnAddress(page);
  await fakeTurnstile(page);
  await page.goto("/account/edit#membership-settings");
  await signInAsAdministrator(page);
  const card = page.getByRole("region", { name: "Turnstile", exact: true });
  await card.scrollIntoViewIfNeeded();
  await card.getByRole("switch", { name: "Turnstile" }).tap();
  const setup = page.getByRole("dialog", { name: "Set up Turnstile" });
  await expect(setup.getByRole("list", { name: "Steps to make a Turnstile widget" })).toBeVisible();
  await screenIsFine({ denseTargets: [SWITCHES] });

  await setup.getByRole("textbox", { name: "Site key" }).fill(TURNSTILE_WIDGET.siteKey);
  await setup.getByRole("textbox", { name: "Secret key" }).fill(TURNSTILE_WIDGET.secretKey);
  await setup.getByRole("button", { name: "Continue" }).tap();
  const check = page.getByRole("dialog", { name: "Pass the widget's check" });
  await expect(check.frameLocator("iframe[title=\"Turnstile's check\"]").getByRole("button", { name: "Verify you are human" })).toBeVisible();
  await screenIsFine({ denseTargets: [SWITCHES] });
});

test("an administrator's custom domain steps, for a domain at another provider, fit the phone", async ({ page, screenIsFine }) => {
  await useOwnAddress(page);
  // As Cloudflare's resolver finds a domain whose DNS is at GoDaddy, whose steps to keep it there are the
  // most, and which doesn't reach Ember yet.
  await page.route("**/api/account/custom_domain_lookups", (route) => route.fulfill({ json: { zone: "example.com", provider: "godaddy" } }));
  await page.route("**/api/account/custom_domain_checks", (route) => route.fulfill({ json: { reaches: "nothing" } }));
  await page.goto("/account/edit#domain-settings");
  await signInAsAdministrator(page);
  const section = page.getByRole("region", { name: "Custom domain" });
  await section.getByRole("textbox", { name: "Domain" }).fill("chat.example.com");
  await section.getByRole("button", { name: "Set up" }).tap();
  await section.getByRole("textbox", { name: "Domain on Cloudflare" }).fill("example.net");
  const steps = section.getByRole("list", { name: "Steps to make chat.example.com Ember's address" });
  await expect(steps.getByRole("listitem")).toHaveCount(5);
  const provider = section.getByRole("combobox", { name: "DNS provider" });
  await provider.scrollIntoViewIfNeeded();
  await screenIsFine({ denseTargets: [SWITCHES] });

  // The longest record, to add at GoDaddy.
  await steps.getByRole("button", { name: "Copy ember-saas.example.net" }).scrollIntoViewIfNeeded();
  await screenIsFine({ denseTargets: [SWITCHES] });
  await steps.getByRole("button", { name: "Use chat.example.com" }).scrollIntoViewIfNeeded();
  await screenIsFine({ denseTargets: [SWITCHES] });

  // Or moving its DNS to Cloudflare.
  await provider.selectOption("cloudflare");
  await expect(steps.getByRole("listitem")).toHaveCount(4);
  await provider.scrollIntoViewIfNeeded();
  await screenIsFine({ denseTargets: [SWITCHES] });
});

test("an administrator's Save, for a domain that already reaches Ember, fits the phone, under Domain settings in view", async ({ page, screenIsFine }) => {
  await useOwnAddress(page);
  // As Set up's check finds Ember at a domain added to the Worker before.
  await page.route("**/api/account/custom_domain_checks", (route) => route.fulfill({ json: { reaches: "ember" } }));
  await page.goto("/account/edit#domain-settings");
  await signInAsAdministrator(page);
  await expect(page.getByRole("navigation", { name: "Community settings" }).getByRole("link", { name: "Domain settings" })).toBeInViewport();
  const section = page.getByRole("region", { name: "Custom domain" });
  await section.getByRole("textbox", { name: "Domain" }).fill("community-chat.analytical-engines.example.com");
  await section.getByRole("button", { name: "Set up" }).tap();
  await expect(section).toContainText("community-chat.analytical-engines.example.com already reaches Ember.");
  await section.getByRole("button", { name: "Save" }).scrollIntoViewIfNeeded();
  await screenIsFine({ denseTargets: [SWITCHES] });
});

test("a member's workspace settings, with a long name, fit the phone", async ({ page, session, screenIsFine }) => {
  await nameTheWorkspaceLong(page);
  await signInAs(page, session);
  await page.goto("/account/edit");
  await expect(page.getByRole("main").getByRole("heading", { level: 2, name: LONG_NAME })).toBeVisible();
  await screenIsFine();
});

/** How many lines `text` takes up. */
const linesOf = (text: Locator) =>
  text.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    return new Set([...range.getClientRects()].map((line) => Math.round(line.top))).size;
  });

test("the longest tagline fits the phone under a long name, in a member's settings and the conversations, clear of the drawer's close button", async ({
  page,
  room,
  session,
  screenIsFine,
}) => {
  await changeTheWorkspace(page, (account) => ({ ...account, name: LONG_NAME, tagline: LONGEST_TAGLINE }));
  await signInAs(page, session);
  await page.goto("/account/edit");
  const settingsName = page.getByRole("main").getByRole("heading", { level: 2, name: LONG_NAME });
  await expect(settingsName.locator("xpath=following-sibling::p")).toHaveText(LONGEST_TAGLINE);
  await screenIsFine();

  // Community settings' links take the conversations' place, so they're a room's.
  await openRoom(page, room);
  if (hasDrawerLayout(page)) await page.getByRole("button", { name: "Open conversations" }).tap();
  const conversations = page.getByRole("complementary", { name: "Conversations" });
  const tagline = conversations.locator("hgroup > h2 + p");
  await expect(tagline).toHaveText(LONGEST_TAGLINE);
  await screenIsFine();
  if (hasDrawerLayout(page)) {
    const [line, close] = [(await tagline.boundingBox())!, (await page.getByRole("dialog").getByRole("button", { name: "Close conversations" }).boundingBox())!];
    expect(line.x + line.width <= close.x || line.y >= close.y + close.height, "the tagline is clear of the close button").toBe(true);
  }
  // A drawer with room for the sidebar's full 280px, from 376px wide, takes it on one line, as the desktop does.
  if ((await conversations.evaluate((sidebar) => sidebar.getBoundingClientRect().width)) >= 280) expect(await linesOf(tagline)).toBe(1);
});

test("the Custom styles page fits the phone, its navigation icons first, then a CSS field too big for iOS to zoom in on", async ({ page, screenIsFine }) => {
  await useOwnAddress(page);
  await page.goto("/account/custom_styles/edit");
  await signInAsAdministrator(page);
  const css = page.getByRole("textbox", { name: "Custom CSS" });
  await expect(css).toBeEnabled();
  await expect(page.getByRole("region", { name: "Navigation icons" }).getByRole("button", { name: "Choose Home icon" })).toBeInViewport();
  await screenIsFine();

  await css.scrollIntoViewIfNeeded();
  await expect(css).toBeInViewport();
  await screenIsFine();
});

/** A bot named as long as names go, in a room named so, as the bots page lists it. */
const BOT: BotSettings = {
  id: "0mgk3x2a9b4c5e",
  name: LONG_NAME,
  bio: null,
  role: "bot",
  status: "active",
  avatarUrl: "/users/0mgk3x2a9b4c5e/avatar?v=1",
  key: "0mgk3x2a9b4c5e-Ab3dEf5hiJ7k",
  rooms: [{ id: "0mgk3x2a9b4c5a", name: LONG_NAME }],
  webhookUrl: "https://ci.example.com/hook",
};

/** Shows `page` `BOT` as the only bot, without adding one to the test server, where it would join every other test's rooms. */
async function showTheBot(page: Page): Promise<void> {
  await page.route("**/api/account/bots", (route) => route.fulfill({ json: { bots: [BOT] } satisfies Bots }));
  await page.route(`**/api/account/bots/${BOT.id}`, (route) => route.fulfill({ json: { bot: BOT } satisfies BotAnswer }));
}

test("the Chat bots page, with a bot's commands, fits the phone", async ({ page, screenIsFine }) => {
  await useOwnAddress(page);
  await showTheBot(page);
  await page.goto("/account/bots");
  await signInAsAdministrator(page);
  await expect(page.getByRole("textbox", { name: "curl command for posting messages" })).toHaveValue(/^curl -d 'Hello!' /);
  await screenIsFine();
});

test("a bot's settings fit the phone", async ({ page, screenIsFine }) => {
  await useOwnAddress(page);
  await showTheBot(page);
  await page.goto("/account/bots");
  await signInAsAdministrator(page);
  // From the bots page, as the Worker answers its 404 page for a bot it doesn't have.
  await page.getByRole("link", { name: `Edit ${BOT.name}` }).click();
  await expect(page.getByRole("textbox", { name: "Bot name" })).toHaveValue(BOT.name);
  await expect(page.getByRole("button", { name: "Generate a new key" })).toBeVisible();
  await screenIsFine();
  // Incoming, whose menu names a room as long as names go, then Outgoing, each scrolled to.
  for (const name of ["Incoming", "Outgoing"]) {
    await page.getByRole("region", { name }).scrollIntoViewIfNeeded();
    await screenIsFine();
  }
});

test("your profile, opened from the rail, fits the phone with Log out in the top bar and a translation button by each field", async ({ page, room, session, screenIsFine }) => {
  await showTranslationButtons(page);
  await signInAs(page, session);
  await openRoom(page, room);
  if (hasDrawerLayout(page)) {
    await page.getByRole("button", { name: "Open conversations" }).tap();
    await settle(page);
  }
  await page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "Your profile" }).tap();
  await expect(page.getByLabel("Name", { exact: true })).toBeEnabled();
  await expect(page.getByRole("navigation", { name: "Page" }).getByRole("button", { name: "Log out" })).toBeVisible();
  await expect(page.getByRole("main").locator("summary", { hasText: "Translate" })).toHaveCount(4);
  await screenIsFine();
});

test("your sign-in link, at the foot of your profile, fits the phone", async ({ page, room: _, session, screenIsFine }) => {
  await signInAs(page, session);
  await page.goto("/users/me/profile");
  const link = page.getByRole("textbox", { name: "Use this link to login automatically on another device" });
  await link.scrollIntoViewIfNeeded();
  await expect(link).toBeInViewport();
  await screenIsFine();
});

test("translation buttons, and the list each opens, fit the phone", async ({ page, safeArea, screenIsFine }) => {
  await showTranslationButtons(page);
  await page.goto("/session/new");
  const globe = page.locator("summary", { hasText: "Translate" }).first();
  await expect(globe).toBeVisible();
  await screenIsFine();

  await globe.tap();
  await expect(page.locator("details[open] dl")).toBeVisible();
  // What the list covers takes no tap until it closes, as under any menu, so only how it fits counts.
  const results = await auditScreen(page, safeArea);
  expect.soft(results.overflow, "Nothing is cut off or pushed off the side of the screen").toEqual([]);
  expect.soft(results.safeArea, "Nothing sits under the notch, rounded corners or home indicator").toEqual([]);
});

test("the welcome card's translation list, by the screen's edge, opens where it fits the phone", async ({ page, room, session, safeArea }) => {
  await isolateRoom(page, room, { joinCode: "aB3d-Ef5h-iJ7k" });
  await showTranslationButtons(page, listing([room.id]));
  await signInAs(page, session);
  await openRoom(page, room);
  await page.getByRole("main").locator("summary", { hasText: "Translate" }).tap();
  await expect(page.locator("details[open] dl")).toBeVisible();
  const results = await auditScreen(page, safeArea);
  expect.soft(results.overflow, "Nothing is cut off or pushed off the side of the screen").toEqual([]);
  expect.soft(results.safeArea, "Nothing sits under the notch, rounded corners or home indicator").toEqual([]);
});
