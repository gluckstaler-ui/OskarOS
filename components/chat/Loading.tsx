/**
 * Loading primitives — Spinner, Skeleton, DesignCardSkeleton, CenteredLoader.
 *
 * Source: external/open-design/apps/web/src/components/Loading.tsx
 * Ported 2026-05-02 (FEATURE-X §1.4 WP-2.6, Phase 2 Commit A foundation).
 *
 * Adaptation
 * ----------
 * OD's Spinner imports `Icon name="spinner"` from a shared Icon component
 * registry. OskarOS doesn't have that registry yet, so this port renders an
 * inline CSS-animated spinner (border-spinning circle) — same visual idea,
 * zero dependencies. If/when OskarOS adds an Icon registry, swap the inline
 * SVG out for `<Icon name="spinner" />`.
 *
 * Class names match OD verbatim so styles stay portable; CSS lives in
 * `app/globals.css` under "LOADING PRIMITIVES" section.
 */
'use client';

import * as React from 'react';

interface SpinnerProps {
  size?: number;
  label?: string;
}

export function Spinner({ size = 14, label }: SpinnerProps) {
  return (
    <span className="loading-spinner" role="status" aria-live="polite">
      <span
        className="loading-spinner-icon"
        style={{ width: size, height: size }}
        aria-hidden
      />
      {label ? <span className="loading-spinner-label">{label}</span> : null}
    </span>
  );
}

interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  radius?: number | string;
  className?: string;
}

export function Skeleton({ width, height = 14, radius = 6, className }: SkeletonProps) {
  return (
    <span
      className={`skeleton-block${className ? ` ${className}` : ''}`}
      style={{ width, height, borderRadius: radius }}
      aria-hidden
    />
  );
}

/**
 * Card-shaped skeleton tuned for vibe / design-card grids.
 *
 * Renders a thumb area over a row of meta lines so an empty grid feels like
 * content is arriving rather than missing.
 */
export function DesignCardSkeleton() {
  return (
    <div className="design-card design-card-skeleton" aria-hidden>
      <div className="design-card-thumb skeleton-shimmer" />
      <div className="design-card-meta-block">
        <Skeleton height={13} width="65%" />
        <Skeleton height={11} width="45%" />
      </div>
    </div>
  );
}

/**
 * Centered overlay used while bootstrap data loads (agents, skills, brand
 * data, session list). Sits inside a flex / grid parent and grows with it.
 */
export function CenteredLoader({ label }: { label?: string }) {
  return (
    <div className="centered-loader">
      <Spinner size={20} />
      {label ? <span className="centered-loader-label">{label}</span> : null}
    </div>
  );
}
