import { describe, expect, it } from 'vitest'
import {
  connectPolygons,
  generateArrowGeometry,
  invertTransform,
  lineEndpoints,
  polylineHasSelfIntersection,
  rectangleCorners,
  tangentAtEnd,
  transformPoint,
  type AffineTransform,
} from '../src/core/geometry'
import { DEFAULT_SETTINGS } from '../src/shared/types'

describe('geometry transforms', () => {
  it('round-trips a point through an affine transform', () => {
    const transform: AffineTransform = [[0, -1, 120], [1, 0, 40]]
    const point = { x: 12, y: 30 }
    const result = transformPoint(invertTransform(transform), transformPoint(transform, point))
    expect(result.x).toBeCloseTo(point.x)
    expect(result.y).toBeCloseTo(point.y)
  })

  it('extracts rotated line endpoints', () => {
    const transform: AffineTransform = [[0, -1, 50], [1, 0, 20]]
    const [start, end] = lineEndpoints(100, transform)
    expect(start).toEqual({ x: 50, y: 20 })
    expect(end.x).toBeCloseTo(50)
    expect(end.y).toBeCloseTo(120)
  })
})

describe('node connections', () => {
  it('connects the facing edges of two rectangles', () => {
    const identity: AffineTransform = [[1, 0, 0], [0, 1, 0]]
    const shifted: AffineTransform = [[1, 0, 300], [0, 1, 20]]
    const connection = connectPolygons(
      rectangleCorners(100, 100, identity),
      rectangleCorners(120, 80, shifted),
      12,
    )
    expect(connection).not.toBeNull()
    expect(connection?.start.x).toBeCloseTo(112, 1)
    expect(connection?.end.x).toBeCloseTo(288, 1)
    expect(connection?.sourceOrder).toEqual([0, 1])
  })

  it('orders vertical nodes from top to bottom', () => {
    const top: AffineTransform = [[1, 0, 20], [0, 1, 0]]
    const bottom: AffineTransform = [[1, 0, 0], [0, 1, 240]]
    const connection = connectPolygons(
      rectangleCorners(80, 80, bottom),
      rectangleCorners(80, 80, top),
      10,
    )
    expect(connection?.sourceOrder).toEqual([1, 0])
    expect(connection!.start.y).toBeLessThan(connection!.end.y)
  })

  it('rejects overlapping node bounds', () => {
    const first: AffineTransform = [[1, 0, 0], [0, 1, 0]]
    const overlapping: AffineTransform = [[1, 0, 60], [0, 1, 30]]
    const connection = connectPolygons(
      rectangleCorners(100, 100, first),
      rectangleCorners(100, 100, overlapping),
      10,
    )
    expect(connection).toBeNull()
  })
})

describe('arrow generation', () => {
  it('is deterministic for the same seed', () => {
    const first = generateArrowGeometry({ x: 0, y: 0 }, { x: 500, y: 180 }, DEFAULT_SETTINGS, 42)
    const second = generateArrowGeometry({ x: 0, y: 0 }, { x: 500, y: 180 }, DEFAULT_SETTINGS, 42)
    expect(first.shaftPath).toBe(second.shaftPath)
    expect(first.headPath).toBe(second.headPath)
  })

  it('changes its hand-drawn shape for a different seed', () => {
    const first = generateArrowGeometry({ x: 0, y: 0 }, { x: 500, y: 180 }, DEFAULT_SETTINGS, 42)
    const second = generateArrowGeometry({ x: 0, y: 0 }, { x: 500, y: 180 }, DEFAULT_SETTINGS, 43)
    expect(first.shaftPath).not.toBe(second.shaftPath)
  })

  it('reverses the same loop gesture instead of regenerating its shape', () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      style: 'loop' as const,
      curvature: 0.52,
      roughness: 0,
    }
    const forward = generateArrowGeometry({ x: 40, y: 20 }, { x: 760, y: 330 }, settings, 29)
    const reversed = generateArrowGeometry({ x: 40, y: 20 }, { x: 760, y: 330 }, {
      ...settings,
      reversed: true,
    }, 29)

    expect(reversed.start).toEqual(forward.end)
    expect(reversed.end).toEqual(forward.start)
    expect(reversed.points).toHaveLength(forward.points.length)
    reversed.points.forEach((point, index) => {
      const original = forward.points[forward.points.length - 1 - index]
      expect(point.x).toBeCloseTo(original.x, 6)
      expect(point.y).toBeCloseTo(original.y, 6)
    })
    expect(reversed.crossing!.firstVisitIndex)
      .toBe(forward.points.length - 1 - forward.crossing!.secondVisitIndex)
    expect(reversed.crossing!.secondVisitIndex)
      .toBe(forward.points.length - 1 - forward.crossing!.firstVisitIndex)
    expect(reversed.shaftSegments.every((segment) => !polylineHasSelfIntersection(segment))).toBe(true)
  })

  it('keeps head size stable across long path lengths', () => {
    const short = generateArrowGeometry({ x: 0, y: 0 }, { x: 220, y: 0 }, DEFAULT_SETTINGS, 2)
    const long = generateArrowGeometry({ x: 0, y: 0 }, { x: 1400, y: 0 }, DEFAULT_SETTINGS, 2)
    expect(long.headLength).toBeCloseTo(short.headLength)
    expect(long.headLength).toBeCloseTo(DEFAULT_SETTINGS.strokeWidth * DEFAULT_SETTINGS.headScale * 5.325)
  })

  it('uses closed pressure outlines with a rounded filled arrowhead', () => {
    const result = generateArrowGeometry({ x: 0, y: 0 }, { x: 800, y: 220 }, {
      ...DEFAULT_SETTINGS,
      roughness: 0,
    }, 17)
    expect(result.shaftPath.endsWith('Z')).toBe(true)
    expect(result.headPath.endsWith('Z')).toBe(true)
    // Rounded wings use extra corner arcs instead of two pointed chevrons.
    expect(result.headPath.match(/Q/g)).toHaveLength(8)
    const capOffset = Math.hypot(result.end.x - result.shaftEnd.x, result.end.y - result.shaftEnd.y)
    expect(capOffset).toBeGreaterThan(DEFAULT_SETTINGS.strokeWidth * 0.51)
  })

  it('splits its explicit loop junction into non-self-intersecting knot segments', () => {
    const result = generateArrowGeometry({ x: 0, y: 0 }, { x: 700, y: 260 }, {
      ...DEFAULT_SETTINGS,
      style: 'loop',
      roughness: 0,
    }, 7)
    const distinctPoints = new Set(result.points.map((point) => `${point.x.toFixed(4)},${point.y.toFixed(4)}`))
    expect(distinctPoints.size).toBe(result.points.length - 1)
    expect(result.points.length).toBeGreaterThan(45)
    expect(result.crossing).toMatchObject({ overpass: 'tail' })
    expect(result.shaftPaths).toHaveLength(2)
    expect(result.shaftPaths.every((path) => path.endsWith('Z'))).toBe(true)
    expect(result.shaftSegments.every((segment) => !polylineHasSelfIntersection(segment))).toBe(true)
    const lowerEnd = result.shaftSegments[0][result.shaftSegments[0].length - 1]
    const crossing = result.crossing!.point
    expect(Math.hypot(lowerEnd.x - crossing.x, lowerEnd.y - crossing.y)).toBeCloseTo(result.crossing!.gap, 1)
  })

  it('keeps both loop visits tangent-continuous with a curved, lower gesture', () => {
    const result = generateArrowGeometry({ x: 0, y: 0 }, { x: 760, y: 310 }, {
      ...DEFAULT_SETTINGS,
      style: 'loop',
      roughness: 0,
    }, 23)
    const { firstVisitIndex: first, secondVisitIndex: second } = result.crossing!
    const unit = (from: { x: number; y: number }, to: { x: number; y: number }) => {
      const x = to.x - from.x
      const y = to.y - from.y
      const length = Math.hypot(x, y)
      return { x: x / length, y: y / length }
    }
    const alignment = (a: { x: number; y: number }, b: { x: number; y: number }) => a.x * b.x + a.y * b.y
    const approachIn = unit(result.points[first - 1], result.points[first])
    const loopOut = unit(result.points[first], result.points[first + 1])
    const loopIn = unit(result.points[second - 1], result.points[second])
    const tailOut = unit(result.points[second], result.points[second + 1])

    expect(alignment(approachIn, loopOut)).toBeGreaterThan(0.995)
    expect(alignment(loopIn, tailOut)).toBeGreaterThan(0.995)
    expect(Math.asin(Math.abs(result.loop!.axis.y))).toBeLessThanOrEqual(Math.PI / 30 + 1e-6)
    expect(result.loop!.height / result.loop!.width).toBeGreaterThan(1)
    expect(result.loop!.height / result.loop!.width).toBeLessThan(1.5)
    expect(result.loop!.center.y).toBeGreaterThan(result.crossing!.point.y)
    expect(result.crossing!.gap).toBeLessThan(DEFAULT_SETTINGS.strokeWidth * 0.5)
    const chord = { x: result.end.x - result.start.x, y: result.end.y - result.start.y }
    const chordLength = Math.hypot(chord.x, chord.y)
    const maxCurveOffset = Math.max(...result.points.map((point) => Math.abs(
      chord.x * (point.y - result.start.y) - chord.y * (point.x - result.start.x)
    ) / chordLength))
    expect(maxCurveOffset).toBeGreaterThan(chordLength * 0.075)

    const tail = result.points.slice(second)
    const headings = tail.slice(1).map((point, index) => Math.atan2(
      point.y - tail[index].y,
      point.x - tail[index].x,
    ))
    const headingChanges = headings.slice(1).map((heading, index) => {
      const raw = Math.abs(heading - headings[index])
      return raw > Math.PI ? Math.PI * 2 - raw : raw
    })
    expect(Math.max(...headingChanges)).toBeLessThan(0.1)
    expect(Math.abs(headings[headings.length - 1] - headings[0])).toBeGreaterThan(0.45)

    const approach = result.points.slice(0, first + 1)
    const approachHeadings = approach.slice(1).map((point, index) => Math.atan2(
      point.y - approach[index].y,
      point.x - approach[index].x,
    ))
    const approachChanges = approachHeadings.slice(1).map((heading, index) => {
      const raw = Math.abs(heading - approachHeadings[index])
      return raw > Math.PI ? Math.PI * 2 - raw : raw
    })
    expect(Math.max(...approachChanges)).toBeLessThan(0.1)
    expect(Math.abs(approachHeadings[approachHeadings.length - 1] - approachHeadings[0])).toBeGreaterThan(0.5)
  })

  it('keeps loop segments non-self-intersecting across directions and sides', () => {
    const endpoints = [
      { x: 800, y: 100 },
      { x: 120, y: 760 },
      { x: -680, y: 340 },
      { x: -260, y: -720 },
    ]
    for (const end of endpoints) {
      for (const curvature of [-0.65, 0.65]) {
        const result = generateArrowGeometry({ x: 0, y: 0 }, end, {
          ...DEFAULT_SETTINGS,
          style: 'loop',
          curvature,
          roughness: 0,
        }, 19)
        expect(result.shaftSegments).toHaveLength(2)
        expect(
          result.shaftSegments.every((segment) => !polylineHasSelfIntersection(segment)),
          `unexpected crossing for end=${end.x},${end.y} curvature=${curvature}`,
        ).toBe(true)
      }
    }
  })

  it('mirrors the rightward loop gesture cleanly for a leftward path', () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      style: 'loop' as const,
      curvature: 0.5,
      roughness: 0,
    }
    const right = generateArrowGeometry({ x: 0, y: 0 }, { x: 760, y: 310 }, settings, 31)
    const left = generateArrowGeometry({ x: 0, y: 0 }, { x: -760, y: 310 }, settings, 31)

    expect(left.points).toHaveLength(right.points.length)
    left.points.forEach((point, index) => {
      expect(point.x).toBeCloseTo(-right.points[index].x, 4)
      expect(point.y).toBeCloseTo(right.points[index].y, 4)
    })
    expect(left.loop!.width).toBeCloseTo(right.loop!.width, 4)
    expect(left.loop!.height).toBeCloseTo(right.loop!.height, 4)
  })

  it('clamps geometry safely for short paths', () => {
    const result = generateArrowGeometry({ x: 0, y: 0 }, { x: 40, y: 0 }, {
      ...DEFAULT_SETTINGS,
      style: 'loop',
      roughness: 1,
    }, 9)
    expect(result.shaftPath).not.toContain('NaN')
    expect(result.headPath).not.toContain('NaN')
    expect(result.headLength).toBeLessThanOrEqual(12)
  })

  it('returns the final path direction as a normalized tangent', () => {
    const tangent = tangentAtEnd([{ x: 0, y: 0 }, { x: 3, y: 4 }])
    expect(tangent.x).toBeCloseTo(0.6)
    expect(tangent.y).toBeCloseTo(0.8)
  })
})
