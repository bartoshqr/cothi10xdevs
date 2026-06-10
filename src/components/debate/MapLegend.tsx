import { useState } from "react";
import { Panel } from "@xyflow/react";
import {
  roleDescriptors,
  connectiveDescriptors,
  relationDescriptors,
  markStanceDescriptors,
} from "./mapVisualLanguage";
import type { ConnectiveOp, RelationKind, MarkStance } from "./mapVisualLanguage";

const ROLES: { badge: string | null; accent: string; description: string }[] = [
  {
    badge: "ROOT",
    accent: roleDescriptors.claim.accent,
    description: "The main contention the whole debate is about",
  },
  {
    badge: null,
    accent: roleDescriptors.claim.accent,
    description: "An intermediate claim supporting a higher one",
  },
  {
    badge: "SOURCE",
    accent: roleDescriptors.source.accent,
    description: "Assertion about a cited origin — its reliability can be contested",
  },
  {
    badge: "DATA",
    accent: roleDescriptors.data.accent,
    description: "An interpretation of the source in the argument's context",
  },
  {
    badge: "WARRANT",
    accent: roleDescriptors.warrant.accent,
    description: "The logical bridge connecting data to the claim",
  },
  {
    badge: "BACKING",
    accent: roleDescriptors.backing.accent,
    description: "Evidence or authority that supports the warrant",
  },
  {
    badge: "REBUTTAL",
    accent: roleDescriptors.rebuttal.accent,
    description: "A claim that undermines or directly rebuts another claim",
  },
];

const CONNECTIVES: { op: ConnectiveOp; description: string }[] = [
  { op: "and", description: "All operands required" },
  { op: "or", description: "Any operand suffices" },
];

const MARKS: { stance: MarkStance; description: string }[] = [
  { stance: "agree", description: "You agree with this statement" },
  { stance: "challenge", description: "You challenge this statement" },
  { stance: "abstain", description: "You abstain — unresolved, blocks turn submit" },
];

const RELATIONS: { kind: RelationKind; description: string }[] = [
  { kind: "supports", description: "Connective / claim supports a claim" },
  { kind: "link", description: "Operand feeds into a connective" },
  { kind: "rephrases", description: "One statement restates another" },
  { kind: "rebuts", description: "Rebuttal attacks a claim" },
];

export default function MapLegend() {
  const [open, setOpen] = useState(false);

  return (
    <Panel position="bottom-right" style={{ padding: 0, margin: "0 0 24px 0" }}>
      <div
        className="flex items-stretch"
        style={{ pointerEvents: "none", filter: "drop-shadow(0 2px 8px rgba(0,0,0,0.12))" }}
      >
        <div style={{ position: "relative", width: 60, flexShrink: 0, pointerEvents: "none" }}>
          <button
            onClick={() => {
              setOpen((v) => !v);
            }}
            className="nodrag nopan flex flex-col items-center justify-center"
            style={{
              pointerEvents: "auto",
              position: "absolute",
              top: "0%",
              width: 60,
              height: 44,
              borderRadius: "8px 0 0 8px",
              backgroundColor: "var(--card)",
              border: "1px solid var(--border)",
              borderRight: "none",
              color: "var(--muted-foreground)",
              fontSize: 8,
              fontWeight: 800,
              letterSpacing: "0.08em",
              lineHeight: 1.3,
              textAlign: "center",
              cursor: "pointer",
              userSelect: "none",
              transition: "border-color 0.25s ease, border-radius 0.25s ease",
            }}
          >
            <span>HOW IT</span>
            <span>WORKS?</span>
          </button>
        </div>

        <div
          style={{
            width: open ? 290 : 0,
            overflow: "hidden",
            transition: "width 0.25s ease",
            pointerEvents: open ? "auto" : "none",
          }}
        >
          <div
            className="text-xs"
            style={{
              width: 290,
              maxHeight: "80vh",
              overflowY: "auto",
              backgroundColor: "var(--card)",
              border: "1px solid var(--border)",
              borderLeft: "none",
              borderRadius: "0 8px 8px 0",
              padding: "14px 14px 12px",
              lineHeight: 1.5,
              color: "var(--card-foreground)",
            }}
          >
            <p className="mb-0.5 font-bold" style={{ fontSize: 11, color: "var(--foreground)" }}>
              Claim
            </p>
            <p className="mb-3" style={{ fontSize: 10, color: "var(--muted-foreground)" }}>
              An assertion that can be agreed, challenged, or rebutted.
            </p>

            <p
              className="mb-2 font-bold tracking-wider uppercase"
              style={{ fontSize: 10, color: "var(--muted-foreground)" }}
            >
              Every node is a claim — role badge shows its function
            </p>

            <div className="mb-3 space-y-1.5">
              {ROLES.map(({ badge, accent, description }, i) => (
                <div key={i} className="flex items-start gap-2">
                  <div
                    className="mt-0.5 flex w-20 shrink-0 items-center gap-1 overflow-hidden rounded"
                    style={{ border: "1px solid var(--border)", backgroundColor: "var(--card)" }}
                  >
                    <div className="w-1 shrink-0 self-stretch" style={{ backgroundColor: accent }} />
                    <div className="flex flex-1 items-center justify-center py-0.5">
                      {badge ? (
                        <span
                          className="rounded px-1 py-0.5 text-[9px] font-bold tracking-wider text-white"
                          style={{ backgroundColor: accent }}
                        >
                          {badge}
                        </span>
                      ) : (
                        <span className="text-[9px] italic" style={{ color: "var(--muted-foreground)" }}>
                          plain
                        </span>
                      )}
                    </div>
                  </div>
                  <span style={{ color: "var(--foreground)" }}>{description}</span>
                </div>
              ))}
            </div>

            <div className="mb-3 space-y-1">
              {CONNECTIVES.map(({ op, description }) => {
                const d = connectiveDescriptors[op];
                return (
                  <div key={op} className="flex items-center gap-2">
                    <div
                      className="flex shrink-0 items-center justify-center rounded-full border-2 font-bold"
                      style={{
                        width: 36,
                        height: 22,
                        fontSize: 9,
                        backgroundColor: d.bg,
                        borderColor: d.border,
                        color: d.text,
                      }}
                    >
                      {d.label}
                    </div>
                    <span style={{ color: "var(--foreground)" }}>{description}</span>
                  </div>
                );
              })}
            </div>

            <hr style={{ borderColor: "var(--border)", marginBottom: "8px" }} />

            <p
              className="mb-2 font-bold tracking-wider uppercase"
              style={{ fontSize: 10, color: "var(--muted-foreground)" }}
            >
              Relations
            </p>
            <div className="mb-3 space-y-1">
              {RELATIONS.map(({ kind, description }) => {
                const d = relationDescriptors[kind];
                return (
                  <div key={kind} className="flex items-center gap-2">
                    <svg width="36" height="12" className="shrink-0" overflow="visible">
                      <line
                        x1="0"
                        y1="6"
                        x2="36"
                        y2="6"
                        stroke={d.color}
                        strokeWidth={d.strokeWidth ?? 2}
                        strokeDasharray={d.strokeDasharray}
                      />
                      <polygon points="32,3 36,6 32,9" fill={d.color} />
                    </svg>
                    <span style={{ color: "var(--foreground)" }}>
                      <strong>{kind}</strong> — {description}
                    </span>
                  </div>
                );
              })}
            </div>

            <p style={{ color: "var(--muted-foreground)", fontSize: 10, lineHeight: 1.4 }}>
              <strong style={{ color: "var(--foreground)" }}>link</strong> feeds connectives ·{" "}
              <strong style={{ color: "var(--foreground)" }}>others</strong> land on claims.
            </p>

            <hr style={{ borderColor: "var(--border)", margin: "8px 0" }} />

            <p
              className="mb-2 font-bold tracking-wider uppercase"
              style={{ fontSize: 10, color: "var(--muted-foreground)" }}
            >
              Statement marks
            </p>
            <div className="mb-3 space-y-1">
              {MARKS.map(({ stance, description }) => {
                const d = markStanceDescriptors[stance];
                return (
                  <div key={stance} className="flex items-center gap-2">
                    <span
                      className="w-16 shrink-0 rounded px-1.5 py-0.5 text-center text-[9px] font-semibold"
                      style={{ backgroundColor: `color-mix(in srgb, ${d.color} 12%, transparent)`, color: d.color }}
                    >
                      {d.label}
                    </span>
                    <span style={{ color: "var(--foreground)" }}>{description}</span>
                  </div>
                );
              })}
            </div>

            <hr style={{ borderColor: "var(--border)", margin: "8px 0" }} />

            <p style={{ color: "var(--muted-foreground)", fontSize: 9, lineHeight: 1.4 }}>
              Inspired by the{" "}
              <a
                href="https://en.wikipedia.org/wiki/Toulmin_model"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "var(--primary)", textDecoration: "underline", textUnderlineOffset: "2px" }}
              >
                Toulmin model of argument ↗
              </a>
            </p>
          </div>
        </div>
      </div>
    </Panel>
  );
}
