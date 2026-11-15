/** A temporary resource/source failure is not evidence that a photo is missing. */
export class CatalogImageDeferred extends Error {
  constructor() { super("CATALOG_IMAGE_DEFERRED"); }
}

export function isImageResourceError(error: unknown): boolean {
  return error instanceof CatalogImageDeferred ||
    (error instanceof Error && (/memory|bad_alloc|allocation|timed?\s*out|timeout/i.test(error.message) ||
      (error as NodeJS.ErrnoException).code === "ENOMEM"));
}
