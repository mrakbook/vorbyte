import * as React from 'react'

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

function cx(...classes: Array<string | undefined | null | false>) {
  return classes.filter(Boolean).join(' ')
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, type, ...props }, ref) => {
  return (
    <input
      ref={ref}
      type={type ?? 'text'}
      className={cx(
        'flex h-9 w-full rounded-md border border-zinc-200 bg-white px-3 py-1 text-sm shadow-sm ' +
          'placeholder:text-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 ' +
          'focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    />
  )
})

Input.displayName = 'Input'
