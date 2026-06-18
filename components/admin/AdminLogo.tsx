'use client'

// ============================================================================
// AdminLogo — admin.html's left-slot fill for <TopBar>.
// Wraps the shared <Logo> wordmark with admin's suffix.
// ============================================================================

import { Logo } from '../Logo'

export function AdminLogo() {
  return <Logo suffix="ADMIN" />
}
