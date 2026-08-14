/**
 * Display names for the four wards — presentation only, the data everywhere
 * keeps its codes (GENERAL/TWIN/PRIVATE/ICU). Shared by the ward board, the
 * time machine's miniature board, and the command deck's occupancy bars.
 */
export const WARD_LABELS: Record<string, string> = {
  GENERAL: 'General ward',
  TWIN: 'Twin sharing',
  PRIVATE: 'Private rooms',
  ICU: 'Intensive care',
}
