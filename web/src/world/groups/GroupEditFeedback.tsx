export function GroupEditFeedback({
  error,
  changed,
  current,
  onReview,
}: {
  error: string | null;
  changed: boolean;
  current: string;
  onReview(): void;
}) {
  return (
    <>
      {error && (
        <p role="alert" className="group-error">
          {error}
        </p>
      )}
      {changed && (
        <div className="group-hint">
          <p>The Group changed while this form was open. {current}</p>
          <button type="button" onClick={onReview}>
            Use current version
          </button>
          <p>Your draft is kept. Review these values before saving again.</p>
        </div>
      )}
    </>
  );
}
