/**
 * @vitest-environment jsdom
 *
 * Tests for components/chat/ConfirmUnderstandingCard.tsx (Ralph 2026-05-04).
 *
 * Locks the readyToGenerate gating: button only renders when true and
 * dispatches exactly once. Button hidden when false (informational mode).
 */

import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent, screen } from '@testing-library/react'
import { ConfirmUnderstandingCard } from './ConfirmUnderstandingCard'

describe('ConfirmUnderstandingCard', () => {
  it('renders the summary', () => {
    render(
      <ConfirmUnderstandingCard
        summary="A coffee bar in Vienna's 7th."
        readyToGenerate={false}
      />,
    )
    expect(screen.getByText(/coffee bar/i)).toBeTruthy()
  })

  it('hides the build button when readyToGenerate=false', () => {
    const onBuild = vi.fn()
    render(
      <ConfirmUnderstandingCard
        summary="Summary."
        readyToGenerate={false}
        onBuild={onBuild}
      />,
    )
    const button = screen.queryByRole('button', { name: /build/i })
    expect(button).toBeNull()
  })

  it('shows the build button when readyToGenerate=true and onBuild is provided', () => {
    const onBuild = vi.fn()
    render(
      <ConfirmUnderstandingCard
        summary="Summary."
        readyToGenerate={true}
        onBuild={onBuild}
      />,
    )
    expect(screen.getByRole('button', { name: /build it/i })).toBeTruthy()
  })

  it('hides the build button when onBuild is missing even if readyToGenerate=true', () => {
    render(
      <ConfirmUnderstandingCard
        summary="Summary."
        readyToGenerate={true}
      />,
    )
    expect(screen.queryByRole('button', { name: /build/i })).toBeNull()
  })

  it('fires onBuild exactly once when clicked', () => {
    const onBuild = vi.fn()
    render(
      <ConfirmUnderstandingCard
        summary="Summary."
        readyToGenerate={true}
        onBuild={onBuild}
      />,
    )
    const button = screen.getByRole('button', { name: /build it/i })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(onBuild).toHaveBeenCalledTimes(1)
  })

  it('changes the button label after click', () => {
    const onBuild = vi.fn()
    render(
      <ConfirmUnderstandingCard
        summary="Summary."
        readyToGenerate={true}
        onBuild={onBuild}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /build it/i }))
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
        onBuild={() => {}}
      />,
    )
    expect(screen.getByText(/ready to build/i)).toBeTruthy()
  })
})
