import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-full flex-1 flex-col justify-center px-[var(--gutter)] py-16">
      <p className="text-[0.75rem] tracking-wide text-muted-foreground">404</p>
      <h1 className="mt-2 text-4xl tracking-tight text-foreground">
        Page not found
      </h1>
      <p className="mt-4 max-w-md text-[0.9375rem] text-muted-foreground">
        That address does not match a page in the font catalog.
      </p>
      <Link
        href="/"
        className="mt-6 inline-flex min-h-6 w-fit min-w-6 items-center text-foreground underline underline-offset-4"
      >
        Return to font catalog
      </Link>
    </main>
  );
}
