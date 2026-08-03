import { QueuePage } from "@/components/jobs/queue-page";
import { requireOwner } from "@/lib/auth/owner";
import { listQueue } from "@/lib/jobs/queue";

export default async function DismissedPage() {
  const owner = await requireOwner();
  return (
    <QueuePage
      description="Dismissed jobs stay recoverable and never re-enter the active queue unless you restore them."
      jobs={await listQueue(owner.id, "dismissed")}
      status="dismissed"
      title="Dismissed jobs"
    />
  );
}
