export default function SizeRecommendation({ recommendedSize, confidence, notes }) {
  return (
    <article>
      <strong>Recommended size: {recommendedSize}</strong>
      <div>Confidence: {Math.round(confidence * 100)}%</div>
      <ul>
        {notes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
    </article>
  );
}
