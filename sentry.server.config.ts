import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enabled: Boolean(process.env.SENTRY_DSN),
  sendDefaultPii: false,
  tracesSampleRate: 0.1,
  beforeSend(event) {
    delete event.request;
    if (event.exception?.values)
      for (const exception of event.exception.values)
        exception.value = `${exception.type ?? "Error"} (message redacted by FirstSeen)`;
    if (event.message) event.message = "FirstSeen captured a server error (message redacted)";
    return event;
  },
});
