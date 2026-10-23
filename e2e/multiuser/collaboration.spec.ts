import { expect, test } from "@playwright/test";
import { SKIP_REASON, accounts, multiUserEnabled } from "../env";
import { createItem, signIn, upgradeWorkspace, waitSynced, workspaceIdOf, type Session } from "./helpers";

/**
 * Acceptance tests across separate browser contexts and separate users.
 * A component updating its own state never counts: every assertion reads the
 * *other* user's page (or a fresh reload).
 */
test.describe.configure({ mode: "serial" });
test.skip(!multiUserEnabled, SKIP_REASON);

let alice: Session;
let bob: Session;
let carol: Session;
let ws: string;

test.beforeAll(async ({ browser }) => {
  const { a, b, c } = accounts();
  alice = await signIn(browser, a);
  bob = await signIn(browser, b);
  carol = await signIn(browser, c);
});

test.afterAll(async () => {
  await Promise.all([alice?.context.close(), bob?.context.close(), carol?.context.close()]);
});

test("1. a new user creates a workspace through onboarding", async () => {
  const p = alice.page;
  await p.goto("/onboarding");
  const name = p.getByLabel("Display name");
  if (await name.isVisible()) {
    await name.fill("Alice");
    await p.getByRole("button", { name: /Continue/ }).click();
  }
  await p.getByLabel("Workspace name").fill(`E2E ${Date.now()}`);
  await p.getByRole("button", { name: "Create workspace" }).click();
  await p.waitForURL(/\/w\/[0-9a-f-]{36}$/);
  ws = workspaceIdOf(p);
  // Free covers 4 of the 8 tools; the later tests use all of them.
  await upgradeWorkspace(ws);
  await expect(p.getByRole("heading", { level: 1 })).toContainText("Alice");
});

test("2. invitations are bound to the intended recipient", async () => {
  const { b, c } = accounts();
  const p = alice.page;
  await p.goto(`/w/${ws}/settings/members`);
  await p.getByLabel("Email").fill(b.email);
  await p.getByRole("button", { name: "Create invite" }).click();
  const link = await p.getByLabel("Invitation link").inputValue();
  expect(link).toMatch(/\/invite\/[0-9a-f]{64}$/);
  const path = new URL(link).pathname;

  // Carol holds Bob's link: refused.
  await carol.page.goto(path);
  await expect(carol.page.getByText(/sent to a different email address/)).toBeVisible();

  // Bob accepts.
  await bob.page.goto(path);
  await bob.page.getByRole("button", { name: "Accept and join" }).click();
  await bob.page.waitForURL(new RegExp(`/w/${ws}$`));

  // Re-using the link fails.
  await bob.page.goto(path);
  await expect(bob.page.getByText(/already used/)).toBeVisible();

  // Carol joins as a viewer for the permission tests.
  await p.getByLabel("Email").fill(c.email);
  await p.getByLabel("Role").selectOption("viewer");
  await p.getByRole("button", { name: "Create invite" }).click();
  const carolLink = new URL(await p.getByLabel("Invitation link").inputValue()).pathname;
  await carol.page.goto(carolLink);
  await carol.page.getByRole("button", { name: "Accept and join" }).click();
  await carol.page.waitForURL(new RegExp(`/w/${ws}$`));
});

test("4/13/14. two users edit one document concurrently, converge, and survive reload", async () => {
  const url = await createItem(alice.page, ws, "docs", "document", "Spec");
  await bob.page.goto(url);
  await Promise.all([waitSynced(alice.page), waitSynced(bob.page)]);
  const aEditor = alice.page.getByLabel("Document body");
  const bEditor = bob.page.getByLabel("Document body");
  await aEditor.click();
  await bEditor.click();
  await Promise.all([aEditor.pressSequentially("Alice writes. ", { delay: 15 }), bEditor.pressSequentially("Bob writes. ", { delay: 15 })]);
  for (const ed of [aEditor, bEditor]) {
    await expect(ed).toContainText("Alice writes.");
    await expect(ed).toContainText("Bob writes.");
  }
  expect(await aEditor.innerText()).toBe(await bEditor.innerText());
  // Collaborator presence is visible.
  await expect(alice.page.getByLabel(/collaborator.* here/)).toBeVisible();

  // Interruption: Bob goes offline, edits, comes back.
  await bob.context.setOffline(true);
  await bEditor.press("End");
  await bEditor.pressSequentially(" Offline edit.", { delay: 10 });
  await bob.context.setOffline(false);
  await expect(aEditor).toContainText("Offline edit.", { timeout: 30_000 });

  // Refresh: confirmed content is still there.
  await waitSynced(alice.page);
  await alice.page.reload();
  await expect(alice.page.getByLabel("Document body")).toContainText("Offline edit.");
});

test("5. whiteboard objects added by one user appear for another", async () => {
  const url = await createItem(alice.page, ws, "whiteboard", "board", "Ideas");
  await bob.page.goto(url);
  await Promise.all([waitSynced(alice.page), waitSynced(bob.page)]);
  const canvas = alice.page.getByLabel("Whiteboard canvas");
  const box = (await canvas.boundingBox())!;
  await alice.page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  await alice.page.keyboard.type("Shared sticky");
  await alice.page.keyboard.press("Escape");
  await expect(bob.page.getByLabel("Whiteboard canvas")).toContainText("Shared sticky");
});

test("6. kanban cards created and edited by one user appear for another without refresh", async () => {
  const url = await createItem(alice.page, ws, "kanban", "board", "Sprint");
  await bob.page.goto(url);
  await alice.page.getByRole("button", { name: "Add card" }).first().click();
  await alice.page.getByLabel("New card title").fill("Write tests");
  await alice.page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(bob.page.getByRole("button", { name: "Write tests" })).toBeVisible();

  // Move via keyboard drag (dnd-kit keyboard sensor) into the next column.
  const card = alice.page.getByRole("button", { name: "Write tests" });
  await card.focus();
  await alice.page.keyboard.press("Space");
  await alice.page.keyboard.press("ArrowRight");
  await alice.page.keyboard.press("Space");
  await expect(bob.page.getByRole("region", { name: "In progress column" }).getByRole("button", { name: "Write tests" })).toBeVisible();

  // Edit in the dialog; Bob sees the new title.
  await card.click();
  const title = alice.page.getByLabel("Title");
  await title.fill("Write more tests");
  await title.blur();
  await expect(bob.page.getByRole("button", { name: "Write more tests" })).toBeVisible();
});

test("7. chat messages are delivered live and persisted", async () => {
  await alice.page.goto(`/w/${ws}/chat`);
  await bob.page.goto(`/w/${ws}/chat`);
  const msg = `hello from alice ${Date.now()}`;
  await alice.page.getByLabel(/Message #general/).fill(msg);
  await alice.page.keyboard.press("Enter");
  await expect(bob.page.getByText(msg)).toBeVisible();
  await bob.page.reload();
  await expect(bob.page.getByText(msg)).toBeVisible();
});

test("8. mindmap changes synchronise", async () => {
  const url = await createItem(alice.page, ws, "mindmap", "mindmap", "Launch");
  await bob.page.goto(url);
  await Promise.all([waitSynced(alice.page), waitSynced(bob.page)]);
  await alice.page.getByText("Launch", { exact: true }).last().click();
  await alice.page.getByRole("button", { name: /Child/ }).click();
  await alice.page.getByLabel("Topic").fill("Marketing");
  await alice.page.keyboard.press("Enter");
  await expect(bob.page.getByText("Marketing", { exact: true })).toBeVisible();
});

test("9. concurrent code edits converge", async () => {
  const url = await createItem(alice.page, ws, "code", "project", "Snippets");
  await bob.page.goto(url);
  for (const p of [alice.page, bob.page]) await expect(p.locator(".monaco-editor")).toBeVisible({ timeout: 30_000 });
  await alice.page.locator(".monaco-editor .view-lines").click();
  await alice.page.keyboard.press("Control+Home");
  await alice.page.keyboard.type("// from alice\n");
  await bob.page.locator(".monaco-editor .view-lines").click();
  await bob.page.keyboard.press("Control+End");
  await bob.page.keyboard.type("\n// from bob");
  for (const p of [alice.page, bob.page]) {
    await expect(p.locator(".monaco-editor .view-lines")).toContainText("from alice");
    await expect(p.locator(".monaco-editor .view-lines")).toContainText("from bob");
  }
});

test("10. playlist operations synchronise and persist", async () => {
  const url = await createItem(alice.page, ws, "playlists", "playlist", "Focus");
  await bob.page.goto(url);
  await alice.page.getByRole("button", { name: "Add track" }).first().click();
  await alice.page.getByLabel("Title").fill("Track one");
  await alice.page.getByLabel("Link").fill("https://example.com/track-one");
  await alice.page.getByRole("button", { name: "Add track" }).last().click();
  await expect(bob.page.getByText("Track one")).toBeVisible();
  await bob.page.reload();
  await expect(bob.page.getByText("Track one")).toBeVisible();
});

test("11. to-do list changes synchronise both ways", async () => {
  const url = await createItem(alice.page, ws, "shopping", "list", "Groceries");
  await bob.page.goto(url);
  await alice.page.getByLabel("Task name").fill("Oat milk");
  await alice.page.getByRole("button", { name: "Add", exact: true }).click();
  await bob.page.getByRole("checkbox", { name: "Check Oat milk" }).click();
  await expect(alice.page.getByRole("checkbox", { name: "Uncheck Oat milk" })).toBeVisible();
  await expect(alice.page.getByText("Done by")).toBeVisible();
});

test("12. dashboard previews reflect the same data as module pages", async () => {
  await alice.page.goto(`/w/${ws}`);
  await expect(alice.page.getByLabel("Docs widget")).toContainText("Spec");
  await expect(alice.page.getByLabel("Shopping widget")).toContainText(/All picked up|done/);
  await expect(alice.page.getByLabel("Whiteboard widget")).toContainText(/objects/);
});

test("3. viewers can read but not modify", async () => {
  await carol.page.goto(`/w/${ws}/docs`);
  await expect(carol.page.getByRole("button", { name: /New document/ })).toHaveCount(0);
  await carol.page.getByText("Spec").first().click();
  await expect(carol.page.getByText("View only")).toBeVisible();
  await expect(carol.page.getByLabel("Document body")).toHaveAttribute("contenteditable", "false");
  await carol.page.goto(`/w/${ws}/chat`);
  await expect(carol.page.getByText("You have view-only access")).toBeVisible();
});

test("15. a removed member loses access in their open session", async () => {
  // Bob has a document open while Alice removes him.
  await bob.page.goto(`/w/${ws}/docs`);
  await bob.page.getByText("Spec").first().click();
  await waitSynced(bob.page);
  await alice.page.goto(`/w/${ws}/settings/members`);
  await alice.page.getByRole("button", { name: /More actions for E2E B|More actions for Bob/ }).click();
  await alice.page.getByRole("menuitem", { name: "Remove from workspace" }).click();
  await alice.page.getByRole("button", { name: "Remove" }).click();
  // Shell redirect (realtime) or collab revocation, whichever lands first.
  await expect(bob.page.getByText(/removed from this workspace|access to this workspace was removed|can't open this/i).first()).toBeVisible({ timeout: 40_000 });
  await bob.page.goto(`/w/${ws}`);
  await expect(bob.page.getByRole("heading", { name: "Nothing here" })).toBeVisible();
});
