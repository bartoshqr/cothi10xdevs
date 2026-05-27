import type { StatementNodeType } from "./StatementNode";
import type { ConnectiveNodeType } from "./ConnectiveNode";
import type { RelationEdgeType } from "./RelationEdge";

// ─── Statement nodes ──────────────────────────────────────────────────────────
//
// Layout (top-down, higher y = lower in canvas — source handles are at the TOP
// of each statement node so edges flow upward from lower nodes to higher claims):
//
//                     [Claim B  ROOT]  y=0
//                           ↑ supports
//                     [Claim A]        y=180
//                           ↑ supports
//                        [OR-1]        y=360
//           ↑ link               ↑ link
//         [AND-1]          [Observed]  y=540
//   ↑ link      ↑ link
//  [Data]    [Warrant]                y=720
//    ↑             ↑ supports  ← rebuts [Rebuttal]
// [Source]      [OR-backing]          y=900
// (rephrases→)  ↑ link   ↑ link
//           [Back1]   [Back2]         y=1080

const statementNodes: StatementNodeType[] = [
  {
    id: "claim-b",
    type: "statement",
    position: { x: 380, y: 0 },
    data: {
      title: "Globalne ocieplenie wymaga pilnych działań ograniczających emisje",
      body: "Naukowo ugruntowane zagrożenia klimatyczne uzasadniają natychmiastową, szeroko zakrojoną redukcję emisji gazów cieplarnianych.",
      isRoot: true,
    },
  },
  {
    id: "claim-a",
    type: "statement",
    position: { x: 380, y: 180 },
    data: {
      title: "Średnia temperatura Ziemi będzie rosnąć wraz ze wzrostem CO₂",
      body: "Dalszy wzrost koncentracji CO₂ w atmosferze nieuchronnie przełoży się na wyższe średnie temperatury globalne.",
    },
  },
  {
    id: "data-observed",
    type: "statement",
    position: { x: 680, y: 540 },
    data: {
      role: "data",
      title: "Obserwowany wzrost średniej temperatury globalnej",
      body: "Globalna średnia temperatura powierzchni wzrosła o ok. 1,1 °C ponad poziom sprzed epoki przemysłowej — potwierdzają to niezależne zestawy danych meteorologicznych i oceanograficznych.",
    },
  },
  {
    id: "data-co2",
    type: "statement",
    position: { x: 80, y: 720 },
    data: {
      role: "data",
      title: "Stężenie CO₂ w atmosferze systematycznie rośnie",
      body: "Koncentracja CO₂ osiągnęła 421 ppm w 2023 r. — najwyższy poziom od co najmniej 800 tys. lat. Krzywa Keelinga notuje nieprzerwany trend wzrostowy od 1958 r.",
    },
  },
  {
    id: "warrant-1",
    type: "statement",
    position: { x: 340, y: 720 },
    data: {
      role: "warrant",
      title: "Przy stałym dopływie energii ze Słońca więcej CO₂ zatrzymuje więcej energii — temperatura musi wzrosnąć",
      body: "Efekt cieplarniany: wzrost stężenia CO₂ zmniejsza ucieczkę promieniowania długofalowego, zaburzając równowagę energetyczną Ziemi i wymuszając wzrost temperatury.",
    },
  },
  {
    id: "source-1",
    type: "statement",
    position: { x: 80, y: 930 },
    data: {
      role: "source",
      title: "Krzywa Keelinga — pomiary CO₂ z Mauna Loa",
      body: "Scripps Institution of Oceanography / NOAA — nieprzerwane pomiary atmosferycznego CO₂ od 1958 r. Uznawane za wzorzec monitorowania składu atmosfery.",
      url: "https://keelingcurve.ucsd.edu",
    },
  },
  {
    id: "backing-1",
    type: "statement",
    position: { x: 180, y: 1120 },
    data: {
      role: "backing",
      title: "Fizyka efektu cieplarnianego — Fourier / Tyndall / Arrhenius",
      body: "Mechanizm ustalony przez Fouriera (1824), zademonstrowany przez Tyndalla (1859) i skwantyfikowany przez Arrheniusa (1896). Powtarzalny, potwierdzony laboratoryjnie.",
    },
  },
  {
    id: "backing-2",
    type: "statement",
    position: { x: 490, y: 1120 },
    data: {
      role: "backing",
      title: "Dodatni bilans radiacyjny +0,6 W/m²",
      body: "Pomiary zasobności cieplnej oceanów i satelitarne dane radiometryczne potwierdzają, że Ziemia pochłania więcej energii niż oddaje — niezależne potwierdzenie mechanizmu.",
    },
  },
  {
    id: "rebuttal-1",
    type: "statement",
    position: { x: 680, y: 720 },
    data: {
      role: "rebuttal",
      title: "Nie zadziałałoby, gdyby Słońce osłabło",
      body: "Kontrargument zakłada stały dopływ energii słonecznej. Pomiary satelitarne wykazują, że aktywność Słońca pozostaje stabilna lub lekko spada od lat 80. XX w., więc warunek jest spełniony.",
    },
  },
];

// ─── Connective nodes ─────────────────────────────────────────────────────────

const connectiveNodes: ConnectiveNodeType[] = [
  {
    id: "or-1",
    type: "connective",
    position: { x: 430, y: 360 },
    data: { op: "or" },
  },
  {
    id: "and-1",
    type: "connective",
    position: { x: 220, y: 540 },
    data: { op: "and" },
  },
  {
    id: "or-backing",
    type: "connective",
    position: { x: 370, y: 930 },
    data: { op: "or" },
  },
];

export const nodes = [...statementNodes, ...connectiveNodes];

// ─── Edges ────────────────────────────────────────────────────────────────────
//
// link edges use floating target (getNotTopFloatingTargetParams in RelationEdge)
// so no targetHandle needed — the edge finds the nearest non-top entry point.
//
// rebuts edges use horizontal floating target (getHorizontalFloatingTargetParams).
//
// supports and rephrases use standard bezier between handles.

export const edges: RelationEdgeType[] = [
  // Claim A directly supports Claim B (lone supporter → direct edge)
  {
    id: "e-claima-claimb",
    source: "claim-a",
    target: "claim-b",
    type: "relation",
    data: { kind: "supports" },
  },

  // OR-1 supports Claim A
  {
    id: "e-or1-claima",
    source: "or-1",
    target: "claim-a",
    type: "relation",
    data: { kind: "supports" },
  },

  // AND-1 links into OR-1 (operand 0)
  {
    id: "e-and1-or1",
    source: "and-1",
    target: "or-1",
    type: "relation",
    data: { kind: "link" },
  },

  // Observed warming links into OR-1 as alternative operand
  {
    id: "e-observed-or1",
    source: "data-observed",
    target: "or-1",
    type: "relation",
    data: { kind: "link" },
  },

  // Data-CO2 links into AND-1
  {
    id: "e-data-and1",
    source: "data-co2",
    target: "and-1",
    type: "relation",
    data: { kind: "link" },
  },

  // Warrant links into AND-1
  {
    id: "e-warrant-and1",
    source: "warrant-1",
    target: "and-1",
    type: "relation",
    data: { kind: "link" },
  },

  // Source rephrases Data
  {
    id: "e-source-data",
    source: "source-1",
    target: "data-co2",
    type: "relation",
    data: { kind: "rephrases" },
  },

  // OR-backing supports Warrant
  {
    id: "e-orbacking-warrant",
    source: "or-backing",
    target: "warrant-1",
    type: "relation",
    data: { kind: "supports" },
  },

  // Backing-1 links into OR-backing
  {
    id: "e-back1-orbacking",
    source: "backing-1",
    target: "or-backing",
    type: "relation",
    data: { kind: "link" },
  },

  // Backing-2 links into OR-backing
  {
    id: "e-back2-orbacking",
    source: "backing-2",
    target: "or-backing",
    type: "relation",
    data: { kind: "link" },
  },

  // Rebuttal rebuts Warrant
  {
    id: "e-rebuttal-warrant",
    source: "rebuttal-1",
    target: "warrant-1",
    type: "relation",
    data: { kind: "rebuts" },
  },
];
