import type { StatementNodeType } from "./StatementNode";
import type { ConnectiveNodeType } from "./ConnectiveNode";
import type { RelationEdgeType } from "./RelationEdge";

const statementNodes: StatementNodeType[] = [
  {
    id: "root-claim",
    type: "statement",
    position: { x: 400, y: 0 },
    data: {
      title: "Climate action is urgent",
      body: "Global warming demands immediate large-scale emission reductions to avoid catastrophic tipping points.",
      isRoot: true,
    },
  },
  {
    id: "claim-a",
    type: "statement",
    position: { x: 350, y: 200 },
    data: {
      title: "Temperatures are rising",
      body: "Average global surface temperature has increased by over 1.1 °C since the pre-industrial era.",
    },
  },
  {
    id: "claim-b",
    type: "statement",
    position: { x: 20, y: 200 },
    data: {
      title: "CO₂ drives warming",
      body: "Greenhouse gas concentrations correlate strongly with temperature anomalies over geological timescales.",
    },
  },
  {
    id: "source-1",
    type: "statement",
    position: { x: 200, y: 900 },
    data: {
      role: "source",
      title: "IPCC AR6 (2021)",
      body: "Intergovernmental Panel on Climate Change, Sixth Assessment Report, Working Group I.",
      url: "https://ipcc.ch/report/ar6/wg1",
    },
  },
  {
    id: "data-1",
    type: "statement",
    position: { x: 200, y: 680 },
    data: {
      role: "data",
      title: "CO₂ at 421 ppm",
      body: "Atmospheric CO₂ concentration reached 421 ppm in 2023, the highest level in at least 800,000 years. The Keeling Curve shows an unbroken upward trend since 1958.",
    },
  },
  {
    id: "data-2",
    type: "statement",
    position: { x: 620, y: 680 },
    data: {
      role: "data",
      title: "Observed warming +1.1 °C",
      body: "Global mean surface temperature was approximately 1.1 °C above the 1850–1900 baseline in 2011–2020, according to multiple independent datasets.",
    },
  },
  {
    id: "warrant-1",
    type: "statement",
    position: { x: -30, y: 480 },
    data: {
      role: "warrant",
      title: "Greenhouse effect mechanism",
      body: "At constant solar input, higher CO₂ traps more outgoing longwave radiation, raising the equilibrium temperature.",
    },
  },
  {
    id: "backing-1",
    type: "statement",
    position: { x: -300, y: 800 },
    data: {
      role: "backing",
      title: "Fourier–Tyndall–Arrhenius physics",
      body: "The greenhouse effect was established by Fourier (1824), demonstrated by Tyndall (1859), and quantified by Arrhenius (1896).",
    },
  },
  {
    id: "backing-2",
    type: "statement",
    position: { x: -300, y: 640 },
    data: {
      role: "backing",
      title: "Positive radiative forcing +0.6 W/m²",
      body: "Earth's energy imbalance is approximately +0.6 W/m², confirmed by ocean heat content measurements.",
    },
  },
  {
    id: "rebuttal-1",
    type: "statement",
    position: { x: -500, y: 480 },
    data: {
      role: "rebuttal",
      title: "Solar dimming counter",
      body: "This wouldn't hold if the Sun were weakening — but solar irradiance has been flat or slightly declining since the 1980s.",
    },
  },
  {
    id: "claim-c",
    type: "statement",
    position: { x: 780, y: 200 },
    data: {
      title: "Renewable transition is feasible",
      body: "Solar and wind costs have fallen 90 % in a decade, making a full energy transition economically viable.",
    },
  },
  {
    id: "data-3",
    type: "statement",
    position: { x: 780, y: 440 },
    data: {
      role: "data",
      title: "Solar LCOE $20–30/MWh",
      body: "Utility-scale solar levelised cost of energy dropped below $30/MWh in most markets by 2023.",
    },
  },
  {
    id: "data-4",
    type: "statement",
    position: { x: 450, y: 680 },
    data: {
      role: "data",
      title: "Ice core records",
      body: "Antarctic ice cores reveal CO₂ and temperature moved together over the past 800,000 years.",
    },
  },
  {
    id: "warrant-2",
    type: "statement",
    position: { x: -50, y: 680 },
    data: {
      role: "warrant",
      title: "Carbon isotope signature",
      body: "Declining δ¹³C in atmospheric CO₂ fingerprints fossil fuel combustion as the dominant source.",
    },
  },
  {
    id: "data-5",
    type: "statement",
    position: { x: 900, y: 700 },
    data: {
      role: "data",
      title: "Wind LCOE $25–50/MWh",
      body: "Onshore wind costs dropped to $25–50/MWh globally, competitive with natural gas in most regions.",
    },
  },
  {
    id: "warrant-3",
    type: "statement",
    position: { x: 600, y: 880 },
    data: {
      role: "warrant",
      title: "Battery storage costs halved",
      body: "Lithium-ion battery pack prices fell below $140/kWh in 2023, making grid-scale storage economically viable.",
    },
  },
  {
    id: "data-6",
    type: "statement",
    position: { x: 1100, y: 700 },
    data: {
      role: "data",
      title: "Grid parity reached",
      body: "Renewables reached grid parity in over 90 % of the world by 2023, undercutting new fossil fuel plants.",
    },
  },
];

const connectiveNodes: ConnectiveNodeType[] = [
  {
    id: "and-1",
    type: "connective",
    position: { x: 200, y: 500 },
    data: { op: "and" },
  },
  {
    id: "or-1",
    type: "connective",
    position: { x: 480, y: 400 },
    data: { op: "or" },
  },
  {
    id: "or-backing",
    type: "connective",
    position: { x: -150, y: 560 },
    data: { op: "or" },
  },
  {
    id: "and-renewable",
    type: "connective",
    position: { x: 900, y: 580 },
    data: { op: "and" },
  },
];

export const initialNodes = [...statementNodes, ...connectiveNodes];

export const initialEdges: RelationEdgeType[] = [
  { id: "e-claim-a-root", source: "claim-a", target: "root-claim", type: "relation", data: { kind: "supports" } },
  { id: "e-claim-b-root", source: "claim-b", target: "root-claim", type: "relation", data: { kind: "supports" } },
  { id: "e-claim-c-root", source: "claim-c", target: "root-claim", type: "relation", data: { kind: "supports" } },

  {
    id: "e-or1-claima",
    source: "or-1",
    sourceHandle: "out",
    target: "claim-a",
    type: "relation",
    data: { kind: "supports" },
  },
  {
    id: "e-and1-or1",
    source: "and-1",
    sourceHandle: "out",
    target: "or-1",
    type: "relation",
    data: { kind: "link" },
  },
  {
    id: "e-data2-or1",
    source: "data-2",
    target: "or-1",
    type: "relation",
    data: { kind: "link" },
  },

  {
    id: "e-warrant2-and1",
    source: "warrant-2",
    target: "and-1",
    type: "relation",
    data: { kind: "link" },
  },
  {
    id: "e-data1-and1",
    source: "data-1",
    target: "and-1",
    type: "relation",
    data: { kind: "link" },
  },
  {
    id: "e-data4-and1",
    source: "data-4",
    target: "and-1",
    type: "relation",
    data: { kind: "link" },
  },
  {
    id: "e-warrant1-and1",
    source: "warrant-1",
    target: "and-1",
    type: "relation",
    data: { kind: "link" },
  },

  {
    id: "e-orbacking-warrant",
    source: "or-backing",
    sourceHandle: "out",
    target: "warrant-1",
    type: "relation",
    data: { kind: "supports" },
  },
  {
    id: "e-backing1-orbacking",
    source: "backing-1",
    target: "or-backing",
    type: "relation",
    data: { kind: "link" },
  },
  {
    id: "e-backing2-orbacking",
    source: "backing-2",
    target: "or-backing",
    type: "relation",
    data: { kind: "link" },
  },

  { id: "e-rebuttal-warrant", source: "rebuttal-1", target: "warrant-1", type: "relation", data: { kind: "rebuts" } },

  { id: "e-source1-data1", source: "source-1", target: "data-1", type: "relation", data: { kind: "rephrases" } },

  {
    id: "e-andrenewable-claimc",
    source: "and-renewable",
    sourceHandle: "out",
    target: "claim-c",
    type: "relation",
    data: { kind: "supports" },
  },
  {
    id: "e-data3-andrenewable",
    source: "data-3",
    target: "and-renewable",
    type: "relation",
    data: { kind: "link" },
  },
  {
    id: "e-data5-andrenewable",
    source: "data-5",
    target: "and-renewable",
    type: "relation",
    data: { kind: "link" },
  },
  {
    id: "e-warrant3-andrenewable",
    source: "warrant-3",
    target: "and-renewable",
    type: "relation",
    data: { kind: "link" },
  },
  {
    id: "e-data6-andrenewable",
    source: "data-6",
    target: "and-renewable",
    type: "relation",
    data: { kind: "link" },
  },
  {
    id: "e-source1-andrenewable",
    source: "source-1",
    target: "and-renewable",
    type: "relation",
    data: { kind: "link" },
  },
];
