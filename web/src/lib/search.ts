export const MAX_LINK_SEARCH_BYTES = 48;

export function linkSearchIsTooLong(search: string): boolean {
  return new TextEncoder().encode(search).byteLength > MAX_LINK_SEARCH_BYTES;
}
