import { slugify } from "@booking/shared";
import { AppError } from "./app-error.js";

/**
 * Resolves the slug for a create/update:
 *  - explicit slug → must be free, otherwise 409;
 *  - no slug → derived from the name, suffixed -2, -3 … until free.
 * `taken(slug)` must ignore the record being updated.
 */
export async function resolveSlug(
  explicit: string | undefined,
  name: string,
  taken: (slug: string) => Promise<boolean>,
): Promise<string> {
  if (explicit) {
    if (await taken(explicit)) throw AppError.conflict(`The slug "${explicit}" is already in use`);
    return explicit;
  }
  const base = slugify(name) || "item";
  if (!(await taken(base))) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base.slice(0, 75)}-${i}`;
    if (!(await taken(candidate))) return candidate;
  }
  throw AppError.conflict("Could not generate a unique slug; please provide one");
}
