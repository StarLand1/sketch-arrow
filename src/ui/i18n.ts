import type { Locale, SelectionKind } from '../shared/types'

const translations = {
  'zh-CN': {
    appName: 'Sketch Arrow',
    free: '免费版',
    status: {
      line: ['已选择引导线', '将按这条线的方向和长度生成'],
      'two-nodes': ['已选择两个图层', '将在两个图层的边界之间生成'],
      'generated-arrow': ['已选择 Sketch Arrow', '可以调整参数、更新或重新随机'],
      invalid: ['等待选择', '请选择一条 Line，或同时选择两个图层'],
    },
    style: '箭头形态',
    natural: '自然弯曲',
    loop: '手绘小圈',
    color: '颜色',
    strokeWidth: '线宽',
    headSize: '箭头大小',
    curvature: '弯曲',
    roughness: '手绘感',
    left: '左',
    right: '右',
    subtle: '轻微',
    strong: '明显',
    reverse: '反转方向',
    reroll: '重新随机',
    generate: '生成箭头',
    update: '更新箭头',
    hint: '提示：按 L 画一条线，选中后即可生成。',
    operation: {
      generated: '箭头已生成',
      updated: '箭头已更新',
      'invalid-selection': '请选择一条 Line、两个图层或一个已生成箭头',
      'source-missing': '原始图层或隐藏引导线已不存在',
      'too-close': '距离太短或图层重叠，请改用 Line',
      readonly: '该内容位于组件或不可编辑容器中',
      unexpected: '发生意外错误，请重试',
    },
  },
  en: {
    appName: 'Sketch Arrow',
    free: 'Free',
    status: {
      line: ['Guide line selected', 'The arrow will follow its length and direction'],
      'two-nodes': ['Two layers selected', 'The arrow will connect their facing edges'],
      'generated-arrow': ['Sketch Arrow selected', 'Adjust, update, reverse, or reroll it'],
      invalid: ['Waiting for a selection', 'Select one Line or exactly two layers'],
    },
    style: 'Arrow shape',
    natural: 'Natural',
    loop: 'Hand-drawn loop',
    color: 'Color',
    strokeWidth: 'Stroke width',
    headSize: 'Head size',
    curvature: 'Curve',
    roughness: 'Hand-drawn feel',
    left: 'Left',
    right: 'Right',
    subtle: 'Subtle',
    strong: 'Strong',
    reverse: 'Reverse',
    reroll: 'Reroll',
    generate: 'Generate arrow',
    update: 'Update arrow',
    hint: 'Tip: press L, draw a line, then select it to generate.',
    operation: {
      generated: 'Arrow generated',
      updated: 'Arrow updated',
      'invalid-selection': 'Select one Line, two layers, or a generated arrow',
      'source-missing': 'A source layer or hidden guide no longer exists',
      'too-close': 'Layers overlap or are too close; use a Line instead',
      readonly: 'This content is inside a component or read-only container',
      unexpected: 'Something went wrong. Please try again.',
    },
  },
} as const

export function getStrings(locale: Locale) {
  return translations[locale]
}

export function getStatusCopy(locale: Locale, kind: SelectionKind): readonly [string, string] {
  return translations[locale].status[kind]
}
