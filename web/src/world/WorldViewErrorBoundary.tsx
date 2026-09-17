import { Component, type ReactNode } from "react";

export class WorldViewErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="world-view-failure" role="alert">
          <h2>This view could not be rendered</h2>
          <p>
            Your connection, Spaces, Inspector, and terminals are still
            available. Choose another view or retry this one.
          </p>
          <button
            type="button"
            onClick={() => this.setState({ failed: false })}
          >
            Retry view
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
