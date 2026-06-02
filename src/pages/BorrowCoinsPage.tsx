import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { formatDateTime } from '../lib/format';
import type { BorrowRequestRow, BorrowUser } from '../types';

function formatCoins(value: number) {
  return Number(value).toLocaleString('en-AU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function statusLabel(status: BorrowRequestRow['status']) {
  switch (status) {
    case 'completed':
      return 'Completed';
    case 'declined':
      return 'Declined';
    case 'pending':
      return 'Pending';
  }
}

export function BorrowCoinsPage() {
  const { refreshProfile } = useAuth();
  const [users, setUsers] = useState<BorrowUser[]>([]);
  const [requests, setRequests] = useState<BorrowRequestRow[]>([]);
  const [selectedLenderId, setSelectedLenderId] = useState('');
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [actionRequestId, setActionRequestId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pendingIncoming = useMemo(
    () => requests.filter((request) => request.is_incoming && request.status === 'pending'),
    [requests]
  );
  const outstandingOutgoing = useMemo(
    () => requests.filter((request) => request.is_outgoing && request.status === 'completed' && request.outstanding_amount > 0),
    [requests]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const [{ data: usersData, error: usersError }, { data: requestsData, error: requestsError }] = await Promise.all([
      supabase.rpc('get_borrow_users'),
      supabase.rpc('get_coin_borrow_requests'),
    ]);

    if (usersError || requestsError) {
      setError(usersError?.message ?? requestsError?.message ?? 'Could not load borrow requests.');
      setLoading(false);
      return;
    }

    const nextUsers = (usersData ?? []) as BorrowUser[];
    setUsers(nextUsers);
    setRequests((requestsData ?? []) as BorrowRequestRow[]);
    setSelectedLenderId((current) => current || nextUsers[0]?.user_id || '');
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function sendRequest(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const numericAmount = Number(amount || 0);

      if (!selectedLenderId) throw new Error('Select a user to borrow from.');
      if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
        throw new Error('Enter an amount greater than 0.');
      }

      const { error: requestError } = await supabase.rpc('request_coin_borrow', {
        p_lender_id: selectedLenderId,
        p_amount: numericAmount,
      });

      if (requestError) throw requestError;

      setAmount('');
      setMessage('Borrow request sent.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send borrow request.');
    } finally {
      setSaving(false);
    }
  }

  async function handleRequest(requestId: string, action: 'approve' | 'decline') {
    setActionRequestId(requestId);
    setError(null);
    setMessage(null);

    try {
      const rpcName = action === 'approve' ? 'approve_coin_borrow_request' : 'decline_coin_borrow_request';
      const { error: actionError } = await supabase.rpc(rpcName, {
        p_request_id: requestId,
      });

      if (actionError) throw actionError;

      setMessage(action === 'approve' ? 'Coins transferred and request completed.' : 'Borrow request declined.');
      await refreshProfile();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update borrow request.');
    } finally {
      setActionRequestId(null);
    }
  }

  async function returnBorrowedCoins(requestId: string) {
    setActionRequestId(requestId);
    setError(null);
    setMessage(null);

    try {
      const { error: repayError } = await supabase.rpc('repay_coin_borrow_request', {
        p_request_id: requestId,
      });

      if (repayError) throw repayError;

      setMessage('Borrowed coins returned.');
      await refreshProfile();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not return borrowed coins.');
    } finally {
      setActionRequestId(null);
    }
  }

  if (loading) return <p className="page-message">Loading borrow requests…</p>;

  return (
    <section className="borrow-layout">
      <form className="panel-card" onSubmit={sendRequest}>
        <p className="eyebrow">Borrow coins</p>
        <h2>Request coins</h2>

        <label className="field-label">
          Borrow from
          <select value={selectedLenderId} onChange={(event) => setSelectedLenderId(event.target.value)}>
            {users.length === 0 ? (
              <option value="">No users available</option>
            ) : (
              users.map((user) => (
                <option key={user.user_id} value={user.user_id}>
                  {user.username} ({formatCoins(user.balance)} coins)
                </option>
              ))
            )}
          </select>
        </label>

        <label className="field-label">
          Amount
          <input
            type="number"
            min="1"
            step="0.01"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="e.g. 10"
          />
        </label>

        <button className="primary-button full-width" disabled={saving || users.length === 0}>
          {saving ? 'Sending…' : 'Send request'}
        </button>

        {message && <p className="success-text">{message}</p>}
        {error && <p className="error-text">{error}</p>}
      </form>

      <div className="panel-card wide">
        <div className="section-heading compact">
          <div>
            <p className="eyebrow">Return coins</p>
            <h2>Outstanding borrowed coins</h2>
          </div>
          <button className="ghost-button dark" type="button" onClick={load}>Refresh</button>
        </div>

        {outstandingOutgoing.length === 0 ? (
          <p className="muted-text">No borrowed coins to return.</p>
        ) : (
          <div className="borrow-request-list">
            {outstandingOutgoing.map((request) => (
              <div className="borrow-request-row" key={request.request_id}>
                <div>
                  <strong>{request.lender_username}</strong>
                  <span>Owing {formatCoins(request.outstanding_amount)} coins from {formatCoins(request.amount)} borrowed.</span>
                </div>
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => returnBorrowedCoins(request.request_id)}
                  disabled={actionRequestId === request.request_id}
                >
                  Return coins
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="borrow-history">
          <div className="section-heading compact">
            <div>
              <p className="eyebrow">Incoming</p>
              <h2>Requests from others</h2>
            </div>
          </div>

          {pendingIncoming.length === 0 ? (
            <p className="muted-text">No pending requests for you.</p>
          ) : (
            <div className="borrow-request-list">
              {pendingIncoming.map((request) => (
                <div className="borrow-request-row" key={request.request_id}>
                  <div>
                    <strong>{request.borrower_username}</strong>
                    <span>Requested {formatCoins(request.amount)} coins on {formatDateTime(request.requested_at)}</span>
                  </div>
                  <div className="admin-actions">
                    <button
                      className="ghost-button dark"
                      type="button"
                      onClick={() => handleRequest(request.request_id, 'decline')}
                      disabled={actionRequestId === request.request_id}
                    >
                      Decline
                    </button>
                    <button
                      className="primary-button"
                      type="button"
                      onClick={() => handleRequest(request.request_id, 'approve')}
                      disabled={actionRequestId === request.request_id}
                    >
                      Approve
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="borrow-history">
          <h3>Borrow history</h3>
          {requests.length === 0 ? (
            <p className="muted-text">No borrow requests yet.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Borrower</th>
                    <th>Lender</th>
                    <th>Amount</th>
                    <th>Outstanding</th>
                    <th>Status</th>
                    <th>Requested</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((request) => (
                    <tr key={request.request_id}>
                      <td>{request.borrower_username}{request.is_outgoing ? ' (you)' : ''}</td>
                      <td>{request.lender_username}{request.is_incoming ? ' (you)' : ''}</td>
                      <td className="coin-balance">{formatCoins(request.amount)} coins</td>
                      <td className={request.outstanding_amount > 0 ? 'negative' : 'neutral'}>{formatCoins(request.outstanding_amount)} coins</td>
                      <td>
                        <span className={`borrow-status ${request.status}`}>{statusLabel(request.status)}</span>
                      </td>
                      <td>{formatDateTime(request.requested_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
