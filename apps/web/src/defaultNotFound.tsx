/*
 * DESIGN READ: Study-cockpit utility for self-learners, calm/focused/trust-first.
 * 404 page - composed empty state, consistent with app design language.
 */

import { Link } from "@tanstack/react-router";

export default function DefaultNotFound() {
  return (
    <div className="py-24 text-center">
      <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-slate-100 flex items-center justify-center">
        <svg className="w-10 h-10 text-slate-300" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
        </svg>
      </div>
      <h1 className="text-2xl font-bold text-slate-900 mb-2">Page not found</h1>
      <p className="text-slate-500 mb-8 max-w-sm mx-auto">
        The page you are looking for does not exist or has been moved.
      </p>
      <Link
        to="/"
        className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 active:scale-[0.98] transition-all tactile-btn"
      >
        Back to cards
      </Link>
    </div>
  );
}
