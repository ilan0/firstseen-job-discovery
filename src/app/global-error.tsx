"use client";
import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);
  return (
    <html>
      <body>
        <main
          style={{
            fontFamily: "Arial, sans-serif",
            margin: "4rem auto",
            maxWidth: "38rem",
            padding: "1rem",
            textAlign: "center",
          }}
        >
          <h1>FirstSeen is temporarily unavailable.</h1>
          <p>Your data is safe. Retry this request or return shortly.</p>
          <button onClick={reset} type="button">
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
