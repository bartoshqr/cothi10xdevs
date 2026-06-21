import { test, expect, type Locator, type Page } from "@playwright/test";
import { ADVOCATE_USERNAME, DEMO_PASSWORD } from "./global-setup";

/** Per-character delay for demo typing — kept as one constant so every field types at the same pace. */
const TYPE_DELAY = 30;

/** Clears the field and types `text` once. */
async function typeInto(locator: Locator, text: string) {
  await locator.clear();
  await locator.pressSequentially(text, { delay: TYPE_DELAY });
  await expect(locator).toHaveValue(text);
}

/** A point in flow space — the canvas's own coordinate system. The root claim
 *  is created at the origin {0,0}, so these are effectively root-relative. */
interface FlowPoint {
  x: number;
  y: number;
}

/** The pane's on-screen box plus React Flow's live viewport transform. */
interface Viewport {
  box: { x: number; y: number; width: number; height: number };
  zoom: number;
  tx: number;
  ty: number;
}

/**
 * Reads the pane's screen box and React Flow's viewport transform. React Flow
 * pans/zooms by putting a single CSS `transform: matrix(zoom,0,0,zoom,tx,ty)`
 * on `.react-flow__viewport`; reading it lets us convert flow-space coordinates
 * to screen pixels ourselves — no app hooks, no `useReactFlow` access needed.
 */
async function readViewport(page: Page): Promise<Viewport> {
  const box = await page.locator(".react-flow__pane").boundingBox();
  if (!box) throw new Error("canvas pane is not visible");
  const { zoom, tx, ty } = await page.locator(".react-flow__viewport").evaluate((el) => {
    const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
    return { zoom: m.a, tx: m.e, ty: m.f };
  });
  return { box, zoom, tx, ty };
}

/** Projects a flow-space point to an absolute screen pixel via the live transform. */
function flowToScreen(vp: Viewport, flow: FlowPoint): { x: number; y: number } {
  return { x: vp.box.x + vp.tx + flow.x * vp.zoom, y: vp.box.y + vp.ty + flow.y * vp.zoom };
}

/** True when a screen point sits at least `margin` px inside every pane edge. */
function insidePane(vp: Viewport, p: { x: number; y: number }, margin = 60): boolean {
  const { box } = vp;
  return (
    p.x >= box.x + margin &&
    p.x <= box.x + box.width - margin &&
    p.y >= box.y + margin &&
    p.y <= box.y + box.height - margin
  );
}

/**
 * `fitView` zooms hard onto the lone root node at mount (capped at maxZoom), so
 * flow points even modestly away from the origin project *off* the pane. Click
 * the canvas "zoom out" control until every planned flow point lands inside the
 * pane — giving us room to place nodes at exact, root-relative coordinates
 * without the click target ever falling outside the canvas.
 */
async function makeRoomFor(page: Page, points: FlowPoint[]): Promise<void> {
  const zoomOut = page.getByRole("button", { name: "zoom out" });
  for (let i = 0; i < 8; i++) {
    const vp = await readViewport(page);
    if (points.every((f) => insidePane(vp, flowToScreen(vp, f)))) return;
    await zoomOut.click();
  }
  throw new Error("could not zoom out enough to fit every node position on the pane");
}

/**
 * Right-clicks the pane at a chosen *flow-space* coordinate (converted to a
 * screen pixel via the current viewport transform) and adds a statement node
 * there. The new node is created at exactly this flow point — React Flow's
 * AddNodeMenu calls `screenToFlowPosition` on the same click — so callers get
 * deterministic, hand-placed layout. Asserts the point is on-screen first so a
 * mis-chosen coordinate fails loudly instead of hanging on an unreachable click.
 */
async function addStatementNode(
  page: Page,
  options: {
    role: "CLAIM" | "SOURCE" | "DATA" | "WARRANT" | "BACKING" | "REBUTTAL";
    /** Where to place the node, in flow space (root claim is at {0,0}). */
    flow: FlowPoint;
    title: string;
    body: string;
  },
) {
  const { role, flow, title, body } = options;
  const vp = await readViewport(page);
  const screen = flowToScreen(vp, flow);
  if (!insidePane(vp, screen)) {
    throw new Error(`flow point (${flow.x}, ${flow.y}) projects outside the pane — call makeRoomFor first`);
  }
  // page.mouse fires at absolute coords with no descendant hit-test, so the
  // right-click lands on the pane background (the "add node" trigger) rather
  // than being swallowed by a node the way pane.click({position}) can be.
  await page.mouse.click(screen.x, screen.y, { button: "right" });
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
  await typeInto(emailField, `${ADVOCATE_USERNAME}@example.com`);
  await typeInto(page.getByLabel("Password", { exact: true }), DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  await page.waitForURL("**/debates");

  await page.getByRole("link", { name: /New debate/ }).click();
  await page.waitForURL("**/debates/new");

  const debateTitleField = page.getByLabel("Debate title");
  await typeInto(debateTitleField, "Is human activity driving climate change?");
  await typeInto(page.getByLabel("Root claim", { exact: true }), "Humans are causing climate change");
  await typeInto(
    page.getByLabel(/Root claim details/),
    "The scientific consensus is clear: anthropogenic emissions are driving global temperature rise.",
  );
  await page.getByRole("button", { name: "Create debate" }).click();

  await page.waitForURL(/\/debates\/[0-9a-f-]+$/);
  await page.getByRole("button", { name: "zoom in" }).waitFor();

  // Hand-placed layout: two supporting statements flanking the root claim,
  // symmetric and below it. Zoom out first so both coordinates are reachable.
  const dataPos: FlowPoint = { x: -300, y: 260 };
  const warrantPos: FlowPoint = { x: 300, y: 260 };
  await makeRoomFor(page, [dataPos, warrantPos]);

  await addStatementNode(page, {
    role: "DATA",
    flow: dataPos,
    title: "CO₂ levels at record highs",
    body: "Atmospheric CO₂ exceeded 420 ppm in 2023, the highest in 800,000 years.",
  });

  await addStatementNode(page, {
    role: "WARRANT",
    flow: warrantPos,
    title: "CO₂ is a greenhouse gas",
    body: "Higher CO₂ concentrations trap infrared radiation, raising surface temperatures.",
  });
});
