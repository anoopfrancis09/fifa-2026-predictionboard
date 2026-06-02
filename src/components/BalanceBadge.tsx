import { money } from '../lib/format';

export function BalanceBadge({ balance }: { balance: number }) {
  return (
    <div className="balance-badge" title="Remaining prediction balance">
      <span>Balance</span>
      <strong>{balance + ' coins'}</strong>
    </div>
  );
}
