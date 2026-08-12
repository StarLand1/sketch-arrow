import { getStroke } from 'perfect-freehand'
import { clampSettings, headScaleForSize, type ArrowSettings } from '../shared/types'

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
  /** First shaft path belonging to the overpass layer for Loop geometry. */
  shaftLayerBreakIndex?: number
  /** The independent editable head paths, painted above the shaft. */
  headPaths: string[]
  /** Winding rules parallel to headPaths; hollow heads use EVENODD. */
  headWindingRules: VectorWindingRule[]
  headPath: string
  shaftOpacity: number
  headOpacity: number
  points: Point[]
  start: Point
  end: Point
  shaftEnd: Point
  endTangent: Point
  headLength: number
  crossing?: PathCrossing
  loop?: LoopGeometry
}

export type VectorWindingRule = 'NONZERO' | 'EVENODD'

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
/** Closed silhouettes need this scale to match the stroked Path head bounds. */
export const CLOSED_HEAD_GEOMETRY_SCALE = 1.22

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
  bend: -1 | 1 = 1,
): ArrowGeometry {
  // Keep the pure geometry API tolerant of migrated and standalone callers.
  settings = clampSettings(settings)
  const directDistance = distance(inputStart, inputEnd)
  if (directDistance < 4) throw new Error('Arrow path is too short')
  const authoredCurvature = curvatureForStyle(settings.style) * bend

  // Author the gesture once in the guide's original direction. Reversing an
  // arrow must only reverse that gesture; regenerating from swapped endpoints
  // changes the Loop template's orientation and produces a different shape.
  const canonicalLoopRoute = settings.style === 'loop' && directDistance >= 140
    ? createLoopRoute(inputStart, inputEnd, authoredCurvature)
    : null
  const base = canonicalLoopRoute?.points ?? createStylePoints(inputStart, inputEnd, settings.style, authoredCurvature)
  const spacing = clamp(directDistance / 28, 5, 18)
  // The loop includes an intentional self-intersection. It is authored at
  // stable sample positions so the knot can be split into paint layers, but
  // it still receives the same deterministic low-frequency variation as the
  // other brushes. The helper keeps both visits locked to one crossing point.
  const sampled = canonicalLoopRoute ? base : resamplePolyline(base, spacing)
  const roughness = roughnessForLineStyle(settings.lineStyle)
  const canonicalRoughened = settings.style === 'loop'
    ? canonicalLoopRoute
      ? applyLoopHandDrawnNoise(
        sampled,
        settings.strokeWidth,
        roughness,
        seed,
        canonicalLoopRoute.firstVisitIndex,
        canonicalLoopRoute.secondVisitIndex,
      )
      : sampled.map((point) => ({ ...point }))
    : applyHandDrawnNoise(sampled, settings.strokeWidth, roughness, seed)
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
  const headScale = headScaleForSize(settings.headSize)
  // Rough path heads lose a little apparent area to their pressure profile;
  // compensate so all head styles keep the same visual footprint.
  const pathHeadScale = settings.lineStyle === 'clean' ? 1 : 1.08
  const headGeometryScale = settings.headStyle === 'path' ? pathHeadScale : CLOSED_HEAD_GEOMETRY_SCALE
  const headLength = clamp(
    settings.strokeWidth * headScale * 5.325 * headGeometryScale,
    settings.strokeWidth * 3.675 * headGeometryScale,
    directDistance * 0.3,
  )
  // The shaft ends inside the filled head's base. The head is painted above it,
  // so no rounded shaft cap can protrude beyond the arrow tip.
  // A hollow head has a real transparent centre. Its new concave rear rim
  // occupies roughly 43–55% of the head length behind the tip, so land the
  // shaft cap inside that filled rim: it remains connected and still stops
  // before the transparent centre begins.
  const shaftTrim = settings.headStyle === 'hollow'
    ? Math.max(settings.strokeWidth * 0.72, headLength * 0.58)
    : Math.max(settings.strokeWidth * 0.56, headLength * 0.57)
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

  // Patterned output is generated from the centreline so arc-length spacing
  // is not affected by the number of input samples.
  const shaftPathGroups = shaftSegments.map((segment, index) => createStrokePassPaths(
    segment,
    settings,
    index === 0 ? 'lead' : 'steady',
    seed ^ (index * 0x45d9f3b),
  ))
  const shaftPaths = shaftPathGroups.flat()
  const shaftEnd = shaftSegments[shaftSegments.length - 1][shaftSegments[shaftSegments.length - 1].length - 1]
  const headPaths = createArrowHeadPaths(end, endTangent, headLength, settings, seed)
  const headWindingRules = headPaths.map(() => settings.headStyle === 'hollow' ? 'EVENODD' as const : 'NONZERO' as const)
  const shaftOpacity = 1
  const headOpacity = 1

  return {
    shaftPaths,
    shaftPath: shaftPaths[0],
    shaftSegments,
    shaftLayerBreakIndex: loopRoute ? shaftPathGroups[0].length : undefined,
    headPaths,
    headWindingRules,
    headPath: headPaths[0],
    shaftOpacity,
    headOpacity,
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
  const normal = authoredNormal(direction)
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

function curvatureForStyle(style: ArrowSettings['style']): number {
  if (style === 'loop') return 0.52
  if (style === 's-curve') return 0.56
  if (style === 'wave') return 0.5
  return 0.3
}

function roughnessForLineStyle(style: ArrowSettings['lineStyle']): number {
  if (style === 'sketch') return 0.68
  // The repeated pass supplies the visible variation. Keeping its authored
  // centreline calm prevents the second stroke from reading as a vine.
  if (style === 'double-drawn') return 0.48
  // Clean intentionally retains the subtle character of the previous default.
  return 0.34
}

function createStylePoints(
  start: Point,
  end: Point,
  style: ArrowSettings['style'],
  curvature: number,
): Point[] {
  if (style === 's-curve') return createSCurvePoints(start, end, curvature)
  if (style === 'wave') return createWavePoints(start, end, curvature)
  return createNaturalPoints(start, end, curvature)
}

function createSCurvePoints(start: Point, end: Point, curvature: number): Point[] {
  const direction = normalize(subtract(end, start))
  const normal = authoredNormal(direction)
  const length = distance(start, end)
  const middle = midpoint(start, end)
  const amount = clamp(length * (0.16 + Math.abs(curvature) * 0.16), 28, 150) * (curvature < 0 ? -1 : 1)
  const first = sampleCubic(
    start,
    add(start, add(scale(direction, length * 0.28), scale(normal, amount))),
    add(middle, add(scale(direction, -length * 0.2), scale(normal, amount))),
    middle,
    Math.max(18, Math.ceil(length / 18)),
  )
  const second = sampleCubic(
    middle,
    add(middle, add(scale(direction, length * 0.2), scale(normal, -amount))),
    add(end, add(scale(direction, -length * 0.28), scale(normal, -amount))),
    end,
    Math.max(18, Math.ceil(length / 18)),
  )
  return [...first.slice(0, -1), ...second]
}

function createWavePoints(start: Point, end: Point, curvature: number): Point[] {
  const direction = normalize(subtract(end, start))
  const normal = authoredNormal(direction)
  const length = distance(start, end)
  const amplitude = clamp(length * (0.08 + Math.abs(curvature) * 0.06), 16, 74)
  const cycles = 2 + Math.round(Math.abs(curvature) * 1.5)
  const count = Math.max(42, Math.ceil(length / 10))
  return Array.from({ length: count + 1 }, (_, index) => {
    const t = index / count
    const envelope = Math.sin(Math.PI * t) ** 0.72
    return add(
      add(start, scale(direction, length * t)),
      scale(normal, Math.sin(t * Math.PI * cycles * 2) * amplitude * envelope * (curvature < 0 ? -1 : 1)),
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
  strokeWidth: number,
  roughness: number,
  seed: number,
): Point[] {
  if (roughness <= 0 || points.length < 3) return points.map((point) => ({ ...point }))
  const random = mulberry32(seed)
  const phase1 = random() * Math.PI * 2
  const phase2 = random() * Math.PI * 2
  const directDistance = distance(points[0], points[points.length - 1])
  const gestureDirection = normalize(subtract(points[points.length - 1], points[0]))
  const handedness = gestureDirection.x < -EPSILON ? -1 : 1
  const amplitude = Math.min(
    strokeWidth * (0.2 + roughness * 0.7),
    directDistance * 0.022,
    Math.max(8, strokeWidth * 0.95),
  ) * roughness

  return points.map((point, index) => {
    if (index === 0 || index === points.length - 1) return { ...point }
    const t = index / (points.length - 1)
    const tangent = normalize(subtract(points[index + 1], points[index - 1]))
    const normal = scale(perpendicular(tangent), handedness)
    const envelope = Math.sin(Math.PI * t)
    // Two gentle, low-frequency bends are enough to preserve a hand-drawn
    // character. Keep the long-standing clean/double route untouched, while
    // the sketch route gets less sampled-point noise and a smoother contour.
    const wave = roughness >= 0.6
      ? Math.sin(t * Math.PI * 2.35 + phase1) * 0.78
        + Math.sin(t * Math.PI * 4.6 + phase2) * 0.14
        + (random() - 0.5) * 0.06
      : Math.sin(t * Math.PI * 3.2 + phase1) * 0.64
        + Math.sin(t * Math.PI * 7.1 + phase2) * 0.25
        + (random() - 0.5) * 0.22
    return add(point, scale(normal, wave * amplitude * envelope))
  })
}

function applyLoopHandDrawnNoise(
  points: Point[],
  strokeWidth: number,
  roughness: number,
  seed: number,
  firstVisitIndex: number,
  secondVisitIndex: number,
): Point[] {
  const roughened = applyHandDrawnNoise(points, strokeWidth, roughness, seed)
  if (roughened.length === 0) return roughened

  // A loop is a single gesture that happens to cross itself. Keep a short
  // neighbourhood around both visits on the same authored centreline so the
  // split VectorNodes meet with a shared tangent instead of producing a kink.
  const first = points[Math.max(0, Math.min(points.length - 1, firstVisitIndex))]
  const second = points[Math.max(0, Math.min(points.length - 1, secondVisitIndex))]
  const crossing = midpoint(first, second)
  const lockRadius = 2
  for (let index = 0; index < roughened.length; index += 1) {
    const nearFirst = Math.abs(index - firstVisitIndex) <= lockRadius
    const nearSecond = Math.abs(index - secondVisitIndex) <= lockRadius
    if (nearFirst || nearSecond) {
      // Keep the authored offset along each local tangent, but share the
      // crossing itself exactly. This leaves the hand-drawn rhythm visible
      // immediately before/after the knot while preserving its topology.
      if (index === firstVisitIndex || index === secondVisitIndex) {
        roughened[index] = { ...crossing }
      } else {
        roughened[index] = { ...points[index] }
      }
    }
  }
  roughened[0] = { ...points[0] }
  roughened[roughened.length - 1] = { ...points[points.length - 1] }
  return roughened
}

function createTaperedStrokeOutline(
  points: Point[],
  settings: ArrowSettings,
  pressureMode: 'lead' | 'steady',
  seed = 1,
): string {
  const pressure = createStrokePressureProfile(points.length, settings.lineStyle, pressureMode, seed)
  const input = points.map((point, index) => [point.x, point.y, pressure[index]])
  const brush = settings.lineStyle === 'sketch'
    ? { thinning: 0.9, smoothing: 0.74, streamline: 0.3 }
    : settings.lineStyle === 'double-drawn'
      ? { thinning: 0.82, smoothing: 0.62, streamline: 0.22 }
      : { thinning: 0.76, smoothing: 0.68, streamline: 0.28 }
  const outline = getStroke(input, {
    size: settings.strokeWidth,
    ...brush,
    simulatePressure: false,
    last: true,
    start: { cap: true, taper: 0 },
    end: { cap: true, taper: 0 },
  })
  return outlineToSvgPath(outline.map(([x, y]) => ({ x, y })))
}

/**
 * Build the deterministic pressure rhythm used by perfect-freehand. Keeping
 * it separate makes the visible thick/thin cadence testable instead of
 * relying on an opaque SVG-outline snapshot.
 */
export function createStrokePressureProfile(
  pointCount: number,
  lineStyle: ArrowSettings['lineStyle'],
  pressureMode: 'lead' | 'steady',
  seed: number,
): number[] {
  if (pointCount <= 0) return []
  const random = mulberry32(seed ^ 0x632be59b)
  const firstPhase = random() * Math.PI * 2
  const secondPhase = random() * Math.PI * 2
  const character = lineStyle === 'clean'
    ? { target: 0.96, primary: 0, secondary: 0 }
    : lineStyle === 'sketch'
      // Keep a tablet-like heavy/light rhythm, but stay within a controlled
      // range so the line does not look like a succession of swollen beads.
      ? { target: 0.68, primary: 0.23, secondary: 0.035 }
      : { target: 0.72, primary: 0.06, secondary: 0.02 }
  const finalIndex = Math.max(1, pointCount - 1)

  return Array.from({ length: pointCount }, (_, index) => {
    const t = index / finalIndex
    // Only the physical start of the gesture is light. Split Loop segments
    // otherwise look pasted together if their internal endpoints taper again.
    const basePressure = pressureMode === 'lead'
      ? 0.36 + (character.target - 0.36) * Math.sin(Math.min(1, t / 0.22) * Math.PI * 0.5)
      : character.target
    const envelope = Math.sin(Math.PI * t) ** 0.52
    const variation = (
      Math.sin(t * Math.PI * 2.4 + firstPhase) * character.primary
      + Math.sin(t * Math.PI * 5.2 + secondPhase) * character.secondary
    ) * envelope
    return clamp(basePressure + variation, 0.2, 1)
  })
}

function createStrokePassPaths(
  points: Point[],
  settings: ArrowSettings,
  pressureMode: 'lead' | 'steady',
  seed: number,
): string[] {
  const primary = createPatternedStrokePaths(points, settings, pressureMode, seed)
  if (settings.lineStyle !== 'double-drawn' || points.length < 2) return primary
  const secondaryPoints = createRedrawnPass(points, settings.strokeWidth, seed ^ 0xa511e9b3)
  const secondary = createPatternedStrokePaths(
    secondaryPoints,
    {
      ...settings,
      lineStyle: 'double-drawn',
      // A lighter second pass lets the two silhouettes separate through the
      // middle of the gesture, then settle back into the same endpoint.
      strokeWidth: settings.strokeWidth * 0.64,
    },
    pressureMode,
    seed ^ 0x68bc21eb,
  )
  return [...primary, ...secondary]
}

export function createRedrawnPass(points: Point[], strokeWidth: number, seed: number): Point[] {
  if (points.length < 3) return points.map((point) => ({ ...point }))
  const random = mulberry32(seed)
  const side = random() < 0.5 ? -1 : 1
  const amplitude = strokeWidth * (1.25 + random() * 0.1)
  const offsets = [
    { t: 0, value: 0 },
    { t: 0.2, value: 0.5 },
    { t: 0.48, value: 1 },
    { t: 0.72, value: 0.52 },
    { t: 0.86, value: 0.12 },
    { t: 1, value: 0 },
  ]
  const gestureDirection = normalize(subtract(points[points.length - 1], points[0]))
  const handedness = gestureDirection.x < -EPSILON ? -1 : 1
  const total = polylineLength(points)
  let traversed = 0
  return points.map((point, index) => {
    if (index === 0 || index === points.length - 1) return { ...point }
    traversed += distance(points[index - 1], point)
    const t = total < EPSILON ? index / (points.length - 1) : traversed / total
    const tangent = normalize(subtract(points[index + 1], points[index - 1]))
    const normal = scale(perpendicular(tangent), handedness)
    // One wide, slowly changing deviation mimics drawing the same gesture a
    // second time. It preserves the original curvature and rejoins well before
    // the arrowhead instead of winding around the first pass like a vine.
    const redrawOffset = smoothAnchoredValue(offsets, t) * amplitude * side
    return add(point, scale(normal, redrawOffset))
  })
}

function smoothAnchoredValue(
  anchors: Array<{ t: number; value: number }>,
  t: number,
): number {
  for (let index = 1; index < anchors.length; index += 1) {
    const previous = anchors[index - 1]
    const next = anchors[index]
    if (t <= next.t) {
      const local = clamp((t - previous.t) / Math.max(EPSILON, next.t - previous.t), 0, 1)
      // Smootherstep keeps both slope and acceleration continuous at anchors.
      const eased = local ** 3 * (local * (local * 6 - 15) + 10)
      return previous.value + (next.value - previous.value) * eased
    }
  }
  return anchors[anchors.length - 1]?.value ?? 0
}

/**
 * Render a centreline as multiple filled outlines. Figma's dashPattern only
 * applies to strokes, while this plugin deliberately exports filled vectors;
 * splitting the centreline keeps rounded caps and works on any background.
 */
function createPatternedStrokePaths(
  points: Point[],
  settings: ArrowSettings,
  pressureMode: 'lead' | 'steady',
  seed: number,
): string[] {
  if (points.length < 2 || settings.strokePattern === 'solid') {
    return [createTaperedStrokeOutline(points, settings, pressureMode, seed)]
  }

  const total = polylineLength(points)
  if (total < settings.strokeWidth * 1.8) {
    return [createTaperedStrokeOutline(points, settings, pressureMode, seed)]
  }

  if (settings.strokePattern === 'dotted') {
    const spacing = Math.max(settings.strokeWidth * 2.25, settings.strokeWidth + 4)
    const count = Math.max(1, Math.floor(total / spacing) + 1)
    const adjustedSpacing = count <= 1 ? 0 : total / (count - 1)
    return Array.from({ length: count }, (_, index) => {
      const offset = count <= 1 ? total * 0.5 : adjustedSpacing * index
      const center = pointAtDistance(points, offset)
      const tangent = tangentAtDistance(points, offset)
      const random = mulberry32(seed ^ (index * 0x9e3779b9))
      const size = settings.strokeWidth * (0.9 + random() * 0.12)
      const halfLength = Math.max(0.35, size * 0.045)
      const dotSettings = { ...settings, strokeWidth: size }
      return createTaperedStrokeOutline([
        subtract(center, scale(tangent, halfLength)),
        add(center, scale(tangent, halfLength)),
      ], dotSettings, 'steady', seed ^ (index * 0x85ebca6b))
    })
  }

  const { dashLength, gapLength } = dashPatternLengths(settings.strokeWidth)
  const pieces: string[] = []
  let offset = 0
  let dash = true
  while (offset < total - EPSILON) {
    const requested = dash ? dashLength : gapLength
    const end = Math.min(total, offset + requested)
    if (dash && end - offset > settings.strokeWidth * 0.42) {
      const segment = slicePolyline(points, offset, end)
      if (segment.length >= 2) pieces.push(createTaperedStrokeOutline(
        segment,
        settings,
        pieces.length === 0 ? pressureMode : 'steady',
        seed ^ (pieces.length * 0x27d4eb2d),
      ))
    }
    offset = end
    dash = !dash
  }

  // A short tail after the last full dash is visually worse than a slightly
  // shorter final gap. Merge it into the previous dash when possible.
  if (pieces.length === 0) return [createTaperedStrokeOutline(points, settings, pressureMode, seed)]
  return pieces
}

export function dashPatternLengths(strokeWidth: number): { dashLength: number; gapLength: number } {
  const dashLength = Math.max(strokeWidth * 3.2, strokeWidth * 2.2 + 4)
  return { dashLength, gapLength: dashLength * 0.7 }
}

function polylineLength(points: Point[]): number {
  let total = 0
  for (let index = 1; index < points.length; index += 1) total += distance(points[index - 1], points[index])
  return total
}

function pointAtDistance(points: Point[], target: number): Point {
  if (points.length === 0) return { x: 0, y: 0 }
  if (points.length === 1) return { ...points[0] }
  const clamped = Math.max(0, Math.min(polylineLength(points), target))
  let traversed = 0
  for (let index = 1; index < points.length; index += 1) {
    const segmentLength = distance(points[index - 1], points[index])
    if (traversed + segmentLength >= clamped - EPSILON) {
      const t = segmentLength < EPSILON ? 0 : (clamped - traversed) / segmentLength
      return lerp(points[index - 1], points[index], t)
    }
    traversed += segmentLength
  }
  return { ...points[points.length - 1] }
}

function tangentAtDistance(points: Point[], target: number): Point {
  if (points.length < 2) return { x: 1, y: 0 }
  const clamped = Math.max(0, Math.min(polylineLength(points), target))
  let traversed = 0
  for (let index = 1; index < points.length; index += 1) {
    const segment = subtract(points[index], points[index - 1])
    const segmentLength = magnitude(segment)
    if (traversed + segmentLength >= clamped - EPSILON && segmentLength > EPSILON) return normalize(segment)
    traversed += segmentLength
  }
  return normalize(subtract(points[points.length - 1], points[points.length - 2]))
}

function slicePolyline(points: Point[], start: number, end: number): Point[] {
  if (points.length < 2 || end <= start) return points.map((point) => ({ ...point }))
  const result: Point[] = [pointAtDistance(points, start)]
  let traversed = 0
  for (let index = 1; index < points.length; index += 1) {
    const segmentLength = distance(points[index - 1], points[index])
    const next = traversed + segmentLength
    if (next > start + EPSILON && next < end - EPSILON) result.push({ ...points[index] })
    traversed = next
    if (traversed >= end - EPSILON) break
  }
  result.push(pointAtDistance(points, end))
  return dedupeAdjacentPoints(result)
}

function dedupeAdjacentPoints(points: Point[]): Point[] {
  return points.filter((point, index) => index === 0 || distance(point, points[index - 1]) > EPSILON)
}

function createArrowHeadPaths(
  tip: Point,
  tangent: Point,
  length: number,
  settings: ArrowSettings,
  seed: number,
): string[] {
  const { strokeWidth, headStyle: style } = settings
  if (style === 'path') {
    const normal = perpendicular(tangent)
    const wingDistance = length * 0.7
    const wing = length * 0.38
    const wingBase = subtract(tip, scale(tangent, wingDistance))
    const nearTip = subtract(tip, scale(tangent, strokeWidth * 0.08))
    const headSettings: ArrowSettings = {
      ...settings,
      strokePattern: 'solid',
      strokeWidth: Math.max(1, strokeWidth * 0.66),
    }
    return [1, -1].flatMap((side, index) => {
      const end = add(wingBase, scale(normal, wing * side))
      const middle = add(
        lerp(nearTip, end, 0.52),
        scale(tangent, length * 0.035),
      )
      return createStrokePassPaths([
        nearTip,
        middle,
        end,
      ], headSettings, 'steady', seed ^ (index * 0x7f4a7c15))
    })
  }
  if (style === 'hollow') {
    return [createHollowArrowHeadPath(tip, tangent, length, strokeWidth, seed)]
  }
  return [createRoundedArrowHeadPath(tip, tangent, length, strokeWidth, seed)]
}

function createHollowArrowHeadPath(
  tip: Point,
  tangent: Point,
  length: number,
  strokeWidth: number,
  seed: number,
): string {
  const random = mulberry32(seed ^ 0x7f4a7c15)
  const halfWidth = length * (0.38 + random() * 0.02)
  const rearDistance = length * 0.7
  // Match the visual weight of the stroked Path head. The earlier 0.92× wall
  // was mathematically valid but looked too light beside perfect-freehand's
  // pressure-expanded shaft, especially along the concave rear edge.
  const wall = Math.min(strokeWidth * 1.1, halfWidth * 0.42, length * 0.17)
  const outer = concaveArrowContourPath({
    tip,
    tangent,
    rearDistance,
    halfWidth,
    // Give the closed nose a little more room than a pointed triangle. The
    // outer and inner contours then read like a rounded marker outline rather
    // than a sharp chevron with a hole cut through it.
    noseInset: Math.max(strokeWidth * 0.42, length * 0.092),
    notchDepth: length * 0.2,
    cornerRadius: Math.min(strokeWidth * 1.32, halfWidth * 0.3),
  })

  const innerTip = subtract(tip, scale(tangent, wall * 1.16))
  const innerRearDistance = Math.max(
    length * 0.2,
    rearDistance - wall * 1.92,
  )
  const innerHalfWidth = Math.max(strokeWidth * 0.2, halfWidth - wall * 1.02)
  const inner = concaveArrowContourPath({
    tip: innerTip,
    tangent,
    rearDistance: innerRearDistance,
    halfWidth: innerHalfWidth,
    noseInset: Math.max(wall * 0.38, length * 0.052),
    // Move the inner rear curve forward by roughly one wall thickness. This
    // keeps the concave base as substantial as both side walls.
    notchDepth: Math.min(
      innerRearDistance * 0.56,
      length * 0.2 + wall * 0.58,
    ),
    cornerRadius: Math.max(0.8, Math.min(wall * 0.74, innerHalfWidth * 0.32)),
  })
  return `${outer} ${inner}`
}

interface ConcaveArrowContourOptions {
  tip: Point
  tangent: Point
  rearDistance: number
  halfWidth: number
  noseInset: number
  notchDepth: number
  cornerRadius: number
}

/**
 * A rounded arrow contour whose rear edge bows towards the tip. The inward
 * curve makes the hollow head read as directional rather than as a square,
 * rounded triangular frame.
 */
function concaveArrowContourPath({
  tip,
  tangent,
  rearDistance,
  halfWidth,
  noseInset,
  notchDepth,
  cornerRadius,
}: ConcaveArrowContourOptions): string {
  const normal = perpendicular(tangent)
  const rearCenter = subtract(tip, scale(tangent, rearDistance))
  const leftWing = add(rearCenter, scale(normal, halfWidth))
  const rightWing = add(rearCenter, scale(normal, -halfWidth))
  // A wider, clipped nose makes the leading point visibly soft without
  // changing the overall head dimensions.
  const noseHalfWidth = noseInset * 0.62
  const leftNose = add(subtract(tip, scale(tangent, noseInset)), scale(normal, noseHalfWidth))
  const rightNose = add(subtract(tip, scale(tangent, noseInset)), scale(normal, -noseHalfWidth))
  const sideLength = Math.max(EPSILON, distance(leftNose, leftWing))
  const edgeFraction = clamp(cornerRadius / sideLength, 0.1, 0.32)
  const backFraction = clamp(cornerRadius / Math.max(EPSILON, halfWidth * 2), 0.1, 0.3)
  const leftWingEntry = lerp(leftWing, leftNose, edgeFraction)
  const leftWingBack = lerp(leftWing, rightWing, backFraction)
  const rightWingBack = lerp(rightWing, leftWing, backFraction)
  const rightWingExit = lerp(rightWing, rightNose, edgeFraction)
  const notch = add(rearCenter, scale(tangent, notchDepth))
  const leftNotchControl = add(notch, scale(normal, halfWidth * 0.2))
  const rightNotchControl = add(notch, scale(normal, -halfWidth * 0.2))
  const leftEdgeControl = add(midpoint(leftNose, leftWingEntry), scale(normal, halfWidth * 0.095))
  const rightEdgeControl = add(midpoint(rightWingExit, rightNose), scale(normal, -halfWidth * 0.095))

  return [
    `M ${formatPoint(leftNose)}`,
    `Q ${formatPoint(leftEdgeControl)} ${formatPoint(leftWingEntry)}`,
    `Q ${formatPoint(leftWing)} ${formatPoint(leftWingBack)}`,
    `C ${formatPoint(leftNotchControl)} ${formatPoint(rightNotchControl)} ${formatPoint(rightWingBack)}`,
    `Q ${formatPoint(rightWing)} ${formatPoint(rightWingExit)}`,
    `Q ${formatPoint(rightEdgeControl)} ${formatPoint(rightNose)}`,
    `Q ${formatPoint(tip)} ${formatPoint(leftNose)} Z`,
  ].join(' ')
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
  const width = length * (0.38 + random() * 0.02)
  const base = subtract(tip, scale(tangent, length * 0.62))
  // A slightly wider neck gives the shaft-to-head junction the same soft,
  // marker-like weight as the open Path head.
  const neck = Math.max(strokeWidth * 0.66, width * 0.22)
  const leftBase = add(base, scale(normal, neck))
  const rightBase = add(base, scale(normal, -neck))
  const wingDistance = 0.7
  const leftWing = add(subtract(tip, scale(tangent, length * wingDistance)), scale(normal, width))
  const rightWing = add(subtract(tip, scale(tangent, length * wingDistance)), scale(normal, -width))
  const noseLength = Math.max(strokeWidth * 0.46, length * 0.115)
  const leftNose = add(subtract(tip, scale(tangent, noseLength)), scale(normal, noseLength * 0.63))
  const rightNose = add(subtract(tip, scale(tangent, noseLength)), scale(normal, -noseLength * 0.63))
  // Never use the wing extremity as a path vertex: two sharp straight-ish
  // segments meeting there are what made the old arrowhead look spiky. These
  // two small corner arcs retain a clear arrow silhouette while rounding both
  // wings like a marker stroke.
  const leftWingIn = lerp(leftWing, leftBase, 0.36)
  const leftWingOut = lerp(leftWing, leftNose, 0.34)
  const rightWingIn = lerp(rightWing, rightNose, 0.34)
  const rightWingOut = lerp(rightWing, rightBase, 0.36)
  const leftControl = add(midpoint(leftBase, leftWingIn), scale(normal, width * 0.23))
  const rightControl = add(midpoint(rightWingOut, rightBase), scale(normal, -width * 0.23))
  return [
    `M ${formatPoint(leftBase)}`,
    `Q ${formatPoint(leftControl)} ${formatPoint(leftWingIn)}`,
    `Q ${formatPoint(leftWing)} ${formatPoint(leftWingOut)}`,
    `Q ${formatPoint(add(midpoint(leftWingOut, leftNose), scale(tangent, length * 0.065)))} ${formatPoint(leftNose)}`,
    `Q ${formatPoint(tip)} ${formatPoint(rightNose)}`,
    `Q ${formatPoint(add(midpoint(rightNose, rightWingIn), scale(tangent, length * 0.065)))} ${formatPoint(rightWingIn)}`,
    `Q ${formatPoint(rightWing)} ${formatPoint(rightWingOut)}`,
    `Q ${formatPoint(rightControl)} ${formatPoint(rightBase)}`,
    `Q ${formatPoint(subtract(base, scale(tangent, strokeWidth * 0.34)))} ${formatPoint(leftBase)} Z`,
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

/** Mirror the authored gesture when its horizontal direction is mirrored. */
function authoredNormal(direction: Point): Point {
  const normal = perpendicular(direction)
  return direction.x < -EPSILON ? scale(normal, -1) : normal
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
