import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { functions } from "@/inngest/functions";

const automationPauseGuard = inngest.createFunction(
  {
    id: "automation-paused-guard",
    triggers: [{ event: "firstseen/system.pause.guard" }],
  },
  async () => ({ paused: true }),
);

const registeredFunctions =
  process.env.AUTOMATION_PAUSED === "true" ? [automationPauseGuard] : functions;

export const { GET, POST, PUT } = serve({ client: inngest, functions: registeredFunctions });
