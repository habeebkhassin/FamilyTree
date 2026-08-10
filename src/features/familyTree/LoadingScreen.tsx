import './LoadingScreen.css'

export function LoadingScreen() {
  return (
    <div className="loading" role="status" aria-label="Loading">
      <div className="loading__mark" />
    </div>
  )
}
