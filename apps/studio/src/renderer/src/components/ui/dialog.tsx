import * as React from 'react'
import { createPortal } from 'react-dom'

type DialogContextValue = {
  open: boolean
  setOpen: (open: boolean) => void
}

const DialogContext = React.createContext<DialogContextValue | null>(null)

function useDialogContext() {
  const ctx = React.useContext(DialogContext)
  if (!ctx) throw new Error('Dialog components must be used inside <Dialog />')
  return ctx
}

function cx(...classes: Array<string | undefined | null | false>) {
  return classes.filter(Boolean).join(' ')
}

export interface DialogProps {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  children: React.ReactNode
}

export function Dialog({ open, defaultOpen, onOpenChange, children }: DialogProps) {
  const [internal, setInternal] = React.useState(!!defaultOpen)
  const isControlled = open != null
  const current = isControlled ? (open as boolean) : internal

  const setOpen = React.useCallback(
    (next: boolean) => {
      if (!isControlled) setInternal(next)
      onOpenChange?.(next)
    },
    [isControlled, onOpenChange]
  )

  return <DialogContext.Provider value={{ open: current, setOpen }}>{children}</DialogContext.Provider>
}

export interface DialogTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean
}

export const DialogTrigger = React.forwardRef<HTMLButtonElement, DialogTriggerProps>(
  ({ asChild, className, onClick, children, ...props }, ref) => {
    const ctx = useDialogContext()

    if (asChild && React.isValidElement(children)) {
      // Minimal asChild support: clone the child and inject click handler
      return React.cloneElement(children as React.ReactElement<any>, {
        onClick: (e: any) => {
          ctx.setOpen(true)
          children.props?.onClick?.(e)
        }
      })
    }

    return (
      <button
        ref={ref}
        type="button"
        className={className}
        onClick={(e) => {
          ctx.setOpen(true)
          onClick?.(e)
        }}
        {...props}
      >
        {children}
      </button>
    )
  }
)

DialogTrigger.displayName = 'DialogTrigger'

export interface DialogContentProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * If true, clicking the overlay will NOT close the dialog.
   */
  disableOverlayClose?: boolean
}

export const DialogContent = React.forwardRef<HTMLDivElement, DialogContentProps>(
  ({ className, children, disableOverlayClose, ...props }, ref) => {
    const ctx = useDialogContext()

    React.useEffect(() => {
      if (!ctx.open) return

      function onKeyDown(e: KeyboardEvent) {
        if (e.key === 'Escape') ctx.setOpen(false)
      }

      window.addEventListener('keydown', onKeyDown)
      return () => window.removeEventListener('keydown', onKeyDown)
    }, [ctx])

    if (!ctx.open) return null
    if (typeof document === 'undefined') return null

    return createPortal(
      <div className="fixed inset-0 z-50">
        <div
          className="fixed inset-0 bg-black/40"
          onMouseDown={() => {
            if (!disableOverlayClose) ctx.setOpen(false)
          }}
        />
        <div className="fixed inset-0 flex items-start justify-center p-4 md:items-center">
          <div
            ref={ref}
            className={cx(
              'relative w-full max-w-lg rounded-lg border border-zinc-200 bg-white p-4 shadow-lg',
              className
            )}
            // Prevent overlay close when clicking inside content
            onMouseDown={(e) => e.stopPropagation()}
            {...props}
          >
            {children}
          </div>
        </div>
      </div>,
      document.body
    )
  }
)

DialogContent.displayName = 'DialogContent'

export interface DialogHeaderProps extends React.HTMLAttributes<HTMLDivElement> {}

export function DialogHeader({ className, ...props }: DialogHeaderProps) {
  return <div className={cx('flex flex-col space-y-1.5 text-center sm:text-left', className)} {...props} />
}

export interface DialogFooterProps extends React.HTMLAttributes<HTMLDivElement> {}

export function DialogFooter({ className, ...props }: DialogFooterProps) {
  return <div className={cx('flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2', className)} {...props} />
}

export interface DialogTitleProps extends React.HTMLAttributes<HTMLHeadingElement> {}

export const DialogTitle = React.forwardRef<HTMLHeadingElement, DialogTitleProps>(({ className, ...props }, ref) => {
  return <h2 ref={ref} className={cx('text-lg font-semibold leading-none tracking-tight', className)} {...props} />
})

DialogTitle.displayName = 'DialogTitle'

export interface DialogDescriptionProps extends React.HTMLAttributes<HTMLParagraphElement> {}

export const DialogDescription = React.forwardRef<HTMLParagraphElement, DialogDescriptionProps>(
  ({ className, ...props }, ref) => {
    return <p ref={ref} className={cx('text-sm text-zinc-600', className)} {...props} />
  }
)

DialogDescription.displayName = 'DialogDescription'
