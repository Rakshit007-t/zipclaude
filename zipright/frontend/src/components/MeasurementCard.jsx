export default function MeasurementCard({ label, value, confidence }) {
  return (
    <article>
      <strong>{label}</strong>
      <div>{value}</div>
      <small>Confidence: {Math.round(confidence * 100)}%</small>
    </article>
  );
}
