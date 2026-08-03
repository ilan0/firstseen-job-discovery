import { QueuePage } from "@/components/jobs/queue-page";
import { requireOwner } from "@/lib/auth/owner";
import { listQueue } from "@/lib/jobs/queue";

export default async function SavedPage() {
  const owner = await requireOwner();
  return (
    <QueuePage
      description="Good opportunities you want to revisit before applying."
      jobs={await listQueue(owner.id, "saved")}
      status="saved"
      title="Saved jobs"
    />
  );
}
