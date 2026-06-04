export function BalanceBadge({
  balance,
  owingBalance,
  label = 'Balance',
}: {
  balance: number;
  owingBalance?: number;
  label?: string;
}) {
  return (
    <div className="balance-badge" title="Remaining prediction balance">
      <div>
        <span>{label}</span>
        <strong>{balance + ' coins'}</strong>
      </div>
      {owingBalance !== undefined && (
        <div>
          <span>Owing</span>
          <strong>{owingBalance + ' coins'}</strong>
        </div>
      )}
    </div>
  );
}
