import { useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import { loadAllDecks } from '../domain/decks';
import { levelLabel, type Deck, type StudyItem } from '../domain/items';
import { REVIEW_MODES, deckTypeForReviewMode, reviewModeLabel, type ReviewMode } from '../domain/modes';
import {
  BANDS,
  activityStrip,
  bandLabel,
  streaksFrom,
  summarise,
  type Streaks,
} from '../domain/progress';
import { useReviewStates } from '../hooks/useReviewStates';
import { loadReviewHistory } from '../storage/reviewLog';

/**
 * How far through the material you are, and how steadily you have been at it.
 *
 * The CLI printed completion bars on startup and they were the first thing you
 * saw; this is that screen. It measures with stability rather than with a count
 * of correct answers, so a full bar means "you would still know this next
 * month" instead of "you have answered this a lot".
 *
 * Split by review mode rather than averaged across them. Recalling a reading
 * and producing the characters are different skills that come along at
 * different rates, and one bar blending them would hide exactly the gap worth
 * seeing.
 */

const PERCENT = new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 0 });

export function ProgressPanel({ user }: { user: User }) {
  const { lookup, loading: statesLoading } = useReviewStates(user);

  const [mode, setMode] = useState<ReviewMode>('vocab-reading');
  const [decks, setDecks] = useState<Record<string, Deck<StudyItem>[]>>({});
  const [streaks, setStreaks] = useState<Streaks | null>(null);
  const [error, setError] = useState<string | null>(null);

  const type = deckTypeForReviewMode(mode);

  useEffect(() => {
    let live = true;

    loadAllDecks(type).then(
      (loaded) => live && setDecks((current) => ({ ...current, [type]: loaded })),
      (caught: unknown) =>
        live && setError(caught instanceof Error ? caught.message : 'Could not load the decks.'),
    );

    return () => {
      live = false;
    };
  }, [type]);

  useEffect(() => {
    let live = true;

    loadReviewHistory(user.uid).then(
      (history) => live && setStreaks(streaksFrom(history.map((r) => r.at), new Date())),
      (caught: unknown) => {
        console.error('[progress] Could not read the review log.', caught);
        if (live) setStreaks(streaksFrom([], new Date()));
      },
    );

    return () => {
      live = false;
    };
  }, [user.uid]);

  const loaded = decks[type];

  // Recomputed when the states change, which is what makes the bars move the
  // moment a review lands rather than on the next visit.
  const progress = useMemo(
    () => (loaded ? summarise(loaded, mode, lookup, new Date()) : null),
    [loaded, mode, lookup],
  );

  return (
    <section className="card">
      <h1 className="card__title">Progress</h1>

      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}

      <h2 className="card__subtitle">Turning up</h2>
      {streaks === null ? (
        <p className="card__body">Reading your history…</p>
      ) : (
        <>
          <div className="tally">
            <div className="tally__figure">
              <span className="tally__number">{streaks.current}</span>
              <span className="tally__label">day streak</span>
            </div>
            <div className="tally__figure tally__figure--muted">
              <span className="tally__number">{streaks.today}</span>
              <span className="tally__label">today</span>
            </div>
            <div className="tally__figure tally__figure--muted">
              <span className="tally__number">{streaks.totalReviews.toLocaleString()}</span>
              <span className="tally__label">all time</span>
            </div>
          </div>

          <div className="strip" aria-hidden="true">
            {activityStrip(streaks, new Date()).map(({ day, active }) => (
              <span key={day} className={`strip__day${active ? ' strip__day--active' : ''}`} />
            ))}
          </div>
          <p className="card__hint">
            The last eight weeks. Longest run so far: {streaks.longest}{' '}
            {streaks.longest === 1 ? 'day' : 'days'}.
          </p>
        </>
      )}

      <h2 className="card__subtitle">How much you hold</h2>

      <fieldset className="field">
        <legend className="field__label">Skill</legend>
        <div className="segmented segmented--wrap">
          {REVIEW_MODES.map((option) => (
            <button
              key={option}
              type="button"
              className={`segmented__option${mode === option ? ' segmented__option--active' : ''}`}
              aria-pressed={mode === option}
              onClick={() => setMode(option)}
            >
              {reviewModeLabel(option)}
            </button>
          ))}
        </div>
      </fieldset>

      {statesLoading || !progress ? (
        <p className="card__body">Working it out…</p>
      ) : (
        <>
          <p className="card__body">
            <strong>{PERCENT.format(progress.seen)} started</strong>,{' '}
            <strong>{PERCENT.format(progress.score)} held</strong>, of{' '}
            {progress.total.toLocaleString()}. {progress.due} due now.
          </p>

          <ul className="levels">
            {progress.levels.map((level) => (
              <li className="levels__row" key={level.level}>
                <span className="levels__name">{levelLabel(level.level)}</span>
                <span
                  className="levels__bar"
                  title={
                    `${level.total} items — ` +
                    BANDS.map((b) => `${bandLabel(b)} ${level.counts[b]}`).join(', ')
                  }
                >
                  {BANDS.map((band) =>
                    level.counts[band] > 0 ? (
                      <span
                        key={band}
                        className={`levels__band levels__band--${band}`}
                        style={{ width: `${(level.counts[band] / level.total) * 100}%` }}
                      />
                    ) : null,
                  )}
                </span>
                {/*
                  Both numbers, because they diverge and the bar shows the
                  difference. A level that is fully started and nothing held
                  draws a full bar next to 0%, which reads as a bug unless the
                  other number is there to explain it.
                */}
                <span className="levels__figure">
                  <span className="levels__held">{PERCENT.format(level.score)}</span>
                  <span className="levels__seen">{PERCENT.format(level.seen)} seen</span>
                </span>
              </li>
            ))}
          </ul>

          <ul className="key">
            {BANDS.map((band) => (
              <li className="key__item" key={band}>
                <span className={`key__swatch levels__band--${band}`} />
                {bandLabel(band)}
                <span className="key__count">{progress.counts[band].toLocaleString()}</span>
              </li>
            ))}
          </ul>

          <p className="card__hint">
            <strong>Held</strong> counts only what the schedule can vouch for: known is a month or
            more of expected retention, familiar a week or more, counted as half. <strong>Seen</strong>{' '}
            is everything you have started. They are not a count of how often you have answered —
            that was the old app’s measure, and it rewarded attendance rather than knowing.
          </p>
          {progress.counts.learning > 0 ? (
            <p className="card__hint">
              Imported items begin in <strong>Learning</strong> and stay there until you answer
              them here. The old app recorded <em>that</em> you were right, never <em>when</em>, so
              there is nothing to vouch for yet — the first real answer replaces the guess with a
              measurement, and the bars move then.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
