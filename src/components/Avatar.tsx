import './Avatar.css'

interface AvatarProps {
  name: string
  size?: number
}

export function Avatar({ name, size = 48 }: AvatarProps) {
  return (
    <div
      className="avatar"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
      aria-hidden="true"
    >
      {getInitials(name)}
    </div>
  )
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const first = parts[0]?.[0] ?? ''
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : ''
  const initials = (first + last).toUpperCase()
  return initials || '?'
}
