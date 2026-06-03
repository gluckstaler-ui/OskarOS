/**
 * @vitest-environment jsdom
 *
 * Tests for components/chat/ConfirmUnderstandingCard.tsx.
 * Updated 2026-05-12 (Ralph): card rebuilt to mockup §3.5 — onBuild prop
 * replaced by onSubmit({action, freeformText}); button label changed to
 * "Looks right — build wireframes →". Tests track the new API.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent, screen } from '@testing-library/react'
import { ConfirmUnderstandingCard } from './ConfirmUnderstandingCard'

describe('ConfirmUnderstandingCard', () => {
  it('renders the summary as prose fallback when no distillation chips', () => {
    render(
      <ConfirmUnderstandingCard
        summary="A coffee bar in Vienna's 7th."
        readyToGenerate={false}
      />,
    )
    expect(screen.getByText(/coffee bar/i)).toBeTruthy()
  })

  it('hides the build CTA when readyToGenerate=false', () => {
    render(
      <ConfirmUnderstandingCard
        summary="Summary."
        readyToGenerate={false}
        onSubmit={vi.fn()}
      />,
    )
    expect(screen.queryByRole('button', { name: /build wireframes/i })).toBeNull()
  })

  it('shows the build CTA when readyToGenerate=true', () => {
    render(
      <ConfirmUnderstandingCard
        summary="Summary."
        readyToGenerate={true}
        onSubmit={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: /build wireframes/i })).toBeTruthy()
  })

  it('disables the CTA when onSubmit is missing even if readyToGenerate=true', () => {
    render(
      <ConfirmUnderstandingCard
        summary="Summary."
        readyToGenerate={true}
      />,
    )
    const button = screen.getByRole('button', { name: /build wireframes/i }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })

  it('fires onSubmit exactly once when clicked', () => {
    const onSubmit = vi.fn()
    render(
      <ConfirmUnderstandingCard
        summary="Summary."
        readyToGenerate={true}
        onSubmit={onSubmit}
      />,
    )
    const button = screen.getByRole('button', { name: /build wireframes/i })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledWith({ action: 'commit', freeformText: '' })
  })

  it('changes the button label after click', () => {
    render(
      <ConfirmUnderstandingCard
        summary="Summary."
        readyToGenerate={true}
        onSubmit={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /build wireframes/i }))
    expect(screen.getByRole('button', { name: /building/i })).toBeTruthy()
  })

  it('uses the "Where I am so far" header when readyToGenerate=false', () => {
    render(
      <ConfirmUnderstandingCard
        summary="Still learning."
        readyToGenerate={false}
      />,
    )
    expect(screen.getByText(/where i am so far/i)).toBeTruthy()
  })

  it('uses the "Ready to build" header when readyToGenerate=true', () => {
    render(
      <ConfirmUnderstandingCard
        summary="All set."
        readyToGenerate={true}
        onSubmit={vi.fn()}
      />,
    )
    expect(screen.getByText(/ready to build/i)).toBeTruthy()
  })

  it('renders the 4-chip distillation grid when supplied', () => {
    render(
      <ConfirmUnderstandingCard
        summary="fallback prose"
        readyToGenerate={true}
        distillation={{
          business: 'Third-wave coffee bar',
          location: "Vienna's 7th",
          customers: 'Locals first',
          voice: 'Spare, confident',
        }}
        onSubmit={vi.fn()}
      />,
    )
    expect(screen.getByText('Third-wave coffee bar')).toBeTruthy()
    expect(screen.getByText("Vienna's 7th")).toBeTruthy()
    expect(screen.getByText('Locals first')).toBeTruthy()
    expect(screen.getByText('Spare, confident')).toBeTruthy()
  })

  it('renders the weird-detail callout when supplied', () => {
    render(
      <ConfirmUnderstandingCard
        summary="fallback"
        readyToGenerate={true}
        weirdDetail="Falcon and camel — Yemeni-Austrian roaster's two homelands."
        onSubmit={vi.fn()}
      />,
    )
    expect(screen.getByText(/falcon and camel/i)).toBeTruthy()
    expect(screen.getByText(/the weird detail/i)).toBeTruthy()
  })

  it('passes freeformText to onSubmit when textarea has content', () => {
    const onSubmit = vi.fn()
    render(
      <ConfirmUnderstandingCard
        summary="Summary."
        readyToGenerate={true}
        onSubmit={onSubmit}
      />,
    )
    const textarea = screen.getByPlaceholderText(/ship the brief/i) as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'nail the contrast' } })
    fireEvent.click(screen.getByRole('button', { name: /build wireframes/i }))
    expect(onSubmit).toHaveBeenCalledWith({ action: 'commit', freeformText: 'nail the contrast' })
  })

  it('renders the still-need list on the check-in variant', () => {
    render(
      <ConfirmUnderstandingCard
        summary="Mid-discovery."
        readyToGenerate={false}
        stillNeed={['Customer profile', 'Offerings catalog']}
      />,
    )
    expect(screen.getByText(/still need/i)).toBeTruthy()
    expect(screen.getByText(/customer profile/i)).toBeTruthy()
    expect(screen.getByText(/offerings catalog/i)).toBeTruthy()
  })
})
