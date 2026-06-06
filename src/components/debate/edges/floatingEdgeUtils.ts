import { Position } from "@xyflow/react";
import type { InternalNode, Node } from "@xyflow/react";

function getNodeCenter(node: InternalNode<Node>) {
  return {
    x: node.internals.positionAbsolute.x + (node.measured.width ?? 0) / 2,
    y: node.internals.positionAbsolute.y + (node.measured.height ?? 0) / 2,
  };
}

function getClosestSide(from: { x: number; y: number }, to: { x: number; y: number }): Position {
  const dx = to.x - from.x;
  const dy = to.y - from.y;

  if (Math.abs(dx) > Math.abs(dy)) {
    return dx > 0 ? Position.Right : Position.Left;
  }
  return dy > 0 ? Position.Bottom : Position.Top;
}

function getClosestSideNoTop(
  from: { x: number; y: number },
  to: { x: number; y: number },
): Exclude<Position, Position.Top> {
  const dx = to.x - from.x;
  const dy = to.y - from.y;

  if (Math.abs(dx) > Math.abs(dy)) {
    return dx > 0 ? Position.Right : Position.Left;
  }
  if (dy < 0) return dx >= 0 ? Position.Right : Position.Left;
  return Position.Bottom;
}

function clamp(val: number, min: number, max: number) {
  return Math.max(min, Math.min(max, val));
}

function getPointOnSide(
  pos: { x: number; y: number },
  width: number,
  height: number,
  side: Position,
  otherCenter: { x: number; y: number },
) {
  switch (side) {
    case Position.Top:
      return { x: clamp(otherCenter.x, pos.x, pos.x + width), y: pos.y };
    case Position.Bottom:
      return { x: clamp(otherCenter.x, pos.x, pos.x + width), y: pos.y + height };
    case Position.Left:
      return { x: pos.x, y: clamp(otherCenter.y, pos.y, pos.y + height) };
    case Position.Right:
      return { x: pos.x + width, y: clamp(otherCenter.y, pos.y, pos.y + height) };
  }
}

export function getFloatingTargetParams(sourceX: number, sourceY: number, target: InternalNode<Node>) {
  const sourcePoint = { x: sourceX, y: sourceY };
  const targetPosition = getClosestSide(getNodeCenter(target), sourcePoint);

  const tW = target.measured.width ?? 0;
  const tH = target.measured.height ?? 0;

  const tp = getPointOnSide(target.internals.positionAbsolute, tW, tH, targetPosition, sourcePoint);

  return {
    targetX: tp.x,
    targetY: tp.y,
    targetPosition,
  };
}

export function getNotTopFloatingTargetParams(sourceX: number, sourceY: number, target: InternalNode<Node>) {
  const sourcePoint = { x: sourceX, y: sourceY };
  const targetPosition = getClosestSideNoTop(getNodeCenter(target), sourcePoint);

  const tW = target.measured.width ?? 0;
  const tH = target.measured.height ?? 0;

  const tp = getPointOnSide(target.internals.positionAbsolute, tW, tH, targetPosition, sourcePoint);

  return { targetX: tp.x, targetY: tp.y, targetPosition };
}

export function getHorizontalFloatingTargetParams(sourceX: number, _sourceY: number, target: InternalNode<Node>) {
  const tc = getNodeCenter(target);
  const targetPosition = tc.x > sourceX ? Position.Left : Position.Right;

  const tW = target.measured.width ?? 0;
  const targetX = tc.x > sourceX ? target.internals.positionAbsolute.x : target.internals.positionAbsolute.x + tW;
  const targetY = tc.y;

  return { targetX, targetY, targetPosition };
}

export function getRectIntersection(
  fromX: number,
  fromY: number,
  dropX: number,
  dropY: number,
  target: InternalNode<Node>,
): { targetX: number; targetY: number; targetPosition: Position } {
  const pos = target.internals.positionAbsolute;
  const left = pos.x;
  const right = pos.x + (target.measured.width ?? 0);
  const top = pos.y;
  const bottom = pos.y + (target.measured.height ?? 0);

  const dx = dropX - fromX;
  const dy = dropY - fromY;

  const candidates: { t: number; x: number; y: number; position: Position }[] = [];

  if (dx !== 0) {
    for (const [edgeX, position] of [
      [left, Position.Left],
      [right, Position.Right],
    ] as const) {
      const t = (edgeX - fromX) / dx;
      if (t > 0) {
        const iy = fromY + t * dy;
        if (iy >= top && iy <= bottom) candidates.push({ t, x: edgeX, y: iy, position });
      }
    }
  }

  if (dy !== 0) {
    for (const [edgeY, position] of [
      [top, Position.Top],
      [bottom, Position.Bottom],
    ] as const) {
      const t = (edgeY - fromY) / dy;
      if (t > 0) {
        const ix = fromX + t * dx;
        if (ix >= left && ix <= right) candidates.push({ t, x: ix, y: edgeY, position });
      }
    }
  }

  candidates.sort((a, b) => a.t - b.t);

  if (candidates.length > 0) {
    const best = candidates[0];
    return { targetX: best.x, targetY: best.y, targetPosition: best.position };
  }

  // fallback: top-center
  return { targetX: (left + right) / 2, targetY: top, targetPosition: Position.Top };
}
