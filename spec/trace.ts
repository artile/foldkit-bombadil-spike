// Exactly 60 semantic actions, each issued and observed separately.
export const trace = Array.from({ length: 5 }, () => [
  'search-all', 'delay', 'success-newest', 'next', 'delay', 'success-newest',
  'previous', 'delay', 'success-newest', 'search-b', 'delay', 'success-newest',
]).flat()
