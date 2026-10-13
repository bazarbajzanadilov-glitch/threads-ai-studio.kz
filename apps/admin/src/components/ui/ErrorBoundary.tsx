import { Component, type ComponentChildren } from "preact";
import { AlertCircle, RefreshCw } from "lucide-preact";

interface Props {
  children: ComponentChildren;
  fallback?: ComponentChildren;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { hasError: false };

  static override getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  override componentDidCatch(_error: Error) {
    // Keep error local
  }

  reset = () => {
    this.setState({ hasError: false, error: undefined });
  };

  override render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div class="trantor-error-boundary">
          <div class="trantor-error-icon">
            <AlertCircle size={32} />
          </div>
          <h3>Что-то пошло не так</h3>
          <p>{this.state.error?.message || "Произошла непредвиденная ошибка интерфейса"}</p>
          <button
            class="trantor-pill-btn trantor-pill-btn--primary"
            onClick={this.reset}
            type="button"
          >
            <RefreshCw size={14} />
            <span>Попробовать снова</span>
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
