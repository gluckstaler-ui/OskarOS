/**
 * @vitest-environment jsdom
 *
 * Tests for components/chat/DiscoveryQuestionsCard.tsx (Ralph 2026-05-04).
 *
 * Locks the formatted-answer payload shape. CD's next turn references
 * answers by number, so the markdown structure has to stay stable.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent, screen } from '@testing-library/react'
import { DiscoveryQuestionsCard } from './DiscoveryQuestionsCard'

describe('DiscoveryQuestionsCard', () => {
  it('renders nothing when questions array is empty', () => {
    const onSubmit = vi.fn()
    const { container } = render(<DiscoveryQuestionsCard questions={[]} onSubmit={onSubmit} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders one input per question', () => {
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
