import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, LayoutDashboard, RefreshCw } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { isChunkLoadError } from '../lib/lazyWithRetry';

type BoundaryProps = {
  children: ReactNode;
  route: string;
};

type BoundaryState = {
  error: unknown;
};

class RouteBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('ClassPulse route render failed', error, info.componentStack);
  }

  private dashboardPath() {
    if (this.props.route.startsWith('/super-admin')) return '/super-admin';
    if (this.props.route.startsWith('/instructor')) return '/instructor';
    return '/admin';
  }

  render() {
    if (!this.state.error) return this.props.children;

    const staleVersion = isChunkLoadError(this.state.error);
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-5 py-12">
        <section className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-7 text-center shadow-xl shadow-slate-200/50 sm:p-10">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-600">
            <AlertTriangle size={28} />
          </div>
          <h1 className="mt-5 text-2xl font-extrabold text-slate-900">This page could not open</h1>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-slate-600">
            {staleVersion
              ? 'A newer ClassPulse version is available. Reload once to continue with the latest files.'
              : 'ClassPulse kept the rest of the app safe. Reload this page, or return to the dashboard and try again.'}
          </p>
          <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
            <button type="button" onClick={() => window.location.reload()} className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-bold text-white hover:brightness-95">
              <RefreshCw size={17} /> Reload page
            </button>
            <button type="button" onClick={() => window.location.assign(this.dashboardPath())} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50">
              <LayoutDashboard size={17} /> Dashboard
            </button>
          </div>
        </section>
      </main>
    );
  }
}

export default function RouteErrorBoundary({ children }: { children: ReactNode }) {
  const location = useLocation();
  return <RouteBoundary key={location.pathname} route={location.pathname}>{children}</RouteBoundary>;
}
