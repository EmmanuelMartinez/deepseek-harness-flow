/** The payload one in-app file-tree drag carries for a reference drop target. */

/**
 * MIME type marking a drag that carries a workspace path rather than operating
 * system files. A drop target reads it before it considers `Files`, so an
 * in-app drag becomes a reference instead of an attachment.
 */
export const FILE_PATH_DRAG_MIME = 'application/x-dsh-path'

/**
 * Mark one started drag as carrying a workspace path.
 * @param dataTransfer - the drag event's transfer object.
 * @param path - the path the source names, as its own surface shows it.
 */
export function writeFilePathDrag(dataTransfer: DataTransfer, path: string): void {
  dataTransfer.setData(FILE_PATH_DRAG_MIME, path)
  // The fallback keeps the drag meaningful in a target that only reads text,
  // and matches the `@` mention the reference inserts.
  dataTransfer.setData('text/plain', `@${path}`)
}

/**
 * Read the workspace path one drag carries.
 * @param dataTransfer - the drop event's transfer object, when it has one.
 * @returns the carried path, or undefined when this drag carries none.
 */
export function readFilePathDrag(dataTransfer: DataTransfer | null): string | undefined {
  if (dataTransfer === null || !dataTransfer.types.includes(FILE_PATH_DRAG_MIME)) return undefined
  const path = dataTransfer.getData(FILE_PATH_DRAG_MIME)
  return path === '' ? undefined : path
}
