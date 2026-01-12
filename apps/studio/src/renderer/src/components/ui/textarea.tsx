import * as React from 'react'

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

function cx(...classes: Array<string | undefined | null | false>) {
  return classes.filter(Boolean).join(' ')
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, ...props }, ref) => {
  return (
    <textarea
      ref={ref}
      className={cx(
        'flex min-h-[80px] w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm shadow-sm ' +
          'placeholder:text-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 ' +
          'focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    />
  )
})

Textarea.displayName = 'Textarea'
