'use client'

interface BillingToggleProps {
  mode: 'cli' | 'api'
  onChange: (mode: 'cli' | 'api') => void
}

export function BillingToggle({ mode, onChange }: BillingToggleProps) {
  return (
    <div className="billing-toggle">
      <button
        className={`toggle-option ${mode === 'cli' ? 'active' : ''}`}
        onClick={() => onChange('cli')}
      >
        <span className="label">CLI</span>
      </button>

      <button
        className={`toggle-option ${mode === 'api' ? 'active' : ''}`}
        onClick={() => onChange('api')}
      >
        <span className="label">API</span>
      </button>

      <style jsx>{`
        .billing-toggle {
          display: flex;
          gap: 2px;
          background: #1a1a1a;
          padding: 3px;
          border-radius: 6px;
          border: 1px solid #333;
        }

        .toggle-option {
          padding: 6px 14px;
          border: none;
          background: transparent;
          color: #666;
          cursor: pointer;
          border-radius: 4px;
          font-size: 12px;
          font-weight: 600;
          transition: all 0.15s;
        }

        .toggle-option:hover {
          color: #999;
        }

        .toggle-option.active {
          background: #2a2a2a;
          color: #fff;
        }
      `}</style>
    </div>
  )
}
