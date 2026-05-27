export function BillingClient({
  plan,
  limits,
  usage
}: {
  plan: string;
  limits: { uploadsPerDay: number; questionsPerDay: number; storageMb: number };
  usage: { uploads: number; questions: number; storageBytes: number };
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-md border border-ink/10 p-3 text-sm">
        <p className="font-medium text-ink">Private beta access: free</p>
        <p className="text-ink/60">Internal plan label: {plan}</p>
        <p className="text-ink/60">
          Uploads today: {usage.uploads}/{limits.uploadsPerDay}
        </p>
        <p className="text-ink/60">
          Questions today: {usage.questions}/{limits.questionsPerDay}
        </p>
        <p className="text-ink/60">
          Storage: {Math.round(usage.storageBytes / (1024 * 1024))}MB / {limits.storageMb}MB
        </p>
      </div>

      <p className="text-sm text-ink/60">
        Paid billing is not active for this beta cohort.
      </p>
    </div>
  );
}
