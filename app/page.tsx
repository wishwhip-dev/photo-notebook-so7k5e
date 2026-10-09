import { PhotoNotebook } from "@/components/photo-notebook";

export default function Home() {
  return (
    <main className="mx-auto min-h-dvh max-w-5xl px-4 py-10 sm:px-6">
      <header className="mb-8">
        <p className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          Photo notebook
        </p>
        <h1 className="mt-1 text-4xl font-semibold tracking-tight text-balance">
          Your photos, captioned and kept
        </h1>
        <p className="mt-2 max-w-2xl text-lg text-muted-foreground">
          Take a photo or add one from your device, give it a caption, and it stays in this browser —
          no account, nothing leaves your device.
        </p>
      </header>
      <PhotoNotebook />
    </main>
  );
}