import './style.css'
import presetHtml from '../presetHTML/academic-page.html?raw'

type TagStatus = 'active' | 'inactive'
type Operation =
    | 'UPDATE_PROMPT_OR_REFRESH'
    | 'UPDATE_TAG_DESIGN_SEMANTICS'
    | 'UPDATE_TAG_APPLY_RANGE'
    | 'ADD_NEW_TAG'
    | 'ADD_NEW_DIMENSION'

type StyleBlock = {
  tokens: Record<string, string>
  apply_range: string[]
}

type StyleTag = {
  dimension: string
  status: TagStatus
  tag_id: string
  design_semantics: string
  style_blocks: StyleBlock[]
  raw_css?: string | null
}

type DimensionGroup = {
  dimension: string
  tags: StyleTag[]
}

type DimensionsTagsJson = {
  metadata: {
    version: number
    createdAt: string
    updatedAt: string
    tagCount: number
    dimensionCount: number
    [key: string]: unknown
  }
  dimensions: DimensionGroup[]
}

type GenerateRequest = {
  mock: boolean
  prompt: string
  html: string
}

type UpdateRequest = {
  mock: boolean
  operation: Operation
  prompt: string
  raw_html: string
  target: {
    dimension: string | null
    tag_id: string | null
    field: 'design_semantics' | 'apply_range' | null
  }
  user_request: string
  dimensions_tags_json: DimensionsTagsJson
  styled_html: string
}

type SavedView = {
  id: string
  name: string
  thumbnailName: string
  prompt: string
  dimensionsTagsJson: DimensionsTagsJson
  styledHtml: string
  activeCount: number
  tagCount: number
}

type HistoryEntry = {
  dimensionsTagsJson: DimensionsTagsJson
  promptText: string
  selectedTagId: string
  isInspectorOpen: boolean
}

type ScrollSnapshot = {
  documentLeft: number
  documentTop: number
  dimensionPanelTop: number
  galleryLeft: number
  inspectorTop: number
  previewLeft: number
  previewTop: number
}

type ElementPickerSource = 'prompt' | 'apply-range'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080'
const GENERATE_API_URL = `${API_BASE_URL}/api/generate-tags`
const UPDATE_API_URL = `${API_BASE_URL}/api/update-tags`
const USE_MOCK_API = import.meta.env.VITE_USE_MOCK_API !== 'false'
const SAVED_VIEWS_KEY = 'styleprism:saved-views'
const MAX_HISTORY_ENTRIES = 40
const DEFAULT_DIMENSION_PANEL_WIDTH = 340
const MIN_DIMENSION_PANEL_WIDTH = 240
const MIN_PREVIEW_WIDTH = 360
const RESIZE_STEP = 24

type IconName = 'plus' | 'pencil' | 'send' | 'chevron-up' | 'chevron-down' | 'undo' | 'redo' | 'sparkles'

const now = new Date().toISOString()
let rawHtml = presetHtml

let dimensionsTagsJson: DimensionsTagsJson = {
  metadata: {
    version: 1,
    createdAt: now,
    updatedAt: now,
    tagCount: 0,
    dimensionCount: 0,
  },
  dimensions: [],
}

let selectedTagId = ''
let isInspectorOpen = false
let promptText = ''
let isLoading = false
let pendingTargetDimension: string | null = null
let pendingNewDimensionName: string | null = null
let savedViews: SavedView[] = readSavedViews()
let isSaveDialogOpen = false
let saveDialogError = ''
let historyPast: HistoryEntry[] = []
let historyFuture: HistoryEntry[] = []
let elementPickerSource: ElementPickerSource | null = null
let promptPickerMarkerIndex: number | null = null
let previewPickerDocument: Document | null = null
let previewPickableElements: HTMLElement[] = []
let previewHoveredElement: HTMLElement | null = null
let previewSelectedElement: HTMLElement | null = null
let previewHighlightedApplyRangeSelector: string | null = null
let previewHighlightedApplyRangeElements: HTMLElement[] = []
let isGalleryCollapsed = false
let dimensionPanelWidth = DEFAULT_DIMENSION_PANEL_WIDTH

const $ = <T extends Element>(selector: string) => document.querySelector<T>(selector)
const $$ = <T extends Element>(selector: string) => Array.from(document.querySelectorAll<T>(selector))
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))

function icon(name: IconName) {
  const paths: Record<IconName, string> = {
    plus: '<path d="M12 5v14"></path><path d="M5 12h14"></path>',
    pencil: '<path d="M12 20h9"></path><path d="m16.5 3.5 4 4L8 20H4v-4L16.5 3.5Z"></path>',
    send: '<path d="M22 2 11 13"></path><path d="m22 2-7 20-4-9-9-4 20-7Z"></path>',
    'chevron-up': '<path d="m18 15-6-6-6 6"></path>',
    'chevron-down': '<path d="m6 9 6 6 6-6"></path>',
    undo: '<path d="M9 14 4 9l5-5"></path><path d="M4 9h11a5 5 0 0 1 0 10h-2"></path>',
    redo: '<path d="m15 14 5-5-5-5"></path><path d="M20 9H9a5 5 0 0 0 0 10h2"></path>',
    sparkles: '<path d="m12 3 1.7 4.3L18 9l-4.3 1.7L12 15l-1.7-4.3L6 9l4.3-1.7L12 3Z"></path><path d="m19 14 .8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8L19 14Z"></path><path d="m5 13 .7 1.8L8 15.5l-2.3.7L5 18l-.7-1.8-2.3-.7 2.3-.7L5 13Z"></path>',
  }

  return `<svg aria-hidden="true" viewBox="0 0 24 24">${paths[name]}</svg>`
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function resizePromptTextarea(input: HTMLTextAreaElement) {
  input.style.height = 'auto'

  const styles = window.getComputedStyle(input)
  const minHeight = Number.parseFloat(styles.minHeight)
  const maxHeight = Number.parseFloat(styles.maxHeight)
  const hasMaxHeight = Number.isFinite(maxHeight)
  const nextHeight = Math.max(
      Number.isFinite(minHeight) ? minHeight : 0,
      Math.min(input.scrollHeight, hasMaxHeight ? maxHeight : input.scrollHeight)
  )

  input.style.height = `${nextHeight}px`
  input.style.overflowY = hasMaxHeight && input.scrollHeight > maxHeight ? 'auto' : 'hidden'
}

function syncPromptTextareaHeight() {
  const input = $<HTMLTextAreaElement>('#prompt-input')
  if (input) resizePromptTextarea(input)
}

function readElementScroll<T extends HTMLElement>(selector: string) {
  const element = $<T>(selector)
  return element?.scrollTop ?? 0
}

function readElementScrollLeft<T extends HTMLElement>(selector: string) {
  const element = $<T>(selector)
  return element?.scrollLeft ?? 0
}

function readPreviewScroll() {
  const frame = $<HTMLIFrameElement>('.preview-frame')

  try {
    return {
      left: frame?.contentWindow?.scrollX ?? frame?.contentDocument?.documentElement.scrollLeft ?? 0,
      top: frame?.contentWindow?.scrollY ?? frame?.contentDocument?.documentElement.scrollTop ?? 0,
    }
  } catch {
    return { left: 0, top: 0 }
  }
}

function captureScrollSnapshot(): ScrollSnapshot {
  const scrollingElement = document.scrollingElement
  const preview = readPreviewScroll()

  return {
    documentLeft: scrollingElement?.scrollLeft ?? 0,
    documentTop: scrollingElement?.scrollTop ?? 0,
    dimensionPanelTop: readElementScroll<HTMLElement>('.dimension-panel'),
    galleryLeft: readElementScrollLeft<HTMLElement>('.gallery-strip'),
    inspectorTop: readElementScroll<HTMLElement>('.inspector'),
    previewLeft: preview.left,
    previewTop: preview.top,
  }
}

function restoreElementScroll<T extends HTMLElement>(selector: string, top: number, left = 0) {
  const element = $<T>(selector)
  if (!element) return

  element.scrollTop = top
  element.scrollLeft = left
}

function restorePreviewScroll(snapshot: ScrollSnapshot) {
  const frame = $<HTMLIFrameElement>('.preview-frame')
  if (!frame) return

  const restore = () => {
    try {
      frame.contentWindow?.scrollTo(snapshot.previewLeft, snapshot.previewTop)
    } catch {
      // The iframe can be briefly unavailable while srcdoc is being replaced.
    }
  }

  frame.addEventListener('load', () => requestAnimationFrame(restore), { once: true })
  requestAnimationFrame(restore)
  setTimeout(restore, 0)
}

function restoreScrollSnapshot(snapshot: ScrollSnapshot) {
  const restore = () => {
    const scrollingElement = document.scrollingElement
    if (scrollingElement) {
      scrollingElement.scrollTop = snapshot.documentTop
      scrollingElement.scrollLeft = snapshot.documentLeft
    }

    restoreElementScroll<HTMLElement>('.gallery-strip', 0, snapshot.galleryLeft)
    restoreElementScroll<HTMLElement>('.dimension-panel', snapshot.dimensionPanelTop)
    restoreElementScroll<HTMLElement>('.inspector', snapshot.inspectorTop)
  }

  requestAnimationFrame(restore)
  requestAnimationFrame(() => requestAnimationFrame(restore))
  restorePreviewScroll(snapshot)
}

function cssIdentifier(value: string) {
  const cssApi = window.CSS as unknown as { escape?: (input: string) => string }
  return typeof cssApi.escape === 'function' ? cssApi.escape(value) : value.replace(/[^a-zA-Z0-9_-]/g, '\\$&')
}

function selectorCount(doc: Document, selector: string) {
  try {
    return doc.querySelectorAll(selector).length
  } catch {
    return 0
  }
}

function selectorForPreviewElement(element: HTMLElement) {
  const doc = element.ownerDocument
  const tagName = element.tagName.toLowerCase()

  if (element.id) return `#${cssIdentifier(element.id)}`
  if (tagName === 'body' || tagName === 'html') return tagName

  const classNames = Array.from(element.classList).filter(Boolean)
  const uniqueClass = classNames.find((className) => selectorCount(doc, `.${cssIdentifier(className)}`) === 1)
  if (uniqueClass) return `.${cssIdentifier(uniqueClass)}`
  if (classNames.length > 0) {
    const classSelector = classNames.map((className) => `.${cssIdentifier(className)}`).join('')
    if (selectorCount(doc, classSelector) > 0) return classSelector
  }

  const path: string[] = []
  let current: HTMLElement | null = element

  while (current && current !== doc.documentElement) {
    const currentTagName = current.tagName.toLowerCase()
    if (currentTagName === 'body') {
      path.unshift('body')
      break
    }

    const parent: HTMLElement | null = current.parentElement
    const sameTagSiblings = parent
        ? Array.from(parent.children).filter((sibling): sibling is HTMLElement => (sibling as HTMLElement).tagName === current?.tagName)
        : []
    const position = sameTagSiblings.indexOf(current) + 1
    path.unshift(sameTagSiblings.length > 1 ? `${currentTagName}:nth-of-type(${position})` : currentTagName)

    const candidate = path.join(' > ')
    if (selectorCount(doc, candidate) === 1) return candidate
    current = parent
  }

  return path.join(' > ') || tagName
}

function isPreviewElementPickable(element: HTMLElement) {
  const tagName = element.tagName.toLowerCase()
  if (['script', 'style', 'meta', 'link', 'title'].includes(tagName)) return false
  if (element.id === 'styleprism-element-picker-styles') return false

  const rect = element.getBoundingClientRect()
  if (rect.width < 2 || rect.height < 2) return false

  const style = element.ownerDocument.defaultView?.getComputedStyle(element)
  return Boolean(style && style.display !== 'none' && style.visibility !== 'hidden')
}

function collectPreviewPickableElements(doc: Document) {
  const body = doc.body
  if (!body) return []

  return [body, ...Array.from(body.querySelectorAll<HTMLElement>('*'))].filter(isPreviewElementPickable)
}

function ensureElementPickerStyles(doc: Document) {
  if (doc.getElementById('styleprism-element-picker-styles')) return

  const style = doc.createElement('style')
  style.id = 'styleprism-element-picker-styles'
  style.textContent = `
    [data-styleprism-picker-hover] {
      outline: 2px solid rgba(14, 165, 233, .95) !important;
      outline-offset: 2px !important;
      cursor: crosshair !important;
    }
    [data-styleprism-picker-selected] {
      outline: 3px solid rgba(79, 70, 229, .98) !important;
      outline-offset: 3px !important;
      box-shadow: 0 0 0 5px rgba(79, 70, 229, .18) !important;
      cursor: crosshair !important;
    }
    [data-styleprism-selector-highlight] {
      outline: 3px solid rgba(245, 158, 11, .98) !important;
      outline-offset: 4px !important;
      box-shadow: 0 0 0 7px rgba(245, 158, 11, .22), 0 10px 24px rgba(15, 23, 42, .18) !important;
      border-radius: 4px !important;
    }
    [data-styleprism-selector-highlight-primary] {
      outline-color: rgba(79, 70, 229, .98) !important;
      box-shadow: 0 0 0 7px rgba(79, 70, 229, .2), 0 10px 24px rgba(15, 23, 42, .2) !important;
    }
  `
  doc.head?.appendChild(style)
}

function readPreviewDocument() {
  const frame = $<HTMLIFrameElement>('.preview-frame')

  try {
    return frame?.contentDocument?.body ? frame.contentDocument : null
  } catch {
    return null
  }
}

function clearPreviewPickerMarks() {
  previewHoveredElement?.removeAttribute('data-styleprism-picker-hover')
  previewSelectedElement?.removeAttribute('data-styleprism-picker-selected')
}

function clearPreviewApplyRangeMarks(doc: Document | null = readPreviewDocument()) {
  previewHighlightedApplyRangeElements.forEach((element) => {
    element.removeAttribute('data-styleprism-selector-highlight')
    element.removeAttribute('data-styleprism-selector-highlight-primary')
  })

  doc
      ?.querySelectorAll('[data-styleprism-selector-highlight], [data-styleprism-selector-highlight-primary]')
      .forEach((element) => {
        element.removeAttribute('data-styleprism-selector-highlight')
        element.removeAttribute('data-styleprism-selector-highlight-primary')
      })

  previewHighlightedApplyRangeElements = []
}

function setApplyRangeChipPreviewState() {
  $$<HTMLElement>('[data-preview-apply-range]').forEach((target) => {
    const selector = normalizeApplyRangeSelector(target.dataset.previewApplyRange ?? '')
    const isPreviewing = Boolean(previewHighlightedApplyRangeSelector && selector === previewHighlightedApplyRangeSelector)

    target.closest('.apply-range-chip')?.classList.toggle('is-previewing', isPreviewing)
  })
}

function markApplyRangeSelectorInPreview(selector: string, shouldScroll = false) {
  const doc = readPreviewDocument()
  if (!doc) return false

  clearPreviewApplyRangeMarks(doc)
  ensureElementPickerStyles(doc)

  let matches: HTMLElement[]
  try {
    matches = Array.from(doc.querySelectorAll<HTMLElement>(selector)).filter(isPreviewElementPickable)
  } catch {
    return true
  }

  matches.forEach((element, index) => {
    element.setAttribute('data-styleprism-selector-highlight', 'true')
    if (index === 0) element.setAttribute('data-styleprism-selector-highlight-primary', 'true')
  })

  previewHighlightedApplyRangeElements = matches
  if (shouldScroll) matches[0]?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' })

  return true
}

function syncApplyRangePreviewHighlight(shouldScroll = false) {
  if (!previewHighlightedApplyRangeSelector) {
    clearPreviewApplyRangeMarks()
    setApplyRangeChipPreviewState()
    return
  }

  const frame = $<HTMLIFrameElement>('.preview-frame')
  if (!frame) return

  const applyHighlight = () => {
    if (!markApplyRangeSelectorInPreview(previewHighlightedApplyRangeSelector ?? '', shouldScroll)) return
    setApplyRangeChipPreviewState()
  }

  frame.addEventListener('load', applyHighlight, { once: true })
  requestAnimationFrame(applyHighlight)
  setTimeout(applyHighlight, 0)
}

function clearApplyRangePreviewHighlight() {
  previewHighlightedApplyRangeSelector = null
  clearPreviewApplyRangeMarks()
  setApplyRangeChipPreviewState()
}

function hoverApplyRangeSelectorInPreview(selector: string) {
  const normalizedSelector = normalizeApplyRangeSelector(selector)
  if (!normalizedSelector) return

  previewHighlightedApplyRangeSelector = normalizedSelector
  syncApplyRangePreviewHighlight(true)
}

function setPreviewPickedElement(element: HTMLElement | null) {
  if (!element) return

  clearPreviewPickerMarks()
  previewHoveredElement = element
  previewSelectedElement = element
  previewHoveredElement.setAttribute('data-styleprism-picker-hover', 'true')
  previewSelectedElement.setAttribute('data-styleprism-picker-selected', 'true')
}

function previewElementFromTarget(target: EventTarget | null) {
  if (!target || (target as Node).nodeType !== 1) return null

  let element: HTMLElement | null = target as HTMLElement
  while (element && !previewPickableElements.includes(element)) {
    element = element.parentElement
  }
  return element
}

function cleanupPreviewElementPicker() {
  clearPreviewPickerMarks()

  if (previewPickerDocument) {
    previewPickerDocument.removeEventListener('mousemove', handlePreviewPickerMouseMove, true)
    previewPickerDocument.removeEventListener('click', handlePreviewPickerClick, true)
    previewPickerDocument.removeEventListener('keydown', handleElementPickerKeydown, true)
  }

  previewPickerDocument = null
  previewPickableElements = []
  previewHoveredElement = null
  previewSelectedElement = null
}

function attachElementPickerToPreview() {
  if (!elementPickerSource) return

  const frame = $<HTMLIFrameElement>('.preview-frame')
  if (!frame) return

  const attach = () => {
    const doc = frame.contentDocument
    if (!doc?.body) return

    cleanupPreviewElementPicker()
    previewPickerDocument = doc
    previewPickableElements = collectPreviewPickableElements(doc)
    ensureElementPickerStyles(doc)
    doc.addEventListener('mousemove', handlePreviewPickerMouseMove, true)
    doc.addEventListener('click', handlePreviewPickerClick, true)
    doc.addEventListener('keydown', handleElementPickerKeydown, true)
    setPreviewPickedElement(previewPickableElements.find((element) => element !== doc.body) ?? previewPickableElements[0] ?? null)
  }

  frame.addEventListener('load', attach, { once: true })
  attach()
}

function startElementPicker(source: ElementPickerSource, markerIndex: number | null = null) {
  elementPickerSource = source
  promptPickerMarkerIndex = source === 'prompt' ? markerIndex : null
  document.body.classList.add('is-element-picker-active')
  attachElementPickerToPreview()
}

function stopElementPicker() {
  cleanupPreviewElementPicker()
  elementPickerSource = null
  promptPickerMarkerIndex = null
  document.body.classList.remove('is-element-picker-active')
}

function sourceInputStillHasPickerMarker() {
  if (elementPickerSource === 'apply-range') {
    return Boolean(($<HTMLInputElement>('#range-input')?.value ?? '').includes('@'))
  }

  if (elementPickerSource === 'prompt') {
    const input = $<HTMLTextAreaElement>('#prompt-input')
    return Boolean(input && promptPickerMarkerIndex !== null && input.value[promptPickerMarkerIndex] === '@')
  }

  return false
}

function stopElementPickerIfMarkerWasDeleted() {
  if (elementPickerSource && !sourceInputStillHasPickerMarker()) stopElementPicker()
}

function selectAdjacentPreviewElement(direction: 1 | -1) {
  if (previewPickableElements.length === 0) return

  const currentIndex = previewSelectedElement ? previewPickableElements.indexOf(previewSelectedElement) : -1
  const nextIndex = currentIndex < 0
      ? 0
      : (currentIndex + direction + previewPickableElements.length) % previewPickableElements.length
  const nextElement = previewPickableElements[nextIndex]
  setPreviewPickedElement(nextElement)
  nextElement.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}

function insertPromptSelector(selector: string) {
  const normalizedSelector = normalizeApplyRangeSelector(selector)
  const token = `@${normalizedSelector}`
  const input = $<HTMLTextAreaElement>('#prompt-input')
  const currentValue = input?.value ?? promptText
  const markerIndex = promptPickerMarkerIndex !== null && currentValue[promptPickerMarkerIndex] === '@'
      ? promptPickerMarkerIndex
      : currentValue.lastIndexOf('@')
  const insertIndex = markerIndex >= 0 ? markerIndex : input?.selectionStart ?? currentValue.length
  const nextValue = markerIndex >= 0
      ? `${currentValue.slice(0, insertIndex)}${token}${currentValue.slice(insertIndex + 1)}`
      : `${currentValue.slice(0, insertIndex)}${token}${currentValue.slice(insertIndex)}`

  promptText = nextValue
  if (input) {
    input.value = nextValue
    resizePromptTextarea(input)
    input.focus()
    input.selectionStart = insertIndex + token.length
    input.selectionEnd = input.selectionStart
  }
}

function confirmPreviewElementPick() {
  if (!elementPickerSource || !previewSelectedElement) return

  const source = elementPickerSource
  const selector = selectorForPreviewElement(previewSelectedElement)
  stopElementPicker()

  if (source === 'apply-range') {
    const input = $<HTMLInputElement>('#range-input')
    if (input) input.value = ''
    addSelectedApplyRange(selector)
    return
  }

  insertPromptSelector(selector)
}

function handlePreviewPickerMouseMove(event: Event) {
  if (!elementPickerSource) return

  const element = previewElementFromTarget(event.target)
  if (element) setPreviewPickedElement(element)
}

function handlePreviewPickerClick(event: Event) {
  if (!elementPickerSource) return

  event.preventDefault()
  event.stopPropagation()
  confirmPreviewElementPick()
}

function handleElementPickerKeydown(event: KeyboardEvent) {
  if (!elementPickerSource) return

  if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
    event.preventDefault()
    event.stopPropagation()
    selectAdjacentPreviewElement(1)
    return
  }

  if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
    event.preventDefault()
    event.stopPropagation()
    selectAdjacentPreviewElement(-1)
    return
  }

  if (event.key === 'Enter') {
    event.preventDefault()
    event.stopPropagation()
    confirmPreviewElementPick()
    return
  }

  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    stopElementPicker()
    return
  }

  if (event.key === 'Backspace' || event.key === 'Delete') {
    requestAnimationFrame(stopElementPickerIfMarkerWasDeleted)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function normalizeApplyRangeSelector(value: string) {
  return value.trim().replace(/^@+/, '').trim()
}

function uniqueApplyRangeSelectors(selectors: string[]) {
  const seen = new Set<string>()

  return selectors.reduce<string[]>((nextSelectors, selector) => {
    const normalizedSelector = normalizeApplyRangeSelector(selector)
    if (!normalizedSelector || seen.has(normalizedSelector)) return nextSelectors

    seen.add(normalizedSelector)
    nextSelectors.push(normalizedSelector)
    return nextSelectors
  }, [])
}

function promptTextForRequest() {
  return promptText.replace(/@(?=(?:[#.[:]|body\b|html\b))/gi, '')
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function parseTokens(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {}

  return Object.entries(value).reduce<Record<string, string>>((tokens, [property, tokenValue]) => {
    if (typeof tokenValue === 'string' || typeof tokenValue === 'number') {
      tokens[property] = String(tokenValue)
    }
    return tokens
  }, {})
}

function parseStyleBlocks(value: unknown): StyleBlock[] {
  return arrayValue(value)
      .filter(isRecord)
      .map((block) => ({
        apply_range: arrayValue(block.apply_range)
            .filter((selector): selector is string => typeof selector === 'string' && selector.trim().length > 0)
            .map(normalizeApplyRangeSelector)
            .filter(Boolean),
        tokens: parseTokens(block.tokens),
      }))
      .filter((block) => block.apply_range.length > 0 && Object.keys(block.tokens).length > 0)
}

function parseStyleTag(value: unknown, fallbackDimension: string): StyleTag | null {
  if (!isRecord(value)) return null

  const dimension = stringValue(value.dimension, fallbackDimension || 'uncategorized')
  const tagId = stringValue(value.tag_id)
  if (!tagId) return null

  const status = value.status === 'active' ? 'active' : 'inactive'

  return {
    dimension,
    status,
    tag_id: tagId,
    design_semantics: stringValue(value.design_semantics, 'Mock style tag for frontend rendering.'),
    style_blocks: parseStyleBlocks(value.style_blocks),
    raw_css: typeof value.raw_css === 'string' && value.raw_css.trim() ? value.raw_css : null,
  }
}

function groupTags(tags: StyleTag[], metadata: Record<string, unknown> = {}): DimensionsTagsJson {
  const groups = new Map<string, StyleTag[]>()

  for (const tag of tags) {
    const dimension = tag.dimension || 'uncategorized'
    groups.set(dimension, [...(groups.get(dimension) || []), tag])
  }

  return {
    metadata: {
      ...metadata,
      version: typeof metadata.version === 'number' ? metadata.version : 1,
      createdAt: typeof metadata.createdAt === 'string' ? metadata.createdAt : now,
      updatedAt: typeof metadata.updatedAt === 'string' ? metadata.updatedAt : now,
      tagCount: tags.length,
      dimensionCount: groups.size,
    },
    dimensions: Array.from(groups.entries()).map(([dimension, groupedTags]) => ({
      dimension,
      tags: groupedTags,
    })),
  }
}

function parseDimensionsTagsJson(value: unknown): DimensionsTagsJson {
  if (Array.isArray(value)) {
    return groupTags(value.map((item) => parseStyleTag(item, 'uncategorized')).filter((tag): tag is StyleTag => Boolean(tag)))
  }

  if (!isRecord(value)) {
    return groupTags([])
  }

  const metadata = isRecord(value.metadata) ? value.metadata : {}
  const tags: StyleTag[] = []

  for (const dimensionValue of arrayValue(value.dimensions)) {
    if (!isRecord(dimensionValue)) continue

    const dimension = stringValue(dimensionValue.dimension, 'uncategorized')
    for (const tagValue of arrayValue(dimensionValue.tags)) {
      const tag = parseStyleTag(tagValue, dimension)
      if (tag) tags.push(tag)
    }
  }

  return groupTags(tags, metadata)
}

function readSavedViews(): SavedView[] {
  try {
    const saved = localStorage.getItem(SAVED_VIEWS_KEY)
    const parsed = saved ? (JSON.parse(saved) as SavedView[]) : []
    return parsed.map((view) => ({
      ...view,
      thumbnailName: view.thumbnailName || view.name,
      dimensionsTagsJson: parseDimensionsTagsJson(view.dimensionsTagsJson),
    }))
  } catch {
    return []
  }
}

function persistSavedViews() {
  try {
    localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(savedViews))
  } catch {
    // localStorage can be unavailable in private browsing; keeping the in-memory view is enough.
  }
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (char) => {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#039;',
      '"': '&quot;',
    }
    return map[char]
  })
}

function titleCase(value: string) {
  return value
      .split('-')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ')
}

function flattenTags(json = dimensionsTagsJson) {
  return json.dimensions.flatMap((dimension) => dimension.tags)
}

function hasGeneratedTags() {
  return flattenTags().length > 0
}

function findTag(tagId = selectedTagId) {
  return flattenTags().find((tag) => tag.tag_id === tagId) ?? flattenTags()[0]
}

function refreshMetadata() {
  const tagCount = flattenTags().length
  dimensionsTagsJson.metadata = {
    ...dimensionsTagsJson.metadata,
    updatedAt: new Date().toISOString(),
    tagCount,
    dimensionCount: dimensionsTagsJson.dimensions.length,
  }
}

function tokensToCss(tokens: Record<string, string>) {
  return Object.entries(tokens)
      .map(([property, value]) => `  ${property}: ${value};`)
      .join('\n')
}

function tagToCss(tag: StyleTag) {
  const cssBlocks: string[] = []

  for (const block of tag.style_blocks || []) {
    if (block.apply_range.length === 0 || Object.keys(block.tokens).length === 0) continue
    cssBlocks.push(`${block.apply_range.join(', ')} {\n${tokensToCss(block.tokens)}\n}`)
  }

  if (tag.raw_css) cssBlocks.push(tag.raw_css)

  return cssBlocks.join('\n\n')
}

function activeTagCss() {
  return flattenTags()
      .filter((tag) => tag.status === 'active')
      .map((tag) => `/* Tag: ${tag.tag_id} [${tag.dimension}] */\n${tagToCss(tag)}`)
      .join('\n\n')
}

function injectGeneratedStyles(html: string, css: string) {
  const generatedStyle = `<!-- StylePrism generated styles -->\n<style id="styleprism-generated-styles">\n${css}\n</style>`
  const existingGeneratedStyle = /<style\s+id=["']styleprism-generated-styles["'][^>]*>[\s\S]*?<\/style>/i

  if (existingGeneratedStyle.test(html)) {
    return html.replace(existingGeneratedStyle, generatedStyle)
  }

  if (html.includes('</head>')) {
    return html.replace('</head>', `${generatedStyle}\n</head>`)
  }

  return `${generatedStyle}\n${html}`
}

function buildStyledHtml() {
  return injectGeneratedStyles(rawHtml, activeTagCss())
}

function selectedApplyRange() {
  const tag = findTag()
  return uniqueApplyRangeSelectors(tag?.style_blocks.flatMap((block) => block.apply_range) ?? [])
}

function previewHtmlForExport() {
  const frame = $<HTMLIFrameElement>('.preview-frame')
  const frameSrcdoc = frame?.srcdoc || frame?.getAttribute('srcdoc') || ''
  if (frameSrcdoc.trim()) return frameSrcdoc

  try {
    const doc = frame?.contentDocument
    if (doc?.documentElement) return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`
  } catch {
    // Fall back to the source used to render the preview.
  }

  return buildStyledHtml()
}

function exportCurrentPreviewHtml() {
  const blob = new Blob([previewHtmlForExport()], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')

  link.href = url
  link.download = `styleprism-preview-${timestamp}.html`
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)

  render()
}

function snapshotState(): HistoryEntry {
  return {
    dimensionsTagsJson: clone(dimensionsTagsJson),
    promptText,
    selectedTagId,
    isInspectorOpen,
  }
}

function rememberCurrentState() {
  historyPast = [...historyPast, snapshotState()].slice(-MAX_HISTORY_ENTRIES)
  historyFuture = []
}

function restoreSnapshot(snapshot: HistoryEntry) {
  dimensionsTagsJson = clone(snapshot.dimensionsTagsJson)
  promptText = snapshot.promptText
  isInspectorOpen = snapshot.isInspectorOpen
  const availableTags = flattenTags(dimensionsTagsJson)
  selectedTagId = availableTags.some((tag) => tag.tag_id === snapshot.selectedTagId)
      ? snapshot.selectedTagId
      : availableTags[0]?.tag_id ?? selectedTagId
  render()
}

function undoHistory() {
  if (historyPast.length === 0) return
  const previous = historyPast[historyPast.length - 1]
  historyPast = historyPast.slice(0, -1)
  historyFuture = [snapshotState(), ...historyFuture].slice(0, MAX_HISTORY_ENTRIES)
  restoreSnapshot(previous)
}

function redoHistory() {
  if (historyFuture.length === 0) return
  const next = historyFuture[0]
  historyFuture = historyFuture.slice(1)
  historyPast = [...historyPast, snapshotState()].slice(-MAX_HISTORY_ENTRIES)
  restoreSnapshot(next)
}

function rememberCurrentStateFrom(snapshot: HistoryEntry) {
  historyPast = [...historyPast, clone(snapshot)].slice(-MAX_HISTORY_ENTRIES)
  historyFuture = []
}

function buildRequest(operation: Operation, field: UpdateRequest['target']['field'] = null): UpdateRequest {
  const tag = findTag()
  const requestPrompt = promptTextForRequest()
  return {
    mock: USE_MOCK_API,
    operation,
    prompt: requestPrompt,
    raw_html: rawHtml,
    target: {
      dimension:
          operation === 'ADD_NEW_DIMENSION'
              ? pendingNewDimensionName || 'new-style-dimension'
              : operation === 'ADD_NEW_TAG'
                  ? pendingTargetDimension || tag?.dimension || null
                  : tag?.dimension ?? null,
      tag_id: operation.includes('TAG_') ? tag?.tag_id ?? null : null,
      field,
    },
    user_request: requestPrompt,
    dimensions_tags_json: clone(dimensionsTagsJson),
    styled_html: buildStyledHtml(),
  }
}

async function sendUpdate(operation: Operation, field: UpdateRequest['target']['field'] = null) {
  const previousState = snapshotState()
  const request = buildRequest(operation, field)
  isLoading = true
  render()

  try {
    const response = await fetch(UPDATE_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    const updatedJson = (await response.json()) as DimensionsTagsJson
    rememberCurrentStateFrom(previousState)
    dimensionsTagsJson = updatedJson
    refreshMetadata()
    selectedTagId = flattenTags()[0]?.tag_id ?? selectedTagId
    pendingTargetDimension = null
    pendingNewDimensionName = null
  } catch (error) {
    console.error(error)
  } finally {
    isLoading = false
    render()
  }
}

async function generateInitialDimensionsTagsJson() {
  const previousState = snapshotState()
  const requestPrompt = promptTextForRequest()
  const request: GenerateRequest = {
    mock: USE_MOCK_API,
    prompt: requestPrompt,
    html: rawHtml,
  }

  isLoading = true
  render()

  try {
    const response = await fetch(GENERATE_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    dimensionsTagsJson = parseDimensionsTagsJson(await response.json())
    refreshMetadata()
    selectedTagId = flattenTags()[0]?.tag_id ?? ''
    rememberCurrentStateFrom(previousState)
  } catch (error) {
    console.error(error)
  } finally {
    isLoading = false
    render()
  }
}

function toggleTag(tagId: string) {
  const tag = flattenTags().find((item) => item.tag_id === tagId)
  if (!tag) return
  rememberCurrentState()
  tag.status = tag.status === 'active' ? 'inactive' : 'active'
  selectedTagId = tagId
  refreshMetadata()
  render()
}

function setAll(status: TagStatus) {
  rememberCurrentState()
  flattenTags().forEach((tag) => {
    tag.status = status
  })
  refreshMetadata()
  render()
}

function normalizedName(value: string) {
  return value.trim().toLowerCase()
}

function nextSavedViewName() {
  let index = savedViews.length + 1
  while (savedViews.some((view) => normalizedName(view.name) === normalizedName(`View ${index}`))) {
    index += 1
  }
  return `View ${index}`
}

function nextThumbnailName() {
  let index = savedViews.length + 1
  while (savedViews.some((view) => normalizedName(view.thumbnailName) === normalizedName(`View ${index}`))) {
    index += 1
  }
  return `View ${index}`
}

function savedViewActiveRatio(view: SavedView) {
  return view.tagCount > 0 ? view.activeCount / view.tagCount : 0
}

function savedViewActivityLevel(view: SavedView) {
  const ratio = savedViewActiveRatio(view)
  if (ratio <= 0) return 'empty'
  if (ratio < 0.34) return 'low'
  if (ratio < 0.67) return 'medium'
  if (ratio < 1) return 'high'
  return 'full'
}

function savedViewActivityLabel(view: SavedView) {
  const ratio = Math.round(savedViewActiveRatio(view) * 100)
  return `${ratio}% active`
}

function openSaveDialog() {
  isSaveDialogOpen = true
  saveDialogError = ''
  render()
}

function closeSaveDialog() {
  isSaveDialogOpen = false
  saveDialogError = ''
  render()
}

function saveCurrentView(name: string, thumbnailName: string) {
  const trimmedName = name.trim()
  const trimmedThumbnailName = thumbnailName.trim()

  if (!trimmedName || !trimmedThumbnailName) {
    saveDialogError = 'Name and thumbnail are required.'
    render()
    return
  }

  if (savedViews.some((view) => normalizedName(view.name) === normalizedName(trimmedName))) {
    saveDialogError = 'A saved view with this name already exists.'
    render()
    return
  }

  if (savedViews.some((view) => normalizedName(view.thumbnailName) === normalizedName(trimmedThumbnailName))) {
    saveDialogError = 'A thumbnail with this label already exists.'
    render()
    return
  }

  const tags = flattenTags()
  const savedView: SavedView = {
    id: crypto.randomUUID(),
    name: trimmedName,
    thumbnailName: trimmedThumbnailName,
    prompt: promptText,
    dimensionsTagsJson: clone(dimensionsTagsJson),
    styledHtml: buildStyledHtml(),
    activeCount: tags.filter((tag) => tag.status === 'active').length,
    tagCount: tags.length,
  }

  savedViews = [savedView, ...savedViews]
  persistSavedViews()
  isSaveDialogOpen = false
  saveDialogError = ''
  render()
}

function deleteSavedView(viewId: string) {
  savedViews = savedViews.filter((view) => view.id !== viewId)
  persistSavedViews()
  render()
}

function restoreSavedView(viewId: string) {
  const savedView = savedViews.find((view) => view.id === viewId)
  if (!savedView) return
  rememberCurrentState()
  dimensionsTagsJson = clone(savedView.dimensionsTagsJson)
  promptText = savedView.prompt
  selectedTagId = flattenTags()[0]?.tag_id ?? selectedTagId
  isInspectorOpen = false
  render()
}

function updateSelectedSemantics(value: string) {
  const tag = findTag()
  if (!tag) return
  tag.design_semantics = value
  refreshMetadata()
}

function parseApplyRangeInput(value: string) {
  return value
      .split(',')
      .map(normalizeApplyRangeSelector)
      .filter(Boolean)
}

function setFirstStyleBlockApplyRange(selectors: string[]) {
  const tag = findTag()
  if (!tag?.style_blocks[0]) return

  tag.style_blocks[0].apply_range = uniqueApplyRangeSelectors(selectors)
  refreshMetadata()
}

function addSelectedApplyRange(value: string) {
  const tag = findTag()
  const firstBlock = tag?.style_blocks[0]
  if (!firstBlock) return

  setFirstStyleBlockApplyRange([...firstBlock.apply_range, ...parseApplyRangeInput(value)])
  render()
}

function removeSelectedApplyRange(selector: string) {
  const normalizedSelector = normalizeApplyRangeSelector(selector)
  const tag = findTag()
  if (!tag || !normalizedSelector) return

  tag.style_blocks.forEach((block) => {
    block.apply_range = uniqueApplyRangeSelectors(block.apply_range)
        .filter((item) => normalizeApplyRangeSelector(item) !== normalizedSelector)
  })

  if (previewHighlightedApplyRangeSelector === normalizedSelector) clearApplyRangePreviewHighlight()

  refreshMetadata()
  render()
}

// @ts-ignore
function addLocalTag(dimensionName: string) {
  const dimension = dimensionsTagsJson.dimensions.find((item) => item.dimension === dimensionName)
  if (!dimension) return
  rememberCurrentState()
  const next = dimension.tags.length + 1
  const tag: StyleTag = {
    dimension: dimensionName,
    status: 'inactive',
    tag_id: `${dimensionName}-new-tag-${next}`.toLowerCase(),
    design_semantics: 'Describe the new visual idea, then use AI to generate compatible tokens.',
    style_blocks: [
      {
        apply_range: ['.card'],
        tokens: {
          outline: '1px solid rgba(80, 60, 40, 0.12)',
        },
      },
    ],
    raw_css: null,
  }
  dimension.tags.push(tag)
  selectedTagId = tag.tag_id
  refreshMetadata()
  render()
}

// @ts-ignore
function addLocalDimension() {
  const name = window.prompt('New dimension name', 'motion-and-animation')?.trim()
  if (!name) return
  if (dimensionsTagsJson.dimensions.some((item) => item.dimension === name)) return
  rememberCurrentState()
  const tag: StyleTag = {
    dimension: name,
    status: 'inactive',
    tag_id: `${name}-starter-tag`.toLowerCase(),
    design_semantics: 'Starter tag for this new dimension.',
    style_blocks: [
      {
        apply_range: ['.card'],
        tokens: {
          transition: 'all 180ms ease',
        },
      },
    ],
    raw_css: null,
  }
  dimensionsTagsJson.dimensions.push({ dimension: name, tags: [tag] })
  selectedTagId = tag.tag_id
  refreshMetadata()
  render()
}

function dimensionCanBeDeleted(dimension: DimensionGroup) {
  return dimension.tags.length > 0 && dimension.tags.every((tag) => tag.status === 'inactive')
}

function deleteDimension(dimensionName: string) {
  const dimension = dimensionsTagsJson.dimensions.find((item) => item.dimension === dimensionName)
  if (!dimension || !dimensionCanBeDeleted(dimension)) return

  rememberCurrentState()
  const deletedSelectedTag = dimension.tags.some((tag) => tag.tag_id === selectedTagId)
  dimensionsTagsJson.dimensions = dimensionsTagsJson.dimensions.filter((item) => item.dimension !== dimensionName)

  if (deletedSelectedTag) {
    selectedTagId = flattenTags()[0]?.tag_id ?? ''
    isInspectorOpen = false
  }

  refreshMetadata()
  render()
}

function deleteTag(tagId: string) {
  const dimension = dimensionsTagsJson.dimensions.find((item) => item.tags.some((tag) => tag.tag_id === tagId))
  const tag = dimension?.tags.find((item) => item.tag_id === tagId)
  if (!dimension || !tag || tag.status !== 'inactive') return

  rememberCurrentState()
  dimension.tags = dimension.tags.filter((item) => item.tag_id !== tagId)

  if (selectedTagId === tagId) {
    selectedTagId = flattenTags()[0]?.tag_id ?? ''
    isInspectorOpen = false
  }

  refreshMetadata()
  render()
}

function renderApplyRangeEditor() {
  const selectors = selectedApplyRange()

  return `
    <div class="apply-range-editor" aria-label="Apply range selectors">
      ${
        selectors.length > 0
            ? selectors
                .map((selector) => {
                  const normalizedSelector = normalizeApplyRangeSelector(selector)
                  const isPreviewing = previewHighlightedApplyRangeSelector === normalizedSelector

                  return `
                    <span class="apply-range-chip ${isPreviewing ? 'is-previewing' : ''}">
                      <span
                        class="apply-range-chip-target"
                        data-preview-apply-range="${escapeHtml(normalizedSelector)}"
                      >@${escapeHtml(normalizedSelector)}</span>
                      <button
                        class="apply-range-chip-remove"
                        type="button"
                        data-remove-apply-range="${escapeHtml(normalizedSelector)}"
                        aria-label="Remove ${escapeHtml(normalizedSelector)} from apply range"
                      >×</button>
                    </span>
                  `
                })
                .join('')
            : '<span class="apply-range-empty">No selectors yet</span>'
      }
      <input
        id="range-input"
        class="apply-range-input"
        type="text"
        placeholder="@.selector"
        autocomplete="off"
        aria-label="Add apply range selector"
      />
    </div>
  `
}

function renderDimensions() {
  return dimensionsTagsJson.dimensions
      .map((dimension) => {
        const canDeleteDimension = dimensionCanBeDeleted(dimension)

        return `
        <section class="dimension-card">
          <div class="dimension-head">
            <div class="dimension-title-row">
              <h3>${escapeHtml(titleCase(dimension.dimension))}</h3>
              ${
                canDeleteDimension
                    ? `
                      <button
                        class="dimension-delete-button"
                        type="button"
                        data-delete-dimension="${escapeHtml(dimension.dimension)}"
                        aria-label="Delete ${escapeHtml(titleCase(dimension.dimension))} dimension"
                        title="Delete inactive dimension"
                      >
                        <svg aria-hidden="true" viewBox="0 0 24 24">
                          <path d="M3 6h18"></path>
                          <path d="M8 6V4h8v2"></path>
                          <path d="M6 6l1 15h10l1-15"></path>
                          <path d="M10 11v6"></path>
                          <path d="M14 11v6"></path>
                        </svg>
                      </button>
                    `
                    : ''
              }
            </div>
            <button
              class="ghost small icon-add-button icon-add-button--tag"
              type="button"
              data-add-tag="${escapeHtml(dimension.dimension)}"
              aria-label="Add Tag"
              title="Add Tag"
            >${icon('plus')}</button>
          </div>
          <div class="tag-list">
            ${dimension.tags
              .map(
                  (tag) => `
                  <div class="tag-item">
                    <button
                      class="tag-pill ${tag.status === 'active' ? 'is-active' : 'is-inactive'}"
                      type="button"
                      data-toggle-tag="${escapeHtml(tag.tag_id)}"
                      title="${escapeHtml(tag.design_semantics)}"
                    >
                      <span class="status-dot"></span>
                      <span class="tag-label">${escapeHtml(titleCase(tag.tag_id))}</span>
                    </button>
                    <button
                      class="info-button ${isInspectorOpen && tag.tag_id === selectedTagId ? 'is-selected' : ''}"
                      type="button"
                      data-open-detail="${escapeHtml(tag.tag_id)}"
                      aria-label="Edit ${escapeHtml(titleCase(tag.tag_id))} details"
                      title="Edit tag details"
                    >${icon('pencil')}</button>
                    ${
                      tag.status === 'inactive'
                          ? `
                            <button
                              class="tag-delete-button"
                              type="button"
                              data-delete-tag="${escapeHtml(tag.tag_id)}"
                              aria-label="Delete ${escapeHtml(titleCase(tag.tag_id))} tag"
                              title="Delete inactive tag"
                            >
                              <svg aria-hidden="true" viewBox="0 0 24 24">
                                <path d="M3 6h18"></path>
                                <path d="M8 6V4h8v2"></path>
                                <path d="M6 6l1 15h10l1-15"></path>
                                <path d="M10 11v6"></path>
                                <path d="M14 11v6"></path>
                              </svg>
                            </button>
                          `
                          : '<span class="tag-delete-spacer" aria-hidden="true"></span>'
                    }
                  </div>
                `,
              )
              .join('')}
          </div>
        </section>
      `
      })
      .join('')
}

function renderInspector() {
  if (!isInspectorOpen) return ''

  const tag = findTag()
  if (!tag) return '<aside class="inspector empty">Select a tag</aside>'
  const tokens = tag.style_blocks
      .flatMap((block) => Object.entries(block.tokens))
      .map(([property, value]) => `${property}: ${value}`)
      .join('\n')

  return `
    <aside class="inspector">
      <div class="panel-title">
        <div>
          <span class="eyebrow">Tag Details</span>
          <h2>${escapeHtml(titleCase(tag.tag_id))}</h2>
        </div>
        <div class="detail-actions">
          <button class="icon-button" type="button" data-toggle-tag="${escapeHtml(tag.tag_id)}">${tag.status === 'active' ? 'Deactivate' : 'Activate'}</button>
          <button class="icon-button square" type="button" data-close-inspector aria-label="Close tag details">×</button>
        </div>
      </div>

      <label class="field">
        <span>Design semantics</span>
        <textarea id="semantics-input">${escapeHtml(tag.design_semantics)}</textarea>
      </label>
      <button class="primary wide" type="button" data-ai-semantics>Update style from semantics</button>

      <label class="field">
        <span>Applied components</span>
        ${renderApplyRangeEditor()}
      </label>
<!--      <button class="primary wide" type="button" data-ai-range>Update style from apply range</button>-->

      <section class="code-card">
        <div class="section-row">
          <h3>Current tokens</h3>
          <span>${tag.style_blocks.length} block${tag.style_blocks.length === 1 ? '' : 's'}</span>
        </div>
        <pre>${escapeHtml(tokens || 'No tokens')}</pre>
      </section>
    </aside>
  `
}

function renderSavedViews() {
  if (savedViews.length === 0) {
    return `
      <div class="gallery-empty">
        <div class="logo-mark">SP</div>
        <span>Saved views will appear here</span>
      </div>
    `
  }

  return savedViews
      .map(
          (view) => `
        <div
          class="saved-thumb saved-thumb--${savedViewActivityLevel(view)}"
          style="--active-ratio: ${savedViewActiveRatio(view).toFixed(3)}"
        >
          <button
            class="thumb-restore"
            type="button"
            data-restore-view="${escapeHtml(view.id)}"
            title="${escapeHtml(`${view.name} · ${savedViewActivityLabel(view)} · ${view.prompt}`)}"
          >
            <span class="thumb-preview" aria-hidden="true">
              <span class="thumb-page">
                <span class="thumb-topline"></span>
                <span class="thumb-titleline"></span>
                <span class="thumb-chiprow">
                  <span></span>
                  <span></span>
                  <span></span>
                </span>
                <span class="thumb-grid">
                  <span class="thumb-block thumb-block-large"></span>
                  <span class="thumb-block"></span>
                  <span class="thumb-block thumb-block-wide"></span>
                </span>
                <span class="thumb-activity-meter">
                  <span></span>
                </span>
              </span>
            </span>
            <span class="thumb-meta">
              <strong>${escapeHtml(view.name)}</strong>
              <span>
                <span class="thumb-state-dot" aria-hidden="true"></span>
                ${view.activeCount}/${view.tagCount} active
              </span>
            </span>
          </button>
          <button class="thumb-delete" type="button" data-delete-view="${escapeHtml(view.id)}" aria-label="Delete ${escapeHtml(view.name)}">×</button>
        </div>
      `,
      )
      .join('')
}

function renderSaveDialog() {
  if (!isSaveDialogOpen) return ''
  const defaultName = nextSavedViewName()
  const defaultThumbnailName = nextThumbnailName()

  return `
    <div class="modal-backdrop" role="presentation">
      <form class="save-dialog" role="dialog" aria-modal="true" aria-labelledby="save-dialog-title">
        <div class="dialog-title">
          <div>
            <span class="eyebrow">Gallery</span>
            <h2 id="save-dialog-title">Save current view</h2>
          </div>
          <button class="icon-button square" type="button" data-close-save-dialog aria-label="Close save dialog">×</button>
        </div>
        <label class="field">
          <span>Favorite name</span>
          <input id="save-name-input" name="save-name" value="${escapeHtml(defaultName)}" maxlength="40" autocomplete="off" required autofocus />
        </label>
        <label class="field">
          <span>Thumbnail label</span>
          <input id="thumbnail-name-input" name="thumbnail-name" value="${escapeHtml(defaultThumbnailName)}" maxlength="24" autocomplete="off" required />
        </label>
        ${saveDialogError ? `<p class="dialog-error">${escapeHtml(saveDialogError)}</p>` : ''}
        <div class="dialog-actions">
          <button class="ghost" type="button" data-close-save-dialog>Cancel</button>
          <button class="primary" type="submit">Save</button>
        </div>
      </form>
    </div>
  `
}

function maxDimensionPanelWidth(layout: HTMLElement) {
  const style = getComputedStyle(layout)
  const gap = parseFloat(style.columnGap || style.gap) || 0
  const dividerWidth = $<HTMLElement>('.layout-divider')?.getBoundingClientRect().width ?? 0
  const inspectorWidth = $<HTMLElement>('.inspector')?.getBoundingClientRect().width ?? 0
  const columnCount = isInspectorOpen ? 4 : 3
  const reservedGaps = gap * (columnCount - 1)
  const previewMin = isInspectorOpen ? 320 : MIN_PREVIEW_WIDTH
  const maxWidth = layout.clientWidth - previewMin - inspectorWidth - dividerWidth - reservedGaps

  return Math.max(MIN_DIMENSION_PANEL_WIDTH, Math.floor(maxWidth))
}

function clampDimensionPanelWidth(width: number, layout = $<HTMLElement>('.layout')) {
  const maxWidth = layout ? maxDimensionPanelWidth(layout) : DEFAULT_DIMENSION_PANEL_WIDTH
  return clamp(Math.round(width), MIN_DIMENSION_PANEL_WIDTH, maxWidth)
}

function setDimensionPanelWidth(width: number, layout = $<HTMLElement>('.layout')) {
  dimensionPanelWidth = clampDimensionPanelWidth(width, layout)
  layout?.style.setProperty('--dimension-panel-width', `${dimensionPanelWidth}px`)
  layout?.querySelector<HTMLElement>('.layout-divider')?.setAttribute('aria-valuenow', String(dimensionPanelWidth))
}

function bindPanelResize() {
  const divider = $<HTMLElement>('.layout-divider')
  if (!divider) return

  divider.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return

    const layout = divider.closest<HTMLElement>('.layout')
    if (!layout) return

    event.preventDefault()
    const startX = event.clientX
    const startWidth = dimensionPanelWidth
    document.body.classList.add('is-resizing-panels')
    divider.setPointerCapture(event.pointerId)

    const handlePointerMove = (moveEvent: PointerEvent) => {
      setDimensionPanelWidth(startWidth - (moveEvent.clientX - startX), layout)
    }

    const finishResize = () => {
      document.body.classList.remove('is-resizing-panels')
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', finishResize)
      window.removeEventListener('pointercancel', finishResize)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', finishResize, { once: true })
    window.addEventListener('pointercancel', finishResize, { once: true })
  })

  divider.addEventListener('keydown', (event) => {
    const layout = divider.closest<HTMLElement>('.layout')
    if (!layout) return

    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      setDimensionPanelWidth(dimensionPanelWidth + RESIZE_STEP, layout)
    }

    if (event.key === 'ArrowRight') {
      event.preventDefault()
      setDimensionPanelWidth(dimensionPanelWidth - RESIZE_STEP, layout)
    }

    if (event.key === 'Home') {
      event.preventDefault()
      setDimensionPanelWidth(MIN_DIMENSION_PANEL_WIDTH, layout)
    }

    if (event.key === 'End') {
      event.preventDefault()
      setDimensionPanelWidth(maxDimensionPanelWidth(layout), layout)
    }
  })
}

function render() {
  const scrollSnapshot = captureScrollSnapshot()
  const app = $('#app') as HTMLDivElement
  const allTags = flattenTags()
  const hasTags = allTags.length > 0
  const allTagsActive = allTags.length > 0 && allTags.every((tag) => tag.status === 'active')
  const bulkTarget: TagStatus = allTagsActive ? 'inactive' : 'active'

  app.innerHTML = `
    <main class="app-shell">
      <header class="topbar ${isGalleryCollapsed ? 'is-collapsed' : ''}">
        ${
          isGalleryCollapsed
              ? `
                <button
                  class="gallery-rail"
                  type="button"
                  data-toggle-gallery
                  aria-expanded="false"
                  aria-label="Expand gallery"
                  title="Expand gallery"
                >
                  <span></span>
                  ${icon('chevron-down')}
                </button>
              `
              : `
                <div class="gallery-strip" aria-label="Saved view gallery">
                  ${renderSavedViews()}
                </div>
                <button
                  class="gallery-toggle"
                  type="button"
                  data-toggle-gallery
                  aria-expanded="true"
                  aria-label="Collapse gallery"
                  title="Collapse gallery"
                >
                  ${icon('chevron-up')}
                </button>
              `
        }
      </header>

      <section class="layout ${isInspectorOpen ? 'has-inspector' : ''}" style="--dimension-panel-width: ${dimensionPanelWidth}px">
        <section class="preview-column">
          <div class="preview-toolbar">
            <div>
              <span class="eyebrow">Live preview</span>
            </div>
            <div class="preview-actions">
              <button class="favorite-button" type="button" data-save-view aria-label="Save current view" title="Save current view">☆</button>
              <button class="export-button" type="button" data-export-preview aria-label="Export current preview HTML" title="Export current preview HTML">
                <svg aria-hidden="true" viewBox="0 0 24 24">
                  <path d="M12 3v12"></path>
                  <path d="m7 10 5 5 5-5"></path>
                  <path d="M5 21h14"></path>
                </svg>
              </button>
            </div>
          </div>
          <iframe class="preview-frame" title="Styled HTML Preview" srcdoc="${escapeHtml(buildStyledHtml())}"></iframe>
        </section>

        <div
          class="layout-divider"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize preview and Style Dimensions panels"
          aria-valuemin="${MIN_DIMENSION_PANEL_WIDTH}"
          aria-valuenow="${dimensionPanelWidth}"
          tabindex="0"
        ></div>

        <aside class="dimension-panel">
          <div class="history-toolbar" aria-label="Version history controls">
            <button class="ghost history-button" type="button" data-undo-history ${historyPast.length === 0 || isLoading ? 'disabled' : ''} aria-label="Undo" title="Undo">${icon('undo')}</button>
            <button class="ghost history-button" type="button" data-redo-history ${historyFuture.length === 0 || isLoading ? 'disabled' : ''} aria-label="Redo" title="Redo">${icon('redo')}</button>
          </div>
          <section class="prompt-card" aria-label="Prompt editor">
            <div class="prompt-card-accent" aria-hidden="true">
              <span class="section-icon section-icon--prompt">${icon('sparkles')}</span>
            </div>
            <form class="promptbar">
              <textarea id="prompt-input" rows="5" placeholder="Describe any style you like — e.g. 'retro synthwave', 'brutalist minimal', 'soft pastel dreamscape'...">${escapeHtml(promptText)}</textarea>
              <button class="primary generate-button" type="submit" ${isLoading ? 'disabled' : ''} aria-label="Generate" title="Generate">${icon('send')}</button>
            </form>
          </section>
          <div class="dimension-toolbar" aria-label="Style dimensions controls">
            <span class="count-pill">${allTags.length} tags</span>
            <div class="control-actions">
              ${
                hasTags
                    ? `
                      <span class="bulk-toggle-control ${allTagsActive ? 'is-on' : ''}">
                        <span class="bulk-toggle-label">All</span>
                        <button
                          class="toggle-switch ${allTagsActive ? 'is-on' : ''}"
                          type="button"
                          role="switch"
                          aria-checked="${allTagsActive}"
                          aria-label="Toggle all tags"
                          title="Toggle all tags"
                          data-toggle-all="${bulkTarget}"
                        >
                          <span class="toggle-switch__track" aria-hidden="true">
                            <span class="toggle-switch__thumb"></span>
                          </span>
                        </button>
                      </span>
                      <button class="primary icon-add-button icon-add-button--dimension" type="button" data-add-dimension aria-label="Add Dimension" title="Add Dimension">${icon('plus')}</button>
                    `
                    : ''
              }
            </div>
          </div>
          ${
            hasTags
                ? renderDimensions()
                : `
                  <div class="dimension-empty-state">
                    <strong>No style dimensions yet</strong>
                    <span>Submit the prompt to generate the backend mock JSON.</span>
                  </div>
                `
          }
        </aside>

        ${renderInspector()}
      </section>
      ${renderSaveDialog()}
    </main>
  `

  bindEvents()
  syncPromptTextareaHeight()
  restoreScrollSnapshot(scrollSnapshot)
  if (elementPickerSource) attachElementPickerToPreview()
  if (previewHighlightedApplyRangeSelector) syncApplyRangePreviewHighlight()
}

function bindEvents() {
  window.removeEventListener('keydown', handleElementPickerKeydown, true)
  window.addEventListener('keydown', handleElementPickerKeydown, true)

  $('[data-toggle-gallery]')?.addEventListener('click', () => {
    isGalleryCollapsed = !isGalleryCollapsed
    render()
  })

  bindPanelResize()

  $$<HTMLButtonElement>('[data-open-detail]').forEach((button) => {
    button.addEventListener('click', () => {
      if (selectedTagId !== button.dataset.openDetail) clearApplyRangePreviewHighlight()
      selectedTagId = button.dataset.openDetail ?? selectedTagId
      isInspectorOpen = true
      render()
    })
  })

  $$<HTMLButtonElement>('[data-toggle-tag]').forEach((button) => {
    button.addEventListener('click', () => toggleTag(button.dataset.toggleTag ?? selectedTagId))
  })

  $$<HTMLButtonElement>('[data-toggle-all]').forEach((button) => {
    button.addEventListener('click', () => setAll(button.dataset.toggleAll as TagStatus))
  })

  $('[data-undo-history]')?.addEventListener('click', undoHistory)
  $('[data-redo-history]')?.addEventListener('click', redoHistory)

  $('[data-save-view]')?.addEventListener('click', openSaveDialog)
  $('[data-export-preview]')?.addEventListener('click', exportCurrentPreviewHtml)

  $$<HTMLButtonElement>('[data-restore-view]').forEach((button) => {
    button.addEventListener('click', () => restoreSavedView(button.dataset.restoreView ?? ''))
  })

  $$<HTMLButtonElement>('[data-delete-view]').forEach((button) => {
    button.addEventListener('click', () => deleteSavedView(button.dataset.deleteView ?? ''))
  })

  $$<HTMLButtonElement>('[data-close-save-dialog]').forEach((button) => {
    button.addEventListener('click', closeSaveDialog)
  })

  $$<HTMLButtonElement>('[data-delete-dimension]').forEach((button) => {
    button.addEventListener('click', () => deleteDimension(button.dataset.deleteDimension ?? ''))
  })

  $$<HTMLButtonElement>('[data-delete-tag]').forEach((button) => {
    button.addEventListener('click', () => deleteTag(button.dataset.deleteTag ?? ''))
  })

  $$<HTMLButtonElement>('[data-add-tag]').forEach((button) => {
    button.addEventListener('click', () => {
      pendingTargetDimension = button.dataset.addTag ?? 'surface-and-depth'
      const description = window.prompt('Describe the new tag to add', 'Add a subtle, reusable visual tag for this dimension.')
      if (!description) return
      promptText = description.trim()
      sendUpdate('ADD_NEW_TAG')
    })
  })

  $('[data-add-dimension]')?.addEventListener('click', () => {
    const name = window.prompt('New dimension name', 'motion-and-animation')?.trim()
    if (!name) return
    pendingNewDimensionName = name
    const description = window.prompt('Describe the new dimension and its tags', `Add a new ${name} dimension with minimal optional tags.`)
    if (!description) return
    promptText = description.trim()
    sendUpdate('ADD_NEW_DIMENSION')
  })
  $('[data-close-inspector]')?.addEventListener('click', () => {
    clearApplyRangePreviewHighlight()
    isInspectorOpen = false
    render()
  })

  $('#semantics-input')?.addEventListener('input', (event) => {
    updateSelectedSemantics((event.target as HTMLTextAreaElement).value)
  })

  $('#prompt-input')?.addEventListener('input', (event) => {
    const input = event.target as HTMLTextAreaElement
    promptText = input.value
    resizePromptTextarea(input)

    if ((event as InputEvent).data === '@') {
      startElementPicker('prompt', Math.max(0, input.selectionStart - 1))
      return
    }

    if (elementPickerSource === 'prompt') stopElementPickerIfMarkerWasDeleted()
  })

  $('#range-input')?.addEventListener('input', (event) => {
    const input = event.target as HTMLInputElement

    if (input.value.includes('@')) {
      startElementPicker('apply-range')
      return
    }

    if (elementPickerSource === 'apply-range') stopElementPickerIfMarkerWasDeleted()
  })

  $('#range-input')?.addEventListener('keydown', (event) => {
    const keyboardEvent = event as KeyboardEvent
    if (elementPickerSource) return
    if (keyboardEvent.key !== 'Enter' && keyboardEvent.key !== ',') return

    keyboardEvent.preventDefault()
    const input = keyboardEvent.target as HTMLInputElement
    addSelectedApplyRange(input.value)
  })

  $('#range-input')?.addEventListener('blur', (event) => {
    if (elementPickerSource) return
    const input = event.target as HTMLInputElement
    if (!input.value.trim()) return
    addSelectedApplyRange(input.value)
  })

  $('#range-input')?.addEventListener('paste', (event) => {
    if (elementPickerSource) return
    const input = event.target as HTMLInputElement
    requestAnimationFrame(() => {
      if (input.value.includes(',')) addSelectedApplyRange(input.value)
    })
  })

  $$<HTMLButtonElement>('[data-remove-apply-range]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation()
      removeSelectedApplyRange(button.dataset.removeApplyRange ?? '')
    })
  })

  $$<HTMLElement>('[data-preview-apply-range]').forEach((target) => {
    target.addEventListener('mouseenter', () => hoverApplyRangeSelectorInPreview(target.dataset.previewApplyRange ?? ''))
    target.addEventListener('mouseleave', clearApplyRangePreviewHighlight)
  })

  $('[data-ai-semantics]')?.addEventListener('click', () => sendUpdate('UPDATE_TAG_DESIGN_SEMANTICS', 'design_semantics'))
  $('[data-ai-range]')?.addEventListener('click', () => sendUpdate('UPDATE_TAG_APPLY_RANGE', 'apply_range'))

  $('.promptbar')?.addEventListener('submit', (event) => {
    event.preventDefault()
    const input = $('#prompt-input') as HTMLTextAreaElement
    promptText = input.value.trim() || promptText
    if (hasGeneratedTags()) {
      sendUpdate('UPDATE_PROMPT_OR_REFRESH')
    } else {
      generateInitialDimensionsTagsJson()
    }
  })

  $('.save-dialog')?.addEventListener('submit', (event) => {
    event.preventDefault()
    const nameInput = $('#save-name-input') as HTMLInputElement
    const thumbnailInput = $('#thumbnail-name-input') as HTMLInputElement
    saveCurrentView(nameInput.value, thumbnailInput.value)
  })
}

render()
