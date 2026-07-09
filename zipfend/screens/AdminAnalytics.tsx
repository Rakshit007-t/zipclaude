import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, doc, getDocs, limit, query, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { getUserRole } from '../utils/subscription';

type AnalyticsEventName =
  | 'recommendation_generated'
  | 'recommendation_viewed'
  | 'recommendation_accepted'
  | 'recommendation_rejected'
  | 'recommendation_feedback'
  | 'product_purchased'
  | 'size_exchanged'
  | 'size_returned';

interface AnalyticsEvent {
  eventName: AnalyticsEventName;
  recommendationId: string;
  normalizedBrand: string;
  brand: string;
  garmentFamily: string;
  fitType: string;
  recommendedSize: string;
  originalSize: string;
  newSize: string;
  returnedSize: string;
  returnReason: string;
  confidence: number | null;
  feedbackType: string;
}

interface CountStats {
  generated: number;
  viewed: number;
  accepted: number;
  rejected: number;
  feedback: number;
  purchased: number;
  exchanged: number;
  returned: number;
}

interface SegmentStats {
  key: string;
  label: string;
  generated: number;
  accepted: number;
  perfectFit: number;
  wrongSize: number;
}

interface ConfidenceStats {
  band: string;
  generated: number;
  perfectFit: number;
  wrongSize: number;
}

interface BrandBiasCandidate {
  brand: string;
  normalizedBrand: string;
  garmentFamily: string;
  sampleCount: number;
  generated: number;
  accepted: number;
  feedback: number;
  purchased: number;
  exchanged: number;
  returned: number;
  biasDirection: 'size_up' | 'size_down' | 'none';
  biasStrength: number;
  confidence: number;
}

interface MutableBrandInsight extends BrandBiasCandidate {
  perfectFit: number;
  slightlyTight: number;
  slightlyLoose: number;
  wrongSize: number;
  exchangeUp: number;
  exchangeDown: number;
  returnTooTight: number;
  returnTooLoose: number;
}

interface BrandInsightDocument {
  normalizedBrand: string;
  displayBrand: string;
  generated: number;
  accepted: number;
  feedback: number;
  purchased: number;
  exchanged: number;
  returned: number;
  sampleCount: number;
  biasDirection: 'size_up' | 'size_down' | 'none';
  biasStrength: number;
  confidence: number;
  familyInsights: BrandBiasCandidate[];
  aggregationVersion: string;
  updatedAt: ReturnType<typeof serverTimestamp>;
}

const EVENT_COLLECTIONS: Array<{ name: AnalyticsEventName; collectionName: string }> = [
  { name: 'recommendation_generated', collectionName: 'recommendation_generated_events' },
  { name: 'recommendation_viewed', collectionName: 'recommendation_viewed_events' },
  { name: 'recommendation_accepted', collectionName: 'recommendation_accepted_events' },
  { name: 'recommendation_rejected', collectionName: 'recommendation_rejected_events' },
  { name: 'recommendation_feedback', collectionName: 'recommendation_feedback_events' },
  { name: 'product_purchased', collectionName: 'product_purchased_events' },
  { name: 'size_exchanged', collectionName: 'size_exchanged_events' },
  { name: 'size_returned', collectionName: 'size_returned_events' },
];

const EMPTY_COUNTS: CountStats = {
  generated: 0,
  viewed: 0,
  accepted: 0,
  rejected: 0,
  feedback: 0,
  purchased: 0,
  exchanged: 0,
  returned: 0,
};

const CONFIDENCE_BANDS = ['95-100', '90-94', '80-89', '70-79', '60-69', '<60', 'Unknown'];

function textFrom(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function numberFrom(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

function rate(part: number, total: number): string {
  if (!total) return '0%';
  return `${Math.round((part / total) * 100)}%`;
}

function getConfidenceBand(confidence: number | null): string {
  if (confidence === null) return 'Unknown';
  if (confidence >= 95) return '95-100';
  if (confidence >= 90) return '90-94';
  if (confidence >= 80) return '80-89';
  if (confidence >= 70) return '70-79';
  if (confidence >= 60) return '60-69';
  return '<60';
}

function normalizeEvent(eventName: AnalyticsEventName, data: Record<string, unknown>): AnalyticsEvent {
  return {
    eventName,
    recommendationId: textFrom(data.recommendationId),
    normalizedBrand: textFrom(data.normalizedBrand) || textFrom(data.brand).toLowerCase().replace(/[^a-z0-9]/g, ''),
    brand: textFrom(data.brand),
    garmentFamily: textFrom(data.garmentFamily) || 'UNKNOWN',
    fitType: textFrom(data.fitType) || 'unknown',
    recommendedSize: textFrom(data.recommendedSize || data.finalSize),
    originalSize: textFrom(data.originalSize),
    newSize: textFrom(data.newSize),
    returnedSize: textFrom(data.returnedSize),
    returnReason: textFrom(data.returnReason),
    confidence: numberFrom(data.confidence),
    feedbackType: textFrom(data.feedbackType),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function sizeRank(size: string): number | null {
  const normalized = size.trim().toUpperCase();
  const alphaRanks: Record<string, number> = {
    XXS: 0,
    XS: 1,
    S: 2,
    M: 3,
    L: 4,
    XL: 5,
    XXL: 6,
    '2XL': 6,
    XXXL: 7,
    '3XL': 7,
  };
  if (normalized in alphaRanks) return alphaRanks[normalized];

  const numeric = Number(normalized.replace(/[^0-9.]/g, ''));
  return Number.isFinite(numeric) ? numeric : null;
}

function exchangeDirection(originalSize: string, newSize: string): 'up' | 'down' | 'same' | 'unknown' {
  const originalRank = sizeRank(originalSize);
  const newRank = sizeRank(newSize);
  if (originalRank === null || newRank === null) return 'unknown';
  if (newRank > originalRank) return 'up';
  if (newRank < originalRank) return 'down';
  return 'same';
}

function emptyBrandInsight(brand: string, normalizedBrand: string, garmentFamily: string): MutableBrandInsight {
  return {
    brand,
    normalizedBrand,
    garmentFamily,
    sampleCount: 0,
    generated: 0,
    accepted: 0,
    feedback: 0,
    purchased: 0,
    exchanged: 0,
    returned: 0,
    perfectFit: 0,
    slightlyTight: 0,
    slightlyLoose: 0,
    wrongSize: 0,
    exchangeUp: 0,
    exchangeDown: 0,
    returnTooTight: 0,
    returnTooLoose: 0,
    biasDirection: 'none',
    biasStrength: 0,
    confidence: 0,
  };
}

function getSampleBiasCap(sampleCount: number): number {
  if (sampleCount >= 500) return 1;
  if (sampleCount >= 100) return 0.75;
  if (sampleCount >= 50) return 0.5;
  if (sampleCount >= 10) return 0.25;
  return 0;
}

function scoreBrandInsight(insight: MutableBrandInsight): BrandBiasCandidate {
  const upSignals = insight.slightlyTight * 2 + insight.exchangeUp * 3 + insight.returnTooTight * 2;
  const downSignals = insight.slightlyLoose * 2 + insight.exchangeDown * 3 + insight.returnTooLoose * 2;
  const signalTotal = upSignals + downSignals;
  const signalDelta = signalTotal ? (upSignals - downSignals) / signalTotal : 0;
  const biasCap = getSampleBiasCap(insight.sampleCount);
  const hasEnoughSignal = signalTotal >= 3 && Math.abs(signalDelta) >= 0.25 && biasCap > 0;
  const biasDirection = !hasEnoughSignal
    ? 'none'
    : signalDelta > 0
      ? 'size_up'
      : 'size_down';
  const biasStrength = biasDirection === 'none'
    ? 0
    : Number((biasCap * clamp(Math.abs(signalDelta), 0.25, 1)).toFixed(2));

  const sampleConfidence = insight.sampleCount >= 500
    ? 86
    : insight.sampleCount >= 100
      ? 76
      : insight.sampleCount >= 50
        ? 64
        : insight.sampleCount >= 10
          ? 48
          : 25;
  const signalConfidence = Math.round(Math.abs(signalDelta) * 14);
  const evidenceCount = insight.feedback + insight.exchanged + insight.returned + insight.purchased;
  const evidenceCoverage = insight.sampleCount ? Math.min(10, Math.round((evidenceCount / insight.sampleCount) * 40)) : 0;
  const confidence = biasDirection === 'none'
    ? Math.min(60, sampleConfidence + evidenceCoverage)
    : clamp(sampleConfidence + signalConfidence + evidenceCoverage, 0, 95);

  return {
    brand: insight.brand,
    normalizedBrand: insight.normalizedBrand,
    garmentFamily: insight.garmentFamily,
    sampleCount: insight.sampleCount,
    generated: insight.generated,
    accepted: insight.accepted,
    feedback: insight.feedback,
    purchased: insight.purchased,
    exchanged: insight.exchanged,
    returned: insight.returned,
    biasDirection,
    biasStrength,
    confidence,
  };
}

function buildBrandFitInsights(events: AnalyticsEvent[]): BrandInsightDocument[] {
  const familyMap = new Map<string, MutableBrandInsight>();

  for (const event of events) {
    const normalizedBrand = event.normalizedBrand || 'unknown';
    const family = event.garmentFamily || 'UNKNOWN';
    const key = `${normalizedBrand}::${family}`;
    const existing = familyMap.get(key) || emptyBrandInsight(event.brand || normalizedBrand, normalizedBrand, family);
    if (!existing.brand && event.brand) existing.brand = event.brand;

    if (event.eventName === 'recommendation_generated') {
      existing.generated += 1;
      existing.sampleCount += 1;
    }
    if (event.eventName === 'recommendation_accepted') existing.accepted += 1;
    if (event.eventName === 'recommendation_feedback') {
      existing.feedback += 1;
      if (event.feedbackType === 'perfect_fit') existing.perfectFit += 1;
      if (event.feedbackType === 'slightly_tight') existing.slightlyTight += 1;
      if (event.feedbackType === 'slightly_loose') existing.slightlyLoose += 1;
      if (event.feedbackType === 'wrong_size') existing.wrongSize += 1;
    }
    if (event.eventName === 'product_purchased') existing.purchased += 1;
    if (event.eventName === 'size_exchanged') {
      existing.exchanged += 1;
      const direction = exchangeDirection(event.originalSize || event.recommendedSize, event.newSize);
      if (direction === 'up') existing.exchangeUp += 1;
      if (direction === 'down') existing.exchangeDown += 1;
    }
    if (event.eventName === 'size_returned') {
      existing.returned += 1;
      if (event.returnReason === 'too_tight') existing.returnTooTight += 1;
      if (event.returnReason === 'too_loose') existing.returnTooLoose += 1;
    }

    familyMap.set(key, existing);
  }

  const brandDocs = new Map<string, BrandInsightDocument>();
  for (const scored of [...familyMap.values()].map(scoreBrandInsight)) {
    const existing = brandDocs.get(scored.normalizedBrand) || {
      normalizedBrand: scored.normalizedBrand,
      displayBrand: scored.brand,
      generated: 0,
      accepted: 0,
      feedback: 0,
      purchased: 0,
      exchanged: 0,
      returned: 0,
      sampleCount: 0,
      biasDirection: 'none' as const,
      biasStrength: 0,
      confidence: 0,
      familyInsights: [],
      aggregationVersion: 'brand-intelligence-v1',
      updatedAt: serverTimestamp(),
    };

    existing.generated += scored.generated;
    existing.accepted += scored.accepted;
    existing.feedback += scored.feedback;
    existing.purchased += scored.purchased;
    existing.exchanged += scored.exchanged;
    existing.returned += scored.returned;
    existing.sampleCount += scored.sampleCount;
    existing.familyInsights.push(scored);
    brandDocs.set(scored.normalizedBrand, existing);
  }

  return [...brandDocs.values()].map(doc => {
    const strongest = [...doc.familyInsights].sort((left, right) => right.confidence * right.biasStrength - left.confidence * left.biasStrength)[0];
    return {
      ...doc,
      biasDirection: strongest?.biasDirection || 'none',
      biasStrength: strongest?.biasStrength || 0,
      confidence: strongest?.confidence || 0,
      familyInsights: doc.familyInsights.sort((left, right) => right.sampleCount - left.sampleCount),
    };
  });
}

async function persistBrandFitInsights(insights: BrandInsightDocument[]) {
  await Promise.all(
    insights.map(insight => setDoc(doc(db, 'brand_fit_insights', insight.normalizedBrand), insight, { merge: true })),
  );
}

function incrementOverview(counts: CountStats, eventName: AnalyticsEventName) {
  if (eventName === 'recommendation_generated') counts.generated += 1;
  if (eventName === 'recommendation_viewed') counts.viewed += 1;
  if (eventName === 'recommendation_accepted') counts.accepted += 1;
  if (eventName === 'recommendation_rejected') counts.rejected += 1;
  if (eventName === 'recommendation_feedback') counts.feedback += 1;
  if (eventName === 'product_purchased') counts.purchased += 1;
  if (eventName === 'size_exchanged') counts.exchanged += 1;
  if (eventName === 'size_returned') counts.returned += 1;
}

function ensureSegment(map: Map<string, SegmentStats>, key: string, label = key): SegmentStats {
  const safeKey = key || 'unknown';
  const existing = map.get(safeKey);
  if (existing) return existing;

  const next = {
    key: safeKey,
    label: label || safeKey,
    generated: 0,
    accepted: 0,
    perfectFit: 0,
    wrongSize: 0,
  };
  map.set(safeKey, next);
  return next;
}

function buildDashboardStats(events: AnalyticsEvent[]) {
  const overview = { ...EMPTY_COUNTS };
  const brandMap = new Map<string, SegmentStats>();
  const familyMap = new Map<string, SegmentStats>();
  const confidenceMap = new Map<string, ConfidenceStats>(
    CONFIDENCE_BANDS.map(band => [band, { band, generated: 0, perfectFit: 0, wrongSize: 0 }]),
  );

  for (const event of events) {
    incrementOverview(overview, event.eventName);

    const brand = ensureSegment(brandMap, event.normalizedBrand || 'unknown', event.normalizedBrand || event.brand || 'unknown');
    const family = ensureSegment(familyMap, event.garmentFamily || 'UNKNOWN', event.garmentFamily || 'UNKNOWN');

    if (event.eventName === 'recommendation_generated') {
      brand.generated += 1;
      family.generated += 1;
      const confidenceBand = getConfidenceBand(event.confidence);
      const confidenceStats = confidenceMap.get(confidenceBand);
      if (confidenceStats) confidenceStats.generated += 1;
    }

    if (event.eventName === 'recommendation_accepted') {
      brand.accepted += 1;
      family.accepted += 1;
    }

    if (event.eventName === 'recommendation_feedback') {
      if (event.feedbackType === 'perfect_fit') {
        brand.perfectFit += 1;
        family.perfectFit += 1;
        const confidenceStats = confidenceMap.get(getConfidenceBand(event.confidence));
        if (confidenceStats) confidenceStats.perfectFit += 1;
      }

      if (event.feedbackType === 'wrong_size') {
        brand.wrongSize += 1;
        family.wrongSize += 1;
        const confidenceStats = confidenceMap.get(getConfidenceBand(event.confidence));
        if (confidenceStats) confidenceStats.wrongSize += 1;
      }
    }
  }

  return {
    overview,
    brands: [...brandMap.values()].sort((left, right) => right.generated - left.generated).slice(0, 25),
    families: [...familyMap.values()].sort((left, right) => right.generated - left.generated),
    confidenceBands: [...confidenceMap.values()],
    brandFitInsights: buildBrandFitInsights(events),
  };
}

const AdminAnalytics: React.FC = () => {
  const navigate = useNavigate();
  const [events, setEvents] = useState<AnalyticsEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aggregationStatus, setAggregationStatus] = useState<string | null>(null);
  const isLocalAdmin = getUserRole() === 'admin';

  useEffect(() => {
    if (!isLocalAdmin) {
      setIsLoading(false);
      setError('Admin access is required to view analytics.');
      return;
    }

    let cancelled = false;

    const loadAnalytics = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const snapshots = await Promise.all(
          EVENT_COLLECTIONS.map(async source => {
            const snapshot = await getDocs(query(collection(db, source.collectionName), limit(1000)));
            return snapshot.docs.map(doc => normalizeEvent(source.name, doc.data()));
          }),
        );
        const loadedEvents = snapshots.flat();

        try {
          const brandInsights = buildBrandFitInsights(loadedEvents);
          await persistBrandFitInsights(brandInsights);
          if (!cancelled) {
            setAggregationStatus(`brand_fit_insights updated for ${brandInsights.length} brands.`);
          }
        } catch (aggregationError) {
          console.warn('[AdminAnalytics] Unable to persist brand fit insights:', aggregationError);
          if (!cancelled) {
            setAggregationStatus('Brand insight aggregation could not be saved.');
          }
        }

        if (!cancelled) {
          setEvents(loadedEvents);
        }
      } catch (err) {
        if (!cancelled) {
          console.warn('[AdminAnalytics] Unable to load analytics:', err);
          setError('Analytics data is unavailable. Check admin access or Firestore rules.');
          setEvents([]);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    loadAnalytics();

    return () => {
      cancelled = true;
    };
  }, [isLocalAdmin]);

  const stats = useMemo(() => buildDashboardStats(events), [events]);
  const brandBiasCandidates = useMemo(() => (
    stats.brandFitInsights
      .flatMap(insight => insight.familyInsights)
      .filter(candidate => candidate.biasDirection !== 'none')
      .sort((left, right) => right.confidence * right.biasStrength - left.confidence * left.biasStrength)
      .slice(0, 25)
  ), [stats.brandFitInsights]);
  const overviewCards = [
    ['Generated', stats.overview.generated],
    ['Viewed', stats.overview.viewed],
    ['Accepted', stats.overview.accepted],
    ['Rejected', stats.overview.rejected],
    ['Feedback', stats.overview.feedback],
    ['Purchased', stats.overview.purchased],
    ['Exchanged', stats.overview.exchanged],
    ['Returned', stats.overview.returned],
  ] as const;

  return (
    <div className="min-h-screen bg-surface-0 text-ink font-sans pb-12">
      <div className="sticky top-0 z-40 flex items-center gap-4 px-6 py-5 bg-surface-0/90 backdrop-blur-xl border-b border-line">
        <button aria-label="Go back"
          onClick={() => navigate(-1)}
          className="h-10 w-10 rounded-full bg-surface-2 border border-line flex items-center justify-center active:scale-95 transition-transform"
        >
          <span className="material-symbols-outlined text-[#6157FF] text-xl">arrow_back</span>
        </button>
        <div>
          <p className="text-[12px] font-bold text-[#6157FF]">Admin</p>
          <h1 className="text-xl font-bold">Analytics Dashboard</h1>
        </div>
      </div>

      <div className="px-6 py-6 flex flex-col gap-6">
        {isLoading && (
          <div className="rounded-[2rem] border border-line bg-surface-2 p-8 text-center">
            <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-[#6157FF]/20 border-t-[#6157FF]"></div>
            <p className="text-sm font-bold text-ink-soft">Loading analytics...</p>
          </div>
        )}

        {error && !isLoading && (
          <div className="rounded-[2rem] border border-amber-500/20 bg-amber-500/10 p-6">
            <p className="text-[12px] font-bold text-amber-600 mb-2">Unavailable</p>
            <p className="text-sm text-amber-50/80">{error}</p>
          </div>
        )}

        {aggregationStatus && !isLoading && !error && (
          <div className="rounded-[2rem] border border-emerald-500/20 bg-emerald-500/10 p-5">
            <p className="text-[12px] font-bold text-emerald-600 mb-1">Brand Intelligence</p>
            <p className="text-sm text-emerald-50/80">{aggregationStatus}</p>
          </div>
        )}

        {!isLoading && (
          <>
            <section className="flex flex-col gap-4">
              <h2 className="text-[12px] font-bold text-[#6157FF]">Overview</h2>
              <div className="grid grid-cols-2 gap-3">
                {overviewCards.map(([label, value]) => (
                  <div key={label} className="rounded-2xl border border-line bg-surface-2 p-5">
                    <p className="text-[12px] font-bold text-ink-soft">{label}</p>
                    <p className="mt-2 text-3xl font-bold text-ink">{value}</p>
                  </div>
                ))}
              </div>
            </section>

            <section className="flex flex-col gap-4">
              <h2 className="text-[12px] font-bold text-[#6157FF]">Brand Table</h2>
              <AnalyticsTable
                headers={['Brand', 'Generated', 'Accepted', 'Perfect', 'Wrong']}
                rows={stats.brands.map(brand => [
                  brand.label,
                  String(brand.generated),
                  rate(brand.accepted, brand.generated),
                  rate(brand.perfectFit, brand.generated),
                  rate(brand.wrongSize, brand.generated),
                ])}
                emptyLabel="No brand analytics yet."
              />
            </section>

            <section className="flex flex-col gap-4">
              <h2 className="text-[12px] font-bold text-[#6157FF]">Brand Bias Candidates</h2>
              <AnalyticsTable
                headers={['Brand', 'Family', 'Samples', 'Direction', 'Strength', 'Confidence']}
                rows={brandBiasCandidates.map(candidate => [
                  candidate.normalizedBrand,
                  candidate.garmentFamily,
                  String(candidate.sampleCount),
                  candidate.biasDirection.replace('_', ' '),
                  candidate.biasStrength.toFixed(2),
                  `${candidate.confidence}%`,
                ])}
                emptyLabel="No brand bias candidates yet."
              />
            </section>

            <section className="flex flex-col gap-4">
              <h2 className="text-[12px] font-bold text-[#6157FF]">Garment Families</h2>
              <AnalyticsTable
                headers={['Family', 'Generated', 'Accepted', 'Wrong']}
                rows={stats.families.map(family => [
                  family.label,
                  String(family.generated),
                  rate(family.accepted, family.generated),
                  rate(family.wrongSize, family.generated),
                ])}
                emptyLabel="No garment-family analytics yet."
              />
            </section>

            <section className="flex flex-col gap-4">
              <h2 className="text-[12px] font-bold text-[#6157FF]">Confidence Calibration</h2>
              <AnalyticsTable
                headers={['Band', 'Generated', 'Perfect', 'Wrong']}
                rows={stats.confidenceBands.map(band => [
                  band.band,
                  String(band.generated),
                  String(band.perfectFit),
                  String(band.wrongSize),
                ])}
                emptyLabel="No confidence analytics yet."
              />
            </section>
          </>
        )}
      </div>
    </div>
  );
};

const AnalyticsTable: React.FC<{ headers: string[]; rows: string[][]; emptyLabel: string }> = ({ headers, rows, emptyLabel }) => (
  <div className="overflow-hidden rounded-[2rem] border border-line bg-surface-2">
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] text-left">
        <thead className="bg-surface-2">
          <tr>
            {headers.map(header => (
              <th key={header} className="px-4 py-3 text-[12px] font-bold text-ink-soft">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length ? rows.map((row, rowIndex) => (
            <tr key={`${row[0]}-${rowIndex}`} className="border-t border-line">
              {row.map((cell, cellIndex) => (
                <td key={`${cell}-${cellIndex}`} className="px-4 py-4 text-xs font-bold text-ink-soft">
                  {cell}
                </td>
              ))}
            </tr>
          )) : (
            <tr>
              <td colSpan={headers.length} className="px-4 py-8 text-center text-sm font-bold text-ink-faint">
                {emptyLabel}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  </div>
);

export default AdminAnalytics;
