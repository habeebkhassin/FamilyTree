import { useEffect, useMemo, useState } from 'react'
import { Background, Controls, Panel, ReactFlow, ReactFlowProvider, useReactFlow } from '@xyflow/react'
import type { Node, NodeMouseHandler } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { FamilyGroup, FamilyGroupMember, ParentLink, Person, Union } from '../../types'
import { buildFamilyGraph } from './graphAdapter'
import { projectFamilyGroups } from './groupProjection'
import { projectFamilyTreeView } from './viewProjection'
import { layoutFamilyGraph } from './layout'
import { PersonNode } from './PersonNode'
import { UnionJunctionNode } from './UnionJunctionNode'
import { FamilyGroupHeader, FamilyGroupNode } from './FamilyGroupNode'
import type { FamilyGroupHeaderNode } from './FamilyGroupNode'
import { GenerationLabel } from './GenerationLabel'
import type { GenerationLabelNode } from './GenerationLabel'
import { GenerationBand } from './GenerationBand'
import type { GenerationBandNode } from './GenerationBand'
import { familyGroupNodeHeight, GENERATION_ROW_HEIGHT, nodeWidth } from './layout'
import { computeRanks } from './rank'
import { resolveRelationships } from '../../lib/relationships/relationshipResolver'
import { RelationshipPanel } from '../relationships/RelationshipPanel'
import { FocusBreadcrumb } from './FocusBreadcrumb'
import { PersonInspector } from './PersonInspector'
import type { FamilyEdge, FamilyNode } from './types'
import './FamilyTreeCanvas.css'

interface FamilyTreeCanvasProps {
  people: Person[]
  parentLinks: ParentLink[]
  unions: Union[]
  familyGroups: FamilyGroup[]
  familyGroupMembers: FamilyGroupMember[]
  collapsedGroupIds: ReadonlySet<string>
  onToggleFamilyGroup: (familyGroupId: string) => void
  onSelectPerson: (personId: string) => void
  onBack: () => void
  /**
   * The person the tree is currently being explored from. Centers the
   * viewport on them instead of fitting everything, and gives their card
   * a halo. Purely a viewpoint — it takes no part in building the graph,
   * ranking it, or laying it out, so the same records draw the same tree
   * whoever is focused.
   */
  focalPersonId?: string
  /** Chosen from the selection inspector — never from an ordinary click. */
  onFocusPerson: (personId: string) => void
  /** Oldest first, current last. Empty until the viewpoint has moved. */
  focusHistory: readonly string[]
  onFocusBack: () => void
  /** Who this device's user has said they are, so the trail can say "You". */
  claimedPersonId: string | null
  /** Nobody is focused, and the offer to choose has not been waved away. */
  shouldPromptForFocus: boolean
  onDismissFocusPrompt: () => void
}

// Stable across renders/instances — React Flow warns (and re-renders
// needlessly) if nodeTypes changes identity on every render.
const NODE_TYPES = {
  person: PersonNode,
  unionJunction: UnionJunctionNode,
  familyGroup: FamilyGroupNode,
  familyGroupHeader: FamilyGroupHeader,
  generationLabel: GenerationLabel,
  generationBand: GenerationBand,
}

const GENERATION_LABEL_WIDTH = 64
const GENERATION_LABEL_GAP = 16
const BAND_SIDE_PADDING = 24
/** Lifts an expanded group's header into the empty gutter above its first row, so it never collides with the row above. */
const GROUP_HEADER_OFFSET = 34

/**
 * One control per EXPANDED group, sitting just above its topmost member.
 * Computed from already-laid-out positions and never fed back into the
 * graph — the same render-time-overlay pattern as the generation bands,
 * so it takes no part in ranking, layout, or the projection.
 */
function buildFamilyGroupHeaders(
  nodes: FamilyNode[],
  familyGroups: FamilyGroup[],
  familyGroupMembers: FamilyGroupMember[],
  collapsedGroupIds: ReadonlySet<string>,
): FamilyGroupHeaderNode[] {
  if (nodes.length === 0) return []

  const positionById = new Map(nodes.map((node) => [node.id, node.position]))
  const personIdsByGroupId = new Map<string, Set<string>>()
  for (const member of familyGroupMembers) {
    const ids = personIdsByGroupId.get(member.familyGroupId) ?? new Set<string>()
    ids.add(member.personId)
    personIdsByGroupId.set(member.familyGroupId, ids)
  }

  const headers: FamilyGroupHeaderNode[] = []
  for (const group of familyGroups) {
    if (collapsedGroupIds.has(group.id)) continue
    const memberIds = personIdsByGroupId.get(group.id) ?? new Set<string>()
    const positions = [...memberIds]
      .map((personId) => positionById.get(personId))
      .filter((position): position is { x: number; y: number } => position !== undefined)
    // A group with nobody currently on screen has nothing to label; the
    // toggle list in the corner remains the way to reach it.
    if (positions.length === 0) continue

    // Anchored to the leftmost member OF THE TOPMOST ROW, not to the
    // minimum x and minimum y taken independently — for a family whose
    // people are scattered, those two minima can come from different
    // members and put the header above empty canvas, detached from anyone
    // it names. Taking both from the same row keeps it over a real member.
    const topRowY = Math.min(...positions.map((position) => position.y))
    const topRowLeftX = Math.min(
      ...positions.filter((position) => position.y === topRowY).map((position) => position.x),
    )

    headers.push({
      id: `group-header:${group.id}`,
      type: 'familyGroupHeader',
      position: { x: topRowLeftX, y: topRowY - GROUP_HEADER_OFFSET },
      selectable: false,
      draggable: false,
      data: { familyGroup: group, memberCount: memberIds.size },
    })
  }
  return headers
}

/**
 * Which rows a node occupies horizontally. Almost every node sits on one
 * row, but a collapsed group container reaches across every generation
 * its members span — so the rows underneath it have to know it is there,
 * or their bands and labels get drawn straight through it.
 */
function rowContributions(node: FamilyNode): { y: number; left: number; right: number }[] {
  const left = node.position.x
  const right = left + nodeWidth(node)
  if (node.type !== 'familyGroup') return [{ y: node.position.y, left, right }]

  const rowCount = Math.max(node.data.maxRank - node.data.minRank, 0) + 1
  return Array.from({ length: rowCount }, (_unused, index) => ({
    y: node.position.y + index * GENERATION_ROW_HEIGHT,
    left,
    right,
  }))
}

function measureRows(nodes: FamilyNode[]): Map<number, { minX: number; maxRight: number }> {
  const rowExtent = new Map<number, { minX: number; maxRight: number }>()
  for (const node of nodes) {
    for (const { y, left, right } of rowContributions(node)) {
      const current = rowExtent.get(y)
      if (!current) rowExtent.set(y, { minX: left, maxRight: right })
      else {
        current.minX = Math.min(current.minX, left)
        current.maxRight = Math.max(current.maxRight, right)
      }
    }
  }
  return rowExtent
}

/** One full-width tinted band per row, tiling seamlessly top-to-bottom (band height == row height) so alternating rows read as a subtle guide without any gap or overlap between them. */
function buildGenerationBands(nodes: FamilyNode[]): GenerationBandNode[] {
  if (nodes.length === 0) return []

  const rowExtent = measureRows(nodes)
  const sortedRowYs = [...rowExtent.keys()].sort((a, b) => a - b)
  return sortedRowYs.map((y, index) => {
    const { minX, maxRight } = rowExtent.get(y) as { minX: number; maxRight: number }
    const left = minX - GENERATION_LABEL_WIDTH - GENERATION_LABEL_GAP - BAND_SIDE_PADDING
    const width = maxRight - left + BAND_SIDE_PADDING
    return {
      id: `generation-band:${y}`,
      type: 'generationBand',
      position: { x: left, y },
      selectable: false,
      draggable: false,
      style: { width, height: GENERATION_ROW_HEIGHT },
      data: { alternate: index % 2 === 1 },
    }
  })
}

/** One "Gen N" label per distinct row, placed left of that row's leftmost node — purely a render-time overlay, never part of the adapter/rank/layout graph itself. */
function buildGenerationLabels(nodes: FamilyNode[]): GenerationLabelNode[] {
  if (nodes.length === 0) return []

  const rowExtent = measureRows(nodes)
  const sortedRowYs = [...rowExtent.keys()].sort((a, b) => a - b)
  return sortedRowYs.map((y, index) => ({
    id: `generation-label:${y}`,
    type: 'generationLabel',
    position: { x: (rowExtent.get(y)?.minX ?? 0) - GENERATION_LABEL_WIDTH - GENERATION_LABEL_GAP, y },
    selectable: false,
    draggable: false,
    data: { text: `Gen ${index + 1}` },
  }))
}

/**
 * A boundary edge stands for a relationship belonging to someone inside a
 * collapsed group, not to the group itself — so it is drawn in the same
 * vocabulary as the real edge it came from, just quieter. Deliberately no
 * label: Phase 4D removed per-instance edge text because it became noise,
 * and this would reintroduce exactly that.
 *
 * Routing is forced to smoothstep. A Union segment is normally a short
 * straight line between two partners standing side by side, but once one
 * of them is absorbed the other end can be most of the canvas away, and a
 * straight line across that distance reads as a long diagonal slash
 * through unrelated people. Orthogonal routing keeps it in the same
 * right-angled language as every other edge in the graph. This is a pure
 * rendering choice — React Flow's own edge type, no custom router — and
 * touches neither the relationship nor its rank.
 */
function applyBoundaryEdgeStyle(edges: FamilyEdge[]): FamilyEdge[] {
  return edges.map((edge) =>
    edge.data?.boundary
      ? { ...edge, type: 'smoothstep', style: { ...edge.style, opacity: 0.5 } }
      : edge,
  )
}

/** Centers the viewport on a single node when `focalPersonId` resolves to one currently on screen. Must render inside ReactFlowProvider. */
function FocalPersonCenterer({ focalPersonId, nodes }: { focalPersonId?: string; nodes: FamilyNode[] }) {
  const { fitView } = useReactFlow()

  useEffect(() => {
    if (!focalPersonId) return
    if (!nodes.some((node) => node.id === focalPersonId)) return
    // The glide is what preserves orientation when the viewpoint moves —
    // an instant jump loses the user. For anyone who has asked for less
    // motion, arriving instantly is the lesser harm.
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
    fitView({ nodes: [{ id: focalPersonId }], duration: prefersReducedMotion ? 0 : 300, maxZoom: 1.1 })
  }, [focalPersonId, nodes, fitView])

  return null
}

export function FamilyTreeCanvas({
  people,
  parentLinks,
  unions,
  familyGroups,
  familyGroupMembers,
  collapsedGroupIds,
  onToggleFamilyGroup,
  onSelectPerson,
  onBack,
  focalPersonId,
  onFocusPerson,
  focusHistory,
  onFocusBack,
  claimedPersonId,
  shouldPromptForFocus,
  onDismissFocusPrompt,
}: FamilyTreeCanvasProps) {
  /**
   * Selection and focus are different things. Selecting asks "who is
   * this?"; focusing changes the viewpoint. A click does the first and
   * offers the second, so the user's perspective never moves without
   * them saying so.
   */
  const [inspectedPersonId, setInspectedPersonId] = useState<string | null>(null)
  const baseGraph = useMemo(
    () => buildFamilyGraph(people, parentLinks, unions),
    [people, parentLinks, unions],
  )

  // Ranks come from the genealogy graph and are computed BEFORE any view
  // or group is projected, then handed to layout unchanged. That is what
  // makes a person's generation independent of both what is collapsed and
  // how the family is currently being looked at.
  const genealogyRanks = useMemo(() => computeRanks(baseGraph.nodes, baseGraph.edges), [baseGraph])

  /**
   * The pipeline, in full:
   *
   *   buildFamilyGraph  →  computeRanks  →  projectFamilyTreeView
   *     →  projectFamilyGroups  →  layoutFamilyGraph  →  React Flow
   *
   * Views are presentation projections. They never modify genealogy facts
   * and must not be ranked independently — the canonical ranks above are
   * threaded through every stage untouched.
   *
   * Only `full` exists today, and it is an identity projection: the nodes,
   * edges and ranks come back by reference, so inserting this seam changed
   * nothing that reaches the layout.
   */
  const viewGraph = useMemo(
    () => projectFamilyTreeView(baseGraph, genealogyRanks, { view: 'full', focalPersonId }),
    [baseGraph, genealogyRanks, focalPersonId],
  )

  // Destructured deliberately. The full view ignores focalPersonId, so
  // these three are the same references whoever is focused — depending on
  // them rather than on `viewGraph` keeps a change of viewpoint from
  // re-running the group projection and re-laying out the whole tree.
  const { nodes: viewNodes, edges: viewEdges, ranks: viewRanks } = viewGraph

  // The genealogy graph is built first and never altered; collapsing is a
  // pure projection layered on top of it, so toggling a group can only
  // ever change what is drawn — never a ParentLink, Union, or membership.
  const projectedGraph = useMemo(
    () =>
      projectFamilyGroups(
        { nodes: viewNodes, edges: viewEdges },
        familyGroups,
        familyGroupMembers,
        collapsedGroupIds,
        viewRanks,
      ),
    [viewNodes, viewEdges, viewRanks, familyGroups, familyGroupMembers, collapsedGroupIds],
  )

  const [layoutedNodes, setLayoutedNodes] = useState<FamilyNode[]>([])
  const [isLayouting, setIsLayouting] = useState(true)

  /**
   * Comparison is an explicit mode rather than a modifier key: a plain
   * click must keep opening a profile (and there is no modifier key to
   * hold on a phone). While it is on, clicking people picks the pair
   * instead of navigating away from the tree.
   */
  const [isComparing, setIsComparing] = useState(false)
  const [comparisonIds, setComparisonIds] = useState<string[]>([])
  const [preferredByPair, setPreferredByPair] = useState<Record<string, string>>({})

  const peopleById = useMemo(() => new Map(people.map((person) => [person.id, person])), [people])
  const [comparisonAId, comparisonBId] = comparisonIds
  const comparisonPairKey = comparisonIds.length === 2 ? [...comparisonIds].sort().join('|') : null

  /**
   * Resolved from the UNDERLYING genealogy, never from the projected
   * graph — collapsing a family group is a drawing decision and must not
   * change what two people are to each other. Only runs when a full pair
   * is selected or the records themselves change.
   */
  const relationships = useMemo(() => {
    if (!comparisonAId || !comparisonBId) return []
    return resolveRelationships(comparisonAId, comparisonBId, { people, parentLinks, unions })
  }, [comparisonAId, comparisonBId, people, parentLinks, unions])

  function toggleComparisonMode() {
    setIsComparing((comparing) => !comparing)
    setComparisonIds([])
  }

  function pickForComparison(personId: string) {
    setComparisonIds((current) => {
      if (current.includes(personId)) return current.filter((id) => id !== personId)
      // A third pick starts a fresh pair from that person.
      return current.length >= 2 ? [personId] : [...current, personId]
    })
  }

  useEffect(() => {
    let cancelled = false
    setIsLayouting(true)
    layoutFamilyGraph(projectedGraph.nodes, projectedGraph.edges, projectedGraph.ranks).then((positioned) => {
      if (cancelled) return
      setLayoutedNodes(positioned)
      setIsLayouting(false)
    })
    return () => {
      cancelled = true
    }
  }, [projectedGraph])

  const edges = useMemo(() => applyBoundaryEdgeStyle(projectedGraph.edges), [projectedGraph])

  const generationLabels = useMemo(() => buildGenerationLabels(layoutedNodes), [layoutedNodes])
  const generationBands = useMemo(() => buildGenerationBands(layoutedNodes), [layoutedNodes])

  // The toggle is injected here rather than produced by the projection —
  // groupProjection.ts stays a pure data transform with no UI concerns.
  const interactiveNodes = useMemo<Node[]>(
    () =>
      layoutedNodes.map((node) => {
        if (node.type === 'familyGroup') {
          return {
            ...node,
            // The container reaches across every generation its members
            // occupy, so its height is derived from that span.
            style: { height: familyGroupNodeHeight(node.data.minRank, node.data.maxRank) },
            data: { ...node.data, onToggle: () => onToggleFamilyGroup(node.data.familyGroup.id) },
          }
        }
        if (node.type === 'person') {
          const index = comparisonIds.indexOf(node.id)
          const isFocal = node.id === focalPersonId
          if (index !== -1 || isFocal) {
            return {
              ...node,
              data: {
                ...node.data,
                ...(index !== -1 && { comparisonRole: index === 0 ? 'a' : 'b' }),
                ...(isFocal && { isFocal: true }),
              },
            }
          }
        }
        return node
      }),
    [layoutedNodes, onToggleFamilyGroup, comparisonIds, focalPersonId],
  )

  const groupHeaders = useMemo<Node[]>(
    () =>
      buildFamilyGroupHeaders(layoutedNodes, familyGroups, familyGroupMembers, collapsedGroupIds).map((header) => ({
        ...header,
        data: { ...header.data, onToggle: () => onToggleFamilyGroup(header.data.familyGroup.id) },
      })),
    [layoutedNodes, familyGroups, familyGroupMembers, collapsedGroupIds, onToggleFamilyGroup],
  )

  const displayNodes = useMemo<Node[]>(
    () => [...generationBands, ...interactiveNodes, ...generationLabels, ...groupHeaders],
    [generationBands, interactiveNodes, generationLabels, groupHeaders],
  )

  // Only a person is interactive here. Family groups toggle via their own
  // button (so keyboard activation works), junctions and the generation
  // overlays do nothing at all. In comparison mode a person is picked for
  // the pair instead; otherwise a click opens the inspector, which offers
  // the profile and the viewpoint as two explicit choices rather than
  // silently doing either.
  const handleNodeClick: NodeMouseHandler = (_event, node) => {
    if (node.type !== 'person') return
    if (isComparing) pickForComparison(node.id)
    else setInspectedPersonId(node.id)
  }

  const inspectedPerson = inspectedPersonId ? peopleById.get(inspectedPersonId) : undefined

  return (
    <div className="tree-canvas">
      <div className="tree-canvas__header">
        <button type="button" className="tree-canvas__back" onClick={onBack}>
          ← Back to family tree
        </button>
        <FocusBreadcrumb
          history={focusHistory}
          focalPersonId={focalPersonId ?? null}
          claimedPersonId={claimedPersonId}
          peopleById={peopleById}
          onBack={onFocusBack}
        />
      </div>

      {shouldPromptForFocus && (
        <p className="tree-canvas__focus-prompt">
          <span>Pick someone to explore the tree from their point of view.</span>
          <button type="button" className="tree-canvas__focus-dismiss" onClick={onDismissFocusPrompt}>
            Not now
          </button>
        </p>
      )}

      <div className="tree-canvas__viewport">
        {isLayouting && layoutedNodes.length === 0 ? (
          <p className="tree-canvas__status">Laying out your family tree…</p>
        ) : (
          <ReactFlowProvider>
            <ReactFlow
              nodes={displayNodes}
              edges={edges}
              nodeTypes={NODE_TYPES}
              onNodeClick={handleNodeClick}
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable
              fitView={!focalPersonId}
              proOptions={{ hideAttribution: true }}
            >
              <Background gap={24} />
              <Controls showInteractive={false} />
              <Panel position="top-left">
                <button
                  type="button"
                  className={
                    isComparing ? 'tree-canvas__compare tree-canvas__compare--on' : 'tree-canvas__compare'
                  }
                  aria-pressed={isComparing}
                  onClick={toggleComparisonMode}
                >
                  {isComparing ? 'Comparing — pick two people' : 'Compare people'}
                </button>
              </Panel>
              {familyGroups.length > 0 && (
                <Panel position="top-right">
                  <FamilyGroupTogglePanel
                    familyGroups={familyGroups}
                    collapsedGroupIds={collapsedGroupIds}
                    onToggle={onToggleFamilyGroup}
                  />
                </Panel>
              )}
              <FocalPersonCenterer focalPersonId={focalPersonId} nodes={layoutedNodes} />
            </ReactFlow>
          </ReactFlowProvider>
        )}

        {inspectedPerson && !isComparing && (
          <PersonInspector
            person={inspectedPerson}
            isFocal={inspectedPerson.id === focalPersonId}
            onFocus={() => {
              onFocusPerson(inspectedPerson.id)
              setInspectedPersonId(null)
            }}
            onOpenProfile={() => onSelectPerson(inspectedPerson.id)}
            onClose={() => setInspectedPersonId(null)}
          />
        )}

        {comparisonPairKey && comparisonAId && comparisonBId && (
          <RelationshipPanel
            personA={peopleById.get(comparisonAId) as Person}
            personB={peopleById.get(comparisonBId) as Person}
            relationships={relationships}
            peopleById={peopleById}
            preferredRelationshipId={
              preferredByPair[comparisonPairKey] ?? relationships[0]?.id ?? null
            }
            onSelectPreferred={(relationshipId) =>
              setPreferredByPair((current) => ({ ...current, [comparisonPairKey]: relationshipId }))
            }
            onClear={() => setComparisonIds([])}
          />
        )}
      </div>
    </div>
  )
}

/**
 * Collapsing needs an entry point that exists while a group is EXPANDED —
 * and an expanded group has no node on the canvas by design (its members
 * are simply drawn normally). So the canvas carries a small list of the
 * tree's groups: collapse from here, and expand either from here or by
 * activating the collapsed group's node in the graph.
 *
 * The list itself is a disclosure. Left permanently open it took roughly
 * a third of the width of a 375px screen and sat on top of the tree; on a
 * phone it now starts as a single small button and opens over the canvas
 * only while in use. On a wider screen there is room to leave it open, so
 * it starts that way and stays glanceable.
 */
function FamilyGroupTogglePanel({
  familyGroups,
  collapsedGroupIds,
  onToggle,
}: {
  familyGroups: FamilyGroup[]
  collapsedGroupIds: ReadonlySet<string>
  onToggle: (familyGroupId: string) => void
}) {
  const [isOpen, setIsOpen] = useState(
    () => !window.matchMedia('(max-width: 480px)').matches,
  )
  const collapsedCount = familyGroups.filter((group) => collapsedGroupIds.has(group.id)).length

  return (
    <div className="tree-canvas__groups">
      <button
        type="button"
        className="tree-canvas__groups-summary"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
      >
        <span className="tree-canvas__groups-disclosure" aria-hidden="true">
          {isOpen ? '▼' : '▶'}
        </span>
        <span className="tree-canvas__groups-title">Family Groups</span>
        <span className="tree-canvas__groups-badge">
          {collapsedCount > 0 ? `${collapsedCount} collapsed` : familyGroups.length}
        </span>
      </button>

      {isOpen && (
        <ul className="tree-canvas__groups-list">
          {familyGroups.map((group) => {
            const isExpanded = !collapsedGroupIds.has(group.id)
            return (
              <li key={group.id}>
                <button
                  type="button"
                  className="tree-canvas__groups-toggle"
                  aria-expanded={isExpanded}
                  onClick={() => onToggle(group.id)}
                >
                  <span className="tree-canvas__groups-disclosure" aria-hidden="true">
                    {isExpanded ? '▼' : '▶'}
                  </span>
                  <span className="tree-canvas__groups-name">{group.name}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
