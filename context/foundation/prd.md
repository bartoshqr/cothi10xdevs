---
project: "WVMap"
version: 1
status: draft
created: 2026-05-20
context_type: greenfield
product_type: web-app
target_scale:
  users: small
  qps: low
  data_volume: small
timeline_budget:
  mvp_weeks: 8
  hard_deadline: null
  after_hours_only: true
---

## Vision & Problem Statement

Worldview debates on social media — YouTube comments, Facebook threads, Twitter arguments — are chaotic and pointless. People argue past each other because free-form comment formats make it impossible to isolate *what* they actually disagree on. An advocate spends effort constructing a careful argument only to have it met with recycled bad-faith objections that never engage the actual reasoning. There is no way to distinguish a genuine point of divergence from deliberate deflection.

The product insight is three-layered: (1) free-form argument actively hides whether the crux of a disagreement is factual (different data) or values-based (different premises) — a structured map forces that distinction to surface; (2) advocates are the high-motivation minority that existing debate tools ignore — they will invest time because it serves their mission; (3) social platforms profit from ongoing conflict, not resolution — a purpose-built tool can escape that incentive structure entirely.

## User & Persona

**The Advocate** — someone who actively pushes a cause (climate, animal rights, pro-life/pro-choice, religious apologetics) and is frustrated that opponents "don't understand" their reasoning.

They are willing to invest time structuring their case (it serves their mission), motivated to convince rather than just win, and already sharing arguments online — just doing it badly. A tool that makes their reasoning auditable and harder to dismiss is directly aligned with their goal.

Role model from the launch community: Marcin Popkiewicz — rigorous, frustrated by recycled objections, wants opponents to engage with actual reasoning. The launch community is Polish climate advocates (Ziemia na rozdrożu, Popkiewicz's followers) — active online, data-rich debates, recurring bad-faith objections.

### Secondary persona

**The Challenger** — the skeptic or opponent who is invited to audit the advocate's map node by node. They are lower-motivation and must be pulled in via a link from the advocate. Challengers must create an account to participate (attributed, persistent identity).

## Success Criteria

### Primary
An advocate builds a structured Toulmin map (Claim → Data → Warrant hierarchy), sets the number of exchange rounds (1–5), invites a challenger by username, the challenger audits nodes (Accept/Challenge/Abstain) and adds rebuttal or contradicting-statement nodes, the advocate responds to the challenger's nodes (up to N rounds), and either party can trigger the divergence summary showing common ground (mutually Accepted Statements), open divergences (Challenged), and unresolved positions (Abstained).

### Secondary
An advocate uses the exchange summary to end an online argument — they link the completed exchange map (optionally including any linked child debates) instead of writing a new comment in response to an objection. This is a behavior-change signal, not a vanity metric. (Note: externalizing the map outside the private pair depends on a sharing mechanic that is itself an Open Question — see below.)

### Guardrails
- **Map data integrity**: nodes, links, and marks are never silently corrupted or lost. An advocate's reasoning map is their intellectual property — data loss destroys trust and makes the tool unusable for its purpose.
- **Neither party can edit or delete the other's Statements**: each party can add, edit, or delete only their own Statements during their active turn. If a party edits or deletes a Statement the other party has already marked, that mark is invalidated; the other party must re-mark it (for edits) or accept the auto-clear (for deletions) in their next turn.

## User Stories

### US-01: Advocate builds and submits a structured argument

- **Given** a logged-in advocate who has created a debate
- **When** they add Statements (Claim, Source, Data, Warrant, Backing, Rebuttal) and AND/OR connective nodes, link them into a hierarchy, and add Source nodes grounding their Data
- **Then** they can invite a challenger and the exchange begins

#### Acceptance Criteria
- The advocate cannot initiate an exchange until at least one root Claim Statement exists in the map (FR-007)

### US-02: Challenger audits the argument and adds counter-statements

- **Given** a logged-in challenger who has accepted an invite
- **When** they review the advocate's map and mark Statements as Accept, Challenge, or Abstain, and add their own Statements (with relations and sources)
- **Then** the advocate's turn becomes active and the exchange view reflects this via UI state

#### Acceptance Criteria
- Neither party can edit or delete the other's Statements — each party can only add, edit, or delete their own (FR-026)
- All challenger Statements are visible only to the advocate/challenger pair (FR-021)
- Relations between challenger Statements and advocate Statements are directional and explicit (FR-014)
- The challenger must mark every advocate Statement that is currently unmarked (newly added by the advocate) or whose prior mark was invalidated by an advocate edit, as Accept, Challenge, or Abstain before the challenger's turn can be submitted (FR-011)

### US-03: Debate closes and summary is generated

- **Given** an exchange where at least one round has completed
- **When** either party triggers the divergence summary
- **Then** both parties see: common ground (mutually Accepted Statements), open divergences (Challenged), and unresolved positions (Abstained)

#### Acceptance Criteria
- Summary is generated deterministically from the Accept/Challenge/Abstain marks on the graph (FR-020)
- Summary is accessible as a read-only view to both the advocate and the challenger (private to the pair — not publicly shareable in MVP)
- Summary can optionally include linked child debates (FR-020)
- Summary is unavailable before the first complete round, even if the exchange closed via the 7-day inactivity path (FR-018)

### US-04: Multi-round exchange with mark invalidation

- **Given** an exchange in round 2 or later where a party has edited or deleted a Statement the other party marked in a prior round
- **When** the other party's turn begins
- **Then** for edits, the exchange view highlights the edited Statement, the prior mark on it is cleared, and the party must re-evaluate every cleared mark on a still-existing Statement before they can add new Statements or submit their turn; for deletions, the Statement and its relations are gone from the exchange and the invalidated marks tied to it are auto-cleared without re-evaluation, and any preserved statements that no longer connect to the root claim in any way (even indirectly) become orphaned and are explicitly highlighted as orphaned in the view.

#### Acceptance Criteria
- A Statement edited after the other party marked it has its mark cleared automatically at the start of the next turn
- A Statement deleted after the other party marked it is removed from the exchange (along with its relations), and the invalidated mark is auto-cleared without re-evaluation
- Statements owned by the other party that lose their connection to the root claim (directly or indirectly) due to a deletion are preserved, their prior marks are auto-cleared, and the exchange view explicitly highlights them as orphaned
- The exchange view visually distinguishes Statements with cleared marks from unmarked (new) Statements that were never marked
- The party must re-evaluate every invalidated mark on a still-existing Statement before adding new Statements or submitting their turn — re-evaluation is enforced, not merely prompted
- If the advocate's final-round turn produces invalidated marks (via edits) or unmarked advocate Statements (via new adds), a mini turn opens for the challenger to re-evaluate and mark only (FR-019); on mini-turn submission the exchange closes, and on 7-day mini-turn inactivity the advocate may close with any still-invalidated marks AND any still-unmarked advocate Statements defaulting to Abstain

## Functional Requirements

### Authentication
- FR-001: User can register with email + password or OAuth, providing a unique username during registration. Priority: must-have
  > Socrates: No counter-argument; authentication is a prerequisite for persistent identity and exchange attribution. The username field is added to support FR-009's username-based invite search. Stands as written.
- FR-002: User can log in and log out. Priority: must-have
  > Socrates: No counter-argument. Stands as written.

### Map Building
- FR-003: Advocate can create a new debate with a title and designates one Statement as the root Claim (the main claim of the debate). Priority: must-have
  > Socrates: No counter-argument; the debate + root claim is the entry point for everything else. Stands as written.
- FR-004: Advocate can add Statements to their map, each tagged with a type (Claim / Source / Data / Warrant / Backing / Rebuttal). A Source is a first-class Statement node (not a sidebar attachment) whose cited reliability is itself contestable by the challenger. Priority: must-have
  > Socrates: Type tags are load-bearing — they let the divergence summary distinguish factual gaps (contested Data / Source / Backing) from logical gaps (contested Warrant / Claim) and trigger AI Warrant suggestion in Phase 2. The map-visual-spike (F-02) added Source as a sixth type after showing that a citation the challenger can Accept/Challenge/Abstain on must be a node, not a footnote.
- FR-004a: Advocate can add logical-connective nodes (AND / OR) that aggregate multiple supporting Statements before they support a Claim — AND requires all operands, OR requires any one. Connectives are a second node category, not a statement type. Priority: must-have
  > Socrates: Added after the map-visual-spike (F-02). Without an aggregator, a claim backed by the conjunction of Data + Warrant AND an independent observation collapses into a flat list of `supports` edges, losing the logical structure the divergence summary depends on. Operands feed a connective via `link` (FR-006); the connective's single output `supports` the claim.
  > Implementation note (2026-06-06): "AND requires all operands / OR requires any one" is an **aggregation/evaluation** semantic, not a creation-time structural constraint. Because map edits save instantly per node (NFR <200 ms), a connective is created before its operands are linked — so an operand-count rule cannot and must not be enforced at node creation. Any cardinality validation is evaluated at exchange-initiation / round boundaries, not at the persistence layer.
- FR-005: A Source is represented as its own Statement node carrying the cited reference (URL or citation) directly on the statement, linked to the Statement it grounds via a `rephrases` relation. There is no separate sources sub-entity. Priority: must-have
  > Socrates: Reworked after the map-visual-spike (F-02). A source as a contestable node (the challenger can mark its reliability Accept/Challenge/Abstain) beats a sidebar attachment, and the reference lives on the source statement row itself — a separate sources table would only duplicate that row. (URL validation and broken-link handling remain Open Questions — see below.)
- FR-006: Advocate can create directed relations between Statements: `supports` (a Statement or connective backs a Claim), `link` (an operand feeds a connective node, per FR-004a), `rephrases` (a Statement restates another — e.g. a Source rephrasing the Data it grounds), and `rebuts` (a Rebuttal attacks a Claim/Warrant). Priority: must-have
  > Socrates: Relation kinds revised after the map-visual-spike (F-02). `bridges` was conceived for a model without connective nodes; the Warrant node now plays the bridging role, so `bridges` is dropped. `link` is required to feed the new AND/OR connectives (FR-004a), and `rephrases` makes the Source→Data relationship explicit and contestable on the canvas.
  > Implementation note (2026-06-06): the role parentheticals above ("`supports` backs a Claim", "`rebuts` a Rebuttal attacks a Claim/Warrant", etc.) describe **typical intent, not enforced structural constraints** — consistent with FR-014 / FR-016, which let either party relate their Statements to **any existing Statement**. The single enforced structural rule in MVP: **a `link` relation must target a connective node** (its source may be any node, including a connective). `supports` / `rephrases` / `rebuts` may connect **any node → any node**. (Self-relations are disallowed at the DB.)
- FR-007: Advocate can initiate an exchange once at least one root Claim Statement exists in the map. A root Claim Statement is one explicitly designated as the root by the advocate at the time of debate creation; it is the top-level claim the exchange is about. Priority: must-have
  > Socrates: Counter-argument considered: "removing the commit gate lets advocates invite challengers with a thin, half-formed map." Resolution: commit mechanic removed — all statements are effective on add. The round-turn model is the integrity guarantee: once a turn is submitted, statements are locked until the next turn. The root Claim requirement ensures the exchange has a defined subject.
  > Implementation note (2026-06-06): root-Claim lifecycle (the designated root is created as a `claim` and must stay one). **(a)** The root Claim cannot be deleted — the UI blocks it ("You cannot delete the root claim, but you can set a different claim as the root") and the DB foreign key is the backstop. **(b)** The root can be **re-designated**: choosing a different Claim as root persists the new root and, because the root is the map's apex (it only *receives* support), the newly-designated root loses any **outgoing (source)** relations. **(c)** The designated root's type cannot be changed away from `claim` except via re-designation.

### Exchange Setup
- FR-008: Advocate sets the round count (1–5) when initiating an exchange; the count is fixed for the duration. Within each round the challenger acts first, the advocate acts last. Default 3 rounds. Priority: must-have
  > Socrates: Counter-argument considered: "requiring round count upfront adds a configuration decision advocates have no basis to make before the exchange starts." Resolution: fixed at initiation, capped at 5 rounds. Challenger-first / advocate-last preserves the advocate's last word.
- FR-009: Advocate can search for a registered user by username and send an in-app challenge invite. Priority: must-have
  > Socrates: No counter-argument; invite by search is the only friction-appropriate mechanic given challengers must have accounts. Email-based search was removed as unsafe (it would let an advocate confirm whether an arbitrary email is registered and expose the associated username); username-only search keeps lookup intentional and avoids leaking account existence.
- FR-010: Challenger can accept or decline a challenge invite. Priority: must-have
  > Socrates: No counter-argument. Stands as written.

### Exchange — Challenger Turn
- FR-011: Challenger must mark every advocate Statement that is currently unmarked (newly added by the advocate) or whose prior mark was invalidated by an advocate edit, as Accept, Challenge, or Abstain before submitting their turn. Already-marked statements with valid marks carry over and do not require re-marking. Abstain marks count as unresolved in the divergence summary. Priority: must-have
  > Socrates: No counter-argument; the three-state marking mechanic is the input that generates the divergence data. Stands as written.
- FR-012: Challenger can add Statements of any type (Claim / Source / Data / Warrant / Backing / Rebuttal) and connective (AND / OR) nodes to the exchange. Priority: must-have
  > Socrates: No counter-argument; challenger must be able to introduce alternative evidence, logic bridges, and counter-claims to make the exchange substantive. Stands as written.
- FR-013: Challenger can add Source nodes (per FR-005) grounding their Statements, giving their Data/Backing the same auditable evidence trail as the advocate's. Priority: must-have
  > Socrates: Reworded after the map-visual-spike (F-02) folded sources into first-class Statement nodes — the challenger adds a Source node and a `rephrases` relation rather than attaching a sidebar source. The audit-trail intent is unchanged.
- FR-014: Challenger can create directed relations between their Statements and any existing Statements in the exchange. Priority: must-have
  > Socrates: No counter-argument; relations are what connect the challenger's statements to the advocate's map — without them, the exchange is just two parallel lists. Stands as written.

### Exchange — Advocate Turn
- FR-015: Advocate must mark every challenger Statement that is currently unmarked (newly added by the challenger) or whose prior mark was invalidated by a challenger edit, as Accept, Challenge, or Abstain before submitting their turn. Already-marked statements with valid marks carry over and do not require re-marking. Symmetric with FR-011. Priority: must-have
  > Socrates: No counter-argument. Stands as written.
- FR-016: Advocate can add Statements of any type (Claim / Source / Data / Warrant / Backing / Rebuttal), connective (AND / OR) nodes, and create directed relations between their Statements and any existing Statements in the exchange — symmetric with FR-012 through FR-014. Priority: must-have
  > Socrates: No counter-argument; symmetric capability is required for the exchange to be a real dialogue. Stands as written.

### Round Lifecycle & Divergence Summary
- FR-017: A round is complete when both the challenger and the advocate have each submitted their turn for that round number; the next round opens only after both submissions. Priority: must-have
  > Socrates: No counter-argument; the round-completion semantics are the gate for FR-018 summary trigger and FR-019 close mechanics. Stands as written.
- FR-018: Either party can trigger the divergence summary at any point after at least one complete round (per FR-017), including after the exchange has closed. No summary is available before the first complete round, even if the exchange was closed early via the 7-day challenger-inactivity path (FR-019). Priority: must-have
  > Socrates: Counter-argument considered: "letting the advocate trigger a summary against a silent challenger could weaponize the artifact — the advocate could publish a one-sided 'divergence' map." Resolution: gated on at least one complete round — summary requires both parties to have submitted at least once. If the challenger never submits round 1's turn, the exchange can be closed (FR-019) but produces no summary.
- FR-019: An exchange reaches its end state when either (a) all rounds are exhausted (subject to the final-round mini turn described below), or (b) the advocate explicitly closes it. **Close precondition**: before initiating any close action (including the 7-day-inactivity path), the advocate must have satisfied FR-015 — every challenger Statement currently unmarked or carrying an invalidated mark must be marked Accept/Challenge/Abstain. This guarantees no challenger Statement reaches close unmarked. (b) includes the 7-day challenger-inactivity path: when it is the challenger's turn — a regular turn or a final-round mini turn — and they fail to submit within 7 days of the turn opening, the advocate may close the exchange (the precondition is automatically satisfied on this path because the challenger has not added new statements since the advocate's last turn). The exchange UI surfaces a countdown once the 7-day close window becomes available. At close, all statements become immutable; any still-invalidated marks AND any still-unmarked advocate Statements at the moment of close default to Abstain (counted as unresolved in the divergence summary). **Final-round mini turn (re-evaluation & marking)**: immediately after the advocate submits the final round's advocate turn, if any challenger marks were invalidated by the advocate's final-turn edits OR if the advocate's final turn added any new Statements (which are unmarked by the challenger), a mini turn opens for the challenger. During the mini turn the challenger may only (a) re-evaluate every still-existing invalidated mark and (b) mark every unmarked advocate Statement added during the advocate's final turn — each as Accept, Challenge, or Abstain. No new Statements, no edits, no deletions, no other changes are permitted during the mini turn. Submission of the mini turn closes the exchange. If no invalidated marks and no unmarked advocate Statements exist after the advocate's final-turn submission, the mini turn is skipped and the exchange closes immediately. Priority: must-have
  > Socrates: Counter-argument considered: "the final-round mini turn extends the exchange beyond the agreed N rounds." Resolution: the mini turn is bounded (re-eval + mark only, no new content or edits) and exists solely to give the challenger a chance to respond to the advocate's last-turn edits and new statements — without it, the advocate could silently invalidate marks or introduce unmarked statements in the final turn with no resolution path, breaking the data-integrity guardrail. The 7-day window applies symmetrically; if the challenger ignores the mini turn, advocate close defaults unresolved marks and unmarked statements to Abstain.
- FR-020: The divergence summary shows common ground (mutually Accepted Statements), open divergences (Challenged Statements), and unresolved positions (Abstained Statements), with an option to include linked child debates. Deterministic only — no AI suggestions in MVP. Priority: must-have
  > Socrates: Counter-argument considered: "AI resolution suggestions in the summary undermine credibility if generic." Resolution: AI layer stripped from MVP. Deterministic common-ground / divergence map ships first; AI-enhanced suggestions are Phase 2. The deterministic summary is the core artifact.
- FR-021: Exchange content (Statements, relations, marks, summary) is visible only to the advocate/challenger pair. Priority: must-have
  > Socrates: No counter-argument; private exchange was a deliberate MVP scope decision. Stands as written.

### Parent Debate Linking
- FR-022: When creating a new debate, the advocate can optionally link it to an existing debate as its parent and select a Statement from that parent debate as the correspondence point. The link is informational — no consistency check between the child's root claim and the parent statement. In MVP, a parent debate must involve the same two users as the child debate, regardless of which role each holds in either debate. The creator of the child debate always assumes the Advocate role for this new sub-debate, which allows either party to initiate a child debate targeting a statement made by the other party in the parent exchange (effectively reversing the Advocate/Challenger roles for that specific sub-chain). The ancestor chain is capped at 4; attempting to link to a debate that already has 4 ancestors shows an error and prevents the link. Priority: must-have
  > Socrates: No counter-argument; parent linking replaces the recursive sub-debate mechanic with a simple foreign key. Removes recursive state machine complexity while preserving fractal navigation value. Soft correspondence keeps implementation tractable. Same-users constraint eliminates cross-visibility issues in MVP; cross-pair linking is in Deferred to Phase 2.
- FR-023: A debate and its parent are navigable from each other: the parent shows a list of linked child debates; the child shows a link to the parent and the corresponding Statement. Priority: must-have
  > Socrates: No counter-argument; without bidirectional navigation the parent-child relationship is invisible in the UI.

### Navigation
- FR-024: Advocate can view a list of all their debates, showing each debate's current state (drafting, exchange in progress, closed). Priority: must-have
  > Socrates: No counter-argument; without a debate list the product has no entry point after the first session. Stands as written.
- FR-025: User can view all pending challenge invites and active exchanges where they are the challenger, and navigate to each. Priority: must-have
  > Socrates: No counter-argument; challengers need an inbox to find and respond to debates. Stands as written.

### Statement Lifecycle
- FR-026: Each party can add, edit, and delete only their own Statements during their active turn in a round; once a turn is submitted, their Statements are locked until their next turn. Statements are effective as written — no separate commit step. Neither party can edit or delete the other's Statements in any way. If a party edits or deletes a Statement the other party had previously marked, that mark is invalidated. Edited Statements remain in the exchange and are highlighted in the exchange view with the cleared mark. Deleted Statements and only their direct incoming and outgoing relations are removed from the exchange, while statements owned by the other party that referenced the deleted node are preserved but have their prior marks and links to it cleared automatically; if these preserved statements no longer connect to the root claim in any way (even indirectly), they become orphaned and are explicitly highlighted as orphaned in the exchange view. At the start of the affected turn, re-evaluating every still-existing invalidated mark is the mandatory first action: the party must mark each as Accept, Challenge, or Abstain before they can add new Statements or submit their turn. Invalidated marks tied to deleted Statements are cleared automatically — no re-evaluation needed. The final-round mini turn (FR-019) is restricted to re-evaluating invalidated marks and marking unmarked advocate Statements only — no add, edit, or delete operations are permitted during it. Priority: must-have
  > Socrates: Counter-argument considered: "blocking statement addition outside your active turn makes the exchange feel locked — a party who thinks of a key point mid-wait has no outlet." Resolution: kept — the turn model is the integrity guarantee. An unrestricted addition path breaks mark validity and the round structure. Parties can note thoughts externally and submit them when their turn opens.
- FR-027: Statements in a closed exchange are immutable: neither party can edit or delete them after the exchange closes. Priority: must-have
  > Socrates: No counter-argument; post-close immutability preserves the exchange as an honest record of the original reasoning. The fork mechanic (Deferred to Phase 2) is the intended correction path for a map the exchange revealed to be wrong.

## Non-Functional Requirements

- Map edit operations are perceived as instant: user-visible response to any node add, edit, or link is under 200 ms.
- Debate summary generation completes within 10 seconds of being triggered. No explicit graph size cap in MVP; if the budget is breached in practice, a cap will be introduced in Phase 2 (see Open Questions).
- The product works correctly on the latest two major versions of the four mainstream desktop browsers (Chrome, Firefox, Safari, Edge). No mobile-native requirement in MVP.

## Business Logic

WVMap subtracts common ground from a structured exchange, enables linked child debates on each unresolved divergence, and progressively isolates the irreducible point of disagreement — so both parties know exactly where they differ and whether more evidence or a different premise is needed to resolve it.

**Known MVP limitation**: linked child debates are restricted to the same two users as the parent debate (FR-022). So the "progressively isolate the irreducible point" loop only works as far as both parties remain engaged across the chain — if the challenger walks away, the advocate cannot recruit a different challenger to deepen a specific unresolved divergence. Cross-pair parent linking is in Deferred to Phase 2.

The inputs are the structured Statements and Accept/Challenge/Abstain marks produced by both parties across one or more exchange rounds. The output is a divergence summary: a map of what was agreed, what remains contested, what was abstained from, and (in Phase 2) what type of evidence or reasoning could resolve each contested point. Either party can trigger this summary on demand after at least one complete round, and it remains permanently available after the exchange reaches its closed state (either through round exhaustion or explicit closure by the advocate). Once a divergence is identified in the summary, either party can initiate a new child debate linked back to that contested Statement as an informational reference point, allowing the users to isolate disagreements across a flat chain of up to 4 companion debates.

The Statement type tags (Claim / Source / Data / Warrant / Backing / Rebuttal) are the input to the summary algorithm. Contested Source, Data, or Backing Statements indicate factual gaps; contested Warrant or Claim Statements indicate logical or premise gaps. AND/OR connective nodes carry no mark themselves — they only structure how their operands combine. Abstained Statements appear as unresolved positions with no classified disagreement type. The summary presents this structurally, without AI interpretation in MVP.

## Access Control

Multi-user web application with account-based authentication.

- **Sign-up / sign-in**: email + password or OAuth (at least one OAuth provider). A unique username is required at registration and is used to look users up when sending challenge invites.
- **Role model**: flat — any registered user can act as an advocate (builds maps) or a challenger (audits maps) depending on context. Roles are situational, not account types.
- **Map visibility**: all debates are private to the advocate/challenger pair. An invited challenge is delivered via a private link; the recipient must already have a registered account to be selected by the advocate and to respond.
- **Unauthenticated access**: not applicable in MVP — all content requires authentication.

> See **Open Questions** for the unresolved tradeoff between attribution (account required) and challenger-engagement friction.

## Non-Goals

- **No public debate maps**: all exchanges are private 1:1 in MVP. A public map gallery is out of scope — prevents scope creep toward a social platform before the core mechanic is proven.
- **No team or org accounts**: individual user accounts only. No workspace, no org-level debate management, no shared map ownership.
- **No mobile-native UX**: desktop web only. The map editor and exchange UI are complex enough to require a dedicated mobile UX — that is a separate product decision, not an MVP concern.
- **No real-time collaborative editing**: the map is owned and edited by one party at a time, per the exchange round model. Simultaneous multi-cursor editing is explicitly out of scope.
- **No external notifications (email / push / in-app push)**: turn state, the 7-day countdown, and pending invites are surfaced via UI only. Deemed not important for MVP — challengers and advocates discover state on return visit. Revisit only if Phase 2 engagement data shows it as a blocker.
- **No AI Warrant suggestion in MVP**: deferred to Phase 2. A bad AI warrant is worse than no warrant — it trains advocates to accept weak logical bridges. Ship the core map mechanic and validate the exchange loop first.
- **No fork mechanic for closed maps in MVP**: deferred to Phase 2. After an exchange closes, an advocate cannot fork their map into a new debate. MVP ships post-close immutability (FR-027) without this correction path.
- **No AI-enhanced divergence summary in MVP**: deferred to Phase 2. The deterministic summary (FR-020) ships first; an AI layer that classifies divergences (factual vs values-based) and suggests resolution paths comes later.
- **No cross-pair parent debate linking in MVP**: deferred to Phase 2. FR-022's same-two-users constraint stands. Restoring the full "progressively isolate the irreducible point" value prop named in Business Logic depends on relaxing this later.
- **No statement caps or graph size cap in MVP**: deferred to Phase 2. No per-turn / per-round / per-map statement cap and no graph size cap. Revisit if abuse appears or if the 10-second summary NFR breaks at scale.
- **No public sharing of completed exchange maps in MVP**: deferred to Phase 2. Required to fully satisfy the Secondary success criterion ("advocate links the completed exchange map instead of writing a comment"). MVP has no externalization path; the secondary metric is only partially testable until this ships.

## Open Questions

1. **Challenger account friction** — Owner: user (post-launch product team). Requiring challengers to create an account raises the barrier for the skeptic to engage. Discovery notes flagged "how do you get the *opponent* to engage?" as a known risk. This decision trades challenger friction for attribution and persistence. Worth revisiting if post-launch data shows low invite-acceptance rates. By: post-MVP launch, after invite-acceptance data is available.
2. **Source format** — Owner: user. FR-005 / FR-013 allow "URL or citation," but citation is currently free-text — no URL validation, no broken-link detection, no canonical citation format. Acceptable for MVP; revisit if poor-quality citations undermine the auditability the source layer is meant to provide. By: post-MVP, on signal.
3. **"Silent" definition for the 7-day window** — Owner: user / implementation. FR-019 ties the close path to "the challenger fails to submit their turn within 7 days of the turn opening." The clock starts when the challenger's turn opens (i.e., when the round opens or when the advocate submits in the prior round). What counts as "submission" is the turn submission action — partial activity (login, viewing, drafting unsaved marks) does not extend the clock. Documented here so the implementation makes the correct call. By: implementation time.
4. **Public sharing of completed exchange maps** — Owner: user. Required to fully satisfy the Secondary success criterion (advocate links the completed exchange map instead of writing a new comment). MVP has no externalization path; the secondary metric is only partially testable until this ships. Block: no (Phase 2). By: Phase 2.
5. **Statement and graph size caps** — Owner: user. No per-turn / per-round / per-map statement cap and no graph size cap in MVP. Revisit if abuse appears (e.g., a challenger spamming hundreds of statements per turn) or if the 10-second summary NFR breaks at scale. Block: no. By: on signal.
6. **External notifications** — Owner: user. Email / push / in-app push for turn-open, pending invites, and the 7-day inactivity countdown. Considered post-MVP if engagement data shows the UI-only model isn't enough to keep challengers returning. Block: no. By: post-MVP, on signal.
7. **Cross-pair parent debate linking** — Owner: user. Relax FR-022's same-two-users constraint so an advocate can recruit a different challenger to deepen a specific unresolved divergence from an earlier exchange. Restoring the full "progressively isolate the irreducible point" value prop depends on this. Block: no (Phase 2). By: Phase 2.
8. **AI Warrant suggestion** — Owner: user. When at least one Statement is linked to another, AI proposes a Warrant Statement (the logical bridge). Demoted because a bad AI warrant is worse than no warrant. Block: no (Phase 2). By: Phase 2.
9. **AI-enhanced divergence summary** — Owner: user. The deterministic summary (FR-020) gets an AI layer that classifies divergences (factual vs values-based) and suggests resolution paths. Block: no (Phase 2). By: Phase 2.
10. **Fork mechanic for closed maps** — Owner: user. After an exchange closes, an advocate can fork their map into a new debate — copying their own Statements as the starting point — and initiate a new exchange. The intended correction path for a map the exchange revealed to be wrong. Block: no (Phase 2). By: Phase 2.
