/**
 * Weighted Risk Score Engine for Student Analytics
 *
 * Computes a 0-100 risk score from multiple signals:
 *   Absence rate          → 0-30 pts
 *   Consecutive absences  → 0-20 pts
 *   Absence trend         → 0-10 pts  (recent window worse than prior)
 *   Late frequency        → 0-10 pts
 *   Failing subjects      → 0-15 pts
 *   Low overall average   → 0-10 pts
 *   Grade decline         → 0-5 pts   (latest quarter avg < prior quarter avg)
 *
 * Status mapping:
 *   0-19  → good
 *   20-39 → at-risk
 *   40+   → critical
 */

export interface RiskInput {
  /** Sorted array of daily attendance statuses (oldest→newest). */
  dailyStatuses: { date: string; status: string }[];
  /** Overall absence rate 0-100. */
  absenceRate: number;
  /** Total attendance sessions. */
  totalSessions: number;
  /** Number of absences. */
  absences: number;
  /** Number of lates. */
  lates: number;
  /** Number of subjects with avg < 75. */
  failingSubjectCount: number;
  /** Overall grade average across all subjects/quarters, or null. */
  averageGrade: number | null;
  /** Per-quarter averages (keyed by quarter number), for trend detection. */
  quarterAverages: Map<number, number>;
}

export interface RiskResult {
  score: number;
  status: 'critical' | 'at-risk' | 'good';
  breakdown: {
    absenceRate: number;
    consecutiveAbsences: number;
    absenceTrend: number;
    lateFrequency: number;
    failingSubjects: number;
    lowAverage: number;
    gradeDecline: number;
  };
  /** Longest consecutive absence streak. */
  maxConsecutiveAbsences: number;
  /** True if absences are getting worse recently. */
  trendWorsening: boolean;
}

const MIN_SESSIONS = 3;

export function computeRiskScore(input: RiskInput): RiskResult {
  const {
    dailyStatuses,
    absenceRate,
    totalSessions,
    lates,
    failingSubjectCount,
    averageGrade,
    quarterAverages,
  } = input;

  let absenceRatePts = 0;
  let consecutivePts = 0;
  let trendPts = 0;
  let latePts = 0;
  let failingPts = 0;
  let lowAvgPts = 0;
  let declinePts = 0;
  let maxConsecutive = 0;
  let trendWorsening = false;

  // ─── 1. Absence rate (0-30) ───
  // Only kick in after minimum sessions
  if (totalSessions >= MIN_SESSIONS) {
    // Linear scale: 0% → 0pt, 10% → 15pt, 20%+ → 30pt
    absenceRatePts = Math.min(30, Math.round((absenceRate / 20) * 30));
  }

  // ─── 2. Consecutive absences (0-20) ───
  if (dailyStatuses.length >= MIN_SESSIONS) {
    let streak = 0;
    for (const day of dailyStatuses) {
      if (day.status === 'absent') {
        streak++;
        maxConsecutive = Math.max(maxConsecutive, streak);
      } else {
        streak = 0;
      }
    }
    if (maxConsecutive >= 5) consecutivePts = 20;
    else if (maxConsecutive >= 3) consecutivePts = 15;
    else if (maxConsecutive >= 2) consecutivePts = 8;
  }

  // ─── 3. Absence trend — recent vs prior (0-10) ───
  if (dailyStatuses.length >= 6) {
    const mid = Math.floor(dailyStatuses.length / 2);
    const olderHalf = dailyStatuses.slice(0, mid);
    const recentHalf = dailyStatuses.slice(mid);

    const olderAbsences = olderHalf.filter(d => d.status === 'absent').length;
    const recentAbsences = recentHalf.filter(d => d.status === 'absent').length;

    const olderRate = olderHalf.length > 0 ? olderAbsences / olderHalf.length : 0;
    const recentRate = recentHalf.length > 0 ? recentAbsences / recentHalf.length : 0;

    if (recentRate > olderRate + 0.05) {
      // Absences are getting worse
      trendWorsening = true;
      const delta = recentRate - olderRate;
      trendPts = Math.min(10, Math.round(delta * 50));
    }
  }

  // ─── 4. Late frequency (0-10) ───
  if (totalSessions >= MIN_SESSIONS) {
    const lateRate = totalSessions > 0 ? (lates / totalSessions) * 100 : 0;
    if (lateRate >= 25) latePts = 10;
    else if (lateRate >= 15) latePts = 7;
    else if (lateRate >= 10) latePts = 4;
  }

  // ─── 5. Failing subjects (0-15) ───
  if (failingSubjectCount >= 3) failingPts = 15;
  else if (failingSubjectCount === 2) failingPts = 12;
  else if (failingSubjectCount === 1) failingPts = 8;

  // ─── 6. Low overall average (0-10) ───
  if (averageGrade !== null) {
    if (averageGrade < 75) lowAvgPts = 10;
    else if (averageGrade < 78) lowAvgPts = 6;
    else if (averageGrade < 80) lowAvgPts = 3;
  }

  // ─── 7. Grade decline across quarters (0-5) ───
  const quarters = [...quarterAverages.entries()].sort((a, b) => a[0] - b[0]);
  if (quarters.length >= 2) {
    const latest = quarters[quarters.length - 1][1];
    const prior = quarters[quarters.length - 2][1];
    const drop = prior - latest;
    if (drop >= 5) declinePts = 5;
    else if (drop >= 3) declinePts = 3;
    else if (drop >= 1) declinePts = 1;
  }

  // ─── Total ───
  const score = Math.min(100,
    absenceRatePts + consecutivePts + trendPts +
    latePts + failingPts + lowAvgPts + declinePts
  );

  let status: 'critical' | 'at-risk' | 'good' = 'good';
  if (score >= 40) status = 'critical';
  else if (score >= 20) status = 'at-risk';

  return {
    score,
    status,
    breakdown: {
      absenceRate: absenceRatePts,
      consecutiveAbsences: consecutivePts,
      absenceTrend: trendPts,
      lateFrequency: latePts,
      failingSubjects: failingPts,
      lowAverage: lowAvgPts,
      gradeDecline: declinePts,
    },
    maxConsecutiveAbsences: maxConsecutive,
    trendWorsening,
  };
}
