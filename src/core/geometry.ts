import { getStroke } from 'perfect-freehand'
import type { ArrowSettings } from '../shared/types'

export interface Point {
  x: number
  y: number
}

export type AffineTransform = [
  [number, number, number],
  [number, number, number],
]

export interface ArrowGeometry {
  /** The individual, non-self-intersecting filled shaft outlines in paint order. */
  shaftPaths: string[]
  /** @deprecated Prefer shaftPaths. Kept for consumers of the original geometry API. */
  shaftPath: string
  shaftSegments: Point[][]
  headPath: string
  points: Point[]
  start: Point
  end: Point
  shaftEnd: Point
  endTangent: Point
  headLength: number
  crossing?: PathCrossing
  loop?: LoopGeometry
}

export interface PathCrossing {
  point: Point
  firstVisitIndex: number
  secondVisitIndex: number
  overpass: 'tail'
  /** Centreline distance removed from the lower pass before its second visit. */
  gap: number
}

export interface LoopGeometry {
  axis: Point
  center: Point
  width: number
  height: number
}

export interface ConnectionResult {
  start: Point
  end: Point
  sourceOrder: [number, number]
}

const EPSILON = 1e-7

export function transformPoint(transform: AffineTransform, point: Point): Point {
  return {
    x: transform[0][0] * point.x + transform[0][1] * point.y + transform[0][2],
    y: transform[1][0] * point.x + transform[1][1] * point.y + transform[1][2],
  }
}

export function invertTransform(transform: AffineTransform): AffineTransform {
  const [[a, c, tx], [b, d, ty]] = transform
  const determinant = a * d - b * c
  if (Math.abs(determinant) < EPSILON) throw new Error('Transform is not invertible')
  const inverse = 1 / determinant
  return [
    [d * inverse, -c * inverse, (c * ty - d * tx) * inverse],
    [-b * inverse, a * inverse, (b * tx - a * ty) * inverse],
  ]
}

export function multiplyTransforms(a: AffineTransform, b: AffineTransform): AffineTransform {
  return [
    [
      a[0][0] * b[0][0] + a[0][1] * b[1][0],
      a[0][0] * b[0][1] + a[0][1] * b[1][1],
      a[0][0] * b[0][2] + a[0][1] * b[1][2] + a[0][2],
    ],
    [
      a[1][0] * b[0][0] + a[1][1] * b[1][0],
      a[1][0] * b[0][1] + a[1][1] * b[1][1],
      a[1][0] * b[0][2] + a[1][1] * b[1][2] + a[1][2],
    ],
  ]
}

export function lineEndpoints(width: number, absoluteTransform: AffineTransform): [Point, Point] {
  return [
    transformPoint(absoluteTransform, { x: 0, y: 0 }),
    transformPoint(absoluteTransform, { x: width, y: 0 }),
  ]
}

export function rectangleCorners(
  width: number,
  height: number,
  absoluteTransform: AffineTransform,
): Point[] {
  return [
    transformPoint(absoluteTransform, { x: 0, y: 0 }),
    transformPoint(absoluteTransform, { x: width, y: 0 }),
    transformPoint(absoluteTransform, { x: width, y: height }),
    transformPoint(absoluteTransform, { x: 0, y: height }),
  ]
}

export function connectPolygons(
  first: Point[],
  second: Point[],
  padding: number,
  minDistance = 24,
): ConnectionResult | null {
  if (first.length < 3 || second.length < 3) return null
  if (convexPolygonsOverlap(first, second)) return null
  const centers = [polygonCenter(first), polygonCenter(second)] as const
  const dx = centers[1].x - centers[0].x
  const dy = centers[1].y - centers[0].y
  const shouldSwap = Math.abs(dx) >= Math.abs(dy) ? dx < 0 : dy < 0
  const sourceOrder: [number, number] = shouldSwap ? [1, 0] : [0, 1]
  const polygons = [first, second]
  const startCenter = centers[sourceOrder[0]]
  const endCenter = centers[sourceOrder[1]]
  const direction = normalize(subtract(endCenter, startCenter))
  if (magnitude(direction) < EPSILON) return null

  const startBoundary = rayPolygonIntersection(
    startCenter,
    direction,
    polygons[sourceOrder[0]],
  )
  const endBoundary = rayPolygonIntersection(
    endCenter,
    scale(direction, -1),
    polygons[sourceOrder[1]],
  )
  if (!startBoundary || !endBoundary) return null

  const start = add(startBoundary, scale(direction, padding))
  const end = add(endBoundary, scale(direction, -padding))
  if (distance(start, end) < minDistance) return null
  return { start, end, sourceOrder }
}

function convexPolygonsOverlap(first: Point[], second: Point[]): boolean {
  for (const polygon of [first, second]) {
    for (let index = 0; index < polygon.length; index += 1) {
      const edge = subtract(polygon[(index + 1) % polygon.length], polygon[index])
      const axis = normalize(perpendicular(edge))
      if (magnitude(axis) < EPSILON) continue
      const firstProjection = projectPolygon(first, axis)
      const secondProjection = projectPolygon(second, axis)
      if (firstProjection.max <= secondProjection.min + EPSILON
        || secondProjection.max <= firstProjection.min + EPSILON) {
        return false
      }
    }
  }
  return true
}

function projectPolygon(points: Point[], axis: Point): { min: number; max: number } {
  const values = points.map((point) => point.x * axis.x + point.y * axis.y)
  return { min: Math.min(...values), max: Math.max(...values) }
}

export function generateArrowGeometry(
  inputStart: Point,
  inputEnd: Point,
  settings: ArrowSettings,
  seed: number,
): ArrowGeometry {
  const directDistance = distance(inputStart, inputEnd)
  if (directDistance < 4) throw new Error('Arrow path is too short')

  // Author the gesture once in the guide's original direction. Reversing an
  // arrow must only reverse that gesture; regenerating from swapped endpoints
  // changes the Loop template's orientation and produces a different shape.
  const canonicalLoopRoute = settings.style === 'loop' && directDistance >= 140
    ? createLoopRoute(inputStart, inputEnd, settings.curvature)
    : null
  const base = canonicalLoopRoute?.points ?? createNaturalPoints(inputStart, inputEnd, settings.curvature)
  const spacing = clamp(directDistance / 28, 5, 18)
  // The loop includes an intentional self-intersection. Preserve its authored
  // points exactly; resampling or random displacement separates the crossing
  // and makes it read as a circle pasted onto a line.
  const sampled = settings.style === 'loop' ? base : resamplePolyline(base, spacing)
  const canonicalRoughened = settings.style === 'loop'
    ? sampled.map((point) => ({ ...point }))
    : applyHandDrawnNoise(sampled, settings, seed)
  canonicalRoughened[0] = inputStart
  canonicalRoughened[canonicalRoughened.length - 1] = inputEnd
  const roughened = settings.reversed
    ? [...canonicalRoughened].reverse()
    : canonicalRoughened
  const start = settings.reversed ? inputEnd : inputStart
  const end = settings.reversed ? inputStart : inputEnd
  roughened[0] = start
  roughened[roughened.length - 1] = end

  const loopRoute = canonicalLoopRoute && settings.reversed
    ? {
        points: [...canonicalLoopRoute.points].reverse(),
        firstVisitIndex: roughened.length - 1 - canonicalLoopRoute.secondVisitIndex,
        secondVisitIndex: roughened.length - 1 - canonicalLoopRoute.firstVisitIndex,
        geometry: canonicalLoopRoute.geometry,
      }
    : canonicalLoopRoute

  const endTangent = tangentAtEnd(roughened)
  const headLength = clamp(
    settings.strokeWidth * settings.headScale * 5.325,
    settings.strokeWidth * 3.675,
    directDistance * 0.3,
  )
  // The shaft ends inside the filled head's base. The head is painted above it,
  // so no rounded shaft cap can protrude beyond the arrow tip.
  const shaftTrim = Math.max(settings.strokeWidth * 0.56, headLength * 0.57)
  let shaftSegments: Point[][]
  let crossing: PathCrossing | undefined
  if (loopRoute) {
    // Keep the lower pass visibly underneath without creating the detached,
    // white wedge that made the loop look like two pasted paths.
    const lowerGap = Math.max(settings.strokeWidth * 0.32, 2)
    const lower = trimPolylineEnd(
      roughened.slice(0, loopRoute.secondVisitIndex + 1),
      lowerGap,
    )
    const upper = trimPolylineEnd(
      roughened.slice(loopRoute.secondVisitIndex),
      shaftTrim,
    )
    shaftSegments = [lower, upper]
    crossing = {
      point: { ...roughened[loopRoute.secondVisitIndex] },
      firstVisitIndex: loopRoute.firstVisitIndex,
      secondVisitIndex: loopRoute.secondVisitIndex,
      overpass: 'tail',
      gap: lowerGap,
    }
  } else {
    shaftSegments = [trimPolylineEnd(roughened, shaftTrim)]
  }

  const shaftPaths = shaftSegments.map((segment, index) => createTaperedStrokeOutline(
    segment,
    settings,
    index === 0 && !loopRoute ? 'lead' : index === 0 ? 'lead' : 'steady',
  ))
  const shaftEnd = shaftSegments[shaftSegments.length - 1][shaftSegments[shaftSegments.length - 1].length - 1]
  const headPath = createRoundedArrowHeadPath(end, endTangent, headLength, settings.strokeWidth, seed)

  return {
    shaftPaths,
    shaftPath: shaftPaths[0],
    shaftSegments,
    headPath,
    points: roughened,
    start,
    end,
    shaftEnd,
    endTangent,
    headLength,
    crossing,
    loop: loopRoute?.geometry,
  }
}

export function tangentAtEnd(points: Point[]): Point {
  if (points.length < 2) return { x: 1, y: 0 }
  const end = points[points.length - 1]
  for (let index = points.length - 2; index >= 0; index -= 1) {
    const tangent = subtract(end, points[index])
    if (magnitude(tangent) > EPSILON) return normalize(tangent)
  }
  return { x: 1, y: 0 }
}

export function catmullRomToSvgPath(points: Point[]): string {
  if (points.length === 0) return ''
  if (points.length === 1) return `M ${formatPoint(points[0])}`
  const commands = [`M ${formatPoint(points[0])}`]
  for (let index = 0; index < points.length - 1; index += 1) {
    const p0 = points[Math.max(0, index - 1)]
    const p1 = points[index]
    const p2 = points[index + 1]
    const p3 = points[Math.min(points.length - 1, index + 2)]
    const c1 = add(p1, scale(subtract(p2, p0), 1 / 6))
    const c2 = subtract(p2, scale(subtract(p3, p1), 1 / 6))
    commands.push(`C ${formatPoint(c1)} ${formatPoint(c2)} ${formatPoint(p2)}`)
  }
  return commands.join(' ')
}

function createNaturalPoints(start: Point, end: Point, curvature: number): Point[] {
  const direction = normalize(subtract(end, start))
  const normal = perpendicular(direction)
  const length = distance(start, end)
  const signedCurve = Math.abs(curvature) < 0.015 ? 0 : curvature
  const control = add(
    midpoint(start, end),
    scale(normal, signedCurve * Math.min(length * 0.42, 240)),
  )
  const count = Math.max(12, Math.ceil(length / 18))
  return Array.from({ length: count + 1 }, (_, index) => {
    const t = index / count
    const oneMinus = 1 - t
    return add(
      add(scale(start, oneMinus * oneMinus), scale(control, 2 * oneMinus * t)),
      scale(end, t * t),
    )
  })
}

interface LoopRoute {
  points: Point[]
  firstVisitIndex: number
  secondVisitIndex: number
  geometry: LoopGeometry
}

function createLoopRoute(start: Point, end: Point, curvature: number): LoopRoute {
  const direction = normalize(subtract(end, start))
  const delta = subtract(end, start)
  const length = distance(start, end)
  const side = curvature < 0 ? -1 : 1
  const curveAmount = Math.max(0.12, Math.abs(curvature))
  // The style-picker preview is a single three-cubic gesture: rise into an
  // arch, curl back into a loop, then cross the first stroke and sweep out to
  // the arrow. Keep that authored rhythm instead of attaching an ellipse to a
  // mostly straight route.
  const horizontal = direction.x < 0 ? { x: -1, y: 0 } : { x: 1, y: 0 }
  const guideTilt = Math.atan2(cross(horizontal, direction), horizontal.x * direction.x)
  const loopAxis = rotate(horizontal, clamp(guideTilt * 0.12, -Math.PI / 30, Math.PI / 30))
  // A leftward gesture must be the horizontal mirror of a rightward one.
  // `perpendicular(loopAxis)` reverses its vertical component when loopAxis
  // points left, which rotates the template instead of mirroring it.
  const loopNormal = scale(perpendicular(loopAxis), horizontal.x)
  const horizontalSpan = clamp(Math.abs(dot(delta, loopAxis)), length * 0.58, length * 0.96)
  const curveHeight = clamp(length * (0.115 + curveAmount * 0.06), 38, 120)
  const endCorrection = subtract(delta, scale(loopAxis, horizontalSpan))
  const templateStart = { x: 8, y: 29 }
  const templateEnd = { x: 101, y: 25 }
  const templateWidth = templateEnd.x - templateStart.x
  const templateHeight = 20.25
  const mapTemplatePoint = (point: Point): Point => {
    const t = (point.x - templateStart.x) / templateWidth
    const baselineY = templateStart.y + (templateEnd.y - templateStart.y) * t
    const vertical = ((point.y - baselineY) / templateHeight) * curveHeight * side
    const eased = loopTargetWarp(clamp(t, 0, 1))
    return add(
      add(add(start, scale(loopAxis, horizontalSpan * t)), scale(endCorrection, eased)),
      scale(loopNormal, vertical),
    )
  }
  const templateSegments: [Point, Point, Point, Point][] = [
    [{ x: 8, y: 29 }, { x: 25, y: 8 }, { x: 49, y: 7 }, { x: 53, y: 19 }],
    [{ x: 53, y: 19 }, { x: 57, y: 31 }, { x: 36, y: 34 }, { x: 34, y: 20 }],
    [{ x: 34, y: 20 }, { x: 32, y: 8 }, { x: 71, y: 6 }, { x: 101, y: 25 }],
  ]
  const samplesPerSegment = Math.max(24, Math.ceil(length / 32))
  const mapped = joinSampledCubics(templateSegments.map(([from, first, second, to]) => (
    sampleCubic(from, first, second, to, samplesPerSegment).map(mapTemplatePoint)
  )))
  mapped[0] = { ...start }

  const intersection = findFirstPolylineSelfIntersection(mapped)
  if (!intersection) throw new Error('Loop template did not produce a crossing')
  const authoredLoopPoints = [
    intersection.point,
    ...mapped.slice(intersection.firstSegment + 1, intersection.secondSegment + 1),
    intersection.point,
  ]
  const authoredBounds = orientedBounds(authoredLoopPoints, loopAxis, loopNormal)
  const authoredCenter = add(
    scale(loopAxis, authoredBounds.axisCenter),
    scale(loopNormal, authoredBounds.normalCenter),
  )
  const loopDown = normalize(subtract(authoredCenter, intersection.point))
  let loopLeft = subtract(scale(loopAxis, -1), scale(loopDown, dot(scale(loopAxis, -1), loopDown)))
  if (magnitude(loopLeft) < EPSILON) loopLeft = scale(perpendicular(loopDown), -1)
  loopLeft = normalize(loopLeft)
  const loopHeight = Math.max(...authoredLoopPoints.map((point) => dot(
    subtract(point, intersection.point),
    loopDown,
 ))) * 1.18
  const loopWidth = Math.max(...authoredLoopPoints.map((point) => Math.abs(dot(
    subtract(point, intersection.point),
    loopLeft,
  )))) * 1.36
  const bottom = add(
    add(intersection.point, scale(loopDown, loopHeight)),
    scale(loopLeft, loopWidth * 0.12),
  )
  // A teardrop loop: leave the apex with a small outward sweep on the tight
  // right edge, then turn on a shared horizontal tangent at the bottom before
  // returning along the wider left edge. Keeping an outward component in the
  // first handle prevents the right side from reading as a straight drop.
  // The two independent tangents at the junction create the pointed cone tip.
  const loopPoints = joinSampledCubics([
    sampleCubic(
      intersection.point,
      add(
        add(intersection.point, scale(loopDown, loopHeight * 0.28)),
        scale(loopLeft, -loopWidth * 0.43),
      ),
      subtract(bottom, scale(loopLeft, loopWidth * 0.64)),
      bottom,
      24,
    ),
    sampleCubic(
      bottom,
      add(bottom, scale(loopLeft, loopWidth * 0.62)),
      add(intersection.point, scale(loopLeft, loopWidth * 0.78)),
      intersection.point,
      24,
    ),
  ])
  loopPoints[0] = { ...intersection.point }
  loopPoints[loopPoints.length - 1] = { ...intersection.point }
  const shapeNormal = perpendicular(loopLeft)
  const loopBounds = orientedBounds(loopPoints, loopLeft, shapeNormal)
  const loopCenter = add(
    scale(loopLeft, loopBounds.axisCenter),
    scale(shapeNormal, loopBounds.normalCenter),
  )
  const outward = normalize(subtract(intersection.point, loopCenter))
  const entryTangent = normalize(subtract(loopPoints[1], loopPoints[0]))
  const exitTangent = normalize(subtract(
    loopPoints[loopPoints.length - 1],
    loopPoints[loopPoints.length - 2],
  ))

  // The two long cubics are the two visible wave peaks; the authored loop sits
  // between them as the valley. Both peaks bow away from the loop centre, while
  // preserving the template's entry/exit tangents at the crossing.
  const approachDirection = normalize(subtract(intersection.point, start))
  let approachBulge = perpendicular(approachDirection)
  if (dot(approachBulge, outward) < 0) approachBulge = scale(approachBulge, -1)
  const startTangent = normalize(add(approachDirection, scale(approachBulge, 0.28)))
  const approachDistance = distance(start, intersection.point)
  const approach = sampleCubic(
    start,
    add(start, scale(startTangent, approachDistance * 0.38)),
    subtract(intersection.point, scale(entryTangent, approachDistance * 0.36)),
    intersection.point,
    Math.max(64, Math.ceil(approachDistance / 10)),
  )

  const targetDirection = normalize(subtract(end, intersection.point))
  let tailBulge = perpendicular(targetDirection)
  if (dot(tailBulge, outward) < 0) tailBulge = scale(tailBulge, -1)
  const endTangent = normalize(subtract(targetDirection, scale(tailBulge, 0.62)))
  const tailDistance = distance(intersection.point, end)
  const tail = sampleCubic(
    intersection.point,
    add(intersection.point, scale(exitTangent, tailDistance * 0.34)),
    subtract(end, scale(endTangent, tailDistance * 0.34)),
    end,
    Math.max(64, Math.ceil(tailDistance / 10)),
  )
  const points = [...approach.slice(0, -1), ...loopPoints, ...tail.slice(1)]
  const firstVisitIndex = approach.length - 1
  const secondVisitIndex = firstVisitIndex + loopPoints.length - 1
  return {
    points,
    firstVisitIndex,
    secondVisitIndex,
    geometry: {
      axis: loopLeft,
      center: loopCenter,
      width: loopBounds.axisRadius,
      height: loopBounds.normalRadius,
    },
  }
}

function joinSampledCubics(segments: Point[][]): Point[] {
  return segments.flatMap((segment, index) => index === 0 ? segment : segment.slice(1))
}

interface PolylineIntersection {
  point: Point
  firstSegment: number
  secondSegment: number
}

function findFirstPolylineSelfIntersection(points: Point[]): PolylineIntersection | null {
  for (let first = 0; first < points.length - 1; first += 1) {
    for (let second = first + 2; second < points.length - 1; second += 1) {
      const point = segmentIntersectionPoint(
        points[first],
        points[first + 1],
        points[second],
        points[second + 1],
      )
      if (point) return { point, firstSegment: first, secondSegment: second }
    }
  }
  return null
}

function orientedBounds(points: Point[], axis: Point, normal: Point) {
  const axisValues = points.map((point) => dot(point, axis))
  const normalValues = points.map((point) => dot(point, normal))
  const axisMin = Math.min(...axisValues)
  const axisMax = Math.max(...axisValues)
  const normalMin = Math.min(...normalValues)
  const normalMax = Math.max(...normalValues)
  return {
    axisCenter: (axisMin + axisMax) / 2,
    normalCenter: (normalMin + normalMax) / 2,
    axisRadius: (axisMax - axisMin) / 2,
    normalRadius: (normalMax - normalMin) / 2,
  }
}

function sampleQuadratic(start: Point, control: Point, end: Point, count: number): Point[] {
  return Array.from({ length: count + 1 }, (_, index) => {
    const t = index / count
    const oneMinus = 1 - t
    return add(
      add(scale(start, oneMinus * oneMinus), scale(control, 2 * oneMinus * t)),
      scale(end, t * t),
    )
  })
}

function sampleCubic(
  start: Point,
  firstControl: Point,
  secondControl: Point,
  end: Point,
  count: number,
): Point[] {
  return Array.from({ length: count + 1 }, (_, index) => {
    const t = index / count
    const oneMinus = 1 - t
    return add(
      add(
        add(scale(start, oneMinus ** 3), scale(firstControl, 3 * oneMinus * oneMinus * t)),
        scale(secondControl, 3 * oneMinus * t * t),
      ),
      scale(end, t ** 3),
    )
  })
}

function applyHandDrawnNoise(
  points: Point[],
  settings: ArrowSettings,
  seed: number,
): Point[] {
  if (settings.roughness <= 0 || points.length < 3) return points.map((point) => ({ ...point }))
  const random = mulberry32(seed)
  const phase1 = random() * Math.PI * 2
  const phase2 = random() * Math.PI * 2
  const directDistance = distance(points[0], points[points.length - 1])
  const amplitude = Math.min(
    settings.strokeWidth * (0.18 + settings.roughness * 0.62),
    directDistance * 0.022,
    8,
  ) * settings.roughness

  return points.map((point, index) => {
    if (index === 0 || index === points.length - 1) return { ...point }
    const t = index / (points.length - 1)
    const tangent = normalize(subtract(points[index + 1], points[index - 1]))
    const normal = perpendicular(tangent)
    const envelope = Math.sin(Math.PI * t)
    const wave = Math.sin(t * Math.PI * 3.2 + phase1) * 0.64
      + Math.sin(t * Math.PI * 7.1 + phase2) * 0.25
      + (random() - 0.5) * 0.22
    return add(point, scale(normal, wave * amplitude * envelope))
  })
}

function createTaperedStrokeOutline(
  points: Point[],
  settings: ArrowSettings,
  pressureMode: 'lead' | 'steady',
): string {
  const finalIndex = Math.max(1, points.length - 1)
  const input = points.map((point, index) => {
    const t = index / finalIndex
    // Only the physical start of the gesture is light. Split Loop segments
    // otherwise look pasted together if their internal endpoints taper again.
    const pressure = pressureMode === 'lead'
      ? 0.38 + 0.58 * Math.sin(Math.min(1, t / 0.22) * Math.PI * 0.5)
      : 0.96
    return [point.x, point.y, pressure]
  })
  const outline = getStroke(input, {
    size: settings.strokeWidth,
    thinning: 0.76,
    smoothing: 0.68,
    streamline: 0.28,
    simulatePressure: false,
    last: true,
    start: { cap: true, taper: 0 },
    end: { cap: true, taper: 0 },
  })
  return outlineToSvgPath(outline.map(([x, y]) => ({ x, y })))
}

function createRoundedArrowHeadPath(
  tip: Point,
  tangent: Point,
  length: number,
  strokeWidth: number,
  seed: number,
): string {
  const random = mulberry32(seed ^ 0x9e3779b9)
  const normal = perpendicular(tangent)
  // Keep the head expressive but avoid the long, sharp barbs produced by a
  // wide wing placed too far behind the tip.
  const width = length * (0.36 + random() * 0.02)
  const base = subtract(tip, scale(tangent, length * 0.62))
  const neck = Math.max(strokeWidth * 0.58, width * 0.19)
  const leftBase = add(base, scale(normal, neck))
  const rightBase = add(base, scale(normal, -neck))
  const leftWing = add(subtract(tip, scale(tangent, length * 0.7)), scale(normal, width))
  const rightWing = add(subtract(tip, scale(tangent, length * 0.7)), scale(normal, -width))
  const noseLength = Math.max(strokeWidth * 0.36, length * 0.1)
  const leftNose = add(subtract(tip, scale(tangent, noseLength)), scale(normal, noseLength * 0.56))
  const rightNose = add(subtract(tip, scale(tangent, noseLength)), scale(normal, -noseLength * 0.56))
  // Never use the wing extremity as a path vertex: two sharp straight-ish
  // segments meeting there are what made the old arrowhead look spiky. These
  // two small corner arcs retain a clear arrow silhouette while rounding both
  // wings like a marker stroke.
  const leftWingIn = lerp(leftWing, leftBase, 0.28)
  const leftWingOut = lerp(leftWing, leftNose, 0.26)
  const rightWingIn = lerp(rightWing, rightNose, 0.26)
  const rightWingOut = lerp(rightWing, rightBase, 0.28)
  const leftControl = add(midpoint(leftBase, leftWingIn), scale(normal, width * 0.16))
  const rightControl = add(midpoint(rightWingOut, rightBase), scale(normal, -width * 0.16))
  return [
    `M ${formatPoint(leftBase)}`,
    `Q ${formatPoint(leftControl)} ${formatPoint(leftWingIn)}`,
    `Q ${formatPoint(leftWing)} ${formatPoint(leftWingOut)}`,
    `Q ${formatPoint(add(midpoint(leftWingOut, leftNose), scale(tangent, length * 0.04)))} ${formatPoint(leftNose)}`,
    `Q ${formatPoint(tip)} ${formatPoint(rightNose)}`,
    `Q ${formatPoint(add(midpoint(rightNose, rightWingIn), scale(tangent, length * 0.04)))} ${formatPoint(rightWingIn)}`,
    `Q ${formatPoint(rightWing)} ${formatPoint(rightWingOut)}`,
    `Q ${formatPoint(rightControl)} ${formatPoint(rightBase)}`,
    `Q ${formatPoint(subtract(base, scale(tangent, strokeWidth * 0.22)))} ${formatPoint(leftBase)} Z`,
  ].join(' ')
}

export function polylineHasSelfIntersection(points: Point[]): boolean {
  for (let first = 0; first < points.length - 1; first += 1) {
    for (let second = first + 2; second < points.length - 1; second += 1) {
      // Adjacent edges share an endpoint and are not an intersection. A closed
      // route is never supplied to the segment renderer, so no wrap case here.
      if (first === 0 && second === points.length - 2) continue
      if (segmentsIntersect(points[first], points[first + 1], points[second], points[second + 1])) return true
    }
  }
  return false
}

function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  return segmentIntersectionPoint(a, b, c, d) !== null
}

function segmentIntersectionPoint(a: Point, b: Point, c: Point, d: Point): Point | null {
  const ab = subtract(b, a)
  const cd = subtract(d, c)
  const denominator = cross(ab, cd)
  if (Math.abs(denominator) < EPSILON) return null
  const ac = subtract(c, a)
  const t = cross(ac, cd) / denominator
  const u = cross(ac, ab) / denominator
  if (t <= EPSILON || t >= 1 - EPSILON || u <= EPSILON || u >= 1 - EPSILON) return null
  return add(a, scale(ab, t))
}

function outlineToSvgPath(points: Point[]): string {
  if (points.length < 3) return ''
  const commands = [`M ${formatPoint(points[0])}`]
  for (let index = 1; index < points.length - 1; index += 1) {
    commands.push(`Q ${formatPoint(points[index])} ${formatPoint(midpoint(points[index], points[index + 1]))}`)
  }
  commands.push(`Q ${formatPoint(points[points.length - 1])} ${formatPoint(points[0])} Z`)
  return commands.join(' ')
}

function trimPolylineEnd(points: Point[], trimDistance: number): Point[] {
  if (points.length < 2 || trimDistance <= 0) return points.map((point) => ({ ...point }))
  const result = points.map((point) => ({ ...point }))
  let remaining = trimDistance
  while (result.length > 1) {
    const last = result[result.length - 1]
    const previous = result[result.length - 2]
    const segmentLength = distance(previous, last)
    if (remaining < segmentLength) {
      result[result.length - 1] = lerp(last, previous, remaining / segmentLength)
      return result
    }
    remaining -= segmentLength
    result.pop()
  }
  return points.slice(0, 2).map((point) => ({ ...point }))
}

function resamplePolyline(points: Point[], spacing: number): Point[] {
  if (points.length < 2) return points.map((point) => ({ ...point }))
  const cumulative = [0]
  for (let index = 1; index < points.length; index += 1) {
    cumulative.push(cumulative[index - 1] + distance(points[index - 1], points[index]))
  }
  const total = cumulative[cumulative.length - 1]
  const count = Math.max(2, Math.ceil(total / spacing))
  const result: Point[] = []
  let segment = 1
  for (let index = 0; index <= count; index += 1) {
    const target = (total * index) / count
    while (segment < cumulative.length - 1 && cumulative[segment] < target) segment += 1
    const previousDistance = cumulative[segment - 1]
    const segmentLength = cumulative[segment] - previousDistance
    const t = segmentLength < EPSILON ? 0 : (target - previousDistance) / segmentLength
    result.push(lerp(points[segment - 1], points[segment], t))
  }
  return result
}


function rayPolygonIntersection(origin: Point, direction: Point, polygon: Point[]): Point | null {
  let nearestDistance = Number.POSITIVE_INFINITY
  let nearest: Point | null = null
  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index]
    const b = polygon[(index + 1) % polygon.length]
    const edge = subtract(b, a)
    const denominator = cross(direction, edge)
    if (Math.abs(denominator) < EPSILON) continue
    const delta = subtract(a, origin)
    const rayDistance = cross(delta, edge) / denominator
    const edgePosition = cross(delta, direction) / denominator
    if (rayDistance >= -EPSILON && edgePosition >= -EPSILON && edgePosition <= 1 + EPSILON) {
      if (rayDistance < nearestDistance) {
        nearestDistance = rayDistance
        nearest = add(origin, scale(direction, rayDistance))
      }
    }
  }
  return nearest
}

function polygonCenter(points: Point[]): Point {
  return scale(points.reduce((sum, point) => add(sum, point), { x: 0, y: 0 }), 1 / points.length)
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function add(a: Point, b: Point): Point {
  return { x: a.x + b.x, y: a.y + b.y }
}

function subtract(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y }
}

function scale(point: Point, amount: number): Point {
  return { x: point.x * amount, y: point.y * amount }
}

function midpoint(a: Point, b: Point): Point {
  return scale(add(a, b), 0.5)
}

function lerp(a: Point, b: Point, t: number): Point {
  return add(a, scale(subtract(b, a), t))
}

function magnitude(point: Point): number {
  return Math.hypot(point.x, point.y)
}

function normalize(point: Point): Point {
  const length = magnitude(point)
  return length < EPSILON ? { x: 0, y: 0 } : scale(point, 1 / length)
}

function perpendicular(point: Point): Point {
  return { x: -point.y, y: point.x }
}

function rotate(point: Point, radians: number): Point {
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)
  return {
    x: point.x * cosine - point.y * sine,
    y: point.x * sine + point.y * cosine,
  }
}

function distance(a: Point, b: Point): number {
  return magnitude(subtract(a, b))
}

function cross(a: Point, b: Point): number {
  return a.x * b.y - a.y * b.x
}

function dot(a: Point, b: Point): number {
  return a.x * b.x + a.y * b.y
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return max
  return Math.min(max, Math.max(min, value))
}

function smoothstep(value: number): number {
  return value * value * (3 - 2 * value)
}

function loopTargetWarp(value: number): number {
  const loopEntry = 0.2
  const heldProgress = 0.3
  if (value < loopEntry) return heldProgress * smoothstep(value / loopEntry)
  return heldProgress
}

function formatPoint(point: Point): string {
  return `${formatNumber(point.x)} ${formatNumber(point.y)}`
}

function formatNumber(value: number): string {
  return Number(value.toFixed(3)).toString()
}
