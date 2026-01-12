import * as React from 'react'

export interface ScrollAreaProps extends React.HTMLAttributes<HTMLDivElement> {}

function cx(...classes: Array<string | undefined | null | false>) {
  return classes.filter(Boolean).join(' ')
}

/**
 * Minimal ScrollArea implementation (no Radix dependency).
 * Provides a predictable `overflow-auto` container.
 */
export const ScrollArea = React.forwardRef<HTMLDivElement, ScrollAreaProps>(({ className, ...props }, ref) => {
  return <div ref={ref} className={cx('relative overflow-auto', className)} {...props} />
})

ScrollArea.displayName = 'ScrollArea'
