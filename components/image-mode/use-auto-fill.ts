'use client'

/**
 * useAutoFill — sync-fill a controlled field with a computed default,
 * preserving user edits.
 *
 * Use case: image-ops bodies want the filename input PRE-POPULATED with
 * the proposed output name (`{stem}-crop.{ext}`, `{stem}-fmt.png`, etc.)
 * so the user sees what file will land instead of an empty placeholder.
 * When the source image or output format changes the suggestion should
 * update too — but NOT clobber a name the user has typed by hand.
 *
 * Strategy: track the previously-applied auto value. If the current value
 * is empty OR matches that previous auto, the field is "untouched" and we
 * apply the new auto. Otherwise the field is "dirty" and we leave it.
 *
 * @param current  Current value of the field (controlled from parent).
 * @param auto     The computed proposed value. Recompute on every relevant
 *                 dep change in the caller and pass the result here.
 * @param onChange Setter the parent uses to update the field.
 */

import { useEffect, useRef } from 'react'

export function useAutoFill(
  current: string,
  auto: string,
  onChange: (next: string) => void,
): void {
  const lastAutoRef = useRef<string>('')
  useEffect(() => {
    if (!auto) return
    // Apply when the field is empty or still matches the previous auto.
    // Both branches indicate the user hasn't customized away from us.
    if (current === '' || current === lastAutoRef.current) {
      if (current !== auto) onChange(auto)
      lastAutoRef.current = auto
    }
    // If the user typed something custom (current ≠ '' and ≠ lastAuto),
    // we don't overwrite. Their value sticks.
  }, [auto, current, onChange])
}
