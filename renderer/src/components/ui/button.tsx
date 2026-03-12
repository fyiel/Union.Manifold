import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn, triggerHapticFeedback } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-30 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:ring-1 focus-visible:ring-white/20 active:scale-95",
  {
    variants: {
      variant: {
        default:
          "bg-white text-black hover:bg-zinc-200",
        destructive:
          "text-zinc-500 hover:text-red-400 hover:bg-red-500/10",
        outline:
          "border border-zinc-700 text-zinc-200 hover:border-zinc-500 hover:text-white",
        secondary:
          "bg-zinc-800 text-zinc-200 hover:bg-zinc-700",
        ghost:
          "text-zinc-400 hover:text-white hover:bg-white/[.05]",
        link: "text-zinc-400 underline-offset-4 hover:text-white hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-10 px-6 has-[>svg]:px-4",
        icon: "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, onClick, ...props }, ref) => {
    const Comp: any = asChild ? Slot : "button"

    const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
      triggerHapticFeedback("medium")
      if (onClick) onClick(event)
    }

    return (
      <Comp
        ref={ref as any}
        data-slot="button"
        className={cn(buttonVariants({ variant, size, className }))}
        onClick={handleClick}
        {...props}
      />
    )
  }
)

Button.displayName = "Button"

export { Button, buttonVariants }
