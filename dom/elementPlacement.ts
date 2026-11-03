import type { PreviewClick } from '../domain/reviewComment'

/** Clipboard placement is relative to the actual preview slide. */
export function previewElementPlacement(click: PreviewClick): { x: number; y: number; width: number; height: number } | undefined {
  const root = document.querySelector('[data-preview-host]')?.shadowRoot
  const element = previewElement(root, click)
  const slideRect = element?.closest('.peitho-slide')?.getBoundingClientRect()
  const rect = element?.getBoundingClientRect()
  if (!slideRect || !rect) return undefined
  return { x: (rect.x - slideRect.x) / slideRect.width, y: (rect.y - slideRect.y) / slideRect.height, width: rect.width / slideRect.width, height: rect.height / slideRect.height }
}

function previewElement(root: ShadowRoot | null | undefined, click: PreviewClick): HTMLElement | null | undefined {
  if (click.image) return Array.from(root?.querySelectorAll<HTMLElement>('[data-studio-image]') ?? []).find(element => element.dataset.studioImage === click.image?.slot)
  return Array.from(root?.querySelectorAll<HTMLElement>('[data-peitho-src]') ?? []).find(element => element.getAttribute('data-peitho-md') === click.hit?.quote && element.getAttribute('data-peitho-src') === `${click.hit?.byteSpan?.start}-${click.hit?.byteSpan?.end}`)?.closest<HTMLElement>('[data-studio-text],h1,h2,h3,h4,h5,h6,p,li')
}
