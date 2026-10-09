import { defineDatabase } from "@/lib/storage/database";

/**
 * This application's database: a photo notebook.
 *
 * A photo is kept as a data URL of the already-resized image (`resizeImage` runs before anything
 * is queued, longest side 1600). A data URL rather than a Blob so the JSON export carries the
 * photos with it — `JSON.stringify` turns a Blob into `{}`, which would make an export that
 * silently loses every picture.
 */
export type Photo = {
  id: string;
  /** A `data:` URL of the resized image (JPEG or PNG), ready for an `<img src>`. */
  dataUrl: string;
  /** Optional caption, as typed. Empty string means no caption. */
  caption: string;
  /**
   * Epoch millis: the moment the shutter fired for a camera photo, or the file's own
   * `lastModified` for one chosen from the device. Indexed, because the grid is ordered by it.
   */
  takenAt: number;
};

/** Ids are generated here so the data layer never depends on an auto-increment round trip. */
export function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export const database = defineDatabase<{ photos: Photo }>({
  // Part of the origin's storage identity. Renaming it does not migrate anything — it points the
  // application at a different, empty database and abandons the old one in place. That is exactly
  // what you want on a first build, and never what you want afterwards.
  name: "photo-notebook",
  versions: [
    // Only the primary key and the properties queried on. `caption` and `dataUrl` are stored but
    // never filtered or sorted by, so indexing them would cost writes and buy nothing.
    { version: 1, stores: { photos: "id, takenAt" } },
  ],
  // No seed, on purpose: a photo notebook starts empty, and the empty state says so and points at
  // the two ways to fill it. Planting example photos would put pictures in someone's notebook
  // that they never took.
});
