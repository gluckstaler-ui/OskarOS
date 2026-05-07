/**
 * PasteTextDialog — modal for pasting raw text and saving it as a session file.
 *
 * Source: external/open-design/apps/web/src/components/PasteTextDialog.tsx (~59 LOC)
 * Ported 2026-05-02 (FEATURE-X §1.4 WP-3.5, Phase 3 Commit D).
 *
 * Adaptation
 * ----------
 * - `useT()` (i18n) stripped; English strings inlined.
 * - Class names `modal-backdrop` / `modal` / `hint` / `row` follow OD; CSS
 *   under "PASTE TEXT DIALOG" in `app/globals.css`.
 * - Auto-extension: when the user-supplied filename has no extension, the
 *   dialog appends `.txt` automatically. `paste-{timestamp}.txt` is the
 *   default fallback name.
 * - Trim guard on submission: empty content → save button disabled, click
 *   is a no-op.
 *
 * Wire-up (follow-up)
 * -------------------
 * Hook into `components/ConversationPanel.tsx` chat composer's "+" /
 * attachment menu as "Paste text…". On save, write the file via the
 * existing session-file write path (same one used by file uploads).
 */
'use client';

import * as React from 'react';
import { useState } from 'react';

interface Props {
  onSave: (name: string, content: string) => void;
  onClose: () => void;
}

export function PasteTextDialog({ onSave, onClose }: Props) {
  const [name, setName] = useState('');
  const [content, setContent] = useState('');

  function commit() {
    const trimmed = content.trim();
    if (!trimmed) return;
    const finalName = name.trim() || `paste-${Date.now()}.txt`;
    onSave(ensureExtension(finalName, '.txt'), content);
  }

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal paste-text-dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="paste-text-dialog-title"
      >
        <h2 id="paste-text-dialog-title">Paste as file</h2>
        <p className="hint">
          Stage a chunk of pasted text as a file in the session. Useful for
          long briefs, transcripts, or ref material that doesn&apos;t fit in
          the chat composer.
        </p>
        <label>
          File name
          <input
            type="text"
            value={name}
            placeholder="paste-2026-05-02.txt"
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </label>
        <label>
          Content
          <textarea
            rows={10}
            value={content}
            placeholder="Paste here…"
            onChange={(e) => setContent(e.target.value)}
          />
        </label>
        <div className="row">
          <button type="button" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="primary"
            onClick={commit}
            disabled={!content.trim()}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function ensureExtension(name: string, ext: string): string {
  if (/\.[a-z0-9]+$/i.test(name)) return name;
  return `${name}${ext}`;
}
