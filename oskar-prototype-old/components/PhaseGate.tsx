'use client'

import { VibeData, FINAL_APPROVAL } from '@/lib/types'

interface FinalApprovalProps {
  vibes: VibeData[]
  selectedVibeIds: string[]
  onApprove: (selectedVibeIds: string[]) => void
  onReject: () => void
  onVibeToggle: (vibeId: string) => void
}

/**
 * Final Approval Modal - the ONLY blocking gate in the workflow
 *
 * Shows when all vibes are complete. User selects favorites and approves.
 */
export function FinalApprovalModal({
  vibes,
  selectedVibeIds,
  onApprove,
  onReject,
  onVibeToggle
}: FinalApprovalProps) {
  const handleApprove = () => {
    if (selectedVibeIds.length > 0) {
      onApprove(selectedVibeIds)
    }
  }

  return (
    <div className="final-approval-overlay">
      <div className="final-approval-modal">
        {/* Header */}
        <div className="approval-header">
          <div className="phase-indicator">
            <span className="phase-dot" />
            <span className="phase-label">Final Review</span>
          </div>
          <h2 className="approval-title">{FINAL_APPROVAL.title}</h2>
          <p className="approval-description">{FINAL_APPROVAL.description}</p>
        </div>

        {/* Vibe Selection */}
        <div className="vibe-selection">
          <p className="selection-hint">
            Select the vibe(s) you want to use. You can mix elements from multiple vibes.
          </p>
          <div className="vibe-grid">
            {vibes.map(vibe => (
              <button
                key={vibe.id}
                className={`vibe-card ${selectedVibeIds.includes(vibe.id) ? 'selected' : ''}`}
                onClick={() => onVibeToggle(vibe.id)}
              >
                <div className="vibe-preview">
                  {vibe.htmlPath ? (
                    <iframe
                      src={vibe.htmlPath}
                      title={vibe.name}
                      className="vibe-iframe"
                    />
                  ) : (
                    <div className="vibe-placeholder">
                      <span>{vibe.name[0]}</span>
                    </div>
                  )}
                </div>
                <div className="vibe-info">
                  <h3>{vibe.name}</h3>
                  <p>{vibe.headline}</p>
                </div>
                {selectedVibeIds.includes(vibe.id) && (
                  <div className="selected-badge">Selected</div>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="approval-actions">
          <button
            className="approval-button reject"
            onClick={onReject}
          >
            {FINAL_APPROVAL.rejectLabel}
          </button>
          <button
            className="approval-button approve"
            onClick={handleApprove}
            disabled={selectedVibeIds.length === 0}
          >
            {FINAL_APPROVAL.approveLabel}
          </button>
        </div>
      </div>

      <style jsx>{`
        .final-approval-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.85);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
          padding: 24px;
        }

        .final-approval-modal {
          background: #1a1a1a;
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 16px;
          max-width: 900px;
          width: 100%;
          max-height: 90vh;
          overflow-y: auto;
        }

        .approval-header {
          padding: 32px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        }

        .phase-indicator {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 16px;
        }

        .phase-dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: #22c55e;
          animation: pulse 2s ease-in-out infinite;
        }

        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }

        .phase-label {
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 1px;
          color: #22c55e;
          font-weight: 600;
        }

        .approval-title {
          font-size: 28px;
          font-weight: 700;
          color: white;
          margin: 0 0 8px 0;
        }

        .approval-description {
          font-size: 16px;
          color: rgba(255, 255, 255, 0.6);
          margin: 0;
          line-height: 1.5;
        }

        .vibe-selection {
          padding: 24px 32px;
        }

        .selection-hint {
          font-size: 14px;
          color: rgba(255, 255, 255, 0.5);
          margin: 0 0 16px 0;
        }

        .vibe-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 16px;
        }

        .vibe-card {
          background: #252525;
          border: 2px solid transparent;
          border-radius: 12px;
          padding: 0;
          cursor: pointer;
          transition: all 0.2s;
          text-align: left;
          overflow: hidden;
          position: relative;
        }

        .vibe-card:hover {
          border-color: rgba(34, 197, 94, 0.5);
          transform: translateY(-2px);
        }

        .vibe-card.selected {
          border-color: #22c55e;
          background: rgba(34, 197, 94, 0.1);
        }

        .vibe-preview {
          aspect-ratio: 16/10;
          background: #1a1a1a;
          overflow: hidden;
        }

        .vibe-iframe {
          width: 200%;
          height: 200%;
          transform: scale(0.5);
          transform-origin: top left;
          border: none;
          pointer-events: none;
        }

        .vibe-placeholder {
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 48px;
          color: rgba(255, 255, 255, 0.2);
        }

        .vibe-info {
          padding: 12px 16px;
        }

        .vibe-info h3 {
          font-size: 14px;
          font-weight: 600;
          color: white;
          margin: 0 0 4px 0;
        }

        .vibe-info p {
          font-size: 12px;
          color: rgba(255, 255, 255, 0.5);
          margin: 0;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .selected-badge {
          position: absolute;
          top: 8px;
          right: 8px;
          background: #22c55e;
          color: white;
          font-size: 10px;
          font-weight: 600;
          padding: 4px 8px;
          border-radius: 4px;
          text-transform: uppercase;
        }

        .approval-actions {
          padding: 24px 32px;
          display: flex;
          justify-content: flex-end;
          gap: 12px;
          border-top: 1px solid rgba(255, 255, 255, 0.1);
        }

        .approval-button {
          padding: 12px 24px;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
        }

        .approval-button.reject {
          background: transparent;
          border: 1px solid rgba(255, 255, 255, 0.2);
          color: rgba(255, 255, 255, 0.6);
        }

        .approval-button.reject:hover {
          border-color: rgba(255, 255, 255, 0.4);
          color: white;
        }

        .approval-button.approve {
          background: #22c55e;
          border: none;
          color: white;
        }

        .approval-button.approve:hover {
          background: #16a34a;
        }

        .approval-button.approve:disabled {
          background: #555;
          cursor: not-allowed;
        }
      `}</style>
    </div>
  )
}
