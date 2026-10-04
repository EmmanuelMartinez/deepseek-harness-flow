/** Query matching shared by the Customizations views. */

/**
 * Whether any of one item's searchable fields contains the query.
 * @param query - the raw search-field value; blank matches everything.
 * @param fields - the item's searchable text, in display order.
 * @returns whether the item stays visible for this query.
 */
export function matches(query: string, fields: readonly (string | undefined)[]): boolean {
  const needle = query.trim().toLowerCase()
  if (needle === '') return true
  return fields.some(field => field !== undefined && field.toLowerCase().includes(needle))
}
