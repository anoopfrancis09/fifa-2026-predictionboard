import { useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { choiceLabel, choiceWeight, closeTime, formatDateTime, isBoardClosed, money, weightLabel } from '../lib/format';
import type { Match, Prediction, PredictionChoice } from '../types';

const choices: PredictionChoice[] = ['team_a', 'draw', 'team_b'];

const countryCodeByTeamName: Record<string, string> = {
  algeria: 'DZ',
  argentina: 'AR',
  australia: 'AU',
  austria: 'AT',
  belgium: 'BE',
  brazil: 'BR',
  cameroon: 'CM',
  canada: 'CA',
  chile: 'CL',
  china: 'CN',
  colombia: 'CO',
  costa_rica: 'CR',
  croatia: 'HR',
  denmark: 'DK',
  ecuador: 'EC',
  egypt: 'EG',
  france: 'FR',
  germany: 'DE',
  ghana: 'GH',
  greece: 'GR',
  india: 'IN',
  iran: 'IR',
  iraq: 'IQ',
  ireland: 'IE',
  italy: 'IT',
  japan: 'JP',
  mexico: 'MX',
  morocco: 'MA',
  netherlands: 'NL',
  new_zealand: 'NZ',
  nigeria: 'NG',
  norway: 'NO',
  paraguay: 'PY',
  peru: 'PE',
  poland: 'PL',
  portugal: 'PT',
  qatar: 'QA',
  saudi_arabia: 'SA',
  scotland: 'GB',
  senegal: 'SN',
  serbia: 'RS',
  south_africa: 'ZA',
  south_korea: 'KR',
  spain: 'ES',
  sweden: 'SE',
  switzerland: 'CH',
  tunisia: 'TN',
  turkey: 'TR',
  ukraine: 'UA',
  united_arab_emirates: 'AE',
  united_states: 'US',
  uruguay: 'UY',
  usa: 'US',
  wales: 'GB',
};

const specialFlagByTeamName: Record<string, string> = {
  england: '🏴',
};

function normalizeTeamName(name: string) {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function codeToFlag(code: string) {
  return code
    .toUpperCase()
    .split('')
    .map((letter) => String.fromCodePoint(127397 + letter.charCodeAt(0)))
    .join('');
}

function teamMark(name: string) {
  const normalizedName = normalizeTeamName(name);
  const specialFlag = specialFlagByTeamName[normalizedName];
  if (specialFlag) return specialFlag;

  const countryCode = countryCodeByTeamName[normalizedName];
  if (countryCode) return codeToFlag(countryCode);

  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function coinResult(value: number | null | undefined) {
  const numericValue = Number(value ?? 0);
  const sign = numericValue > 0 ? '+' : '';
  return `${sign}${numericValue.toLocaleString('en-AU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} coins`;
}

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
        <div className="team">
          <div className="team-flag">{teamMark(match.team_a)}</div>
          <strong className="team-name">{match.team_a}</strong>
        </div>
        <span className="vs">VS</span>
        <div className="team">
          <div className="team-flag">{teamMark(match.team_b)}</div>
          <strong className="team-name">{match.team_b}</strong>
        </div>
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
        <div className="settled-match-summary">
          <div className="settled-match-topline">
            <span>Final result</span>
            <strong>{match.result ? choiceLabel(match.result, match) : 'Result unavailable'}</strong>
          </div>

          {prediction ? (
            <div className="settled-user-result">
              <div>
                <span>Your prediction</span>
                <strong>{choiceLabel(prediction.choice, match)} • {prediction.amount} coins</strong>
              </div>
              <div>
                <span>Payout</span>
                <strong>{coinResult(prediction.payout_amount)}</strong>
              </div>
              <div className={prediction.net_amount > 0 ? 'result-net positive' : prediction.net_amount < 0 ? 'result-net negative' : 'result-net neutral'}>
                <span>{prediction.net_amount >= 0 ? 'Earnings' : 'Loss'}</span>
                <strong>{coinResult(prediction.net_amount)}</strong>
              </div>
            </div>
          ) : (
            <p className="muted-text">You did not place a prediction for this match.</p>
          )}
        </div>
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
