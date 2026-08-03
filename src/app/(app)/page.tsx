import { QueuePage } from "@/components/jobs/queue-page";
import { requireOwner } from "@/lib/auth/owner";
import { listQueue } from "@/lib/jobs/queue";

export default async function MatchesPage() {
  const owner = await requireOwner();
  const jobs = await listQueue(owner.id, "active");
  return (
    <QueuePage
      description="High-precision official listings first, then a broader viable queue. Every hard exclusion is enforced before ranking."
      jobs={jobs}
      status="active"
      title="Today’s matches"
    />
  );
}
