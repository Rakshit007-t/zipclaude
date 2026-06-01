import MeasurementCard from "../components/MeasurementCard";
import SizeRecommendation from "../components/SizeRecommendation";

export default function Results() {
  return (
    <section>
      <h1>Results</h1>
      <MeasurementCard label="Chest" value="--" confidence={0} />
      <SizeRecommendation recommendedSize="--" confidence={0} notes={["Measurement pipeline modules 3-7 pending."]} />
    </section>
  );
}
