"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { attachStream, capturePhoto, requestCamera, stopStream, type PhotoOptions } from "@/lib/camera";

/**
 * The camera panel for "Take photo".
 *
 * The parent renders this component in response to the click on "Take photo", so the camera is
 * requested from that user gesture — there is no second "Open camera" step. The preview stays open
 * after each capture, so several photos can be taken in a row before "Close camera" stops the
 * tracks. A refused or missing camera is a sentence on the page, never a black box, and "Try
 * again" is still there after a refusal.
 *
 * Built on `@/lib/camera` (the pattern in docs/camera.md, "Your own camera UI"): `requestCamera`
 * never throws and every outcome arrives as a status with a message fit to show as it is.
 */

type ViewState =
  | { kind: "starting" }
  | { kind: "on"; stream: MediaStream; mirrored: boolean }
  | { kind: "off" }
  | { kind: "failed"; message: string };

/** The selfie camera is mirrored; a camera that does not report its facing keeps the requested one. */
function isMirrored(stream: MediaStream, requested: "user" | "environment"): boolean {
  const reported = stream.getVideoTracks()[0]?.getSettings().facingMode;
  if (reported === "user") return true;
  if (reported === "environment") return false;
  return requested === "user";
}

function describe(state: ViewState): string {
  switch (state.kind) {
    case "starting":
      return "Starting camera…";
    case "on":
      return "Camera on";
    case "off":
      return "Camera off";
    case "failed":
      return state.message;
  }
}

type CameraCaptureProps = {
  /** Receives each photo taken. The camera stays open afterwards. */
  onPhoto: (photo: Blob) => void;
  /** Passed to `capturePhoto`: type, quality, maxEdge. */
  photoOptions?: PhotoOptions;
  className?: string;
};

export function CameraCapture({ onPhoto, photoOptions, className }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const aliveRef = useRef(true);
  const [state, setState] = useState<ViewState>({ kind: "starting" });
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const stream = state.kind === "on" ? state.stream : null;

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const open = useCallback(async () => {
    const result = await requestCamera({ facing: "environment" });
    if (!aliveRef.current) {
      stopStream(result.stream);
      return;
    }
    if (result.status !== "granted") {
      setState({ kind: "failed", message: result.message });
      return;
    }
    setNote("");
    setState({ kind: "on", stream: result.stream, mirrored: isMirrored(result.stream, "environment") });
  }, []);

  // Opened when the component mounts, which is the moment after the click on "Take photo". Every
  // state change happens inside the promise callback, not in the effect body itself.
  useEffect(() => {
    void open();
  }, [open]);

  // Everything tied to one live stream: showing it, stopping it when the tab is hidden or the
  // camera disappears, and stopping it on the way out.
  useEffect(() => {
    if (!stream) return;
    const video = videoRef.current;
    if (video) void attachStream(video, stream);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        setState({ kind: "off" });
        setNote("Camera stopped while the tab was hidden. Open it again to keep taking photos.");
      }
    };
    const onEnded = () =>
      setState({ kind: "failed", message: "Camera stopped: it was disconnected or access was withdrawn. Try again to continue." });
    const track = stream.getVideoTracks()[0];
    document.addEventListener("visibilitychange", onVisibility);
    track?.addEventListener("ended", onEnded);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      track?.removeEventListener("ended", onEnded);
      if (video && video.srcObject === stream) video.srcObject = null;
      stopStream(stream);
    };
  }, [stream]);

  async function takePhoto() {
    const video = videoRef.current;
    if (!video || state.kind !== "on") return;
    setBusy(true);
    try {
      const photo = await capturePhoto(video, photoOptions);
      onPhoto(photo);
      // The camera stays on: several photos in a row is the point of this panel.
      setNote("Photo taken — it is queued below, ready for a caption. Take another or close the camera.");
    } catch (error) {
      setNote(error instanceof Error ? error.message : "The photo could not be taken.");
    } finally {
      if (aliveRef.current) setBusy(false);
    }
  }

  const on = state.kind === "on";
  const failed = state.kind === "failed";
  const showVideo = on || state.kind === "starting";

  return (
    <div className={cn("flex w-full flex-col gap-3", className)}>
      <div
        className={cn(
          "relative w-full overflow-hidden rounded-lg border bg-muted",
          failed ? "border-destructive/60" : "border-border",
          !showVideo && "hidden",
        )}
        style={{ aspectRatio: "4 / 3" }}
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          aria-label="Camera preview"
          className="absolute inset-0 h-full w-full object-cover"
          style={on && state.mirrored ? { transform: "scaleX(-1)" } : undefined}
        />
      </div>

      <p role="status" aria-live="polite" className={cn("text-sm", failed ? "text-destructive" : "text-muted-foreground")}>
        {describe(state)}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        {on ? (
          <>
            <Button type="button" onClick={() => void takePhoto()} disabled={busy}>
              Capture photo
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setState({ kind: "off" });
                setNote("Camera off.");
              }}
            >
              Stop camera
            </Button>
          </>
        ) : (
          <Button type="button" onClick={() => void open()} disabled={state.kind === "starting"}>
            {failed ? "Try again" : "Open camera"}
          </Button>
        )}
      </div>

      {note && (
        <p aria-live="polite" className="text-sm text-muted-foreground">
          {note}
        </p>
      )}
    </div>
  );
}