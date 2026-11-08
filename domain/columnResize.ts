/** Keeps the preview's reserved width while making its spare space available. */
export function columnWidthBudget({ columnWidth, previewWidth, reservedWidth }: {
  columnWidth: number
  previewWidth: number
  reservedWidth: number
}): number {
  return columnWidth + Math.max(0, previewWidth - reservedWidth)
}
