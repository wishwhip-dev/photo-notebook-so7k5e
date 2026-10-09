import { database, newId, type Photo } from "@/lib/db";

/** This app's queries. Components call these, never Dexie directly. */

const photos = async () => (await database.ready()).photos;

/** Every saved photo, newest first (the grid reads the same order it shows). */
export async function listPhotos(): Promise<Photo[]> {
  return (await photos()).orderBy("takenAt").reverse().toArray();
}

export type NewPhoto = {
  dataUrl: string;
  /** Optional caption. Empty string is stored as "no caption". */
  caption?: string;
  /** Epoch millis: capture time for a camera photo, the file's `lastModified` for a chosen one. */
  takenAt: number;
};

/** Write one photo. Resolves once IndexedDB has it, so the caller can toast the real outcome. */
export async function addPhoto(photo: NewPhoto): Promise<Photo> {
  const row: Photo = {
    id: newId(),
    dataUrl: photo.dataUrl,
    caption: photo.caption?.trim() ?? "",
    takenAt: photo.takenAt,
  };
  await (await photos()).add(row);
  return row;
}

/** Remove one photo by id. Resolves once it is gone. */
export async function deletePhoto(id: string): Promise<void> {
  await (await photos()).delete(id);
}
