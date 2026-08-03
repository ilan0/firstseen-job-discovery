import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
  sendDefaultPii: false,
  tracesSampleRate: 0.05,
  beforeSend(event) {
    delete event.request;
    if (event.exception?.values)
      for (const exception of event.exception.values)
        exception.value = `${exception.type ?? "Error"} (message redacted by FirstSeen)`;
    if (event.message) event.message = "FirstSeen captured a client error (message redacted)";
    return event;
  },
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
