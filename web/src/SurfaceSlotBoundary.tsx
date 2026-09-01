import { Component } from "react";
import type { ReactNode } from "react";

type SurfaceSlotBoundaryProps = {
  children: ReactNode;
  label: string;
  resetKey: string;
  recoveryLabel?: string;
  onRecover?: () => void;
};

type SurfaceSlotBoundaryState = {
  failed: boolean;
};

export class SurfaceSlotBoundary extends Component<
  SurfaceSlotBoundaryProps,
  SurfaceSlotBoundaryState
> {
  state: SurfaceSlotBoundaryState = { failed: false };

  static getDerivedStateFromError(): SurfaceSlotBoundaryState {
    return { failed: true };
  }

  componentDidCatch() {
    // Surface failures stay bounded and are intentionally not copied into logs.
  }

  componentDidUpdate(previous: SurfaceSlotBoundaryProps) {
    if (previous.resetKey !== this.props.resetKey && this.state.failed) {
      this.setState({ failed: false });
    }
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="surface-unavailable" role="alert">
          <strong>{this.props.label} unavailable</strong>
          <span>
            {this.props.onRecover
              ? "This presentation failed without stopping the rest of Herdr World."
              : "Use the primary view switch to continue in Spaces."}
          </span>
          {this.props.onRecover ? (
            <button className="btn" type="button" onClick={this.props.onRecover}>
              {this.props.recoveryLabel ?? "Recover"}
            </button>
          ) : null}
        </div>
      );
    }
    return this.props.children;
  }
}
