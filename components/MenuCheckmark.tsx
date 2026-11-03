'use client'

interface MenuCheckmarkProps {
  checked: boolean
}

export function MenuCheckmark(props: MenuCheckmarkProps) {
  return <>{props.checked ? <span aria-hidden="true">✓</span> : null}</>
}
