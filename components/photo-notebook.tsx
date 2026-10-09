"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { FileDrop } from "@/components/file-drop";
import { addPhoto, deletePhoto, listPhotos } from "@/lib/data/photos";
import { database, newId, type Photo } from "@/lib/db";
import { attachStream, capturePhoto, requestCamera, stopStream } from "@/lib/camera";
import { readAsDataUrl, resizeImage } from "@/lib/files";
import { useIsHydrated, useStorageStatus, useStoredQuery } from "@/lib/storage/react";

/**
 * The photo notebook: take or choose photos, caption them, save them into the browser's own
 * database, and browse or delete them in a grid that survives a reload.
 */

type QueuedItem = {
  id: string;
  /** Resized image, already a data URL — what gets written, and what the thumbnail shows. */
  dataUrl: string;
  takenAt: number;
  source: "camera" | "file";
  /** File name for a chosen photo, a friendly label for a camera one. */
  name: string;
};

function formatTaken(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function pluralPhotos(count: number): string {
  return `${count} ${count === 1 ? "photo" : "photos"}`;
}

/**
 * The camera, owned by the island rather than by a component that mounts on the click.
 *
 * The request is fired from the click on "Take photo" itself — the browser's prompt is the gesture —
 * and the granted stream sits in state here, where a StrictMode remount can never run a cleanup
 * over it. The component tree mounts once with the page; the stream arrives later.
 */
type CameraState =
  | { kind: "closed" }
  | { kind: "starting" }
  | { kind: "on"; stream: MediaStream; mirrored: boolean }
  /** Refused, missing, in use or otherwise not started: the message is the panel's content. */
  | { kind: "blocked"; message: string }
  /** Was live, then the tab hid or the track ended. Says what happened, offers the camera again. */
  | { kind: "stopped"; message: string };

/** The selfie camera is mirrored; a camera that does not report its facing keeps the requested one. */
function isMirrored(stream: MediaStream, requested: "user" | "environment"): boolean {
  const reported = stream.getVideoTracks()[0]?.getSettings().facingMode;
  if (reported === "user") return true;
  if (reported === "environment") return false;
  return requested === "user";
}

/** One queued photo with its own caption form, before it has been saved anywhere. */
function QueuedPhotoCard({
  item,
  onSave,
  onCancel,
  saving,
}: {
  item: QueuedItem;
  onSave: (caption: string) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [caption, setCaption] = useState("");
  const inputId = `caption-${item.id}`;
  return (
    <form
      aria-label={`Caption and save queued photo ${item.name}`}
      onSubmit={(event) => {
        event.preventDefault();
        onSave(caption);
      }}
      className="flex gap-3 rounded-lg border bg-card p-3"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- a data URL of an already-resized image */}
      <img
        src={item.dataUrl}
        alt={`Queued photo ${item.name}`}
        className="h-24 w-24 shrink-0 rounded-md border object-cover"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p className="truncate text-xs text-muted-foreground">
          {item.source === "camera" ? "From camera" : item.name} · {formatTaken(item.takenAt)}
        </p>
        <div className="space-y-1.5">
          <Label htmlFor={inputId}>Caption (optional)</Label>
          <Input
            id={inputId}
            value={caption}
            onChange={(event) => setCaption(event.target.value)}
            placeholder="What is this photo of?"
            maxLength={200}
          />
        </div>
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={saving}>
            Save
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
        </div>
      </div>
    </form>
  );
}

/** One square thumbnail in the grid; a button, so Enter opens the large view. */
function PhotoGridItem({ photo, onOpen }: { photo: Photo; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={photo.caption ? `View photo: ${photo.caption}` : `View photo taken ${formatTaken(photo.takenAt)}`}
      className="group rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="aspect-square overflow-hidden rounded-lg border bg-muted transition-transform group-hover:scale-[1.02]">
        {/* eslint-disable-next-line @next/next/no-img-element -- a stored data URL, which next/image cannot load */}
        <img src={photo.dataUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
      </div>
      {photo.caption ? (
        <p className="mt-1 truncate text-sm text-foreground" title={photo.caption}>
          {photo.caption}
        </p>
      ) : null}
    </button>
  );
}

export function PhotoNotebook() {
  const hydrated = useIsHydrated();
  const { data: photos, isLoading } = useStoredQuery(database, listPhotos);
  const storageStatus = useStorageStatus(database);

  const [camera, setCamera] = useState<CameraState>({ kind: "closed" });
  const [cameraNote, setCameraNote] = useState("");
  const [capturing, setCapturing] = useState(false);
  const [queue, setQueue] = useState<QueuedItem[]>([]);
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [problems, setProblems] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const requestingRef = useRef(false);
  const cameraStream = camera.kind === "on" ? camera.stream : null;

  // Fired by the click on "Take photo" — never in an effect, so the request is the user gesture and
  // no remount can stop the stream it grants. Two clicks in flight collapse into one request.
  const openCamera = useCallback(() => {
    if (requestingRef.current) return;
    requestingRef.current = true;
    setCameraNote("");
    setCamera((current) => (current.kind === "on" || current.kind === "starting" ? current : { kind: "starting" }));
    void requestCamera({ facing: "environment" }).then((result) => {
      requestingRef.current = false;
      setCamera((current) => {
        // The visitor closed the panel while the request was in flight: take the camera back off.
        if (current.kind === "closed") {
          stopStream(result.stream);
          return current;
        }
        if (result.status !== "granted") return { kind: "blocked", message: result.message };
        return { kind: "on", stream: result.stream, mirrored: isMirrored(result.stream, "environment") };
      });
    });
  }, []);

  // One live stream: show it, and stop it when the tab hides, the camera disappears, or the visitor
  // closes the panel. It runs only when the stream changes — the island mounts with the page, when
  // there is no stream yet, so a StrictMode remount can never stop one the visitor granted.
  useEffect(() => {
    if (!cameraStream) return;
    const video = videoRef.current;
    if (video) void attachStream(video, cameraStream);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        setCamera({ kind: "stopped", message: "Camera stopped while the tab was hidden." });
        setCameraNote("Open the camera again to keep taking photos.");
      }
    };
    const onEnded = () =>
      setCamera({ kind: "stopped", message: "Camera stopped: it was disconnected or access was withdrawn." });
    const track = cameraStream.getVideoTracks()[0];
    document.addEventListener("visibilitychange", onVisibility);
    track?.addEventListener("ended", onEnded);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      track?.removeEventListener("ended", onEnded);
      if (video && video.srcObject === cameraStream) video.srcObject = null;
      stopStream(cameraStream);
    };
  }, [cameraStream]);

  async function takePhoto() {
    const video = videoRef.current;
    if (!video || camera.kind !== "on" || capturing) return;
    setCapturing(true);
    try {
      const photo = await capturePhoto(video, { maxEdge: 1600, type: "image/jpeg", quality: 0.85 });
      await queueFromBlob(photo, "camera", "Camera photo", Date.now());
      // The camera stays on: several photos in a row is the point of the panel.
      setCameraNote("Photo taken — it is queued below, ready for a caption. Take another or close the camera.");
    } catch (error) {
      setCameraNote(error instanceof Error ? error.message : "The photo could not be taken.");
    } finally {
      setCapturing(false);
    }
  }

  const saved = photos ?? [];
  const active = activeId === null ? undefined : saved.find((photo) => photo.id === activeId);

  const queueFromBlob = useCallback(async (blob: Blob, source: QueuedItem["source"], name: string, takenAt: number) => {
    try {
      // Shrink before anything keeps it: a phone photo is several megabytes otherwise.
      const resized = await resizeImage(blob, { maxEdge: 1600 });
      const dataUrl = await readAsDataUrl(resized);
      setQueue((current) => [...current, { id: newId(), dataUrl, takenAt, source, name }]);
      setProblems([]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "The photo could not be read.";
      setProblems((current) => [...current, message]);
      toast.error(message);
    }
  }, []);

  const onFilesChosen = useCallback(
    (files: File[]) => {
      for (const file of files) {
        // A file's own lastModified is when it was taken; a missing one falls back to now.
        void queueFromBlob(file, "file", file.name, file.lastModified || Date.now());
      }
    },
    [queueFromBlob],
  );

  async function saveQueued(item: QueuedItem, caption: string) {
    setSavingIds((current) => new Set(current).add(item.id));
    try {
      await addPhoto({ dataUrl: item.dataUrl, caption, takenAt: item.takenAt });
      setQueue((current) => current.filter((queued) => queued.id !== item.id));
      toast.success(caption.trim() ? `Saved “${caption.trim()}” to your notebook` : "Photo saved to your notebook");
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      // The photo stays queued, so nothing is lost and the save can be retried.
      toast.error(`Could not save the photo: ${message}. It stays queued below — try again.`);
    } finally {
      setSavingIds((current) => {
        const next = new Set(current);
        next.delete(item.id);
        return next;
      });
    }
  }

  async function deleteActive(id: string) {
    const target = saved.find((photo) => photo.id === id);
    try {
      await deletePhoto(id);
      setActiveId(null);
      toast.success(target?.caption ? `Deleted “${target.caption}”` : "Photo deleted");
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      toast.error(`Could not delete the photo: ${message}`);
    }
  }

  return (
    <div className="space-y-8">
      {storageStatus === "memory" && (
        <Alert>
          <AlertTitle>This browser will not keep your photos</AlertTitle>
          <AlertDescription>
            It refused to store data, so the notebook works but everything is gone when this tab
            closes. Photos stay in this browser only — there is no sync or sharing.
          </AlertDescription>
        </Alert>
      )}

      <section aria-labelledby="add-heading" className="grid gap-4 md:grid-cols-2">
        <h2 id="add-heading" className="sr-only">
          Add photos
        </h2>

        <div className="rounded-lg border bg-card p-4">
          <h3 className="font-medium">Take a photo</h3>
          <p className="mt-1 mb-3 text-sm text-muted-foreground">
            Opens your camera. It stays open so you can take several in a row.
          </p>
          <Button type="button" onClick={() => setCameraOpen((open) => !open)}>
            Take photo
          </Button>
          {cameraOpen && (
            <CameraCapture
              className="mt-4"
              photoOptions={{ maxEdge: 1600, type: "image/jpeg", quality: 0.85 }}
              onPhoto={(photo) => void queueFromBlob(photo, "camera", "Camera photo", Date.now())}
            />
          )}
        </div>

        <div className="rounded-lg border bg-card p-4">
          <h3 className="font-medium">Add from your device</h3>
          <p className="mt-1 mb-3 text-sm text-muted-foreground">
            Choose several at once, drop them on the zone, or paste a screenshot.
          </p>
          <FileDrop
            accept="image/*"
            multiple
            maxBytes={30 * 1024 * 1024}
            label="Add photos"
            paste
            onFiles={onFilesChosen}
          >
            or drop photos here, or paste
          </FileDrop>
          {problems.length > 0 && (
            <ul aria-live="polite" className="mt-2 space-y-1 text-sm text-destructive">
              {problems.map((problem, index) => (
                <li key={index}>{problem}</li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {queue.length > 0 && (
        <section aria-labelledby="queue-heading" className="space-y-3">
          <h2 id="queue-heading" className="text-lg font-semibold">
            Ready to save{" "}
            <span className="text-sm font-normal text-muted-foreground">
              ({pluralPhotos(queue.length)} queued)
            </span>
          </h2>
          <div className="space-y-3">
            {queue.map((item) => (
              <QueuedPhotoCard
                key={item.id}
                item={item}
                saving={savingIds.has(item.id)}
                onSave={(caption) => void saveQueued(item, caption)}
                onCancel={() => setQueue((current) => current.filter((queued) => queued.id !== item.id))}
              />
            ))}
          </div>
        </section>
      )}

      <section aria-labelledby="grid-heading" className="space-y-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 id="grid-heading" className="text-lg font-semibold">
            Your notebook
          </h2>
          <p aria-live="polite" className="text-sm text-muted-foreground">
            {hydrated && !isLoading ? pluralPhotos(saved.length) : ""}
          </p>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {[0, 1, 2, 3].map((index) => (
              <Skeleton key={index} className="aspect-square rounded-lg" />
            ))}
          </div>
        ) : saved.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            Your notebook is empty. Take a photo or add one from your device above — it is saved in
            this browser and stays here after a reload.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {saved.map((photo) => (
              <PhotoGridItem key={photo.id} photo={photo} onOpen={() => setActiveId(photo.id)} />
            ))}
          </div>
        )}
      </section>

      <Dialog
        open={active !== undefined}
        onOpenChange={(open) => {
          if (!open) setActiveId(null);
        }}
      >
        {active && (
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{active.caption || "Photo"}</DialogTitle>
              <DialogDescription>Taken {formatTaken(active.takenAt)}</DialogDescription>
            </DialogHeader>
            {/* eslint-disable-next-line @next/next/no-img-element -- a stored data URL, which next/image cannot load */}
            <img
              src={active.dataUrl}
              alt={active.caption || `Photo taken ${formatTaken(active.takenAt)}`}
              className="mx-auto max-h-[60vh] w-auto rounded-lg border object-contain"
            />
            {active.caption ? (
              <p className="text-sm text-foreground">{active.caption}</p>
            ) : (
              <p className="text-sm italic text-muted-foreground">No caption</p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setActiveId(null)}>
                Close
              </Button>
              <Button type="button" variant="destructive" onClick={() => void deleteActive(active.id)}>
                Delete photo
              </Button>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}