import * as React from 'react'
import * as CheckboxPrimitive from '@radix-ui/react-checkbox'
import { Check as CheckIcon } from "@/components/icons"

import { cn } from '../../lib/utils'

function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        'peer size-4 shrink-0 rounded-[4px] border border-white/[.15] bg-card transition-colors outline-none',
        'data-[state=checked]:bg-primary data-[state=checked]:border-white data-[state=checked]:text-black',
        'focus-visible:ring-2 focus-visible:ring-white/20 focus-visible:border-white/40',
        'disabled:cursor-not-allowed disabled:opacity-30',
        'active:scale-95',
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="flex items-center justify-center text-current transition-none"
      >
        <CheckIcon className="size-3.5" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }


