import { describe, expect, it } from 'vitest'
import {
  connectPolygons,
  CLOSED_HEAD_GEOMETRY_SCALE,
  createRedrawnPass,
  createStrokePressureProfile,
  dashPatternLengths,
  generateArrowGeometry,
  invertTransform,
  lineEndpoints,
  polylineHasSelfIntersection,
  rectangleCorners,
  tangentAtEnd,
  transformPoint,
  type AffineTransform,
} from '../src/core/geometry'
import {
  clampSettings,
  DEFAULT_SETTINGS,
  freeSettings,
  headScaleForSize,
  STROKE_WIDTHS,
} from '../src/shared/types'

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

  it('keeps the free controls while clamping legacy settings', () => {
    const legacy = clampSettings({ style: 'loop', color: { r: 0.4, g: 0.5, b: 0.6 } })
    expect(legacy.style).toBe('loop')
    expect(legacy.lineStyle).toBe(DEFAULT_SETTINGS.lineStyle)
    expect(legacy.headStyle).toBe(DEFAULT_SETTINGS.headStyle)
    expect(legacy.color).toEqual({ r: 0.4, g: 0.5, b: 0.6 })

    const migrated = clampSettings({ brush: 'pencil', headScale: 1, roughness: 0.8 })
    expect(migrated.lineStyle).toBe('sketch')
    expect(migrated.headSize).toBe('small')
    expect(clampSettings({ headStyle: 'open' }).headStyle).toBe('path')

    const free = freeSettings({ style: 'spiral', brush: 'ink', headStyle: 'path', strokePattern: 'dotted', headScale: 1.5, reversed: true })
    expect(free.style).toBe('natural')
    expect(free.lineStyle).toBe('clean')
    expect(free.headStyle).toBe('solid')
    expect(free.strokePattern).toBe('solid')
    expect(free.headSize).toBe('medium')
    expect(free.reversed).toBe(true)
    expect(clampSettings({ style: 'emphasis' }).style).toBe('natural')
  })

  it('normalizes line widths to the three stable presets', () => {
    expect(clampSettings({ strokeWidth: 1 }).strokeWidth).toBe(STROKE_WIDTHS.thin)
    expect(clampSettings({ strokeWidth: 10 }).strokeWidth).toBe(STROKE_WIDTHS.medium)
    expect(clampSettings({ strokeWidth: 40 }).strokeWidth).toBe(STROKE_WIDTHS.thick)
    expect(DEFAULT_SETTINGS.strokeWidth).toBe(STROKE_WIDTHS.medium)
  })

  it('generates every advanced path deterministically', () => {
    const styles = ['s-curve', 'wave'] as const
    for (const style of styles) {
      const settings = { ...DEFAULT_SETTINGS, style }
      const first = generateArrowGeometry({ x: 0, y: 0 }, { x: 640, y: 280 }, settings, 77)
      const second = generateArrowGeometry({ x: 0, y: 0 }, { x: 640, y: 280 }, settings, 77)
      expect(first.shaftPaths.length).toBeGreaterThan(0)
      expect(first.shaftPath).toBe(second.shaftPath)
      expect(first.headPath).toBe(second.headPath)
      expect(first.shaftPath).not.toContain('NaN')
      expect(first.headPath).not.toContain('NaN')
    }
  })

  it('keeps line and head variants editable as independent paths', () => {
    const base = generateArrowGeometry({ x: 0, y: 0 }, { x: 520, y: 160 }, DEFAULT_SETTINGS, 11)
    const open = generateArrowGeometry({ x: 0, y: 0 }, { x: 520, y: 160 }, {
      ...DEFAULT_SETTINGS,
      headStyle: 'path',
    }, 11)
    expect(base.headPaths).toHaveLength(1)
    expect(open.headPaths).toHaveLength(2)
    expect(base.shaftOpacity).toBe(1)
    expect(base.headOpacity).toBe(1)
    expect(open.headPaths.every((path) => path.endsWith('Z'))).toBe(true)
  })

  it('renders hollow heads as transparent even-odd contours', () => {
    const hollow = generateArrowGeometry({ x: 0, y: 0 }, { x: 520, y: 160 }, {
      ...DEFAULT_SETTINGS,
      headStyle: 'hollow',
    }, 11)
    expect(hollow.headPaths).toHaveLength(1)
    expect(hollow.headWindingRules).toEqual(['EVENODD'])
    expect(hollow.headPath.match(/M /g)!.length).toBeGreaterThan(1)
    const rearCurves = extractCubicCommands(hollow.headPath)
    expect(rearCurves).toHaveLength(2)
    const depthBehindTip = (point: { x: number; y: number }) => (
      (hollow.end.x - point.x) * hollow.endTangent.x
      + (hollow.end.y - point.y) * hollow.endTangent.y
    )
    rearCurves.forEach(({ firstControl, secondControl, end }) => {
      const rearDepth = depthBehindTip(end)
      expect(rearDepth - depthBehindTip(firstControl)).toBeGreaterThan(hollow.headLength * 0.1)
      expect(rearDepth - depthBehindTip(secondControl)).toBeGreaterThan(hollow.headLength * 0.1)
    })
    const outerRearDepth = (
      depthBehindTip(rearCurves[0].firstControl)
      + depthBehindTip(rearCurves[0].secondControl)
    ) / 2
    const innerRearDepth = (
      depthBehindTip(rearCurves[1].firstControl)
      + depthBehindTip(rearCurves[1].secondControl)
    ) / 2
    expect(outerRearDepth - innerRearDepth).toBeGreaterThan(DEFAULT_SETTINGS.strokeWidth * 0.9)
    const shaftOffset = Math.hypot(
      hollow.end.x - hollow.shaftEnd.x,
      hollow.end.y - hollow.shaftEnd.y,
    )
    expect(shaftOffset / hollow.headLength).toBeGreaterThan(0.45)
    expect(shaftOffset / hollow.headLength).toBeLessThan(0.58)
  })

  it('splits dashed and dotted centre lines by arc length', () => {
    const dashed = generateArrowGeometry({ x: 0, y: 0 }, { x: 520, y: 160 }, {
      ...DEFAULT_SETTINGS,
      strokePattern: 'dashed',
    }, 11)
    const dotted = generateArrowGeometry({ x: 0, y: 0 }, { x: 520, y: 160 }, {
      ...DEFAULT_SETTINGS,
      strokePattern: 'dotted',
    }, 11)
    expect(dashed.shaftPaths.length).toBeGreaterThan(3)
    expect(dotted.shaftPaths.length).toBeGreaterThan(5)
    expect(dashed.shaftPaths.every((path) => path.endsWith('Z') && !path.includes('NaN'))).toBe(true)
    expect(dotted.shaftPaths.every((path) => path.endsWith('Z') && !path.includes('NaN'))).toBe(true)
    const pattern = dashPatternLengths(DEFAULT_SETTINGS.strokeWidth)
    expect(pattern.gapLength / pattern.dashLength).toBeCloseTo(0.7)
  })

  it('reverses the same loop gesture instead of regenerating its shape', () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      style: 'loop' as const,
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
    expect(long.headLength).toBeCloseTo(
      DEFAULT_SETTINGS.strokeWidth
      * headScaleForSize(DEFAULT_SETTINGS.headSize)
      * 5.325
      * CLOSED_HEAD_GEOMETRY_SCALE,
    )
  })

  it('uses 100%, 120%, and 150% for the three stable head sizes', () => {
    const sizes = ['small', 'medium', 'large'] as const
    const lengths = sizes.map((headSize) => generateArrowGeometry(
      { x: 0, y: 0 },
      { x: 1200, y: 120 },
      { ...DEFAULT_SETTINGS, headSize },
      5,
    ).headLength)
    expect(lengths[1] / lengths[0]).toBeCloseTo(1.2)
    expect(lengths[2] / lengths[0]).toBeCloseTo(1.5)
    expect(DEFAULT_SETTINGS.headSize).toBe('medium')
  })

  it('keeps solid and hollow head bounds aligned with the path head', () => {
    const headStyles = ['solid', 'hollow', 'path'] as const
    const lineStyles = ['clean', 'sketch', 'double-drawn'] as const
    for (const lineStyle of lineStyles) {
      const bounds = headStyles.map((headStyle) => pathBounds(generateArrowGeometry(
        { x: 0, y: 0 },
        { x: 1000, y: 0 },
        { ...DEFAULT_SETTINGS, lineStyle, headStyle },
        91,
      ).headPaths))
      const path = bounds[2]
      for (const closed of bounds.slice(0, 2)) {
        expect(Math.abs(closed.width - path.width) / path.width).toBeLessThan(0.08)
        expect(Math.abs(closed.height - path.height) / path.height).toBeLessThan(0.08)
      }
    }
  })

  it('uses closed pressure outlines with a rounded filled arrowhead', () => {
    const result = generateArrowGeometry({ x: 0, y: 0 }, { x: 800, y: 220 }, DEFAULT_SETTINGS, 17)
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

  it('applies repeatable sketch variation to the loop without moving its crossing', () => {
    const baseSettings = { ...DEFAULT_SETTINGS, style: 'loop' as const, lineStyle: 'clean' as const }
    const roughSettings = { ...baseSettings, lineStyle: 'sketch' as const }
    const base = generateArrowGeometry({ x: 0, y: 0 }, { x: 760, y: 310 }, baseSettings, 81)
    const rough = generateArrowGeometry({ x: 0, y: 0 }, { x: 760, y: 310 }, roughSettings, 81)
    const repeat = generateArrowGeometry({ x: 0, y: 0 }, { x: 760, y: 310 }, roughSettings, 81)
    expect(rough.points).toEqual(repeat.points)
    expect(rough.shaftPath).not.toBe(base.shaftPath)
    expect(rough.crossing!.point).toEqual(rough.points[rough.crossing!.firstVisitIndex])
    expect(rough.crossing!.point).toEqual(rough.points[rough.crossing!.secondVisitIndex])
    expect(rough.shaftSegments.every((segment) => !polylineHasSelfIntersection(segment))).toBe(true)
  })

  it('renders a deterministic second pass for double-drawn lines', () => {
    const settings = { ...DEFAULT_SETTINGS, lineStyle: 'double-drawn' as const }
    const first = generateArrowGeometry({ x: 0, y: 0 }, { x: 620, y: 190 }, settings, 91)
    const repeat = generateArrowGeometry({ x: 0, y: 0 }, { x: 620, y: 190 }, settings, 91)
    expect(first.shaftPaths).toHaveLength(2)
    expect(first.shaftPaths).toEqual(repeat.shaftPaths)
    expect(first.shaftPaths[0]).not.toBe(first.shaftPaths[1])
  })

  it('uses visible pressure variation for sketch lines', () => {
    const clean = createStrokePressureProfile(101, 'clean', 'steady', 27)
    const sketch = createStrokePressureProfile(101, 'sketch', 'steady', 27)
    const repeat = createStrokePressureProfile(101, 'sketch', 'steady', 27)
    const range = (values: number[]) => Math.max(...values) - Math.min(...values)
    expect(range(clean)).toBeCloseTo(0)
    expect(range(sketch)).toBeGreaterThan(0.36)
    expect(range(sketch)).toBeLessThan(0.52)
    expect(sketch).toEqual(repeat)
  })

  it('keeps the redrawn centreline on one broad, smooth parallel journey', () => {
    const points = Array.from({ length: 101 }, (_, index) => ({ x: index * 6, y: 0 }))
    const redrawn = createRedrawnPass(points, DEFAULT_SETTINGS.strokeWidth, 91)
    const offsets = redrawn.slice(1, -1).map((point) => point.y)
    const absolute = offsets.map(Math.abs)
    const adjacentChanges = offsets.slice(1).map((offset, index) => Math.abs(offset - offsets[index]))
    expect(redrawn[0]).toEqual(points[0])
    expect(redrawn[redrawn.length - 1]).toEqual(points[points.length - 1])
    expect(Math.max(...absolute)).toBeGreaterThan(DEFAULT_SETTINGS.strokeWidth)
    expect(Math.min(...offsets) >= 0 || Math.max(...offsets) <= 0).toBe(true)
    expect(Math.max(...adjacentChanges)).toBeLessThan(DEFAULT_SETTINGS.strokeWidth * 0.08)
    expect(Math.abs(redrawn[86].y)).toBeLessThan(Math.max(...absolute) * 0.16)
  })

  it('keeps all line, pattern, and head combinations editable', () => {
    const lineStyles = ['clean', 'sketch', 'double-drawn'] as const
    const patterns = ['solid', 'dashed', 'dotted'] as const
    const heads = ['solid', 'hollow', 'path'] as const
    for (const lineStyle of lineStyles) {
      for (const strokePattern of patterns) {
        for (const headStyle of heads) {
          const result = generateArrowGeometry({ x: 0, y: 0 }, { x: 620, y: 190 }, {
            ...DEFAULT_SETTINGS,
            lineStyle,
            strokePattern,
            headStyle,
          }, 37)
          expect(result.shaftPaths.length).toBeGreaterThan(0)
          expect(result.headPaths.length).toBeGreaterThan(0)
          expect([...result.shaftPaths, ...result.headPaths].every((path) => path.endsWith('Z') && !path.includes('NaN'))).toBe(true)
          if (headStyle === 'path' && lineStyle === 'double-drawn') expect(result.headPaths).toHaveLength(4)
          if (headStyle === 'hollow') expect(result.headWindingRules).toEqual(['EVENODD'])
        }
      }
    }
  })

  it('keeps both double-drawn loop passes in their knot paint layers', () => {
    const result = generateArrowGeometry({ x: 0, y: 0 }, { x: 760, y: 310 }, {
      ...DEFAULT_SETTINGS,
      style: 'loop',
      lineStyle: 'double-drawn',
    }, 41)
    expect(result.shaftPaths).toHaveLength(4)
    expect(result.shaftLayerBreakIndex).toBe(2)
    expect(result.shaftSegments).toHaveLength(2)
    expect(result.shaftSegments.every((segment) => !polylineHasSelfIntersection(segment))).toBe(true)
  })

  it('keeps loop segments non-self-intersecting across directions and sides', () => {
    const endpoints = [
      { x: 800, y: 100 },
      { x: 120, y: 760 },
      { x: -680, y: 340 },
      { x: -260, y: -720 },
    ]
    for (const end of endpoints) {
      for (const bend of [-1, 1] as const) {
        const result = generateArrowGeometry({ x: 0, y: 0 }, end, {
          ...DEFAULT_SETTINGS,
          style: 'loop',
        }, 19, bend)
        expect(result.shaftSegments).toHaveLength(2)
        expect(
          result.shaftSegments.every((segment) => !polylineHasSelfIntersection(segment)),
          `unexpected crossing for end=${end.x},${end.y} bend=${bend}`,
        ).toBe(true)
      }
    }
  })

  it('mirrors the rightward loop gesture cleanly for a leftward path', () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      style: 'loop' as const,
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

  it('authors every non-loop path in the same mirrored local coordinate system', () => {
    const styles = ['natural', 's-curve', 'wave'] as const
    for (const style of styles) {
      const settings = { ...DEFAULT_SETTINGS, style }
      const right = generateArrowGeometry({ x: 0, y: 0 }, { x: 760, y: 310 }, settings, 31)
      const left = generateArrowGeometry({ x: 0, y: 0 }, { x: -760, y: 310 }, settings, 31)
      expect(left.points).toHaveLength(right.points.length)
      left.points.forEach((point, index) => {
        expect(point.x).toBeCloseTo(-right.points[index].x, 4)
        expect(point.y).toBeCloseTo(right.points[index].y, 4)
      })
    }
  })

  it('clamps geometry safely for short paths', () => {
    const result = generateArrowGeometry({ x: 0, y: 0 }, { x: 40, y: 0 }, {
      ...DEFAULT_SETTINGS,
      style: 'loop',
      lineStyle: 'sketch',
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

function extractCubicCommands(path: string): Array<{
  firstControl: { x: number; y: number }
  secondControl: { x: number; y: number }
  end: { x: number; y: number }
}> {
  const commands: Array<{
    firstControl: { x: number; y: number }
    secondControl: { x: number; y: number }
    end: { x: number; y: number }
  }> = []
  const number = '(-?\\d+(?:\\.\\d+)?)'
  const pattern = new RegExp(`C ${number} ${number} ${number} ${number} ${number} ${number}`, 'g')
  for (const match of path.matchAll(pattern)) {
    commands.push({
      firstControl: { x: Number(match[1]), y: Number(match[2]) },
      secondControl: { x: Number(match[3]), y: Number(match[4]) },
      end: { x: Number(match[5]), y: Number(match[6]) },
    })
  }
  return commands
}

function pathBounds(paths: string[]): { width: number; height: number } {
  const values = paths.flatMap((path) => (
    [...path.matchAll(/-?\d+(?:\.\d+)?/g)].map((match) => Number(match[0]))
  ))
  const points = Array.from({ length: Math.floor(values.length / 2) }, (_, index) => ({
    x: values[index * 2],
    y: values[index * 2 + 1],
  }))
  const x = points.map((point) => point.x)
  const y = points.map((point) => point.y)
  return {
    width: Math.max(...x) - Math.min(...x),
    height: Math.max(...y) - Math.min(...y),
  }
}
