import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn, triggerHapticFeedback } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium transition-all active:scale-95 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-0",
  {
    variants: {
      variant: {
        default:
          "bg-white text-black shadow-xs hover:bg-zinc-200",
        destructive:
          "bg-destructive text-white shadow-xs hover:brightness-105",
        outline:
          "border shadow-xs hover:bg-foreground/5 hover:text-foreground bg-transparent border-zinc-700 text-zinc-200 hover:border-zinc-500",
        secondary:
          "bg-zinc-800 text-zinc-200 shadow-xs hover:bg-zinc-700",
        ghost:
          "hover:bg-foreground/5 hover:text-foreground hover:bg-white/5",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-5 py-2.5 has-[>svg]:px-3",
        sm: "h-8 gap-1.5 px-4 has-[>svg]:px-2.5",
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
