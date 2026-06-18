'use client'

// ============================================================================
// CrmLogo — CRM's left-slot fill for <TopBar>.
// Wraps the shared <Logo> wordmark with CRM's suffix.
// ============================================================================

import { Logo } from '../Logo'

export function CrmLogo() {
  return <Logo suffix="LOTSE" />
}
