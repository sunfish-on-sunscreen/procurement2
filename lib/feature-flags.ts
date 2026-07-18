// Feature flags for temporarily hiding UI surfaces without deleting them.
//
// SHOW_METHODOLOGY: the standalone /methodology page (nav link + route).
// Flip to `true` to restore — the page and its nav entry are both intact on
// disk and gated only by this flag. Does NOT affect the report's Methodology
// appendix section, which is a separate surface.
export const SHOW_METHODOLOGY = false;
