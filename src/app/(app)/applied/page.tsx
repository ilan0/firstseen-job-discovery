import { QueuePage } from "@/components/jobs/queue-page";
import { requireOwner } from "@/lib/auth/owner";
import { listQueue } from "@/lib/jobs/queue";

export default async function AppliedPage() {
  const owner = await requireOwner();
  return (
    <QueuePage
      description="A lightweight record of applications submitted through official employer pages."
      jobs={await listQueue(owner.id, "applied")}
      status="applied"
      title="Applied jobs"
    />
  );
}
