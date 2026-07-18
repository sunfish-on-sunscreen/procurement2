-- Phase 7.5: Reporting periods are now auto-created from uploaded data, so the
-- previously seeded periods (and any data tagged to them) are removed here.
-- This is intentionally destructive: all imported data + periods are wiped and
-- the user re-uploads. CASCADE clears the FK-dependent data tables.
TRUNCATE TABLE
  "Supplier",
  "Purchase",
  "SupplierMetric",
  "Import",
  "AnalysisResult",
  "ReportingPeriod"
RESTART IDENTITY CASCADE;
