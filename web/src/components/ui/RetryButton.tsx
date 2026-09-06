import { Button } from "./Button";

export function RetryButton({
  onRetry,
  loading = false,
}: {
  onRetry: () => void;
  loading?: boolean;
}) {
  return (
    <Button variant="ghost" size="sm" loading={loading} onClick={onRetry}>
      Try again
    </Button>
  );
}
