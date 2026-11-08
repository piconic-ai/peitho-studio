export function isZoomShortcut(event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey'>): boolean {
  return (event.metaKey || event.ctrlKey) && ['+', '=', '-', '0'].includes(event.key)
}
