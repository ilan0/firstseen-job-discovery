import { Bookmark, BriefcaseBusiness, RotateCcw, X } from "lucide-react";
import { transitionQueue } from "@/app/(app)/jobs/actions";
import { SubmitButton } from "@/components/forms/submit-button";
import type { QueueStatus } from "@/lib/jobs/queue";

const actions = [
  { status: "saved" as const, label: "Save for later", icon: Bookmark },
  { status: "applied" as const, label: "Mark as applied", icon: BriefcaseBusiness },
  { status: "dismissed" as const, label: "Dismiss", icon: X },
];

function ActionForm({
  jobId,
  rowVersion,
  status,
  label,
  icon: Icon,
}: {
  jobId: string;
  rowVersion: number;
  status: QueueStatus;
  label: string;
  icon: typeof Bookmark;
}) {
  return (
    <form action={transitionQueue}>
      <input name="jobId" type="hidden" value={jobId} />
      <input name="rowVersion" type="hidden" value={rowVersion} />
      <input name="status" type="hidden" value={status} />
      <SubmitButton
        className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/25 px-4 text-sm font-black text-white transition hover:bg-white/10"
        pendingLabel="Updating…"
        type="submit"
      >
        <Icon aria-hidden="true" size={16} /> {label}
      </SubmitButton>
    </form>
  );
}

export function JobActions({
  jobId,
  rowVersion,
  status,
  officiallyOpen,
}: {
  jobId: string;
  rowVersion: number | null;
  status: QueueStatus | null;
  officiallyOpen: boolean;
}) {
  if (!status || !rowVersion) return null;
  return (
    <div aria-label="Job actions" className="mt-3 flex flex-wrap gap-2">
      {status === "active" ? (
        actions.map((action) => (
          <ActionForm jobId={jobId} key={action.status} rowVersion={rowVersion} {...action} />
        ))
      ) : officiallyOpen ? (
        <ActionForm
          icon={RotateCcw}
          jobId={jobId}
          label="Restore to active"
          rowVersion={rowVersion}
          status="active"
        />
      ) : null}
    </div>
  );
}
