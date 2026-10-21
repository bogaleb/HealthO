import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-[60dvh] items-center justify-center px-4">
      <div className="text-center">
        <h1 className="text-base font-semibold">Not found</h1>
        <p className="mt-1 text-sm text-slate-600">It doesn’t exist, or you don’t have access to it.</p>
        <Link href="/home" className="mt-3 inline-block text-sm font-medium text-teal-700 underline">
          Go home
        </Link>
      </div>
    </main>
  );
}
