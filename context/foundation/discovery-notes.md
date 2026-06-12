# WVMap Discovery Notes

## Core Problem
Chaotic, pointless, recurring worldview wars in YouTube/Facebook/Twitter comments.
People argue past each other because they never isolate *what* they actually disagree on.

## Solution
WorldViewMap (WVMap) — a web platform for structured debates that maps reasoning hierarchically,
forces both sides to engage with each other's actual arguments, and isolates the exact crux of disagreement.

## Key Insight
Most debates fail not because people lack information, but because they never identify
whether the disagreement is **factual** (different data) or **values-based** (different premises).
WVMap exposes exactly which one it is.

## Target Persona: Advocates
Not apologists (faith defenders), not random arguers — **advocates**: people who actively
push a cause and are frustrated that opponents "don't understand" their reasoning.

They are:
- Willing to invest time structuring their case (it serves their mission)
- Motivated to convince, not just win
- Already sharing arguments online, just doing it badly
- Receptive to a tool that makes their reasoning auditable and harder to dismiss

## Launch Communities (in priority order)

1. **Climate skeptics / believers** — launch community; structured, data-rich debates; role model: Marcin Popkiewicz
2. **Animal rights advocates**
3. **Pro-life / pro-choice**
4. **Religious apologetics / arguing atheists** — owner has personal background here; expansion community

## Go-to-Market Logic
Start with Polish climate community as the *launch community* — owner is Polish, no language/cultural barrier,
active online scene (Ziemia na rozdrożu, Popkiewicz's followers), data-driven debates with recurring bad-faith objections.
Role model: Marcin Popkiewicz — rigorous, frustrated by recycled objections, wants opponents to engage with actual reasoning.
Other communities are the expansion roadmap (first Polish, then international).
The product mechanics are domain-agnostic — expanding to new causes is a distribution problem, not a product problem.

## Core Loop (from original spec)
1. Advocate builds their belief map (Claims → Data → Warrants)
2. Commits to every node (forces internal consistency check)
3. Publishes map
4. Challenger audits node by node: [Accept] or [Challenge]
5. System subtracts common ground, isolates the **Crux** — the exact first point of divergence

## Example: Climate Argument Mapped (Toulmin Model)

### Claim
As CO₂ concentration in the atmosphere increases, the average surface temperature of the Earth will rise.

### Data
CO₂ concentration in the atmosphere is systematically growing (mainly due to burning fossil fuels).

### Warrant (the logical bridge)
- **Implication 1**: If CO₂ increases → more energy from the Sun is retained in the Earth system (greenhouse gases act as an extra blanket/insulation).
- **Implication 2**: If more energy is retained while solar input stays constant → surface temperature must rise until the energy balance is restored.

### Backing
- Fundamental physics of the greenhouse effect (Fourier, Tyndall, Arrhenius — 19th century)
- Planetary energy balance: Earth currently absorbs more than it emits (+0.6 W/m²)
- Climate models and direct observational data

### Qualifier
Almost certainly / in accordance with basic physics.

### Rebuttal
The argument would fail if the Sun significantly reduced its activity or greenhouse gases suddenly disappeared — neither of which is happening.

**Analogies:** Insulating a house better → room gets warmer with the same heater. A blanket doesn't produce heat — it prevents heat from escaping.

---

## Minimal MVP Function Set

Phase 1 only (map building + publishing). Challenge mechanic is Phase 2.

### Map Building
1. **Add a Claim** — atomic unit, free-text statement
2. **Add a Data node** — grounds claims in evidence; free-text + optional source URL
3. **Add a Warrant** — logical bridge between Data → Claim
4. **Link nodes** — directed edge (this node supports that one); creates the hierarchy
5. **Add a source** — URL/citation attached to Data nodes
6. **Commit to a node** — the differentiating mechanic; forces internal consistency; 100% commitment required before publish

### Publish
7. **Publish map** — generates shareable URL; read-only artifact
8. **View published map** — the shareable output for social distribution

### Challenge (Phase 2 — pulled into MVP)
9. **Invite challenger** — publish map to a specific person via private link (not public)
10. **Audit node** — challenger marks each node Accept / Challenge (cannot edit original text)
11. **Add rebuttals** — challenger add rebuttals/alternative data etc.
12. **Highlight Crux** — system marks the first Challenge as the exact point of divergence

### AI-Assisted
- **Warrant suggestion** — highest-leverage AI touch point. User states a Claim and a Data node; AI proposes the logical bridge (Warrant). Most users can articulate a claim and cite evidence but struggle to make the logical connection explicit. This is where maps stall without assistance.

### Explicitly out of MVP scope
- Consistency analysis — the commit-to-every-node mechanic is the forcing function; automated contradiction detection is Phase 2+
- Building cases for/against a thesis — Phase 2 (challenge mechanic)
- Public challenge/audit — Phase 2

---

## Open Questions
- How do you get the *opponent* to engage? The advocate will use the tool; will the skeptic?
- Framing: does the tool feel like a weapon (sharpen my arguments) or neutral truth-seeking?
  This matters enormously for adoption on both sides.
- MVP scope: full public publish + challenger mechanics, or start with private 1-to-1 disputes only?
