import type { ButtonHTMLAttributes, Ref } from 'react'
import './Button.css'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger'
  ref?: Ref<HTMLButtonElement>
}

export function Button({ variant = 'primary', className, ref, ...rest }: ButtonProps) {
  const classes = ['button', `button--${variant}`, className].filter(Boolean).join(' ')
  return <button ref={ref} className={classes} {...rest} />
}
