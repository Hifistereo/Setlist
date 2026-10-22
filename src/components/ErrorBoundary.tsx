import { Component, type ReactNode } from 'react'

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="p-6 flex flex-col gap-3 max-w-lg mx-auto">
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <p className="text-sm text-mute">Your data is safe on this device. Try reloading.</p>
        <pre className="text-xs text-bad whitespace-pre-wrap">{this.state.error.message}</pre>
        <button className="btn-primary self-start" onClick={() => location.reload()}>Reload</button>
      </div>
    )
  }
}
