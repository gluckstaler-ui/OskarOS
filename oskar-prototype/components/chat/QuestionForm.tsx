/**
 * QuestionFormView — interactive inline `<question-form>` UI.
 *
 * Source: external/open-design/apps/web/src/components/QuestionForm.tsx
 * Ported 2026-05-02 (FEATURE-X §1.4 WP-2.4, Phase 2 Commit A questionform).
 *
 * Adaptation
 * ----------
 * - `useT()` (i18n) stripped; English strings inlined. Restore via real i18n
 *   layer when OskarOS adopts one.
 * - `import type { ... } from '../artifacts/question-form'` becomes
 *   `import type { ... } from '@/lib/artifacts/question-form'`.
 * - Behavior preserved verbatim: lock-when-answered, max-selections cap,
 *   required-field guard, default values, direction-cards rendering with
 *   palette swatches + display/body type samples + refs.
 *
 * Pre-req (per FEATURE-X.md WP-2.4)
 * ---------------------------------
 * WP-0.2 doctrine has shipped on CD's side — CD now emits `<question-form>`
 * blocks during discovery. Until this UI lands in the chat surface, those
 * blocks render as raw XML in chat (intentional doctrine: "doctrine ships
 * before renderer; raw XML is expected output, not regression").
 */
'use client';

import * as React from 'react';
import { useMemo, useState } from 'react';
import type { DirectionCard, QuestionForm } from '@/lib/artifacts/question-form';
import { formatFormAnswers, parseSubmittedAnswers } from '@/lib/artifacts/question-form';

// Re-export so existing import sites can pull both the UI and the parse helper
// from the React module (matches OD's API shape).
export { parseSubmittedAnswers };

interface Props {
  form: QuestionForm;
  /**
   * Whether the user can still submit answers. The owning AssistantMessage
   * disables the form when the assistant turn is no longer the most recent
   * one (i.e. the user has already moved past it).
   */
  interactive: boolean;
  /**
   * Pre-existing answers — when we detect a follow-up user message that
   * begins with "[form answers — <id>]", we parse it back out and pass
   * it here so the rendered form reflects what was sent.
   */
  submittedAnswers?: Record<string, string | string[]>;
  onSubmit?: (text: string, answers: Record<string, string | string[]>) => void;
}

export function QuestionFormView({
  form,
  interactive,
  submittedAnswers,
  onSubmit,
}: Props) {
  const initial = useMemo(
    () => buildInitialState(form, submittedAnswers),
    [form, submittedAnswers],
  );
  const [answers, setAnswers] = useState<Record<string, string | string[]>>(initial);
  // Local self-lock (Ralph 2026-05-06): the parent doesn't always pass
  // `submittedAnswers` back after a successful submit (ConversationPanel
  // wires `onSubmit={(text) => onSendMessage(text)}` and never reflects
  // the answer back). Without an internal latch, a fast double-click — or
  // any re-render that re-triggers the click handler — fires `onSubmit`
  // twice and the user's answer lands twice in chat. Latching here makes
  // the form idempotent regardless of parent contract.
  const [hasSelfSubmitted, setHasSelfSubmitted] = useState(false);
  const locked = !interactive || !onSubmit || submittedAnswers !== undefined || hasSelfSubmitted;

  function update(id: string, value: string | string[]) {
    if (locked) return;
    setAnswers((prev) => ({ ...prev, [id]: value }));
  }

  function toggleCheckbox(id: string, option: string, maxSelections?: number) {
    if (locked) return;
    setAnswers((prev) => {
      const current = Array.isArray(prev[id]) ? (prev[id] as string[]) : [];
      const has = current.includes(option);
      if (!has && maxSelections !== undefined && current.length >= maxSelections) {
        return prev;
      }
      const next = has ? current.filter((v) => v !== option) : [...current, option];
      return { ...prev, [id]: next };
    });
  }

  function missingRequired(): string | null {
    for (const q of form.questions) {
      if (!q.required) continue;
      const v = answers[q.id];
      if (
        Array.isArray(v)
          ? v.length === 0
          : !(typeof v === 'string' && v.trim().length > 0)
      ) {
        return q.label;
      }
    }
    return null;
  }

  const required = form.questions.filter((q) => q.required);
  const withinSelectionLimits = form.questions.every((q) => {
    if (q.type !== 'checkbox' || q.maxSelections === undefined) return true;
    const v = answers[q.id];
    return !Array.isArray(v) || v.length <= q.maxSelections;
  });
  const ready =
    withinSelectionLimits &&
    required.every((q) => {
      const v = answers[q.id];
      return Array.isArray(v)
        ? v.length > 0
        : typeof v === 'string' && v.trim().length > 0;
    });

  function handleSubmit() {
    if (locked || !onSubmit) return;
    if (!withinSelectionLimits) return;
    const missing = missingRequired();
    if (missing) return;
    // Latch FIRST, then fire — guarantees a re-entrant call (e.g. from
    // React batching / event-listener double-fire) is short-circuited
    // before it can reach `onSubmit` again.
    setHasSelfSubmitted(true);
    onSubmit(formatFormAnswers(form, answers), answers);
  }

  return (
    <div className={`question-form${locked ? ' question-form-locked' : ''}`}>
      <div className="question-form-head">
        <span className="question-form-icon" aria-hidden>?</span>
        <div className="question-form-titles">
          <div className="question-form-title">{form.title}</div>
          {form.description ? (
            <div className="question-form-desc">{form.description}</div>
          ) : null}
        </div>
        {locked ? <span className="question-form-pill">Answered</span> : null}
      </div>
      <div className="question-form-body">
        {form.questions.map((q) => {
          const value = answers[q.id];
          return (
            <div key={q.id} className="qf-field">
              <label className="qf-label">
                <span>{q.label}</span>
                {q.required ? (
                  <span className="qf-required" aria-label="Required">*</span>
                ) : null}
              </label>
              {q.help ? <div className="qf-help">{q.help}</div> : null}
              {q.type === 'radio' && q.options ? (
                <div className="qf-options">
                  {q.options.map((opt) => (
                    <label
                      key={opt}
                      className={`qf-chip${value === opt ? ' qf-chip-on' : ''}`}
                    >
                      <input
                        type="radio"
                        name={`${form.id}-${q.id}`}
                        value={opt}
                        checked={value === opt}
                        disabled={locked}
                        onChange={() => update(q.id, opt)}
                      />
                      <span>{opt}</span>
                    </label>
                  ))}
                </div>
              ) : null}
              {q.type === 'checkbox' && q.options ? (
                <div className="qf-options">
                  {q.options.map((opt) => {
                    const arr = Array.isArray(value) ? value : [];
                    const on = arr.includes(opt);
                    const maxed =
                      q.maxSelections !== undefined &&
                      !on &&
                      arr.length >= q.maxSelections;
                    return (
                      <label
                        key={opt}
                        className={`qf-chip${on ? ' qf-chip-on' : ''}${maxed ? ' qf-chip-disabled' : ''}`}
                      >
                        <input
                          type="checkbox"
                          value={opt}
                          checked={on}
                          disabled={locked || maxed}
                          onChange={() =>
                            toggleCheckbox(q.id, opt, q.maxSelections)
                          }
                        />
                        <span>{opt}</span>
                      </label>
                    );
                  })}
                </div>
              ) : null}
              {q.type === 'select' && q.options ? (
                <select
                  className="qf-select"
                  value={typeof value === 'string' ? value : ''}
                  disabled={locked}
                  onChange={(e) => update(q.id, e.target.value)}
                >
                  <option value="" disabled>
                    Choose…
                  </option>
                  {q.options.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              ) : null}
              {q.type === 'text' ? (
                <input
                  type="text"
                  className="qf-input"
                  value={typeof value === 'string' ? value : ''}
                  placeholder={q.placeholder}
                  disabled={locked}
                  onChange={(e) => update(q.id, e.target.value)}
                />
              ) : null}
              {q.type === 'textarea' ? (
                <textarea
                  className="qf-textarea"
                  value={typeof value === 'string' ? value : ''}
                  placeholder={q.placeholder}
                  disabled={locked}
                  rows={3}
                  onChange={(e) => update(q.id, e.target.value)}
                />
              ) : null}
              {q.type === 'direction-cards' && q.cards && q.cards.length > 0 ? (
                <div className="qf-direction-cards">
                  {q.cards.map((card) => (
                    <DirectionCardView
                      key={card.id}
                      card={card}
                      formId={form.id}
                      questionId={q.id}
                      selected={value === card.id || value === card.label}
                      disabled={locked}
                      onSelect={() => update(q.id, card.id)}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="question-form-foot">
        {locked ? (
          <span className="qf-locked-note">
            {submittedAnswers
              ? 'Answers submitted'
              : 'This form is no longer interactive'}
          </span>
        ) : (
          <span className="qf-hint">Answer the required fields to continue.</span>
        )}
        {!locked ? (
          <button
            type="button"
            className="primary"
            onClick={handleSubmit}
            disabled={!ready}
            title={
              ready
                ? 'Submit answers'
                : 'Fill in required fields and respect selection limits'
            }
          >
            {form.submitLabel ?? 'Submit answers'}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function DirectionCardView({
  card,
  formId,
  questionId,
  selected,
  disabled,
  onSelect,
}: {
  card: DirectionCard;
  formId: string;
  questionId: string;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <label
      className={`qf-card${selected ? ' qf-card-on' : ''}${disabled ? ' qf-card-disabled' : ''}`}
    >
      <input
        type="radio"
        name={`${formId}-${questionId}`}
        value={card.id}
        checked={selected}
        disabled={disabled}
        onChange={() => onSelect()}
      />
      <div className="qf-card-head">
        <div className="qf-card-title">{card.label}</div>
        {selected ? <span className="qf-card-pill">Selected</span> : null}
      </div>
      {card.palette.length > 0 ? (
        <div className="qf-card-swatches" aria-hidden>
          {card.palette.slice(0, 6).map((c, i) => (
            <span
              key={i}
              className="qf-card-swatch"
              style={{ background: c }}
              title={c}
            />
          ))}
        </div>
      ) : null}
      <div className="qf-card-types" aria-hidden>
        <span
          className="qf-card-type-display"
          style={{ fontFamily: card.displayFont }}
        >
          Aa
        </span>
        <span
          className="qf-card-type-body"
          style={{ fontFamily: card.bodyFont }}
        >
          The quick brown fox jumps over the lazy dog
        </span>
      </div>
      {card.mood ? <p className="qf-card-mood">{card.mood}</p> : null}
      {card.references.length > 0 ? (
        <p className="qf-card-refs">
          <span className="qf-card-refs-label">Refs:</span>{' '}
          {card.references.slice(0, 4).join(' · ')}
        </p>
      ) : null}
    </label>
  );
}

function buildInitialState(
  form: QuestionForm,
  submitted: Record<string, string | string[]> | undefined,
): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const q of form.questions) {
    if (submitted && submitted[q.id] !== undefined) {
      out[q.id] = submitted[q.id]!;
      continue;
    }
    if (q.defaultValue !== undefined) {
      out[q.id] = q.defaultValue;
      continue;
    }
    if (q.type === 'checkbox') {
      out[q.id] = [];
    } else {
      out[q.id] = '';
    }
  }
  return out;
}

// parseSubmittedAnswers moved to lib/artifacts/question-form.ts (pure function,
// no JSX / DOM deps) and re-exported above for existing import sites.
