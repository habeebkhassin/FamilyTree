import { useEffect, useMemo, useRef, useState } from 'react'
import { Background, Controls, ReactFlow, ReactFlowProvider, useReactFlow, useStore } from '@xyflow/react'
import type { Node, NodeMouseHandler } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { FamilyGroup, FamilyGroupMember, ParentLink, Person, Union } from '../../types'
import { buildFamilyGraph } from './graphAdapter'
import { projectFamilyGroups } from './groupProjection'
import { emphasisFor, projectFamilyTreeView } from './viewProjection'
import { styleEdgesForView } from './viewEmphasis'
import { centreOnHousehold } from './focalCentering'
import type { ImplementedView } from './viewTypes'
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
import { IconButton } from '../../components/AppShell'
import { FocusBreadcrumb } from './FocusBreadcrumb'
import { PersonInspector } from './PersonInspector'
import type { FamilyNode } from './types'
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

/** Short enough that four of them still read as one small control. */
const VIEW_LABELS: Record<ImplementedView, string> = {
  full: 'Everyone',
  'my-family': 'My family',
  lineage: 'Lineage',
  descendants: 'Descendants',
}

/**
 * How small a person's card may be drawn in the Everyone overview, in real
 * screen pixels — Phase 5C-13.
 *
 * Everyone is meant to read as the whole map, and centring on one person
 * at full size showed thirteen people of fifty. Fitting the entire graph
 * instead is worse than useless: a fifty-person family is 3281px wide, so
 * it lands at scale 0.42, where a card is 68px and a name needing 119px
 * has nowhere to go.
 *
 * The limit is stated as a card width rather than a zoom because that is
 * the thing that actually has to stay legible, and because a phone card is
 * already narrower than a desktop one — one zoom number would mean two
 * different reading experiences. Below roughly this width the view stops
 * being an overview of anything and becomes a diagram of boxes.
 */
const OVERVIEW_MIN_CARD_PX = 112

/**
 * Breathing room around the overview frame, as fitView understands it.
 * Folded back into the window size below so the frame still lands at the
 * card width above rather than a little under it.
 */
const OVERVIEW_PADDING = 0.02

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
 * Frames the viewport around the focal person when they are on screen.
 * Must render inside ReactFlowProvider.
 *
 * `framingIds` is what the camera should try to fit, always including the
 * focal person. Centring on the focal person alone is right for a view
 * that reaches equally in every direction, and wrong for one that does
 * not: Lineage and Descendants extend almost entirely upward or downward,
 * so half the viewport was being spent on empty canvas while the content
 * ran off the opposite edge. See `framingIds` at the call site.
 */
function FocalPersonCenterer({
  focalPersonId,
  framingIds,
  overview,
  nodes,
  recentreTick,
}: {
  focalPersonId?: string
  framingIds: readonly string[]
  /** Everyone only: widen the frame to as much family as stays readable. */
  overview: boolean
  nodes: FamilyNode[]
  /**
   * Bumped when somebody asks to be taken back to the current person.
   *
   * A dependency rather than a second camera: after panning away, the
   * frame this component already knows how to compute is exactly the one
   * you want back, so re-running it is the whole feature.
   */
  recentreTick: number
}) {
  const { fitView } = useReactFlow()
  // The pane's own width, which only something inside the provider can
  // know. It is what decides how much family fits at the readable floor.
  const paneWidth = useStore((state) => state.width)

  /**
   * The overview frame: everyone within the widest window that still
   * leaves a card readable, centred on the focal person.
   *
   * Centred on the person rather than on the graph, and that is the whole
   * reason this is a node set instead of a `minZoom` option. Handing
   * fitView a zoom floor and the whole graph makes it centre the GRAPH,
   * which puts somebody at the edge of a five-generation family off screen
   * entirely. Choosing the nodes keeps the focal person in the middle of
   * whatever is shown, and still goes through the single fitView call
   * every other view uses.
   *
   * When the family is small enough to fit inside the window, this selects
   * all of it and the result is an ordinary fit of the whole graph.
   */
  const overviewIds = useMemo<readonly string[] | null>(() => {
    if (!overview || !focalPersonId || paneWidth <= 0) return null
    const focal = nodes.find((node) => node.id === focalPersonId)
    if (!focal) return null

    // The card's own CSS width, taken from the node the layout measured
    // rather than assumed, so the phone breakpoint is accounted for
    // without this needing to know the breakpoint exists.
    const cardWidth = nodeWidth(focal)
    const minZoom = OVERVIEW_MIN_CARD_PX / cardWidth
    const usableWidth = paneWidth * (1 - 2 * OVERVIEW_PADDING)
    // The frame's bounding box runs from the left edge of the leftmost
    // card to the right edge of the rightmost, so it is one whole card
    // wider than the span between their centres. Measuring from centres
    // without allowing for that made every frame a card too wide, and the
    // zoom that much too low.
    const windowWidth = usableWidth / minZoom
    const halfWindow = Math.max(0, (windowWidth - cardWidth) / 2)

    const focalCentre = focal.position.x + cardWidth / 2
    const framed = nodes
      .filter((node) => {
        if (node.type !== 'person') return false
        return Math.abs(node.position.x + nodeWidth(node) / 2 - focalCentre) <= halfWindow
      })
      .map((node) => node.id)
    return framed.includes(focalPersonId) ? framed : [focalPersonId, ...framed]
  }, [overview, focalPersonId, paneWidth, nodes])

  useEffect(() => {
    if (!focalPersonId) return
    if (!nodes.some((node) => node.id === focalPersonId)) return
    // The glide is what preserves orientation when the viewpoint moves —
    // an instant jump loses the user. For anyone who has asked for less
    // motion, arriving instantly is the lesser harm.
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
    // maxZoom is unchanged, so a small frame never blows a lone person up
    // larger than they have ever been drawn.
    fitView({
      nodes: (overviewIds ?? framingIds).map((id) => ({ id })),
      duration: prefersReducedMotion ? 0 : 300,
      maxZoom: 1.1,
      ...(overviewIds ? { padding: OVERVIEW_PADDING } : {}),
    })
  }, [focalPersonId, framingIds, overviewIds, nodes, fitView, recentreTick])

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

  /**
   * Which view is on. Not persisted: a viewpoint is worth remembering,
   * but which lens you last used is not, and reopening the tree in a
   * narrowed frame you had forgotten choosing would be disorienting.
   */
  const [view, setView] = useState<ImplementedView>('full')
  // My Family is measured from somebody; with nobody focused there is
  // nothing to measure from, so the toggle is not offered.
  const canUseMyFamily = Boolean(focalPersonId)
  const activeView: ImplementedView = canUseMyFamily ? view : 'full'
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
    () => projectFamilyTreeView(baseGraph, genealogyRanks, { view: activeView, focalPersonId }),
    [baseGraph, genealogyRanks, focalPersonId, activeView],
  )

  // Destructured deliberately. The full view ignores focalPersonId, so
  // these three are the same references whoever is focused — depending on
  // them rather than on `viewGraph` keeps a change of viewpoint from
  // re-running the group projection and re-laying out the whole tree.
  const { nodes: viewNodes, edges: viewEdges, ranks: viewRanks, familyUnits } = viewGraph

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
      // A uniform translation, applied only in My Family: it puts the
      // focal household at the origin so ancestors and descendants
      // radiate from where you are standing. Every relative position
      // layout.ts worked out survives untouched, and y is never altered,
      // so generations keep meaning exactly what they meant.
      setLayoutedNodes(
        activeView === 'my-family'
          ? centreOnHousehold(positioned, focalPersonId, familyUnits)
          : positioned,
      )
      setIsLayouting(false)
    })
    return () => {
      cancelled = true
    }
  }, [projectedGraph, activeView, focalPersonId, familyUnits])

  /**
   * What the camera should try to fit on first paint, and whenever the
   * viewpoint or view changes.
   *
   * My Family reaches in every direction from the focal person and is
   * already bounded to a few generations around them, so centring is the
   * whole answer and it is left exactly as it was. Lineage and Descendants
   * are not: their content sits almost entirely above or below, so
   * centring spent half the viewport on empty canvas and pushed the answer
   * off the opposite edge — on a fifty-person tree Descendants showed five
   * people of thirty-eight.
   *
   * Everyone is handled by the camera itself, which is the only place that
   * knows how wide the pane is — see `overviewIds` in
   * FocalPersonCenterer.
   *
   * The frame is the view's own PRIMARY tier, which the projection has
   * already worked out: the focal person and their parents in Lineage,
   * the focal person and their children in Descendants. So the camera asks
   * the view what it is about rather than deciding for itself, and no
   * genealogy is re-derived here.
   *
   * Only the primary tier, deliberately. Reaching one tier further looked
   * better on a small family and fell apart on a large one: a generation
   * of a dozen people is wide, and fitting that width drove the zoom down
   * to the point where names truncated to initials and the focal person
   * became a small box in a corner. A frame that shows everything at a
   * size nobody can read has answered the wrong question. Later
   * generations stay off the initial frame on purpose; they are still
   * there to pan to, and the hidden-count notice already says the family
   * continues.
   */
  const framingIds = useMemo<readonly string[]>(() => {
    if (!focalPersonId) return []
    if (activeView !== 'lineage' && activeView !== 'descendants') return [focalPersonId]
    const framed = layoutedNodes
      .filter((node) => node.type === 'person' && emphasisFor(viewGraph, node.id) === 'primary')
      .map((node) => node.id)
    // The focal person anchors the frame even if a collapsed group has
    // taken every relative off the canvas.
    return framed.includes(focalPersonId) ? framed : [focalPersonId, ...framed]
  }, [focalPersonId, activeView, layoutedNodes, viewGraph])

  // People this view does not reach. Counted against the real people
  // rather than the hidden node count: a union junction is a drawing
  // device, and counting those would tell someone their tree holds more
  // people than it does.
  const hiddenCount = useMemo(
    () => [...viewGraph.hiddenNodeIds].filter((id) => peopleById.has(id)).length,
    [viewGraph, peopleById],
  )

  // Restyled per view, not per graph: emphasis changes when the viewpoint
  // moves, while the edges themselves do not.
  const edges = useMemo(
    () => styleEdgesForView(projectedGraph.edges, viewGraph),
    [projectedGraph, viewGraph],
  )

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
        if (node.type === 'person' || node.type === 'unionJunction') {
          const index = node.type === 'person' ? comparisonIds.indexOf(node.id) : -1
          const isFocal = node.id === focalPersonId
          // Absent from the map means `primary`, which is what every node
          // gets when nobody is focused — so an unfocused tree is drawn
          // exactly as it always was.
          const emphasis = emphasisFor(viewGraph, node.id)
          const familyUnit = familyUnits.get(node.id)
          if (index === -1 && !isFocal && emphasis === 'primary' && !familyUnit) return node

          return {
            ...node,
            data: {
              ...node.data,
              ...(index !== -1 && { comparisonRole: index === 0 ? 'a' : 'b' }),
              ...(isFocal && { isFocal: true }),
              ...(emphasis !== 'primary' && { emphasis }),
              ...(familyUnit && { familyUnit }),
            },
          }
        }
        return node
      }),
    [layoutedNodes, onToggleFamilyGroup, comparisonIds, focalPersonId, viewGraph, familyUnits],
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

  const [recentreTick, setRecentreTick] = useState(0)
  const recentreOnFocalPerson = () => setRecentreTick((tick) => tick + 1)

  /**
   * How far out the tree may be zoomed — Phase 2.
   *
   * Derived rather than fixed, because one number cannot serve both
   * screens. A floor low enough to fit a fifty-person family on a phone
   * leaves a desktop able to zoom until the family is a smudge in the
   * middle of an empty canvas; a floor that suits a desktop traps a phone
   * inside one branch.
   *
   * So the floor is just past what it takes to see everything: the scale
   * at which the whole family fits this viewport, with a little slack so
   * there is somewhere to go, and never further. Falls back to React
   * Flow's own default until the first measurement arrives.
   */
  const viewportRef = useRef<HTMLDivElement>(null)
  const [viewportWidth, setViewportWidth] = useState(0)

  useEffect(() => {
    const element = viewportRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setViewportWidth(entry.contentRect.width)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const minZoom = useMemo(() => {
    const people = layoutedNodes.filter((node) => node.type === 'person')
    if (viewportWidth <= 0 || people.length === 0) return 0.5
    const xs = people.map((node) => node.position.x)
    const graphWidth = Math.max(...xs) - Math.min(...xs) + nodeWidth(people[0] as FamilyNode)
    const fitsEverything = viewportWidth / graphWidth
    // A little past "everything fits", and never further out than a tenth.
    return Math.min(0.5, Math.max(0.1, fitsEverything * 0.8))
  }, [layoutedNodes, viewportWidth])

  const inspectedPerson = inspectedPersonId ? peopleById.get(inspectedPersonId) : undefined

  return (
    <div className="tree-canvas">
      <div className="tree-canvas__header">
        <FocusBreadcrumb
          history={focusHistory}
          focalPersonId={focalPersonId ?? null}
          claimedPersonId={claimedPersonId}
          peopleById={peopleById}
          onBack={onFocusBack}
        />

        {/*
          The occasional tools, as icons on the header row rather than
          panels floating over the family — Phase 2. Between them they used
          to cover both top corners of the canvas, which on a phone is a
          large share of the tree.
        */}
        <div className="tree-canvas__tools">
          {focalPersonId && (
            <IconButton label="Centre on the current person" onClick={recentreOnFocalPerson}>
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <circle cx="12" cy="12" r="3.2" />
                  <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
                </g>
              </svg>
            </IconButton>
          )}
          <IconButton
            label={isComparing ? 'Stop comparing' : 'Compare two people'}
            aria-pressed={isComparing}
            className={isComparing ? 'icon-button--on' : undefined}
            onClick={toggleComparisonMode}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <circle cx="7.5" cy="8" r="3" />
                <circle cx="16.5" cy="8" r="3" />
                <path d="M3 19c0-2.5 2-4.2 4.5-4.2S12 16.5 12 19M12 19c0-2.5 2-4.2 4.5-4.2S21 16.5 21 19" />
              </g>
            </svg>
          </IconButton>
          {familyGroups.length > 0 && (
            <FamilyGroupTogglePanel
              familyGroups={familyGroups}
              collapsedGroupIds={collapsedGroupIds}
              onToggle={onToggleFamilyGroup}
            />
          )}
        </div>

        {canUseMyFamily && (
          <div className="tree-canvas__views" role="group" aria-label="Which view of the family">
            {(['full', 'my-family', 'lineage', 'descendants'] as const).map((candidate) => (
              <button
                key={candidate}
                type="button"
                className={
                  activeView === candidate
                    ? 'tree-canvas__view tree-canvas__view--on'
                    : 'tree-canvas__view'
                }
                aria-pressed={activeView === candidate}
                onClick={() => setView(candidate)}
              >
                {VIEW_LABELS[candidate]}
              </button>
            ))}
          </div>
        )}
      </div>

      {/*
        A framed view must never let the family appear to end at its edge.
        The wording stays neutral about WHY somebody is absent: in Lineage
        most of those hidden are not distant forebears at all but siblings,
        cousins and children, and calling them "further out" would describe
        them wrongly.
      */}
      {activeView !== 'full' && hiddenCount > 0 && (
        <p className="tree-canvas__beyond" role="status">
          {hiddenCount} other {hiddenCount === 1 ? 'person is' : 'people are'} outside this view.{' '}
          <button type="button" className="tree-canvas__beyond-action" onClick={() => setView('full')}>
            Show everyone
          </button>
        </p>
      )}

      {shouldPromptForFocus && (
        <p className="tree-canvas__focus-prompt">
          <span>Pick someone to explore the tree from their point of view.</span>
          <button type="button" className="tree-canvas__focus-dismiss" onClick={onDismissFocusPrompt}>
            Not now
          </button>
        </p>
      )}

      <div className="tree-canvas__viewport" ref={viewportRef}>
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
              /*
                Far enough out to take in a whole family — Phase 2.

                React Flow's default floor of 0.5 could not do it: a
                React Flow's default floor of 0.5 could not take in a
                whole family: fifty people are over 3200px wide, so half
                scale still needs a 1600px window and a phone has 390.
                The floor is now measured from the family and the screen —
                see `minZoom` above.
              */
              minZoom={minZoom}
              maxZoom={2}
              proOptions={{ hideAttribution: true }}
            >
              <Background gap={28} />
              {/*
                Kept for a mouse, hidden on a phone by CSS: pinch already
                zooms, and three stacked buttons over a small canvas cost
                more than they give.
              */}
              <Controls showInteractive={false} showFitView={false} />
              <FocalPersonCenterer
                focalPersonId={focalPersonId}
                framingIds={framingIds}
                overview={activeView === 'full'}
                nodes={layoutedNodes}
                recentreTick={recentreTick}
              />
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
 * Phase 2 moved it off the canvas and onto the header row, where it is one
 * icon until tapped. Left open in the corner of the tree it covered
 * people, which on a phone is a real share of the family; a popover costs
 * nothing until somebody wants it.
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
  // Closed everywhere: it is a popover on the header row now, not a panel
  // that has room to sit open.
  const [isOpen, setIsOpen] = useState(false)
  const collapsedCount = familyGroups.filter((group) => collapsedGroupIds.has(group.id)).length

  return (
    <div className="tree-canvas__groups">
      <button
        type="button"
        className={
          collapsedCount > 0
            ? 'icon-button tree-canvas__groups-trigger icon-button--on'
            : 'icon-button tree-canvas__groups-trigger'
        }
        aria-expanded={isOpen}
        aria-label={
          collapsedCount > 0
            ? `Family Groups, ${collapsedCount} collapsed`
            : `Family Groups, ${familyGroups.length}`
        }
        title="Family Groups"
        onClick={() => setIsOpen((open) => !open)}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3.5" y="4.5" width="17" height="6" rx="2" />
            <rect x="3.5" y="13.5" width="17" height="6" rx="2" />
          </g>
        </svg>
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
