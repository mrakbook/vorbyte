import * as React from 'react'

export interface SeparatorProps extends React.HTMLAttributes<HTMLDivElement> {
  orientation?: 'horizontal' | 'vertical'
}

function cx(...classes: Array<string | undefined | null | false>) {
  return classes.filter(Boolean).join(' ')
}

export const Separator = React.forwardRef<HTMLDivElement, SeparatorProps>(
  ({ className, orientation = 'horizontal', ...props }, ref) => {
    const isHorizontal = orientation === 'horizontal'
    return (
      <div
        ref={ref}
        role="separator"
        aria-orientation={orientation}
        className={cx(
          'shrink-0 bg-zinc-200',
          isHorizontal ? 'h-px w-full' : 'h-full w-px',
          className
        )}
        {...props}
      />
    )
  }
)

Separator.displayName = 'Separator'
