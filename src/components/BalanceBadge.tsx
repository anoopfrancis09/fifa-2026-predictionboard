export function BalanceBadge({ balance, owingBalance }: { balance: number; owingBalance: number }) {
  return (
    <div className="balance-badge" title="Remaining prediction balance">
      <div>
        <span>Balance</span>
        <strong>{balance + ' coins'}</strong>
      </div>
      <div>
        <span>Owing</span>
        <strong>{owingBalance + ' coins'}</strong>
      </div>
    </div>
  );
}
