import {
  connectPolygons,
  generateArrowGeometry,
  invertTransform,
  lineEndpoints,
  multiplyTransforms,
  rectangleCorners,
  transformPoint,
  type AffineTransform,
  type Point,
} from '../core/geometry'
import { entitlements } from '../core/entitlements'
import {
  clampSettings,
  DEFAULT_SETTINGS,
  freeSettings,
  type ArrowMetadataV3,
  type ArrowSettings,
  type BrandColor,
  type Locale,
  type PluginToUiMessage,
  type RgbColor,
  type SelectionSnapshot,
  type UiToPluginMessage,
  type UserPreset,
  type UserPreferences,
} from '../shared/types'

const METADATA_KEY = 'sketch-arrow:metadata'
const ROLE_KEY = 'sketch-arrow:role'
const PREFERENCES_KEY = 'sketch-arrow:preferences-v2'
const LEGACY_PREFERENCES_KEY = 'sketch-arrow:preferences-v1'
const IDENTITY: AffineTransform = [[1, 0, 0], [0, 1, 0]]

type WritableContainer = PageNode | FrameNode

class PluginOperationError extends Error {
  constructor(
    readonly code: Extract<PluginToUiMessage, { type: 'operation-result' }>['code'],
    message: string,
  ) {
    super(message)
  }
}

figma.showUI(__html__, {
  width: 336,
  height: 560,
  themeColors: true,
  title: 'Sketch Arrow',
})

figma.on('selectionchange', () => {
  sendToUi({ type: 'selection', selection: getSelectionSnapshot() })
})

figma.ui.onmessage = async (message: UiToPluginMessage) => {
  try {
    if (message.type === 'ui-ready') {
      const preferences = await loadPreferences(message.locale)
      sendToUi({
        type: 'bootstrap',
        selection: getSelectionSnapshot(),
        preferences,
        entitlement: await entitlements.getSnapshot(),
      })
      return
    }
    if (message.type === 'checkout') {
      try {
        const entitlement = await entitlements.checkout()
        sendToUi({ type: 'entitlement', entitlement })
      } catch (error) {
        throw new PluginOperationError(
          'payment-unavailable',
          error instanceof Error ? error.message : 'Payment checkout is unavailable.',
        )
      }
      return
    }
    if (message.type === 'save-preferences') {
      await savePreferences(message.preferences)
      return
    }
    if (message.type === 'generate') {
      await generateFromSelection(await settingsForNewArrow(message.settings))
      sendToUi({ type: 'operation-result', ok: true, code: 'generated' })
      return
    }
    if (message.type === 'update') {
      await updateSelectedArrow(clampSettings(message.settings))
      sendToUi({ type: 'operation-result', ok: true, code: 'updated' })
    }
  } catch (error) {
    const operationError = normalizeError(error)
    console.error(error)
    figma.notify(operationError.message, { error: true })
    sendToUi({ type: 'operation-result', ok: false, code: operationError.code })
  }
}

async function settingsForNewArrow(input: ArrowSettings): Promise<ArrowSettings> {
  const settings = clampSettings(input)
  const entitlement = await entitlements.getSnapshot()
  return entitlement.tier === 'pro' ? settings : freeSettings(settings)
}

function settingsForExistingUpdate(
  previous: ArrowSettings,
  requested: ArrowSettings,
  tier: 'free' | 'pro',
): ArrowSettings {
  if (tier === 'pro') return requested
  // Do not downgrade an existing Pro-shaped arrow. Free users can still edit
  // the permanently free controls while preserving the old visual settings.
  return {
    ...previous,
    style: isFreeStyle(requested.style) ? requested.style : previous.style,
    color: requested.color,
    strokeWidth: requested.strokeWidth,
    reversed: requested.reversed,
  }
}

function isFreeStyle(style: ArrowSettings['style']): style is 'natural' | 'loop' {
  return style === 'natural' || style === 'loop'
}

async function generateFromSelection(settings: ArrowSettings): Promise<void> {
  const selection = figma.currentPage.selection
  if (selection.length === 1 && selection[0].type === 'LINE') {
    if (!(await entitlements.canUse('line-generation'))) throw new Error('Feature is unavailable')
    await generateFromLine(selection[0], settings)
    return
  }
  if (selection.length === 2 && selection.every(hasGeometry)) {
    if (!(await entitlements.canUse('two-node-generation'))) throw new Error('Feature is unavailable')
    await generateFromTwoNodes(selection[0], selection[1], settings)
    return
  }
  throw new PluginOperationError('invalid-selection', 'Select one line or two layers.')
}

async function generateFromLine(line: LineNode, settings: ArrowSettings): Promise<void> {
  if (hasProtectedAncestor(line)) {
    throw new PluginOperationError('readonly', 'The selected line is inside a component or instance.')
  }
  const target = findSafeContainerForNode(line)
  const [start, end] = lineEndpoints(line.width, asAffine(line.absoluteTransform))
  const seed = createSeed()
  const metadata: ArrowMetadataV3 = {
    version: 3,
    sourceMode: 'line',
    sourceNodeIds: [line.id],
    seed,
    settings,
    loopRendering: { crossingStyle: 'knot', overpass: 'tail' },
  }
  const group = createArrowGroup(target, start, end, metadata, line)
  selectAndReveal(group)
}

async function generateFromTwoNodes(
  first: SceneNode,
  second: SceneNode,
  settings: ArrowSettings,
): Promise<void> {
  const connection = connectionForNodes(first, second, settings.strokeWidth)
  const target = findCommonSafeContainer(first, second)
  const seed = createSeed()
  const metadata: ArrowMetadataV3 = {
    version: 3,
    sourceMode: 'two-nodes',
    sourceNodeIds: [first.id, second.id],
    seed,
    settings,
    loopRendering: { crossingStyle: 'knot', overpass: 'tail' },
  }
  const group = createArrowGroup(target, connection.start, connection.end, metadata)
  selectAndReveal(group)
}

async function updateSelectedArrow(settings: ArrowSettings): Promise<void> {
  const group = findSelectedArrowGroup()
  if (!group) throw new PluginOperationError('invalid-selection', 'Select a generated Sketch Arrow group.')
  const existing = readMetadata(group)
  if (!existing) throw new PluginOperationError('invalid-selection', 'Arrow metadata is missing.')
  const target = group.parent
  if (!target || (target.type !== 'PAGE' && target.type !== 'FRAME')) {
    throw new PluginOperationError('readonly', 'The arrow cannot be updated in this container.')
  }
  const entitlement = await entitlements.getSnapshot()
  const effectiveSettings = settingsForExistingUpdate(existing.settings, settings, entitlement.tier)

  let start: Point
  let end: Point
  let guideForNewGroup: LineNode | undefined
  if (existing.sourceMode === 'line') {
    const source = await figma.getNodeByIdAsync(existing.sourceNodeIds[0])
    if (!source || source.type !== 'LINE') {
      throw new PluginOperationError('source-missing', 'The hidden guide line no longer exists.')
    }
    ;[start, end] = lineEndpoints(source.width, asAffine(source.absoluteTransform))
  } else {
    const [first, second] = await Promise.all(existing.sourceNodeIds.map((id) => figma.getNodeByIdAsync(id)))
    if (!first || !second || !isSceneNode(first) || !isSceneNode(second) || !hasGeometry(first) || !hasGeometry(second)) {
      throw new PluginOperationError('source-missing', 'One or both source layers no longer exist.')
    }
    const connection = connectionForNodes(first, second, effectiveSettings.strokeWidth)
    start = connection.start
    end = connection.end
  }

  const metadata: ArrowMetadataV3 = {
    ...existing,
    version: 3,
    seed: existing.seed,
    settings: effectiveSettings,
    loopRendering: { crossingStyle: 'knot', overpass: 'tail' },
  }

  if (existing.sourceMode === 'line') {
    guideForNewGroup = createGuideLine(target, start, end)
    metadata.sourceNodeIds = [guideForNewGroup.id]
  }

  const replacement = createArrowGroup(target, start, end, metadata, guideForNewGroup)
  group.remove()
  selectAndReveal(replacement)
}

function createArrowGroup(
  target: WritableContainer,
  pageStart: Point,
  pageEnd: Point,
  metadata: ArrowMetadataV3,
  existingGuide?: LineNode,
): GroupNode {
  const targetInverse = invertTransform(containerTransform(target))
  const localStart = transformPoint(targetInverse, pageStart)
  const localEnd = transformPoint(targetInverse, pageEnd)
  const geometry = generateArrowGeometry(localStart, localEnd, metadata.settings, metadata.seed)
  const shafts = geometry.shaftPaths.map((path, index) => createVectorNode(
    target,
    path,
    metadata.settings,
    'shaft',
    geometry.shaftOpacity,
    geometry.shaftPaths.length === 1
      ? 'Arrow shaft'
      : index === geometry.shaftPaths.length - 1
        ? 'Arrow shaft (overpass)'
        : 'Arrow shaft (underpass)',
  ))
  const accents = geometry.accentPaths.map((path) => createVectorNode(
    target,
    path,
    metadata.settings,
    'accent',
    geometry.shaftOpacity,
    'Arrow emphasis mark',
  ))
  const heads = geometry.headPaths.map((path) => createVectorNode(
    target,
    path,
    metadata.settings,
    'head',
    geometry.headOpacity,
  ))

  const guide = existingGuide ?? createGuideLine(target, pageStart, pageEnd)
  if (guide.parent !== target) reparentPreservingTransform(guide, target)
  guide.visible = false
  guide.name = 'Arrow guide (hidden)'
  guide.setPluginData(ROLE_KEY, 'guide')

  const group = figma.group([guide, ...shafts, ...accents, ...heads], target)
  group.name = 'Sketch Arrow'
  group.setPluginData(METADATA_KEY, JSON.stringify(metadata))
  if (target.type === 'FRAME' && target.layoutMode !== 'NONE') {
    group.layoutPositioning = 'ABSOLUTE'
  }
  return group
}

function createVectorNode(
  target: WritableContainer,
  path: string,
  settings: ArrowSettings,
  role: 'shaft' | 'head' | 'accent',
  opacity = 1,
  name?: string,
): VectorNode {
  const vector = figma.createVector()
  target.appendChild(vector)
  vector.name = name ?? (role === 'shaft' ? 'Arrow shaft' : role === 'head' ? 'Arrow head' : 'Arrow accent')
  vector.vectorPaths = [{ windingRule: 'NONZERO', data: path }]
  vector.fills = [{ type: 'SOLID', color: settings.color }]
  vector.opacity = opacity
  vector.strokes = []
  vector.setPluginData(ROLE_KEY, role)
  return vector
}

function createGuideLine(target: WritableContainer, pageStart: Point, pageEnd: Point): LineNode {
  const inverse = invertTransform(containerTransform(target))
  const start = transformPoint(inverse, pageStart)
  const end = transformPoint(inverse, pageEnd)
  const dx = end.x - start.x
  const dy = end.y - start.y
  const length = Math.hypot(dx, dy)
  if (length < 0.01) throw new PluginOperationError('too-close', 'The guide is too short.')
  const ux = dx / length
  const uy = dy / length
  const line = figma.createLine()
  target.appendChild(line)
  if (target.type === 'FRAME' && target.layoutMode !== 'NONE') line.layoutPositioning = 'ABSOLUTE'
  line.resize(length, 0)
  line.relativeTransform = [[ux, -uy, start.x], [uy, ux, start.y]]
  line.visible = false
  line.name = 'Arrow guide (hidden)'
  line.setPluginData(ROLE_KEY, 'guide')
  return line
}

function connectionForNodes(first: SceneNode, second: SceneNode, strokeWidth: number) {
  if (!hasGeometry(first) || !hasGeometry(second)) {
    throw new PluginOperationError('invalid-selection', 'The selected layers have no usable bounds.')
  }
  const firstCorners = rectangleCorners(first.width, first.height, asAffine(first.absoluteTransform))
  const secondCorners = rectangleCorners(second.width, second.height, asAffine(second.absoluteTransform))
  const connection = connectPolygons(firstCorners, secondCorners, Math.max(10, strokeWidth * 1.8), 28)
  if (!connection) {
    throw new PluginOperationError('too-close', 'The selected layers overlap or are too close together.')
  }
  return connection
}

function getSelectionSnapshot(): SelectionSnapshot {
  const selection = figma.currentPage.selection
  const arrowGroup = findSelectedArrowGroup()
  if (arrowGroup) {
    const metadata = readMetadata(arrowGroup)
    if (metadata) {
      return {
        kind: 'generated-arrow',
        title: 'Sketch Arrow',
        detail: metadata.sourceMode,
        nodeNames: [arrowGroup.name],
        metadata,
      }
    }
  }
  if (selection.length === 1 && selection[0].type === 'LINE') {
    return {
      kind: 'line',
      title: 'Line selected',
      detail: `${Math.round(selection[0].width)} px`,
      nodeNames: [selection[0].name],
    }
  }
  if (selection.length === 2 && selection.every(hasGeometry)) {
    return {
      kind: 'two-nodes',
      title: 'Two layers selected',
      detail: 'Ready to connect',
      nodeNames: selection.map((node) => node.name),
    }
  }
  return {
    kind: 'invalid',
    title: 'Select a line or two layers',
    detail: selection.length === 0 ? 'Nothing selected' : `${selection.length} selected`,
    nodeNames: selection.map((node) => node.name).slice(0, 2),
  }
}

function findSelectedArrowGroup(): GroupNode | null {
  if (figma.currentPage.selection.length !== 1) return null
  let node: BaseNode | null = figma.currentPage.selection[0]
  while (node && node.type !== 'PAGE' && node.type !== 'DOCUMENT') {
    if (node.type === 'GROUP' && node.getPluginData(METADATA_KEY)) return node
    node = node.parent
  }
  return null
}

function readMetadata(node: BaseNode): ArrowMetadataV3 | null {
  const raw = node.getPluginData(METADATA_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<Omit<ArrowMetadataV3, 'version'>> & { version?: number }
    if (
      (parsed.version !== 1 && parsed.version !== 2 && parsed.version !== 3)
      || !parsed.settings
      || (parsed.sourceMode !== 'line' && parsed.sourceMode !== 'two-nodes')
      || !Array.isArray(parsed.sourceNodeIds)
    ) {
      return null
    }
    const sourceNodeIds = parsed.sourceNodeIds.filter((id): id is string => typeof id === 'string')
    if ((parsed.sourceMode === 'line' && sourceNodeIds.length < 1)
      || (parsed.sourceMode === 'two-nodes' && sourceNodeIds.length < 2)) {
      return null
    }
    return {
      // Reading V1/V2 migrates it in memory. The next update stores V3 data.
      version: 3,
      sourceMode: parsed.sourceMode,
      sourceNodeIds,
      seed: Number.isFinite(parsed.seed) ? parsed.seed! : 1,
      settings: clampSettings(parsed.settings as Partial<ArrowSettings>),
      loopRendering: { crossingStyle: 'knot', overpass: 'tail' },
    }
  } catch {
    return null
  }
}

function findSafeContainerForNode(node: SceneNode): WritableContainer {
  let parent = node.parent
  while (parent) {
    if ((parent.type === 'FRAME' || parent.type === 'PAGE') && isSafeContainer(parent)) return parent
    parent = parent.parent
  }
  return figma.currentPage
}

function findCommonSafeContainer(first: SceneNode, second: SceneNode): WritableContainer {
  const secondAncestors = new Set<BaseNode>()
  let node: BaseNode | null = second.parent
  while (node) {
    secondAncestors.add(node)
    node = node.parent
  }
  node = first.parent
  while (node) {
    if (secondAncestors.has(node) && (node.type === 'FRAME' || node.type === 'PAGE') && isSafeContainer(node)) {
      return node
    }
    node = node.parent
  }
  return figma.currentPage
}

function isSafeContainer(container: WritableContainer): boolean {
  let node: BaseNode | null = container
  while (node && node.type !== 'PAGE') {
    if (node.type === 'INSTANCE' || node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') return false
    node = node.parent
  }
  return true
}

function hasProtectedAncestor(node: SceneNode): boolean {
  let parent = node.parent
  while (parent && parent.type !== 'PAGE') {
    if (parent.type === 'INSTANCE' || parent.type === 'COMPONENT' || parent.type === 'COMPONENT_SET') return true
    parent = parent.parent
  }
  return false
}

function reparentPreservingTransform(node: SceneNode, target: WritableContainer): void {
  const absolute = asAffine(node.absoluteTransform)
  const local = multiplyTransforms(invertTransform(containerTransform(target)), absolute)
  target.appendChild(node)
  if (target.type === 'FRAME' && target.layoutMode !== 'NONE' && 'layoutPositioning' in node) {
    node.layoutPositioning = 'ABSOLUTE'
  }
  node.relativeTransform = local as Transform
}

function containerTransform(container: WritableContainer): AffineTransform {
  return container.type === 'PAGE' ? IDENTITY : asAffine(container.absoluteTransform)
}

function hasGeometry(node: SceneNode): node is SceneNode & LayoutMixin {
  return 'width' in node && 'height' in node && 'absoluteTransform' in node
    && Number.isFinite(node.width) && Number.isFinite(node.height)
}

function isSceneNode(node: BaseNode): node is SceneNode {
  return node.type !== 'DOCUMENT' && node.type !== 'PAGE'
}

function selectAndReveal(group: GroupNode): void {
  figma.currentPage.selection = [group]
  figma.viewport.scrollAndZoomIntoView([group])
  sendToUi({ type: 'selection', selection: getSelectionSnapshot() })
}

async function loadPreferences(fallbackLocale: Locale): Promise<UserPreferences> {
  const stored = (await figma.clientStorage.getAsync(PREFERENCES_KEY)
    ?? await figma.clientStorage.getAsync(LEGACY_PREFERENCES_KEY)) as Partial<UserPreferences> | undefined
  return {
    locale: stored?.locale === 'en' || stored?.locale === 'zh-CN' ? stored.locale : fallbackLocale,
    settings: stored?.settings ? clampSettings(stored.settings) : DEFAULT_SETTINGS,
    presets: normalizePresets(stored?.presets),
    brandColors: normalizeBrandColors(stored?.brandColors),
  }
}

async function savePreferences(preferences: UserPreferences): Promise<void> {
  await figma.clientStorage.setAsync(PREFERENCES_KEY, {
    locale: preferences.locale === 'zh-CN' ? 'zh-CN' : 'en',
    settings: clampSettings(preferences.settings),
    presets: normalizePresets(preferences.presets),
    brandColors: normalizeBrandColors(preferences.brandColors),
  })
}

function normalizePresets(value: unknown): UserPreset[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item): UserPreset | null => {
      if (!isRecord(item) || typeof item.id !== 'string' || typeof item.name !== 'string') return null
      if (!isRecord(item.settings)) return null
      const createdAt = Number.isFinite(item.createdAt) ? Number(item.createdAt) : Date.now()
      const updatedAt = Number.isFinite(item.updatedAt) ? Number(item.updatedAt) : createdAt
      return {
        id: item.id.slice(0, 120),
        name: item.name.trim().slice(0, 80),
        settings: clampSettings(item.settings as Partial<ArrowSettings>),
        createdAt,
        updatedAt,
      }
    })
    .filter((item): item is UserPreset => item !== null && item.name.length > 0)
    .slice(0, 30)
}

function normalizeBrandColors(value: unknown): BrandColor[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item): BrandColor | null => {
      if (!isRecord(item) || typeof item.id !== 'string' || typeof item.name !== 'string') return null
      if (!isRecord(item.color)) return null
      return {
        id: item.id.slice(0, 120),
        name: item.name.trim().slice(0, 80),
        color: normalizeColor(item.color),
      }
    })
    .filter((item): item is BrandColor => item !== null && item.name.length > 0)
    .slice(0, 16)
}

function normalizeColor(value: Record<string, unknown>): RgbColor {
  return clampSettings({ color: value as unknown as RgbColor }).color
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function normalizeError(error: unknown): PluginOperationError {
  if (error instanceof PluginOperationError) return error
  return new PluginOperationError('unexpected', error instanceof Error ? error.message : 'Unexpected error')
}

function createSeed(): number {
  return Math.floor(Math.random() * 0xffffffff) >>> 0
}

function asAffine(transform: Transform): AffineTransform {
  return transform as AffineTransform
}

function sendToUi(message: PluginToUiMessage): void {
  figma.ui.postMessage(message)
}
