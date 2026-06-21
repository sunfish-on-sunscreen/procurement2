"use client";

/**
 * Jump-to-section table of contents (Batch 6c). Inline horizontal nav rendered
 * at the top of the report (editor only). Sticks to the top of the scroll area;
 * the active section (tracked by ReportDocument's IntersectionObserver) is
 * highlighted. Clicking a chip expands the section if collapsed, then smooth
 * scrolls to it. `no-print` so it never lands in the PDF.
 */
export function ReportTOC({
  sections,
  activeId,
  onSectionClick,
}: {
  sections: { id: string; label: string }[];
  activeId: string | null;
  onSectionClick: (id: string) => void;
}) {
  if (sections.length === 0) return null;
  return (
    <nav
      aria-label="Report sections"
      className="no-print sticky top-0 z-30 -mx-1 flex flex-wrap items-center gap-1 border-b bg-background/95 px-1 py-1.5 backdrop-blur"
    >
      {sections.map((s) => {
        const active = s.id === activeId;
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => onSectionClick(s.id)}
            aria-current={active ? "true" : undefined}
            className={`rounded-full px-2.5 py-1 text-xs transition-colors ${
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted"
            }`}
          >
            {s.label}
          </button>
        );
      })}
    </nav>
  );
}
