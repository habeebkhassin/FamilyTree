import type { HTMLAttributes } from 'react'
import './Card.css'

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  const classes = ['card', className].filter(Boolean).join(' ')
  return <div className={classes} {...rest} />
}
