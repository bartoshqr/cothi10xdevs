import { test, expect, type Locator, type Page } from "@playwright/test";
import { ADVOCATE_USERNAME, DEMO_PASSWORD } from "./global-setup";

/** Per-character delay for demo typing — kept as one constant so every field types at the same pace. */
const TYPE_DELAY = 30;

/**
 * Waits until `locator`'s controlled value actually survives a write —
 * proof that React has hydrated and attached its onChange handler. SignInForm
 * and CreateDebateForm are both Astro `client:load` islands: before
 * hydration, a fill lands on the plain native input and sticks (nothing is
 * listening yet); the moment hydration commits, React forces the DOM value
 * back to its own (still empty) state, wiping it. `toPass` polls a disposable
 * probe value until a fill survives, i.e. until hydration is done — then we
 * clear it and the caller types the real text exactly once.
 */
async function waitForHydration(locator: Locator): Promise<void> {
  const probe = "ready";
  await expect(async () => {
    await locator.fill(probe);
    expect(await locator.inputValue()).toBe(probe);
  }).toPass({ timeout: 15_000 });
  await locator.clear();
}

/** Clears the field and types `text` once. */
async function typeInto(locator: Locator, text: string) {
  await locator.clear();
  await locator.pressSequentially(text, { delay: TYPE_DELAY });
  await expect(locator).toHaveValue(text);
}

/**
 * Right-clicks the pane at a fraction of its *current* bounding box (not a
 * fixed pixel offset, and not a flow-space coordinate) — guaranteed to land
 * inside the visible canvas regardless of viewport size or how tightly
 * `fitView` zoomed in on mount. Targeting a flow-space coordinate directly
 * (an earlier attempt) could compute a screen point outside the pane once
 * fitView zoomed in on a single small root node, leaving Playwright waiting
 * forever for an unreachable click target.
 */
async function addStatementNode(
  page: Page,
  options: {
    role: "CLAIM" | "SOURCE" | "DATA" | "WARRANT" | "BACKING" | "REBUTTAL";
    /** Fraction (0–1) of the pane's width/height to right-click at. */
    xFraction: number;
    yFraction: number;
    title: string;
    body: string;
  },
) {
  const { role, xFraction, yFraction, title, body } = options;
  const pane = page.locator(".react-flow__pane");
  const box = await pane.boundingBox();
  if (!box) throw new Error("canvas pane is not visible");
  await pane.click({ button: "right", position: { x: box.width * xFraction, y: box.height * yFraction } });
  await page.getByRole("button", { name: role }).click();

  const titleField = page.locator("textarea").nth(0);
  const bodyField = page.locator("textarea").nth(1);
  await typeInto(titleField, title);
  await typeInto(bodyField, body);
  await bodyField.press("Control+Enter");
}

test("advocate signs in and starts a debate", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Sign in" }).click();
  await page.waitForURL("**/auth/signin");

  const emailField = page.getByLabel("Email address");
  await waitForHydration(emailField);
  await typeInto(emailField, `${ADVOCATE_USERNAME}@example.com`);
  await typeInto(page.getByLabel("Password", { exact: true }), DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  await page.waitForURL("**/debates");

  await page.getByRole("link", { name: /New debate/ }).click();
  await page.waitForURL("**/debates/new");

  const debateTitleField = page.getByLabel("Debate title");
  await waitForHydration(debateTitleField);
  await typeInto(debateTitleField, "Is human activity driving climate change?");
  await typeInto(page.getByLabel("Root claim", { exact: true }), "Humans are causing climate change");
  await typeInto(
    page.getByLabel(/Root claim details/),
    "The scientific consensus is clear: anthropogenic emissions are driving global temperature rise.",
  );
  await page.getByRole("button", { name: "Create debate" }).click();

  await page.waitForURL(/\/debates\/[0-9a-f-]+$/);
  await page.getByRole("button", { name: "zoom in" }).waitFor();

  await addStatementNode(page, {
    role: "DATA",
    xFraction: 0.3,
    yFraction: 0.6,
    title: "CO₂ levels at record highs",
    body: "Atmospheric CO₂ exceeded 420 ppm in 2023, the highest in 800,000 years.",
  });

  await addStatementNode(page, {
    role: "WARRANT",
    xFraction: 0.7,
    yFraction: 0.6,
    title: "CO₂ is a greenhouse gas",
    body: "Higher CO₂ concentrations trap infrared radiation, raising surface temperatures.",
  });
});
