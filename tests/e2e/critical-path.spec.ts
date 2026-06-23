import { test, expect, type Locator, type Page } from "@playwright/test";
import type { ReactFlowInstance } from "@xyflow/react";
import { ADVOCATE_USERNAME, CHALLENGER_USERNAME, DEMO_PASSWORD } from "./global-setup";

declare global {
  interface Window {
    /** The React Flow instance, exposed by MapEditor in dev for E2E viewport control. */
    __rfInstance?: ReactFlowInstance;
  }
}

/** Per-character delay for demo typing — kept as one constant so every field types at the same pace. */
const TYPE_DELAY = 30;

/** Demo-pacing pause (ms) after a node/edge action so a viewer can see it land. Not a sync wait. */
const DEMO_PAUSE = 500;

/**
 * Waits until the Astro island controlling `locator` has hydrated — WITHOUT
 * mutating the field. React's `hydrateRoot` attaches internal `__reactFiber$…`
 * / `__reactProps$…` properties to every DOM node it manages; the SSR'd HTML
 * has neither. Once they appear, React owns the input (its onChange is wired),
 * so an early fill won't be silently wiped. Without this guard the first field
 * typed into a form gets cleared the instant hydration commits — invisible at
 * slowMo:100 (the delay lets hydration finish first), but fatal at slowMo:0.
 * (Couples to a React internal naming detail; that's the price of not writing a
 * throwaway probe value.)
 */
async function waitForHydration(locator: Locator): Promise<void> {
  await expect
    .poll(() => locator.evaluate((el) => Object.keys(el).some((k) => k.startsWith("__react"))), { timeout: 15_000 })
    .toBe(true);
}

/** Clears the field and types `text` once. */
async function typeInto(locator: Locator, text: string) {
  await locator.clear();
  await locator.pressSequentially(text, { delay: TYPE_DELAY });
  await expect(locator).toHaveValue(text);
}

/** The debate the demo builds — its title is reused as a stable locator anchor. */
const DEBATE_TITLE = "Is human activity driving climate change?";

/**
 * Signs in through the UI as `<username>@example.com` with the shared demo
 * password and lands on /debates. Factored out because the demo signs two users
 * in (advocate, then challenger) over its course — each via the real sign-in
 * form, not a pre-baked session.
 */
async function signIn(page: Page, username: string) {
  await page.goto("/");
  await page.getByRole("link", { name: "Sign in" }).click();
  await page.waitForURL("**/auth/signin");

  const emailField = page.getByLabel("Email address");
  await waitForHydration(emailField);
  await typeInto(emailField, `${username}@example.com`);
  await typeInto(page.getByLabel("Password", { exact: true }), DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  await page.waitForURL("**/debates");
}

/** Signs out via the header button; the server redirects to the public landing
 *  page, so we confirm by waiting for its "Sign in" link to reappear. */
async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByRole("link", { name: "Sign in" }).waitFor();
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

/**
 * Blocks until the painted `.react-flow__viewport` transform matches `target`
 * (the viewport the RF instance computed). fitBounds/fitView update the store
 * synchronously, but the DOM transform only changes on the next React render +
 * paint — so reading geometry right after the call races that repaint and can
 * see the stale transform. Polling for the exact target removes the race with
 * no fixed sleep.
 */
async function waitForViewport(page: Page, target: { x: number; y: number; zoom: number }): Promise<void> {
  await expect
    .poll(
      async () => {
        const { tx, ty, zoom } = await page.locator(".react-flow__viewport").evaluate((el) => {
          const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
          return { tx: m.e, ty: m.f, zoom: m.a };
        });
        return Math.abs(tx - target.x) < 1 && Math.abs(ty - target.y) < 1 && Math.abs(zoom - target.zoom) < 0.01;
      },
      { timeout: 10_000 },
    )
    .toBe(true);
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
 *
 * The points are node *anchors* (top-left corners) and cards render down-right
 * from there, so the raw bbox would clip the bottom/right-most cards. We grow it
 * by roughly one card (NODE_W right, NODE_H down) plus a little MARGIN slack on
 * every side, so whole cards stay on-screen.
 */
const NODE_W = 300;
const NODE_H = 170;
const FRAME_MARGIN = 40;

async function frameView(page: Page, points: FlowPoint[], padding = 0.15): Promise<void> {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const bounds = {
    x: minX - FRAME_MARGIN,
    y: minY - FRAME_MARGIN,
    width: Math.max(...xs) - minX + NODE_W + 2 * FRAME_MARGIN,
    height: Math.max(...ys) - minY + NODE_H + 2 * FRAME_MARGIN,
  };
  await page.waitForFunction(() => window.__rfInstance !== undefined);
  const target = await page.evaluate(
    async ({ bounds, padding }) => {
      await window.__rfInstance?.fitBounds(bounds, { padding });
      const v = window.__rfInstance?.getViewport() ?? { x: 0, y: 0, zoom: 1 };
      return { x: v.x, y: v.y, zoom: v.zoom };
    },
    { bounds, padding },
  );
  await waitForViewport(page, target);
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
  await page.waitForTimeout(DEMO_PAUSE); // demo pacing only — let the new node register on screen
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
  await page.waitForTimeout(DEMO_PAUSE); // demo pacing only — let the new node register on screen
  await page.getByRole("button", { name: options.op }).click();
}

/** Fits every current node in view (real measured sizes, not just anchor points)
 *  via the exposed instance — so handles and full cards are reachable for drags. */
async function fitAllNodes(page: Page, padding = 0.2): Promise<void> {
  await page.waitForFunction(() => window.__rfInstance !== undefined);
  const target = await page.evaluate(async (p) => {
    await window.__rfInstance?.fitView({ padding: p });
    const v = window.__rfInstance?.getViewport() ?? { x: 0, y: 0, zoom: 1 };
    return { x: v.x, y: v.y, zoom: v.zoom };
  }, padding);
  await waitForViewport(page, target);
}

/** A statement node located by its (unique) title text. */
function statementNode(page: Page, title: string): Locator {
  return page.locator(".react-flow__node-statement", { hasText: title });
}

/** The sole connective node on the canvas. */
function connectiveNode(page: Page): Locator {
  return page.locator(".react-flow__node-connective");
}

/**
 * Marks an advocate statement with a stance from the challenger's seat. Each
 * statement card carries an inline mark bar (Accept / Challenge / Abstain); the
 * buttons are labelled by the stance word, so we match by role+name within the
 * node. The click POSTs to `…/marks` — we wait on that response so the assertion
 * rides the round-trip, not a fixed pause, then hold DEMO_PAUSE so a viewer sees
 * the stance land before the next mark.
 */
async function markStatement(page: Page, node: Locator, stance: "Accept" | "Challenge" | "Abstain") {
  const button = node.getByRole("button", { name: stance, exact: true });
  await button.scrollIntoViewIfNeeded();
  await Promise.all([
    page.waitForResponse((r) => r.url().includes("/marks") && r.request().method() === "POST" && r.ok()),
    button.click(),
  ]);
  await page.waitForTimeout(DEMO_PAUSE); // demo pacing only — let the stance tint settle
}

/**
 * Deletes a node via its right-click context menu (NodeContextMenu's "Delete").
 * Right-clicking the card opens the menu at the cursor; we click Delete and wait
 * for the node to leave the DOM. Used in the round phases where a party retracts
 * a statement from an earlier round — RLS allows deleting your own node on your
 * turn regardless of which round created it, and the relations→nodes FK cascade
 * removes its incident edges.
 */
async function deleteStatementNode(page: Page, node: Locator) {
  await node.scrollIntoViewIfNeeded();
  await node.click({ button: "right" });
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(node).toHaveCount(0);
  await page.waitForTimeout(DEMO_PAUSE); // demo pacing only — let the removal settle
}

/**
 * Draws a relation edge by dragging from `from`'s source handle (top of the
 * node) onto `to`, then picking `kind` in the popup. The drag is done with raw
 * mouse events and intermediate steps: React Flow only arms the target node's
 * full-area drop handle *while a connection is in progress*, so the pointer must
 * actually travel (down → move → move → up), not teleport. The kind popup
 * (`ConnectKindPicker`) opens at the drop point; its buttons are named by the
 * relation word, so we match it and confirm the picker closed.
 */
async function connect(
  page: Page,
  opts: { from: Locator; to: Locator; kind: "supports" | "rephrases" | "rebuts" | "link" },
) {
  const { from, to, kind } = opts;
  // A freshly created node is optimistic + `pending` until the server round-trip
  // swaps its temp id (store.ts): the source handle only mounts once `!pending`,
  // AND the id swap *remounts* the node (React re-keys on id), so a one-shot read
  // can catch the element mid-detach and return null. Poll both measurements until
  // they land stably — this rides out the pending→reconcile remount window.
  const sourceHandle = from.locator(".react-flow__handle.source");
  let sBox = await sourceHandle.boundingBox();
  let tBox = await to.boundingBox();
  await expect
    .poll(
      async () => {
        sBox = await sourceHandle.boundingBox();
        tBox = await to.boundingBox();
        return sBox !== null && tBox !== null;
      },
      { timeout: 10_000 },
    )
    .toBe(true);
  if (!sBox || !tBox) throw new Error("connect: source handle or target node is not visible");
  // The source handle sits centered on the node's top edge (translateY(-50%)),
  // so its *center* lands on the card border — occluded by the header. Grab its
  // protruding top edge instead (a couple px below the box top, still above the
  // card), where nothing covers it.
  const sx = sBox.x + sBox.width / 2;
  const sy = sBox.y + 2;
  const tx = tBox.x + tBox.width / 2;
  const ty = tBox.y + tBox.height / 2;

  // Drag with steps so the pointer actually travels — React Flow only arms the
  // target's full-area drop handle while a connection is in progress.
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(tx, ty, { steps: 15 });
  await page.mouse.up();

  await page.waitForTimeout(DEMO_PAUSE); // demo pacing only — let the kind picker settle before choosing
  await page.getByRole("button", { name: new RegExp(`^${kind}\\b`, "i") }).click();
  await expect(page.getByText("Choose relation kind")).toHaveCount(0);
}

test("advocate and challenger argue a debate through two rounds: build, invite, accept, rebut, respond, and rework", async ({
  page,
}) => {
  await signIn(page, ADVOCATE_USERNAME);

  await page.getByRole("link", { name: /New debate/ }).click();
  await page.waitForURL("**/debates/new");

  const debateTitleField = page.getByLabel("Debate title");
  await waitForHydration(debateTitleField);
  await typeInto(debateTitleField, DEBATE_TITLE);
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

  // Re-fit on the real (measured) nodes so every card + handle is fully on-screen,
  // then wire the advocate's support structure exactly as the seed does:
  //   data → and (link), warrant → and (link), and → root (supports),
  //   source → data (rephrases).
  await fitAllNodes(page);

  const root = statementNode(page, "Humans are causing climate change");
  const data = statementNode(page, "CO₂ levels at record highs");
  const warrant = statementNode(page, "CO₂ is a greenhouse gas");
  const source = statementNode(page, "NOAA Global Monitoring Laboratory");
  const and = connectiveNode(page);

  await connect(page, { from: data, to: and, kind: "link" });
  await connect(page, { from: warrant, to: and, kind: "link" });
  await connect(page, { from: and, to: root, kind: "supports" });
  await connect(page, { from: source, to: data, kind: "rephrases" });

  await expect(page.locator(".react-flow__edge")).toHaveCount(4);
  await expect(page.locator(".react-flow__node")).toHaveCount(5);

  // ── Advocate invites the challenger for 3 rounds ──────────────────────────
  // Open the invite panel, search the challenger by username, pick 2 rounds
  // (clicked explicitly so the demo shows the choice), and send. The search box
  // is debounced, so we wait for the result button to appear before clicking it.
  // Sending freezes the canvas and swaps the trigger for a pending status line.
  await page.getByRole("button", { name: "Invite challenger" }).click();
  await page.getByPlaceholder("Search users…").fill(CHALLENGER_USERNAME);
  await page.getByRole("button", { name: CHALLENGER_USERNAME, exact: true }).click();
  await page.getByRole("button", { name: "2", exact: true }).click();
  await page.getByRole("button", { name: "Send invite" }).click();
  await expect(page.getByText(`Invite sent to @${CHALLENGER_USERNAME} for 2 rounds — awaiting response`)).toBeVisible();

  // ── Hand over to the challenger ───────────────────────────────────────────
  await signOut(page);
  await signIn(page, CHALLENGER_USERNAME);

  // The pending invite shows in the "As challenger" section as a card carrying the
  // debate title. The challenger peeks at the advocate's graph first (RLS lets a
  // pending challenger read the debate), then returns to the inbox to respond.
  const inviteCard = page.getByRole("listitem").filter({ hasText: DEBATE_TITLE });
  await inviteCard.getByRole("link", { name: "View debate" }).click();

  await page.waitForURL(/\/debates\/[0-9a-f-]+$/);
  await expect(statementNode(page, "Humans are causing climate change")).toBeVisible();
  await expect(page.locator(".react-flow__node")).toHaveCount(5);

  // Demo pacing only: frame the whole argument and hold ~3s so a viewer can read
  // the advocate's graph before the challenger heads back to respond.
  await fitAllNodes(page);
  await page.waitForTimeout(3000);

  // Back to the inbox and accept — the card flips from a pending invite (View +
  // Accept/Decline) to an accepted one with an "Enter debate" link.
  await page.getByRole("link", { name: "My debates" }).click();
  await page.waitForURL("**/debates");

  await inviteCard.getByRole("button", { name: "Accept" }).click();
  const enterDebate = inviteCard.getByRole("link", { name: "Enter debate" });
  await expect(enterDebate).toBeVisible();

  // Go into the now-accepted debate.
  await enterDebate.click();
  await page.waitForURL(/\/debates\/[0-9a-f-]+$/);
  await expect(statementNode(page, "Humans are causing climate change")).toBeVisible();

  // ── Challenger marks the advocate's statements (round 1) ──────────────────
  // It's the challenger's turn, so every advocate statement shows an inline
  // Accept/Challenge/Abstain bar. The skeptic challenges the root claim and the
  // warrant (the inferential leap), but accepts the raw data and its source.
  // Fit the whole graph first so every card + its mark bar is on-screen.
  await fitAllNodes(page);

  await markStatement(page, statementNode(page, "Humans are causing climate change"), "Challenge");
  await markStatement(page, statementNode(page, "CO₂ is a greenhouse gas"), "Challenge");
  await markStatement(page, statementNode(page, "CO₂ levels at record highs"), "Accept");
  await markStatement(page, statementNode(page, "NOAA Global Monitoring Laboratory"), "Accept");

  // ── Challenger builds a counter-structure (round 1) ───────────────────────
  // Having challenged the root claim and the warrant, the skeptic now plants one
  // rebuttal against each, plus a source that rephrases the warrant rebuttal —
  // the cited paper IS the thermodynamics argument, so "rephrases" reads true and
  // mirrors the advocate's own source→data move. Placed to the right of the
  // advocate's structure (same coordinate frame: root at origin). Frame the new
  // spots plus the two rebut targets so every click/drag lands on-screen.
  // In the round phases each node is wired right after it's created (unlike the
  // pre-exchange build, which adds every node first): frame once over the new
  // column plus the two rebut targets, then add→connect each in turn.
  const naturalCyclesPos: FlowPoint = { x: 517, y: 100 };
  const thermoPos: FlowPoint = { x: 517, y: 450 };
  const challengerSourcePos: FlowPoint = { x: 520, y: 700 };
  await frameView(page, [rootPos, warrantPos, naturalCyclesPos, thermoPos, challengerSourcePos]);

  const rootClaim = statementNode(page, "Humans are causing climate change");
  const warrantClaim = statementNode(page, "CO₂ is a greenhouse gas");

  await addStatementNode(page, {
    role: "REBUTTAL",
    flow: naturalCyclesPos,
    title: "Natural cycles argument",
    body: "Climate shifted dramatically before humans existed — glacial cycles and the medieval warm period were driven by orbital and solar variation, so warming need not be anthropogenic.",
  });
  const naturalCycles = statementNode(page, "Natural cycles argument");
  await connect(page, { from: naturalCycles, to: rootClaim, kind: "rebuts" });

  await addStatementNode(page, {
    role: "REBUTTAL",
    flow: thermoPos,
    title: "Greenhouse effect breaks thermodynamics",
    body: "A cooler atmosphere cannot transfer net heat to the warmer surface, so CO₂ back-radiation cannot raise surface temperature without violating the Second Law of Thermodynamics.",
  });
  const thermo = statementNode(page, "Greenhouse effect breaks thermodynamics");
  await connect(page, { from: thermo, to: warrantClaim, kind: "rebuts" });

  await addStatementNode(page, {
    role: "SOURCE",
    flow: challengerSourcePos,
    title: "Gerlich & Tscheuschner (2009)",
    url: "https://arxiv.org/abs/0707.1161",
  });
  const challengerSource = statementNode(page, "Gerlich & Tscheuschner (2009)");
  await connect(page, { from: challengerSource, to: thermo, kind: "rephrases" });

  await expect(page.locator(".react-flow__node")).toHaveCount(8);
  await expect(page.locator(".react-flow__edge")).toHaveCount(7);

  // ── Challenger submits round 1 ─────────────────────────────────────────────
  // All four counterpart statements are marked and the counter-structure is fully
  // connected, so the turn gate opens "Submit turn". Submitting flips the turn to
  // the advocate (2-round exchange, still round 1). Wait on the submit-turn
  // response, then confirm the bar flipped to the advocate's seat.
  const submitTurn = page.getByRole("button", { name: /^Submit turn/ });
  await expect(submitTurn).toBeEnabled();
  await Promise.all([
    page.waitForResponse((r) => r.url().includes("/submit-turn") && r.request().method() === "POST" && r.ok()),
    submitTurn.click(),
  ]);
  await expect(page.getByText("Advocate's turn")).toBeVisible();

  // ── Hand back to the advocate, who reviews the challenger's round ──────────
  await signOut(page);
  await signIn(page, ADVOCATE_USERNAME);

  // The advocate opens their own debate from the "As advocate" list and now sees
  // the full graph — their support structure plus the challenger's submitted
  // rebuttals — with the turn now theirs.
  const advocateCard = page.getByRole("listitem").filter({ hasText: DEBATE_TITLE });
  await advocateCard.getByRole("link", { name: "Open debate" }).click();
  await page.waitForURL(/\/debates\/[0-9a-f-]+$/);

  await expect(statementNode(page, "Natural cycles argument")).toBeVisible();
  await expect(page.locator(".react-flow__node")).toHaveCount(8);
  await expect(page.getByText("My Turn")).toBeVisible();

  // ── Advocate marks the challenger's statements (round 1 response) ──────────
  // It's the advocate's turn, so the challenger's three statements now carry the
  // mark bar. The advocate challenges all of them. Fit the whole graph first so
  // every card + mark bar is on-screen.
  await fitAllNodes(page);

  await markStatement(page, naturalCycles, "Challenge");
  await markStatement(page, thermo, "Challenge");
  await markStatement(page, challengerSource, "Challenge");

  // ── Advocate builds a counter-rebuttal structure (round 1 response) ────────
  // One rebuttal against each of the challenger's rebuttals, plus a source that
  // rephrases the thermodynamics rebuttal — Halpern et al. (2010) is the
  // peer-reviewed refutation of Gerlich & Tscheuschner, so it both backs the
  // advocate's rebuttal and undercuts the challenger's source in one move. Placed
  // to the right of the challenger's column (same root-at-origin frame).
  // Same round pattern: frame once over the new column plus the two rebut
  // targets, then add→connect each node as it's created.
  const fastWarmingPos: FlowPoint = { x: 950, y: 100 };
  const secondLawPos: FlowPoint = { x: 950, y: 450 };
  const halpernPos: FlowPoint = { x: 1000, y: 700 };
  await frameView(page, [naturalCyclesPos, thermoPos, fastWarmingPos, secondLawPos, halpernPos]);

  await addStatementNode(page, {
    role: "REBUTTAL",
    flow: fastWarmingPos,
    title: "Current warming is too fast for natural cycles",
    body: "Orbital (Milankovitch) cycles act over tens of thousands of years; ~1.1 °C in 150 years is orders of magnitude faster, and solar output has been flat since 1980 — natural forcing cannot produce this.",
  });
  const fastWarming = statementNode(page, "Current warming is too fast for natural cycles");
  await connect(page, { from: fastWarming, to: naturalCycles, kind: "rebuts" });

  await addStatementNode(page, {
    role: "REBUTTAL",
    flow: secondLawPos,
    title: "Second Law governs net heat flow",
    body: "The Second Law forbids only net cold-to-hot transfer. Greenhouse gases slow the surface's heat loss to space, raising its equilibrium temperature; net flow stays surface→space, so nothing is violated.",
  });
  const secondLaw = statementNode(page, "Second Law governs net heat flow");
  await connect(page, { from: secondLaw, to: thermo, kind: "rebuts" });

  await addStatementNode(page, {
    role: "SOURCE",
    flow: halpernPos,
    title: "Halpern et al. (2010)",
    url: "https://doi.org/10.1142/S021797921005555X",
  });
  const halpern = statementNode(page, "Halpern et al. (2010)");
  await connect(page, { from: halpern, to: secondLaw, kind: "rephrases" });

  await expect(page.locator(".react-flow__node")).toHaveCount(11);
  await expect(page.locator(".react-flow__edge")).toHaveCount(10);

  // ── Advocate submits round 1 ───────────────────────────────────────────────
  // All three challenger statements are marked and the response is connected, so
  // the gate opens. A non-final-round submit advances the round: the turn flips
  // back to the challenger and the round ticks to 2.
  const advocateSubmit = page.getByRole("button", { name: /^Submit turn/ });
  await expect(advocateSubmit).toBeEnabled();
  await Promise.all([
    page.waitForResponse((r) => r.url().includes("/submit-turn") && r.request().method() === "POST" && r.ok()),
    advocateSubmit.click(),
  ]);
  await expect(page.getByText("Challenger's turn")).toBeVisible();

  // ── Hand to the challenger for round 2 ─────────────────────────────────────
  await signOut(page);
  await signIn(page, CHALLENGER_USERNAME);

  const round2Card = page.getByRole("listitem").filter({ hasText: DEBATE_TITLE });
  await round2Card.getByRole("link", { name: "Enter debate" }).click();
  await page.waitForURL(/\/debates\/[0-9a-f-]+$/);
  await expect(statementNode(page, "Humans are causing climate change")).toBeVisible();
  await expect(page.locator(".react-flow__node")).toHaveCount(11);
  await expect(page.getByText("My Turn")).toBeVisible();

  // ── Challenger reworks the warrant attack (round 2) ────────────────────────
  // The thermodynamics rebuttal was refuted (Halpern), so the skeptic retracts it
  // and its source — conceding that branch — and rebuilds the warrant attack on
  // firmer ground: CO₂ forcing is logarithmic/saturated (grant the physics,
  // dispute the magnitude). He also opens a new front against the advocate's
  // "too fast for natural cycles" rebuttal.
  await fitAllNodes(page);

  await deleteStatementNode(page, statementNode(page, "Gerlich & Tscheuschner (2009)"));
  await deleteStatementNode(page, statementNode(page, "Greenhouse effect breaks thermodynamics"));
  await expect(page.locator(".react-flow__node")).toHaveCount(9);

  // New counter-nodes, wired as they're created (round pattern). Reuse the freed
  // slot below the warrant for the new warrant rebuttal; open a fresh column to
  // the right for the natural-cycles counter.
  const logSaturationPos: FlowPoint = { x: 517, y: 450 };
  const abruptShiftsPos: FlowPoint = { x: 1380, y: 100 };
  await frameView(page, [warrantPos, fastWarmingPos, logSaturationPos, abruptShiftsPos]);

  const warrantTarget = statementNode(page, "CO₂ is a greenhouse gas");
  const fastWarmingTarget = statementNode(page, "Current warming is too fast for natural cycles");

  await addStatementNode(page, {
    role: "REBUTTAL",
    flow: logSaturationPos,
    title: "CO₂ forcing is logarithmic and largely saturated",
    body: "CO₂'s main absorption bands are already near-saturated, so radiative forcing rises only with the logarithm of concentration — doubling CO₂ yields ~1 °C directly. Larger warming hinges on uncertain positive feedbacks, so CO₂ is at most a weak driver.",
  });
  const logSaturation = statementNode(page, "CO₂ forcing is logarithmic and largely saturated");
  await connect(page, { from: logSaturation, to: warrantTarget, kind: "rebuts" });

  await addStatementNode(page, {
    role: "REBUTTAL",
    flow: abruptShiftsPos,
    title: "Abrupt natural shifts have happened before",
    body: "Dansgaard–Oeschger events and the Younger Dryas saw multi-°C regional swings within decades, so a fast rate of change is not a unique fingerprint of human causation.",
  });
  const abruptShifts = statementNode(page, "Abrupt natural shifts have happened before");
  await connect(page, { from: abruptShifts, to: fastWarmingTarget, kind: "rebuts" });

  await expect(page.locator(".react-flow__node")).toHaveCount(11);
  await expect(page.locator(".react-flow__edge")).toHaveCount(9);

  // ── Challenger marks the advocate's round-1 response ───────────────────────
  // Challenge the natural-cycles rebuttal he's now attacking; abstain on the two
  // thermodynamics-branch nodes, conceding that line (the rebuttal they answered
  // is gone). Re-fit so every mark bar is reachable.
  await fitAllNodes(page);

  await markStatement(page, fastWarmingTarget, "Challenge");
  await markStatement(page, statementNode(page, "Second Law governs net heat flow"), "Abstain");
  await markStatement(page, statementNode(page, "Halpern et al. (2010)"), "Abstain");

  // ── Hand back to the advocate ──────────────────────────────────────────────
  await signOut(page);
  await signIn(page, ADVOCATE_USERNAME);
});
