'use client'

import { LayoutMode } from '@/lib/types'

interface LayoutToggleProps {
  mode: LayoutMode
  onChange: (mode: LayoutMode) => void
}

export function LayoutToggle({ mode, onChange }: LayoutToggleProps) {
  return (
    <div className="layout-toggle">
      <button
        className={`toggle-option ${mode === '2-panel' ? 'active' : ''}`}
        onClick={() => onChange('2-panel')}
        title="2-panel layout (Assets + Chat)"
      >
        <span className="icon">▐▌</span>
      </button>

      <button
        className={`toggle-option ${mode === '3-panel' ? 'active' : ''}`}
        onClick={() => onChange('3-panel')}
        title="3-panel layout (Assets + Canvas + Chat)"
      >
        <span className="icon">▐█▌</span>
      </button>

      <style jsx>{`
        .layout-toggle {
          display: flex;
          gap: 2px;
          background: #1a1a1a;
          padding: 3px;
          border-radius: 6px;
          border: 1px solid #333;
        }

        .toggle-option {
          padding: 6px 10px;
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

        .icon {
          font-family: monospace;
          letter-spacing: -2px;
        }
      `}</style>
    </div>
  )
}
