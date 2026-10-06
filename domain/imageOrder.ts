export type ImageOrderAction = 'front' | 'forward' | 'backward' | 'back'

/** Canvas DOM order is back to front. Never mutate the current order. */
export function moveImageOrder(order: string[], slot: string, action: ImageOrderAction): string[] {
  const index = order.indexOf(slot)
  if (index < 0) return order.slice()
  const target = action === 'front' ? order.length - 1 : action === 'back' ? 0 : action === 'forward' ? Math.min(order.length - 1, index + 1) : Math.max(0, index - 1)
  const next = order.slice()
  next.splice(index, 1)
  next.splice(target, 0, slot)
  return next
}
