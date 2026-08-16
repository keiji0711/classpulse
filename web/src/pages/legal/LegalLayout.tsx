import { Link } from 'react-router-dom';

// Shared shell for the public legal pages (privacy, terms, account deletion).
// These routes are intentionally public — Google Play requires the privacy
// policy and data-deletion URLs to be reachable without logging in.
export default function LegalLayout({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <header className="border-b border-slate-200 bg-white">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4 flex items-center gap-3">
          <Link to="/" className="flex items-center gap-2">
            <img src="/classPulseLogo.png" alt="ClassPulse" className="h-8 w-8" />
            <span className="font-bold text-slate-900">ClassPulse</span>
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
        <h1 className="text-3xl font-bold text-slate-900">{title}</h1>
        <p className="text-sm text-slate-500 mt-2">Last updated: {updated}</p>
        <div className="prose prose-slate mt-8 max-w-none [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:mt-8 [&_h2]:mb-2 [&_h2]:text-slate-900 [&_p]:my-3 [&_p]:leading-relaxed [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6 [&_li]:my-1 [&_a]:text-primary [&_a]:underline">
          {children}
        </div>

        <nav className="mt-12 pt-6 border-t border-slate-200 flex flex-wrap gap-4 text-sm">
          <Link to="/privacy" className="text-primary hover:underline">Privacy Policy</Link>
          <Link to="/terms" className="text-primary hover:underline">Terms of Service</Link>
          <Link to="/delete-account" className="text-primary hover:underline">Delete Account &amp; Data</Link>
        </nav>
        <p className="text-xs text-slate-400 mt-6">
          &copy; {new Date().getFullYear()} ClassPulse. All rights reserved.
        </p>
      </main>
    </div>
  );
}
