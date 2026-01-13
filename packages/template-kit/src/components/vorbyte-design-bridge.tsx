'use client'

import { useEffect, useRef } from 'react'

type ParentMsg =
  | { kind: 'vorbyte:design'; type: 'ping' }
  | { kind: 'vorbyte:design'; type: 'enable'; enabled: boolean }
  | {
      kind: 'vorbyte:design'
      type: 'apply'
      selector: string
      newText?: string
      newClassName?: string
    }

type ChildMsg =
  | { kind: 'vorbyte:design'; type: 'ready'; version: 1 }
  | { kind: 'vorbyte:design'; type: 'pong' }
  | { kind: 'vorbyte:design'; type: 'enabled'; enabled: boolean }
  | {
      kind: 'vorbyte:design'
      type: 'selected'
      selection: {
        selector: string
        tag: string
        text?: string
        className?: string
      }
    }

function postToParent(msg: ChildMsg) {
  // In Electron Studio, the app sits in the parent frame.
  window.parent?.postMessage(msg, '*')
}

function isElement(x: any): x is Element {
  return !!x && typeof x === 'object' && x.nodeType === 1
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function updateOverlayBox(overlay: HTMLDivElement, el: Element | null) {
  if (!el) {
    overlay.style.display = 'none'
    return
  }

  const rect = el.getBoundingClientRect()

  // If element is offscreen / tiny, still draw but clamp.
  const left = clamp(rect.left, 0, window.innerWidth)
  const top = clamp(rect.top, 0, window.innerHeight)
  const width = clamp(rect.width, 0, window.innerWidth)
  const height = clamp(rect.height, 0, window.innerHeight)

  overlay.style.display = 'block'
  overlay.style.left = `${left}px`
  overlay.style.top = `${top}px`
  overlay.style.width = `${width}px`
  overlay.style.height = `${height}px`
}

function cssEscape(value: string) {
  // CSS.escape is not available in all environments; implement a minimal fallback.
  // This is not perfect but works for typical ids/classes.
  // https://developer.mozilla.org/en-US/docs/Web/API/CSS/escape
  if (typeof (window as any).CSS?.escape === 'function') return (window as any).CSS.escape(value)
  return value.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`)
}

function nthOfTypeSelector(el: Element): string {
  const tag = el.tagName.toLowerCase()
  const parent = el.parentElement
  if (!parent) return tag

  const siblings = Array.from(parent.children).filter(
    (c) => (c as Element).tagName.toLowerCase() === tag
  )
  if (siblings.length <= 1) return tag

  const idx = siblings.indexOf(el)
  return `${tag}:nth-of-type(${idx + 1})`
}

function buildUniqueSelector(el: Element): string {
  const id = (el as HTMLElement).id
  if (id) return `#${cssEscape(id)}`

  const parts: string[] = []
  let cur: Element | null = el
  let safety = 0

  while (cur && safety++ < 25) {
    const tagPart = nthOfTypeSelector(cur)
    parts.unshift(tagPart)
    if (cur.parentElement?.tagName.toLowerCase() === 'body') break
    cur = cur.parentElement
  }

  return parts.length ? `body > ${parts.join(' > ')}` : 'body'
}

function bestEffortText(el: Element): string | undefined {
  const h = el as HTMLElement
  if (!h) return undefined

  // Prefer innerText so it matches what the user sees (ignores hidden text).
  const t = (h.innerText ?? '').trim()
  if (!t) return undefined

  // Keep this short; it is used as a matching hint for code edits.
  return t.slice(0, 500)
}

export default function VorByteDesignBridge() {
  const enabledRef = useRef(false)

  const hoverElRef = useRef<Element | null>(null)
  const selectedElRef = useRef<Element | null>(null)
  const selectedSelectorRef = useRef<string | null>(null)

  const hoverOverlayRef = useRef<HTMLDivElement | null>(null)
  const selectedOverlayRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    // Hover overlay
    const hover = document.createElement('div')
    hover.dataset.vorbyteOverlay = 'hover'
    hover.style.position = 'fixed'
    hover.style.pointerEvents = 'none'
    hover.style.zIndex = '2147483647'
    hover.style.border = '2px solid rgba(59,130,246,0.9)'
    hover.style.background = 'rgba(59,130,246,0.08)'
    hover.style.boxSizing = 'border-box'
    hover.style.display = 'none'
    document.body.appendChild(hover)
    hoverOverlayRef.current = hover

    // Selected overlay
    const selected = document.createElement('div')
    selected.dataset.vorbyteOverlay = 'selected'
    selected.style.position = 'fixed'
    selected.style.pointerEvents = 'none'
    selected.style.zIndex = '2147483647'
    selected.style.border = '2px solid rgba(16,185,129,0.95)'
    selected.style.background = 'rgba(16,185,129,0.06)'
    selected.style.boxSizing = 'border-box'
    selected.style.display = 'none'
    document.body.appendChild(selected)
    selectedOverlayRef.current = selected

    const refreshOverlays = () => {
      updateOverlayBox(hover, hoverElRef.current)
      updateOverlayBox(selected, selectedElRef.current)
    }

    const pickTarget = (raw: any): Element | null => {
      if (!isElement(raw)) return null
      const el = raw as Element

      // Avoid selecting our own overlays (should be impossible due to pointer-events:none, but be safe).
      if ((el as HTMLElement).dataset?.vorbyteOverlay) return null

      return el
    }

    const onMove = (e: MouseEvent) => {
      if (!enabledRef.current) return
      const el = pickTarget(e.target)
      hoverElRef.current = el
      updateOverlayBox(hover, el)
    }

    const onClick = (e: MouseEvent) => {
      if (!enabledRef.current) return
      const el = pickTarget(e.target)
      if (!el) return

      // Prevent navigation (links) or other clicks while in inspect mode.
      e.preventDefault()
      e.stopPropagation()

      selectedElRef.current = el
      const selector = buildUniqueSelector(el)
      selectedSelectorRef.current = selector

      updateOverlayBox(selected, el)

      const selection = {
        selector,
        tag: el.tagName.toLowerCase(),
        text: bestEffortText(el),
        className: (el as HTMLElement).className || undefined
      }

      postToParent({ kind: 'vorbyte:design', type: 'selected', selection })
    }

    const onScrollOrResize = () => {
      if (!enabledRef.current && !selectedElRef.current) return
      refreshOverlays()
    }

    const onMessage = (ev: MessageEvent) => {
      const data = ev.data as any
      if (!data || typeof data !== 'object') return
      if (data.kind !== 'vorbyte:design') return

      const msg = data as ParentMsg

      if (msg.type === 'ping') {
        postToParent({ kind: 'vorbyte:design', type: 'pong' })
        return
      }

      if (msg.type === 'enable') {
        enabledRef.current = !!msg.enabled
        if (!enabledRef.current) {
          hoverElRef.current = null
          updateOverlayBox(hover, null)
        }
        postToParent({ kind: 'vorbyte:design', type: 'enabled', enabled: enabledRef.current })
        return
      }

      if (msg.type === 'apply') {
        const { selector, newText, newClassName } = msg
        const el = document.querySelector(selector)
        if (!el) return

        if (typeof newText === 'string') {
          // For inputs, update value; otherwise update text content.
          if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
            el.value = newText
          } else {
            el.textContent = newText
          }
        }

        if (typeof newClassName === 'string') {
          ;(el as HTMLElement).className = newClassName
        }

        // Keep overlays aligned
        if (selectedSelectorRef.current === selector) {
          selectedElRef.current = el
          refreshOverlays()
        }
      }
    }

    window.addEventListener('mousemove', onMove, true)
    window.addEventListener('click', onClick, true)
    window.addEventListener('scroll', onScrollOrResize, true)
    window.addEventListener('resize', onScrollOrResize)
    window.addEventListener('message', onMessage)

    // Signal readiness to the parent Studio UI.
    postToParent({ kind: 'vorbyte:design', type: 'ready', version: 1 })

    return () => {
      window.removeEventListener('mousemove', onMove, true)
      window.removeEventListener('click', onClick, true)
      window.removeEventListener('scroll', onScrollOrResize, true)
      window.removeEventListener('resize', onScrollOrResize)
      window.removeEventListener('message', onMessage)

      hover.remove()
      selected.remove()
    }
  }, [])

  return null
}
