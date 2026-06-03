/**
 * @vitest-environment jsdom
 *
 * Tests for components/chat/DiscoveryQuestionsCard.tsx (Ralph 2026-05-04).
 * v2 expansion (Ralph 2026-05-12): branched rendering by `kind` for
 * text · textarea · radio · checkbox · select. Locks both legacy
 * `string[]` behaviour AND the new typed-question API.
 *
 * Locks the formatted-answer payload shape — CD's next turn references
 * answers by number, so the markdown structure has to stay stable.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent, screen } from '@testing-library/react'
import { DiscoveryQuestionsCard } from './DiscoveryQuestionsCard'

describe('DiscoveryQuestionsCard — legacy string[] shape', () => {
  it('renders nothing when questions array is empty', () => {
    const onSubmit = vi.fn()
    const { container } = render(<DiscoveryQuestionsCard questions={[]} onSubmit={onSubmit} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders one text input per string question', () => {
    const onSubmit = vi.fn()
    render(
      <DiscoveryQuestionsCard
        questions={['Who?', 'Where?', 'Why?']}
        onSubmit={onSubmit}
      />,
    )
    const inputs = document.querySelectorAll('input[type="text"]')
    expect(inputs.length).toBe(3)
  })

  it('shows the optional context preamble', () => {
    const onSubmit = vi.fn()
    render(
      <DiscoveryQuestionsCard
        questions={['First?']}
        context="Heads-up: this matters."
        onSubmit={onSubmit}
      />,
    )
    expect(screen.getByText(/this matters/i)).toBeTruthy()
  })

  it('disables submit when all answers are empty', () => {
    const onSubmit = vi.fn()
    render(
      <DiscoveryQuestionsCard
        questions={['Q1?', 'Q2?']}
        onSubmit={onSubmit}
      />,
    )
    const button = screen.getByRole('button', { name: /submit/i }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })

  it('submits a markdown numbered list with answers', () => {
    const onSubmit = vi.fn()
    render(
      <DiscoveryQuestionsCard
        questions={['Who is your customer?', 'What do you sell?']}
        onSubmit={onSubmit}
      />,
    )
    const inputs = document.querySelectorAll('input[type="text"]')
    fireEvent.change(inputs[0], { target: { value: 'Locals' } })
    fireEvent.change(inputs[1], { target: { value: 'Coffee' } })

    const button = screen.getByRole('button', { name: /submit/i })
    fireEvent.click(button)

    expect(onSubmit).toHaveBeenCalledTimes(1)
    const payload = onSubmit.mock.calls[0][0] as string
    expect(payload).toContain('1. **Who is your customer?** — Locals')
    expect(payload).toContain('2. **What do you sell?** — Coffee')
    expect(payload).toMatch(/^\*\*My answers:\*\*/)
  })

  it('marks unanswered questions as "(no answer)"', () => {
    const onSubmit = vi.fn()
    render(
      <DiscoveryQuestionsCard
        questions={['Q1?', 'Q2?']}
        onSubmit={onSubmit}
      />,
    )
    const inputs = document.querySelectorAll('input[type="text"]')
    fireEvent.change(inputs[0], { target: { value: 'Yes' } })
    // leave inputs[1] blank
    fireEvent.click(screen.getByRole('button', { name: /submit/i }))
    const payload = onSubmit.mock.calls[0][0] as string
    expect(payload).toContain('1. **Q1?** — Yes')
    expect(payload).toContain('2. **Q2?** — (no answer)')
  })

  it('disables itself after submit so it cannot fire twice', () => {
    const onSubmit = vi.fn()
    render(
      <DiscoveryQuestionsCard
        questions={['Q?']}
        onSubmit={onSubmit}
      />,
    )
    const inputs = document.querySelectorAll('input[type="text"]')
    fireEvent.change(inputs[0], { target: { value: 'A' } })
    const button = screen.getByRole('button', { name: /submit/i })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })
})

describe('DiscoveryQuestionsCard — typed-question shape', () => {
  it('renders a textarea when kind=textarea', () => {
    render(
      <DiscoveryQuestionsCard
        questions={[{ kind: 'textarea', prompt: 'Who is the customer?', placeholder: 'A person, not a demographic' }]}
        onSubmit={vi.fn()}
      />,
    )
    const ta = document.querySelector('textarea')
    expect(ta).toBeTruthy()
    expect(ta?.getAttribute('placeholder')).toBe('A person, not a demographic')
  })

  it('renders radio options as a .radio-row and submits the selected value', () => {
    const onSubmit = vi.fn()
    render(
      <DiscoveryQuestionsCard
        questions={[
          {
            kind: 'radio',
            prompt: 'Who comes here?',
            options: ['Locals only', 'Tourists only', 'Both'],
          },
        ]}
        onSubmit={onSubmit}
      />,
    )
    const radios = document.querySelectorAll('input[type="radio"]')
    expect(radios.length).toBe(3)
    fireEvent.click(radios[1])
    fireEvent.click(screen.getByRole('button', { name: /submit/i }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
    const payload = onSubmit.mock.calls[0][0] as string
    expect(payload).toContain('1. **Who comes here?** — Tourists only')
  })

  it('renders checkbox options and comma-joins selections', () => {
    const onSubmit = vi.fn()
    render(
      <DiscoveryQuestionsCard
        questions={[
          {
            kind: 'checkbox',
            prompt: 'What do they order?',
            options: ['Qahwa', 'Pastries', 'Lunch'],
          },
        ]}
        onSubmit={onSubmit}
      />,
    )
    const checkboxes = document.querySelectorAll('input[type="checkbox"]')
    expect(checkboxes.length).toBe(3)
    fireEvent.click(checkboxes[0])
    fireEvent.click(checkboxes[2])
    fireEvent.click(screen.getByRole('button', { name: /submit/i }))
    const payload = onSubmit.mock.calls[0][0] as string
    expect(payload).toContain('1. **What do they order?** — Qahwa, Lunch')
  })

  it('renders a select with non-empty options and submits the chosen value', () => {
    const onSubmit = vi.fn()
    render(
      <DiscoveryQuestionsCard
        questions={[
          {
            kind: 'select',
            prompt: 'Price ceiling',
            options: ['under €5', '€5–€10', '€10–€20', 'over €20'],
            defaultValue: '€5–€10',
          },
        ]}
        onSubmit={onSubmit}
      />,
    )
    const select = document.querySelector('select') as HTMLSelectElement
    expect(select).toBeTruthy()
    expect(select.value).toBe('€5–€10')
    fireEvent.change(select, { target: { value: '€10–€20' } })
    fireEvent.click(screen.getByRole('button', { name: /submit/i }))
    const payload = onSubmit.mock.calls[0][0] as string
    expect(payload).toContain('1. **Price ceiling** — €10–€20')
  })

  it('mixed-input form: text + textarea + radio + select all in one card', () => {
    const onSubmit = vi.fn()
    render(
      <DiscoveryQuestionsCard
        questions={[
          { kind: 'text', prompt: 'Business name?' },
          { kind: 'textarea', prompt: 'Customer?' },
          { kind: 'radio', prompt: 'Who comes?', options: ['Locals', 'Tourists', 'Both'] },
          { kind: 'select', prompt: 'Price?', options: ['low', 'mid', 'high'] },
        ]}
        onSubmit={onSubmit}
      />,
    )
    expect(document.querySelectorAll('input[type="text"]').length).toBe(1)
    expect(document.querySelectorAll('textarea').length).toBe(1)
    expect(document.querySelectorAll('input[type="radio"]').length).toBe(3)
    expect(document.querySelectorAll('select').length).toBe(1)
  })

  it('shows red * indicator when required=true', () => {
    render(
      <DiscoveryQuestionsCard
        questions={[{ kind: 'text', prompt: 'Business name?', required: true }]}
        onSubmit={vi.fn()}
      />,
    )
    expect(screen.getByLabelText(/required/i)).toBeTruthy()
  })

  it('blocks submit and shows a hint when a required field is empty', () => {
    const onSubmit = vi.fn()
    render(
      <DiscoveryQuestionsCard
        questions={[
          { kind: 'text', prompt: 'Business name?', required: true },
          { kind: 'text', prompt: 'Anything else?' },
        ]}
        onSubmit={onSubmit}
      />,
    )
    // Fill the non-required so submit isn't trivially-disabled on all-empty.
    const inputs = document.querySelectorAll('input[type="text"]')
    fireEvent.change(inputs[1], { target: { value: 'Nope' } })
    fireEvent.click(screen.getByRole('button', { name: /submit/i }))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText(/required fields/i)).toBeTruthy()
  })

  it('renders the optional progress chip when supplied', () => {
    render(
      <DiscoveryQuestionsCard
        questions={['Q?']}
        progress={{ current: 1, total: 3 }}
        onSubmit={vi.fn()}
      />,
    )
    expect(screen.getByText(/step 1 \/ 3/i)).toBeTruthy()
  })

  it('renders the optional title when supplied', () => {
    render(
      <DiscoveryQuestionsCard
        questions={['Q?']}
        title="Discovery — about FalCaMel"
        onSubmit={vi.fn()}
      />,
    )
    expect(screen.getByText(/about FalCaMel/i)).toBeTruthy()
  })

  it('coerces a malformed {question:"..."} entry to a text field (preview path safety)', () => {
    const onSubmit = vi.fn()
    render(
      <DiscoveryQuestionsCard
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        questions={[{ question: 'Legacy LLM shape?' } as any]}
        onSubmit={onSubmit}
      />,
    )
    const inputs = document.querySelectorAll('input[type="text"]')
    expect(inputs.length).toBe(1)
    expect(screen.getByText(/legacy llm shape/i)).toBeTruthy()
  })

  it('drops radio/checkbox/select entries that have no options', () => {
    render(
      <DiscoveryQuestionsCard
        questions={[
          { kind: 'text', prompt: 'Real?' },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { kind: 'radio', prompt: 'Empty radio?', options: [] } as any,
        ]}
        onSubmit={vi.fn()}
      />,
    )
    // Only the text field should render.
    expect(document.querySelectorAll('input[type="text"]').length).toBe(1)
    expect(document.querySelectorAll('input[type="radio"]').length).toBe(0)
  })
})
