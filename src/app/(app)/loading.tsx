import { Skeleton } from "@/components/ui/primitives";

// Shown inside the app shell the moment a link is clicked, while the screen
// loads. Having it also lets links prefetch the screen's code ahead of the click.
export default function Loading() {
  return (
    <div role="status" aria-label="Loading" className="mx-auto grid max-w-[1500px] grid-cols-[minmax(0,1fr)] gap-6 px-4 py-8 sm:px-8 lg:grid-cols-[200px_1fr]">
      <Skeleton className="hidden h-80 rounded-[20px] lg:block" />
      <Skeleton className="h-[70vh] rounded-[24px]" />
    </div>
  );
}
