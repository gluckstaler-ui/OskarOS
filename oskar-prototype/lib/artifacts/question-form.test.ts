/**
 * Vitest companion for `lib/artifacts/question-form.ts`.
 *
 * Coverage focus
 * --------------
 * - splitOnQuestionForms: well-formed embed, malformed JSON pass-through,
 *   unterminated tag pass-through, multiple forms in one stream,
 *   prose-around-form preservation
 * - tryParseForm: type normalization across all aliases, options parsing,
 *   maxSelections only for checkbox, defaults, direction-cards
 * - formatFormAnswers: round-trip with parseSubmittedAnswers
 */
import { describe, expect, it } from 'vitest';
import {
  splitOnQuestionForms,
  formatFormAnswers,
  parseSubmittedAnswers,
  type QuestionForm,
} from './question-form';

const TRIVIAL_FORM_BODY = `
{
  "questions": [
    { "id": "platform", "label": "Platform", "type": "radio",
      "options": ["Mobile", "Desktop", "Responsive"], "required": true },
    { "id": "audience", "label": "Audience", "type": "text",
      "placeholder": "e.g. SaaS buyers" }
  ]
}
`.trim();

describe('splitOnQuestionForms', () => {
  it('returns single text segment when no form present', () => {
    const out = splitOnQuestionForms('hello world, no form here');
    expect(out).toEqual([{ kind: 'text', text: 'hello world, no form here' }]);
  });

  it('extracts a single form with surrounding prose', () => {
    const input = `Hi! A few quick questions:\n\n<question-form id="discovery" title="Quick brief">\n${TRIVIAL_FORM_BODY}\n</question-form>\n\nThanks.`;
    const out = splitOnQuestionForms(input);
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ kind: 'text' });
    expect(out[1]).toMatchObject({ kind: 'form' });
    expect(out[2]).toMatchObject({ kind: 'text' });
    if (out[1]?.kind === 'form') {
      expect(out[1].form.id).toBe('discovery');
      expect(out[1].form.title).toBe('Quick brief');
      expect(out[1].form.questions).toHaveLength(2);
      expect(out[1].form.questions[0]?.required).toBe(true);
    }
  });

  it('keeps malformed JSON as text rather than dropping it', () => {
    const input = `<question-form id="bad" title="x">\n{ not json\n</question-form>`;
    const out = splitOnQuestionForms(input);
    expect(out).toHaveLength(1);
    expect(out[0]?.kind).toBe('text');
  });

  // Regression: inline backticked mention of `<question-form>` in prose
  // followed by a REAL block. The old parser treated the inline mention
  // as an open tag, scanned to the real block's </question-form>, failed
  // to parse the body (because it included the mention's prose + the
  // real opening tag), and consumed the WHOLE span as text — never
  // re-attempting to parse the real block. (Ralph 2026-05-06.)
  it('parses a real <question-form> block when an inline mention precedes it', () => {
    const input = [
      'Right — `AskUserQuestion` is the harness primitive; switching to the',
      'OskarOS-native `<question-form>` block which is wired to your chat.',
      '',
      `<question-form id="real" title="Three paths">`,
      `${TRIVIAL_FORM_BODY}`,
      `</question-form>`,
    ].join('\n');
    const out = splitOnQuestionForms(input);
    // Expect: prose-text segment, then the real form.
    expect(out.some((s) => s.kind === 'form')).toBe(true);
    const form = out.find((s) => s.kind === 'form');
    if (form && form.kind === 'form') {
      expect(form.form.id).toBe('real');
      expect(form.form.title).toBe('Three paths');
    }
    // The inline mention text must survive in the prose segment so the
    // user's "talking about the tag" remains readable.
    const proseConcat = out
      .filter((s): s is Extract<typeof out[number], { kind: 'text' }> => s.kind === 'text')
      .map((s) => s.text)
      .join('');
    expect(proseConcat).toContain('OskarOS-native `<question-form>`');
  });

  it('keeps unterminated <question-form> as text', () => {
    const input = `prose <question-form id="x"> { "questions": [] } and more text`;
    const out = splitOnQuestionForms(input);
    // The opener exists but no closer — entire slice from opener becomes text.
    expect(out.some((s) => s.kind === 'form')).toBe(false);
  });

  it('extracts two forms in one stream', () => {
    const input =
      `<question-form id="a" title="A">\n${TRIVIAL_FORM_BODY}\n</question-form>` +
      `between\n` +
      `<question-form id="b" title="B">\n${TRIVIAL_FORM_BODY}\n</question-form>`;
    const out = splitOnQuestionForms(input);
    const forms = out.filter((s) => s.kind === 'form');
    expect(forms).toHaveLength(2);
  });

  it('strips fenced JSON wrapper inside the form body', () => {
    const input = `<question-form id="x" title="X">\n\`\`\`json\n${TRIVIAL_FORM_BODY}\n\`\`\`\n</question-form>`;
    const out = splitOnQuestionForms(input);
    expect(out).toHaveLength(1);
    expect(out[0]?.kind).toBe('form');
  });
});

describe('type normalization', () => {
  it('normalizes radio aliases', () => {
    for (const alias of ['radio', 'single', 'choice', 'CHOICE']) {
      const input = `<question-form id="x" title="X">\n{"questions":[{"id":"q","label":"Q","type":"${alias}","options":["a"]}]}\n</question-form>`;
      const seg = splitOnQuestionForms(input)[0];
      if (seg?.kind === 'form') expect(seg.form.questions[0]?.type).toBe('radio');
      else throw new Error('expected form');
    }
  });

  it('normalizes checkbox aliases', () => {
    for (const alias of ['checkbox', 'multi', 'multiple']) {
      const input = `<question-form id="x" title="X">\n{"questions":[{"id":"q","label":"Q","type":"${alias}","options":["a"]}]}\n</question-form>`;
      const seg = splitOnQuestionForms(input)[0];
      if (seg?.kind === 'form') expect(seg.form.questions[0]?.type).toBe('checkbox');
    }
  });

  it('normalizes direction-cards aliases', () => {
    for (const alias of ['direction-cards', 'directions', 'cards', 'direction']) {
      const input = `<question-form id="x" title="X">\n{"questions":[{"id":"q","label":"Q","type":"${alias}","cards":[{"id":"c1","label":"C1"}]}]}\n</question-form>`;
      const seg = splitOnQuestionForms(input)[0];
      if (seg?.kind === 'form') expect(seg.form.questions[0]?.type).toBe('direction-cards');
    }
  });

  it('falls back to text for unknown types', () => {
    const input = `<question-form id="x" title="X">\n{"questions":[{"id":"q","label":"Q","type":"colorpicker"}]}\n</question-form>`;
    const seg = splitOnQuestionForms(input)[0];
    if (seg?.kind === 'form') expect(seg.form.questions[0]?.type).toBe('text');
  });
});

describe('maxSelections', () => {
  it('attaches only when type is checkbox', () => {
    const cb = `<question-form id="x" title="X">\n{"questions":[{"id":"q","label":"Q","type":"checkbox","options":["a","b","c"],"maxSelections":2}]}\n</question-form>`;
    const radio = `<question-form id="x" title="X">\n{"questions":[{"id":"q","label":"Q","type":"radio","options":["a","b"],"maxSelections":2}]}\n</question-form>`;
    const cbForm = splitOnQuestionForms(cb)[0];
    const radioForm = splitOnQuestionForms(radio)[0];
    if (cbForm?.kind === 'form') expect(cbForm.form.questions[0]?.maxSelections).toBe(2);
    if (radioForm?.kind === 'form') expect(radioForm.form.questions[0]?.maxSelections).toBeUndefined();
  });
});

describe('direction-cards', () => {
  it('parses card metadata', () => {
    const input = `<question-form id="x" title="X">
{
  "questions": [
    {
      "id": "vibe",
      "label": "Direction",
      "type": "direction-cards",
      "cards": [
        {
          "id": "swiss",
          "label": "Swiss Grid",
          "mood": "Disciplined and elemental.",
          "references": ["Müller-Brockmann", "Helvetica"],
          "palette": ["#000000", "#FFFFFF", "#FF0000"],
          "displayFont": "Helvetica, sans-serif",
          "bodyFont": "Helvetica, sans-serif"
        }
      ]
    }
  ]
}
</question-form>`;
    const seg = splitOnQuestionForms(input)[0];
    if (seg?.kind !== 'form') throw new Error('expected form');
    const cards = seg.form.questions[0]?.cards;
    expect(cards).toHaveLength(1);
    expect(cards?.[0]?.id).toBe('swiss');
    expect(cards?.[0]?.palette).toHaveLength(3);
    expect(cards?.[0]?.references).toEqual(['Müller-Brockmann', 'Helvetica']);
  });

  it('drops cards missing id or label', () => {
    const input = `<question-form id="x" title="X">
{
  "questions": [
    {
      "id": "vibe",
      "label": "Direction",
      "type": "direction-cards",
      "cards": [
        { "id": "ok", "label": "OK" },
        { "id": "" },
        { "label": "no-id" }
      ]
    }
  ]
}
</question-form>`;
    const seg = splitOnQuestionForms(input)[0];
    if (seg?.kind === 'form') {
      const cards = seg.form.questions[0]?.cards;
      expect(cards).toHaveLength(1);
      expect(cards?.[0]?.id).toBe('ok');
    }
  });
});

describe('formatFormAnswers / parseSubmittedAnswers round-trip', () => {
  const form: QuestionForm = {
    id: 'discovery',
    title: 'X',
    questions: [
      { id: 'platform', label: 'Platform', type: 'radio', options: ['Mobile', 'Desktop'] },
      { id: 'features', label: 'Features', type: 'checkbox', options: ['A', 'B', 'C'] },
      { id: 'note', label: 'Note', type: 'text' },
    ],
  };

  it('formats then parses back', () => {
    const formatted = formatFormAnswers(form, {
      platform: 'Mobile',
      features: ['A', 'C'],
      note: 'hello',
    });
    expect(formatted).toContain('[form answers');
    const parsed = parseSubmittedAnswers(form, formatted);
    expect(parsed).toEqual({
      platform: 'Mobile',
      features: ['A', 'C'],
      note: 'hello',
    });
  });

  it('preserves "(skipped)" as empty', () => {
    const formatted = formatFormAnswers(form, { platform: '', features: [], note: '' });
    const parsed = parseSubmittedAnswers(form, formatted);
    expect(parsed?.platform).toBe('');
    expect(parsed?.features).toEqual([]);
    expect(parsed?.note).toBe('');
  });

  it('returns null when no form-answers header', () => {
    expect(parseSubmittedAnswers(form, 'hello world')).toBeNull();
  });
});
