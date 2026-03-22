import React from 'react'

interface State {
  hasError: boolean
  error: Error | null
}

/**
 * 全局错误边界：捕获子组件树中的渲染错误，
 * 显示降级 UI 而不是整个应用白屏。
 */
export default class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  State
> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  handleReload = (): void => {
    this.setState({ hasError: false, error: null })
    window.location.reload()
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          fontFamily: 'system-ui, sans-serif',
          color: '#374151',
          padding: 32,
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>😵</div>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>
            页面出了点问题
          </h2>
          <p style={{ fontSize: 13, color: '#9ca3af', marginBottom: 20, maxWidth: 320 }}>
            {this.state.error?.message || '未知错误'}
          </p>
          <button
            onClick={this.handleReload}
            style={{
              padding: '8px 24px',
              borderRadius: 12,
              border: 'none',
              backgroundColor: '#6366f1',
              color: 'white',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            点击刷新
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
