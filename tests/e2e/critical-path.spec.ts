import { test, expect, type Locator, type Page } from "@playwright/test";
import type { ReactFlowInstance } from "@xyflow/react";
import { ADVOCATE_USERNAME, DEMO_PASSWORD } from "./global-setup";

declare global {
  interface Window {
    /** The React Flow instance, exposed by MapEditor in dev for E2E viewport control. */
    __rfInstance?: ReactFlowInstance;
  }
}

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
 * (xyflow's own suite parses the inline `style.transform` string with a regex;
 * `DOMMatrixReadOnly` is sturdier here — it handles signs and either transform
 * form natively, with no parsing to get wrong.)
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
function insidePane(vp: Viewport, p: { x: number; y: number }, margin = 50): boolean {
  const { box } = vp;
  return (
    p.x >= box.x + margin &&
    p.x <= box.x + box.width - margin &&
    p.y >= box.y + margin &&
    p.y <= box.y + box.height - margin
  );
}

/**
 * Frames the viewport on a chosen set of flow-space points — centered, zoomed to
 * fit, with uniform `padding` (a fraction of the pane left as margin on every
 * side). Drives React Flow's own `fitBounds` through the instance the app
 * exposes on `window` in dev, so centering and zoom are exact (the Controls
 * buttons can't pan or hit a precise zoom). Because the caller passes only the
 * points it cares about, this also serves the "move to a selected subset"
 * case — it frames exactly that bounding box, not the whole graph. (To frame
 * existing *nodes* by id instead, `window.__rfInstance.fitView({ nodes })`.)
 */
async function frameView(page: Page, points: FlowPoint[], padding = 0.25): Promise<void> {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const bounds = {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
  await page.waitForFunction(() => window.__rfInstance !== undefined);
  await page.evaluate(({ bounds, padding }) => window.__rfInstance?.fitBounds(bounds, { padding }), {
    bounds,
    padding,
  });
}

/**
 * Right-clicks the pane at a chosen *flow-space* coordinate (converted to a
 * screen pixel via the current viewport transform) and adds a statement node
 * there. The new node is created at exactly this flow point — React Flow's
 * AddNodeMenu calls `screenToFlowPosition` on the same click — so callers get
 * deterministic, hand-placed layout. Asserts the point is on-screen first so a
 * mis-chosen coordinate fails loudly instead of hanging on an unreachable click.
 */
/**
 * Right-clicks the pane at `flow` (projected to a screen pixel) and opens the
 * add-node menu there — the shared first half of every placement. Returns the
 * screen point clicked. Asserts the point is on-screen first so a mis-chosen
 * coordinate fails loudly instead of hanging on an unreachable click.
 */
async function openAddMenuAt(page: Page, flow: FlowPoint): Promise<void> {
  const vp = await readViewport(page);
  const screen = flowToScreen(vp, flow);
  if (!insidePane(vp, screen)) {
    throw new Error(`flow point (${flow.x}, ${flow.y}) projects outside the pane — call frameView first`);
  }
  // page.mouse fires at absolute coords with no descendant hit-test, so the
  // right-click lands on the pane background (the "add node" trigger) rather
  // than being swallowed by a node the way pane.click({position}) can be.
  await page.mouse.click(screen.x, screen.y, { button: "right" });
}

/**
 * Adds a statement node at an exact flow coordinate. The new node is created at
 * exactly this point — React Flow's AddNodeMenu calls `screenToFlowPosition` on
 * the same click — so callers get deterministic, hand-placed layout. A SOURCE
 * node takes a `url` (its edit form swaps the body for a required URL field) and
 * its body is optional; other roles take a `body`.
 */
async function addStatementNode(
  page: Page,
  options: {
    role: "CLAIM" | "SOURCE" | "DATA" | "WARRANT" | "BACKING" | "REBUTTAL";
    /** Where to place the node, in flow space (root claim is at {0,0}). */
    flow: FlowPoint;
    title: string;
    body?: string;
    /** Required for SOURCE nodes; ignored otherwise. */
    url?: string;
  },
) {
  const { role, flow, title, body, url } = options;
  await openAddMenuAt(page, flow);
  await page.getByRole("button", { name: role }).click();

  // The node opens in edit mode: title (textarea), an optional URL <input> for
  // sources, then body (textarea). Fill what's given and commit with Ctrl+Enter
  // from the last field touched (its keydown handler exits edit mode).
  let lastField = page.locator("textarea").nth(0);
  await typeInto(lastField, title);
  if (url !== undefined) {
    lastField = page.getByPlaceholder("https://... (required)");
    await typeInto(lastField, url);
  }
  if (body !== undefined) {
    lastField = page.locator("textarea").nth(1);
    await typeInto(lastField, body);
  }
  await lastField.press("Control+Enter");
}

/**
 * Adds an AND/OR connective at an exact flow coordinate. Connectives have no
 * content, so this just opens the menu and clicks the operator — the node is
 * placed immediately, no edit step.
 */
async function addConnectiveNode(page: Page, options: { op: "AND" | "OR"; flow: FlowPoint }) {
  await openAddMenuAt(page, options.flow);
  await page.getByRole("button", { name: options.op }).click();
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

  // Hand-placed layout taken from the seed's advocate structure (supabase/seed.sql),
  // translated by (-183, +75) so the root claim sits at the origin: data + warrant
  // flank below it, a source under the data, and an AND connective gathers them.
  // Frame the view on all five spots first, so every click target is centered and
  // on-screen.
  const rootPos: FlowPoint = { x: 0, y: 0 };
  const dataPos: FlowPoint = { x: -148, y: 343 };
  const warrantPos: FlowPoint = { x: 178, y: 336 };
  const sourcePos: FlowPoint = { x: -148, y: 516 };
  const andPos: FlowPoint = { x: 117, y: 225 };
  await frameView(page, [rootPos, dataPos, warrantPos, sourcePos, andPos]);

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

  await addStatementNode(page, {
    role: "SOURCE",
    flow: sourcePos,
    title: "NOAA Global Monitoring Laboratory",
    url: "https://gml.noaa.gov/ccgg/trends/",
  });

  await addConnectiveNode(page, { op: "AND", flow: andPos });
});
