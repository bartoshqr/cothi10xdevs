import { BaseEdge, EdgeText, getBezierPath, useInternalNode } from "@xyflow/react";
import type { Edge, EdgeProps } from "@xyflow/react";
import { relationDescriptors } from "../mapVisualLanguage";
import type { RelationKind } from "../mapVisualLanguage";
import { getNotTopFloatingTargetParams, getHorizontalFloatingTargetParams } from "./floatingEdgeUtils";

export interface RelationEdgeData extends Record<string, unknown> {
  kind: RelationKind;
}

export type RelationEdgeType = Edge<RelationEdgeData, "relation">;

const SQUARE_SIZE = 3;

function SquareMarker({ x, y, color }: { x: number; y: number; color: string }) {
  return (
    <rect
      x={x - SQUARE_SIZE}
      y={y - SQUARE_SIZE}
      width={SQUARE_SIZE * 2}
      height={SQUARE_SIZE * 2}
      fill={color}
      transform={`rotate(45 ${x} ${y})`}
    />
  );
}

export default function RelationEdge(props: EdgeProps<RelationEdgeType>) {
  const kind = props.data?.kind ?? "supports";
  const descriptor = relationDescriptors[kind];

  const isLink = kind === "link";
  const isRebuts = kind === "rebuts";
  const targetNode = useInternalNode(props.target);

  let pathParams;

  if (isRebuts && targetNode) {
    const horiz = getHorizontalFloatingTargetParams(props.sourceX, props.sourceY, targetNode);
    pathParams = {
      sourceX: props.sourceX,
      sourceY: props.sourceY,
      sourcePosition: props.sourcePosition,
      ...horiz,
    };
  } else if (isLink && targetNode) {
    const floating = getNotTopFloatingTargetParams(props.sourceX, props.sourceY, targetNode);
    pathParams = {
      sourceX: props.sourceX,
      sourceY: props.sourceY,
      sourcePosition: props.sourcePosition,
      ...floating,
    };
  } else {
    pathParams = {
      sourceX: props.sourceX,
      sourceY: props.sourceY,
      sourcePosition: props.sourcePosition,
      targetX: props.targetX,
      targetY: props.targetY,
      targetPosition: props.targetPosition,
    };
  }

  const [edgePath, labelX, labelY] = isLink
    ? getBezierPath({ ...pathParams, curvature: 1 })
    : getBezierPath(pathParams);

  return (
    <>
      <BaseEdge
        id={props.id}
        path={edgePath}
        style={{
          stroke: descriptor.color,
          strokeWidth: descriptor.strokeWidth ?? 2,
          strokeDasharray: descriptor.strokeDasharray,
        }}
        markerEnd={isLink ? undefined : props.markerEnd}
      />
      {isLink && <SquareMarker x={pathParams.targetX} y={pathParams.targetY} color={descriptor.color} />}
      <EdgeText
        x={labelX}
        y={labelY}
        label={descriptor.label}
        labelStyle={{ fill: descriptor.color, fontSize: 10, fontWeight: 600 }}
        labelBgStyle={{ fill: "var(--card)" }}
        labelBgPadding={[4, 2]}
        labelBgBorderRadius={3}
      />
    </>
  );
}
