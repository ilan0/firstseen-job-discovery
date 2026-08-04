export function assertApplicationReferralOrganization(
  applicationOrganizationId: string | null,
  referralOrganizationId: string,
) {
  if (!applicationOrganizationId || applicationOrganizationId !== referralOrganizationId)
    throw new Error("The selected referral belongs to a different company.");
}
