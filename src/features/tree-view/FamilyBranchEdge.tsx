import { BaseEdge, EdgeLabelRenderer } from '@xyflow/react'
import type { EdgeProps } from '@xyflow/react'
import { DESCENT_RAIL_INSET } from './layout'

/**
 * Descent, drawn the way a family tree draws it.
 *
 * One line leaves the parent (or the couple's marker), drops to a rail
 * sitting in the gap between the two generations, runs along it, and
 * drops again onto the child. Nothing else.
 *
 * The rail is the point. Every child of the same parent gets an edge
 * whose horizontal segment sits at exactly the same height, so the
 * separate paths coincide there and read as ONE branch combing down to a
 * row of siblings — which is what the eye is looking for — instead of a
 * fan of individual elbows. It costs nothing to compute: the rail height
 * comes from the child's own row, so every edge arriving at that row
 * agrees on it without anyone having to co-ordinate.
 *
 * And because a rail only ever runs between the parent's own drop and
 * its own children, it never spans anybody else. Two unrelated couples
 * whose children happen to sit on the same row get two separate rails
 * with the gap between the families left empty, rather than one line
 * running the width of the tree.
 *
 * `smoothstep`, which this replaces, put its horizontal step at the
 * midpoint between the two nodes. For a marker sitting at portrait
 * height that lands only a few pixels under the parents' cards, and for
 * anything else it lands wherever the two happen to be — so the steps
 * did not agree with each other and the comb never formed.
 */
export function FamilyBranchEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  style,
  label,
  labelStyle,
  markerEnd,
  data,
}: EdgeProps) {
  // In the gap above the child's row, measured from the child rather than
  // from the parent, so every edge of one branch agrees on it without
  // having to co-ordinate. A branch that would otherwise share its line
  // with the family next to it is moved to a different height — see
  // assignDescentRails.
  const inset = typeof data?.railInset === 'number' ? data.railInset : DESCENT_RAIL_INSET
  const railY = targetY - inset

  const path = buildPath(sourceX, sourceY, targetX, targetY, railY)

  return (
    <>
      <BaseEdge id={id} path={path} style={style} markerEnd={markerEnd} />
      {/*
        Only non-biological links carry a word ("Adopted", "Step",
        "Foster"). It sits on the rail rather than mid-air, so it reads as
        a note on that branch.
      */}
      {label && (
        <EdgeLabelRenderer>
          <div
            className="family-branch__label"
            style={{
              transform: `translate(-50%, -50%) translate(${targetX}px, ${railY}px)`,
              ...(labelStyle as React.CSSProperties),
            }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

/** How far the corners are rounded. Enough to read as drawn rather than plotted. */
const RADIUS = 10

function buildPath(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  railY: number,
): string {
  const dx = targetX - sourceX

  // Directly below: one straight line, no corners to round. This is the
  // common case for an only child, and drawing it as a plain drop is both
  // calmer and shorter than a step with two 0px turns in it.
  if (Math.abs(dx) < 1) return `M ${sourceX},${sourceY} L ${targetX},${targetY}`

  // A rail that would sit above the source (a child drawn level with or
  // above its parent, which collapsed groups can produce) has no room for
  // corners; fall back to a plain elbow rather than drawing a loop.
  if (railY <= sourceY + 1) return `M ${sourceX},${sourceY} L ${targetX},${sourceY} L ${targetX},${targetY}`

  const direction = dx > 0 ? 1 : -1
  const radius = Math.min(RADIUS, Math.abs(dx) / 2, (railY - sourceY) / 2, (targetY - railY) / 2)

  return [
    `M ${sourceX},${sourceY}`,
    `L ${sourceX},${railY - radius}`,
    `Q ${sourceX},${railY} ${sourceX + radius * direction},${railY}`,
    `L ${targetX - radius * direction},${railY}`,
    `Q ${targetX},${railY} ${targetX},${railY + radius}`,
    `L ${targetX},${targetY}`,
  ].join(' ')
}
