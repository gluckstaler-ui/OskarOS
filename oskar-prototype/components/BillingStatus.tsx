'use client'

export function BillingStatus({ mode }: { mode: 'cli' | 'api' }) {
  return (
    <div className={`billing-status ${mode}`}>
      <div className="status-dot" />
      <span>{mode.toUpperCase()}</span>

      <style jsx>{`
        .billing-status {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 12px;
          border-radius: 20px;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.5px;
        }

        .billing-status.cli {
          background: rgba(74, 222, 128, 0.15);
          color: #4ade80;
          border: 1px solid rgba(74, 222, 128, 0.3);
        }

        .billing-status.api {
          background: rgba(248, 113, 113, 0.15);
          color: #f87171;
          border: 1px solid rgba(248, 113, 113, 0.3);
        }

        .status-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: currentColor;
        }
      `}</style>
    </div>
  )
}
