import { useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { choiceLabel, choiceWeight, closeTime, formatDateTime, isBoardClosed, money, weightLabel } from '../lib/format';
import type { Match, Prediction, PredictionChoice } from '../types';

const choices: PredictionChoice[] = ['team_a', 'draw', 'team_b'];

export function MatchCard({ match, prediction, onChanged }: { match: Match; prediction?: Prediction; onChanged: () => Promise<void> }) {
  const { profile, refreshProfile } = useAuth();
  const closed = isBoardClosed(match);
  const [choice, setChoice] = useState<PredictionChoice>(prediction?.choice ?? 'team_a');
  const [amount, setAmount] = useState(prediction?.amount?.toString() ?? '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const currentStake = prediction?.amount ?? 0;
  const availableForThisMatch = useMemo(() => (profile?.balance ?? 0) + currentStake, [profile?.balance, currentStake]);
  const numericAmount = Number(amount || 0);
  const selectedWeight = choiceWeight(choice, match);
  const possibleReturn = numericAmount > 0 ? numericAmount * selectedWeight : 0;
  const possibleProfit = possibleReturn - numericAmount;
  const insufficientBalance = numericAmount > availableForThisMatch;

  async function submitPrediction() {
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      if (!profile) throw new Error('You must be logged in.');
      if (numericAmount <= 0) throw new Error('Enter a bid greater than $0.');
      if (insufficientBalance) throw new Error(`You only have ${availableForThisMatch + ' coins'} available for this match.`);

      const { error: rpcError } = await supabase.rpc('place_prediction', {
        p_match_id: match.id,
        p_choice: choice,
        p_amount: numericAmount,
      });

      if (rpcError) throw rpcError;

      setMessage('Prediction saved.');
      await refreshProfile();
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save prediction.');
    } finally {
      setSaving(false);
    }
  }

  const statusText = match.status === 'finished'
    ? 'Finished'
    : closed
      ? 'Closed'
      : 'Open';

  return (
    <article className={`match-card ${closed ? 'is-closed' : ''} ${prediction ? 'is-bidded' : ''}`}>
      <div className="match-topline">
        <div className="match-status-group">
          <span className={`status-pill ${statusText.toLowerCase()}`}>{statusText}</span>
          {prediction && <span className="bid-status-pill">Already bid</span>}
        </div>
        <span>{formatDateTime(match.match_time)}</span>
      </div>

      <div className="teams">
        <strong>{match.team_a}</strong>
        <span>vs</span>
        <strong>{match.team_b}</strong>
      </div>

      <div className="weight-strip" aria-label="Outcome weights">
        <span>{match.team_a}: {weightLabel(match.team_a_weight)}</span>
        <span>Draw: {weightLabel(match.draw_weight)}</span>
        <span>{match.team_b}: {weightLabel(match.team_b_weight)}</span>
      </div>

      <p className="close-note">Board closes at {formatDateTime(closeTime(match))}</p>

      {prediction && (
        <div className="my-prediction">
          <span>Your prediction</span>
          <strong>{choiceLabel(prediction.choice, match)} • {prediction.amount +' coins'} • {weightLabel(choiceWeight(prediction.choice, match))}</strong>
        </div>
      )}

      {match.status === 'finished' ? (
        <p className="muted-text">This match is settled. Check the Results tab for outcome details.</p>
      ) : closed ? (
        <p className="warning-box">Prediction board is locked. You can only view your own prediction now.</p>
      ) : (profile?.balance ?? 0) <= 0 && !prediction ? (
        <p className="warning-box">Your balance is finished. You cannot bid on more matches.</p>
      ) : (
        <div className="prediction-form">
          <div className="choice-grid" role="radiogroup" aria-label="Prediction outcome">
            {choices.map((nextChoice) => (
              <button
                key={nextChoice}
                type="button"
                className={choice === nextChoice ? 'choice active' : 'choice'}
                onClick={() => setChoice(nextChoice)}
              >
                <span>{choiceLabel(nextChoice, match)}</span>
                <small>{weightLabel(choiceWeight(nextChoice, match))}</small>
              </button>
            ))}
          </div>

          <label className="field-label">
            Bid amount
            <input
              type="number"
              min="1"
              max={availableForThisMatch}
              step="0.01"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="e.g. 10"
            />
          </label>

          {numericAmount > 0 && (
            <div className="payout-preview">
              If correct: you will get {possibleReturn + ' coins'} including {possibleProfit + ' coins'} profit. 
              <br />
              If wrong: lose {numericAmount + ' coins'} only.
            </div>
          )}

          <div className="form-footer">
            <span className={insufficientBalance ? 'negative' : 'muted-text'}>
              Available for this match: {availableForThisMatch + ' coins'}
            </span>
            <button className="primary-button" onClick={submitPrediction} disabled={saving || insufficientBalance}>
              {saving ? 'Saving…' : prediction ? 'Update bid' : 'Place bid'}
            </button>
          </div>
        </div>
      )}

      {message && <p className="success-text">{message}</p>}
      {error && <p className="error-text">{error}</p>}
    </article>
  );
}
