import * as React from 'react'

type TabsContextValue = {
  value: string
  setValue: (v: string) => void
}

const TabsContext = React.createContext<TabsContextValue | null>(null)

function useTabsContext() {
  const ctx = React.useContext(TabsContext)
  if (!ctx) throw new Error('Tabs components must be used inside <Tabs />')
  return ctx
}

function cx(...classes: Array<string | undefined | null | false>) {
  return classes.filter(Boolean).join(' ')
}

export interface TabsProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
}

export function Tabs({ value, defaultValue, onValueChange, className, children, ...props }: TabsProps) {
  const [internal, setInternal] = React.useState(defaultValue ?? '')
  const isControlled = value != null
  const current = isControlled ? (value as string) : internal

  const setValue = React.useCallback(
    (v: string) => {
      if (!isControlled) setInternal(v)
      onValueChange?.(v)
    },
    [isControlled, onValueChange]
  )

  return (
    <TabsContext.Provider value={{ value: current, setValue }}>
      <div className={cx('w-full', className)} {...props}>
        {children}
      </div>
    </TabsContext.Provider>
  )
}

export interface TabsListProps extends React.HTMLAttributes<HTMLDivElement> {}

export const TabsList = React.forwardRef<HTMLDivElement, TabsListProps>(({ className, ...props }, ref) => {
  return (
    <div
      ref={ref}
      className={cx(
        'inline-flex h-10 items-center justify-center rounded-md bg-zinc-100 p-1 text-zinc-600',
        className
      )}
      {...props}
    />
  )
})

TabsList.displayName = 'TabsList'

export interface TabsTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  value: string
}

export const TabsTrigger = React.forwardRef<HTMLButtonElement, TabsTriggerProps>(
  ({ className, value, onClick, ...props }, ref) => {
    const ctx = useTabsContext()
    const active = ctx.value === value

    return (
      <button
        ref={ref}
        type="button"
        className={cx(
          'inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ' +
            'transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 ' +
            'focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 ring-offset-white',
          active ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-600 hover:text-zinc-900',
          className
        )}
        onClick={(e) => {
          ctx.setValue(value)
          onClick?.(e)
        }}
        {...props}
      />
    )
  }
)

TabsTrigger.displayName = 'TabsTrigger'

export interface TabsContentProps extends React.HTMLAttributes<HTMLDivElement> {
  value: string
}

export const TabsContent = React.forwardRef<HTMLDivElement, TabsContentProps>(
  ({ className, value, children, ...props }, ref) => {
    const ctx = useTabsContext()
    if (ctx.value !== value) return null

    return (
      <div
        ref={ref}
        role="tabpanel"
        className={cx('mt-2 w-full', className)}
        {...props}
      >
        {children}
      </div>
    )
  }
)

TabsContent.displayName = 'TabsContent'
