import HandwritingCanvas from "@/components/handwriting/HandwritingCanvas";

export default function WhiteboardDemo() {
  return (
    <main className="flex h-dvh min-h-96 flex-col bg-white px-4 py-5 sm:px-8">
      <header className="mb-5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Inkling</h1>
        <p className="text-sm text-neutral-500">A little room to practise.</p>
      </header>
      <HandwritingCanvas />
    </main>
  );
}
