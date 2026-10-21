"use client";
import { Button, ErrorState } from "@projectos/ui";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const forbidden = error.message === "forbidden";
  return (
    <ErrorState
      title={forbidden ? "You don’t have access to this page" : "This page couldn’t be loaded"}
      message={forbidden ? "Ask an administrator if you need this permission." : `Try again. If it keeps happening, share reference ${error.digest ?? "n/a"} with support.`}
      action={
        !forbidden && (
          <Button variant="secondary" size="sm" onClick={reset}>
            Retry
          </Button>
        )
      }
    />
  );
}
