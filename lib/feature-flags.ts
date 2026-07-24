// Feature flags for temporarily hiding UI surfaces without deleting them.
//
// SHOW_METHODOLOGY: the standalone /methodology page (nav link + route).
// Flip to `true` to restore — the page and its nav entry are both intact on
// disk and gated only by this flag. Does NOT affect the report's Methodology
// appendix section, which is a separate surface.
//
// Re-enabled 2026-07-24: the page had accumulated content that was only ever
// reachable in source — the eleven-entry dead-metric catalogue (§9.5) and all of
// Section 10 (10.1–10.4). Those are now live; keep this true.
export const SHOW_METHODOLOGY = true;
