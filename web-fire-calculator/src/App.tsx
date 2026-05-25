import { useMemo, useState } from "react";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  BarChart3,
  Calculator,
  DollarSign,
  HelpCircle,
  Percent,
  PiggyBank,
  SlidersHorizontal,
  TrendingUp,
} from "lucide-react";
import "./App.css";

const MAX_AGE = 120;
const MAX_ACCUMULATION_YEARS = 120;
const MAX_DRAWDOWN_YEARS = 120;
const MAX_REQUIRED_CONTRIBUTION_BEFORE_ERROR = 1_000_000;
const DISPLAY_TODAYS_DOLLARS = "Today's dollars";
const DISPLAY_NOMINAL_DOLLARS = "Nominal dollars";
const DISPLAY_MODES = [
  DISPLAY_TODAYS_DOLLARS,
  DISPLAY_NOMINAL_DOLLARS,
] as const;
const STANDARD_CHART = "Standard";
const BAR_CHART = "Bar graph";
const CHART_MODES = [STANDARD_CHART, BAR_CHART] as const;
const STOP_CONTRIBUTING_AT_FIRE = "FIRE goal";
const STOP_CONTRIBUTING_AT_AGE = "Specific age";

type AssetKey = "stocks" | "bonds" | "cash";
type DisplayMode = (typeof DISPLAY_MODES)[number];
type ChartMode = (typeof CHART_MODES)[number];
type ContributionStopMode =
  | typeof STOP_CONTRIBUTING_AT_FIRE
  | typeof STOP_CONTRIBUTING_AT_AGE;

type AssetInput = {
  key: AssetKey;
  name: string;
  allocation: number;
  returnRate: number;
};

type ProjectionPoint = {
  year: number;
  age: number;
  phase: "Saving" | "Retired";
  portfolio: number;
  contributions: number;
  growth: number;
  withdrawals: number;
  realWithdrawals: number;
  annualWithdrawal: number;
  annualWithdrawalYear: number;
};

type Plan = {
  calculatedField:
    | "Years to Retirement"
    | "Monthly Contributions"
    | "Expected Annual Expenses";
  fireReachable: boolean;
  warning: string | null;
  todayFireTarget: number;
  futureFireTarget: number;
  annualSavings: number;
  monthlyContribution: number;
  annualSpending: number;
  retirementAge: number;
  yearsToRetirement: number;
  portfolioAtRetirement: number;
  yearsFunded: number;
  effectiveReturn: number;
  projection: ProjectionPoint[];
};

type AccumulationRecord = {
  year: number;
  endingBalance: number;
  rollingContribution: number;
};

function numberFromInput(value: string, fallback = 0): number {
  const parsed = Number(value.replace(/[$,%\s,]/g, ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function optionalNumberFromInput(value: string): number | null {
  if (value.trim() === "") return null;

  const parsed = Number(value.replace(/[$,%\s,]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function money(value: number, maximumFractionDigits = 0): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits,
  }).format(value || 0);
}

function compactMoney(value: number): string {
  if (Math.abs(value) >= 1_000_000)
    return `$${(value / 1_000_000).toFixed(1)}m`;
  if (Math.abs(value) >= 1_000) return `$${Math.round(value / 1_000)}k`;
  return money(value);
}

function inflationFactor(inflationRate: number, year: number): number {
  return Math.pow(1 + Math.max(inflationRate, 0) / 100, year);
}

function displayAmount(
  value: number,
  displayMode: DisplayMode,
  inflationRate: number,
  year: number,
): number {
  if (displayMode === DISPLAY_NOMINAL_DOLLARS) return value;
  return value / inflationFactor(inflationRate, year);
}

function growBalanceForOneYear(args: {
  startingBalance: number;
  monthlyContribution: number;
  annualContribution: number;
  annualReturnPct: number;
}): number {
  const annualReturnRate = args.annualReturnPct / 100;
  const monthlyGrowthMultiplier = Math.pow(1 + annualReturnRate, 1 / 12);

  let balance = args.startingBalance + args.annualContribution;

  for (let month = 0; month < 12; month += 1) {
    balance += args.monthlyContribution;
    balance *= monthlyGrowthMultiplier;
  }

  return balance;
}

function projectAccumulationTimeline(args: {
  initialBalance: number;
  monthlyContribution: number;
  annualContribution: number;
  annualReturnPct: number;
  years: number;
  contributionYears?: number;
}): AccumulationRecord[] {
  const records: AccumulationRecord[] = [
    {
      year: 0,
      endingBalance: args.initialBalance,
      rollingContribution: 0,
    },
  ];

  let balance = args.initialBalance;
  let rollingContribution = 0;

  for (let year = 1; year <= args.years; year += 1) {
    const shouldContribute =
      args.contributionYears === undefined || year <= args.contributionYears;
    const monthlyContribution = shouldContribute ? args.monthlyContribution : 0;
    const annualContribution = shouldContribute ? args.annualContribution : 0;
    const totalContribution = annualContribution + monthlyContribution * 12;
    rollingContribution += totalContribution;
    balance = growBalanceForOneYear({
      startingBalance: balance,
      monthlyContribution,
      annualContribution,
      annualReturnPct: args.annualReturnPct,
    });

    records.push({ year, endingBalance: balance, rollingContribution });
  }

  return records;
}

function retirementTarget(
  expectedAnnualExpenses: number,
  withdrawalRatePct: number,
): number {
  return expectedAnnualExpenses / (withdrawalRatePct / 100);
}

function futureValue(
  todayValue: number,
  inflationRatePct: number,
  year: number,
): number {
  return todayValue * inflationFactor(inflationRatePct, year);
}

function todayValue(
  futureValueAmount: number,
  inflationRatePct: number,
  year: number,
): number {
  return futureValueAmount / inflationFactor(inflationRatePct, year);
}

function solveMonthlyContribution(args: {
  yearsToRetirement: number;
  expectedAnnualExpenses: number;
  annualContribution: number;
  initialBalance: number;
  annualReturnPct: number;
  inflationRatePct: number;
  withdrawalRatePct: number;
  contributionYears?: number;
}): { monthlyContribution: number; timeline: AccumulationRecord[] } {
  const todayTarget = retirementTarget(
    args.expectedAnnualExpenses,
    args.withdrawalRatePct,
  );
  const futureTarget = futureValue(
    todayTarget,
    args.inflationRatePct,
    args.yearsToRetirement,
  );

  const timelineFor = (monthlyContribution: number) =>
    projectAccumulationTimeline({
      initialBalance: args.initialBalance,
      monthlyContribution,
      annualContribution: args.annualContribution,
      annualReturnPct: args.annualReturnPct,
      years: args.yearsToRetirement,
      contributionYears: args.contributionYears,
    });

  const zeroTimeline = timelineFor(0);

  if (zeroTimeline[zeroTimeline.length - 1].endingBalance >= futureTarget) {
    return { monthlyContribution: 0, timeline: zeroTimeline };
  }

  let low = 0;
  let high = Math.max(25, args.expectedAnnualExpenses / 12);

  while (
    timelineFor(high)[timelineFor(high).length - 1].endingBalance < futureTarget
  ) {
    high *= 2;

    if (high > MAX_REQUIRED_CONTRIBUTION_BEFORE_ERROR) {
      break;
    }
  }

  for (let iteration = 0; iteration < 100; iteration += 1) {
    const mid = (low + high) / 2;
    const finalBalance = timelineFor(mid)[args.yearsToRetirement].endingBalance;

    if (finalBalance >= futureTarget) {
      high = mid;
    } else {
      low = mid;
    }
  }

  return { monthlyContribution: high, timeline: timelineFor(high) };
}

function solveExpectedAnnualExpenses(args: {
  yearsToRetirement: number;
  monthlyContribution: number;
  annualContribution: number;
  initialBalance: number;
  annualReturnPct: number;
  inflationRatePct: number;
  withdrawalRatePct: number;
  contributionYears?: number;
}): { expectedAnnualExpenses: number; timeline: AccumulationRecord[] } {
  const timeline = projectAccumulationTimeline({
    initialBalance: args.initialBalance,
    monthlyContribution: args.monthlyContribution,
    annualContribution: args.annualContribution,
    annualReturnPct: args.annualReturnPct,
    years: args.yearsToRetirement,
    contributionYears: args.contributionYears,
  });
  const nominalPortfolio = timeline[timeline.length - 1].endingBalance;
  const realPortfolio = todayValue(
    nominalPortfolio,
    args.inflationRatePct,
    args.yearsToRetirement,
  );

  return {
    expectedAnnualExpenses: realPortfolio * (args.withdrawalRatePct / 100),
    timeline,
  };
}

function rebalanceAllocations(
  assets: AssetInput[],
  changedKey: AssetKey,
  nextAllocation: number,
): AssetInput[] {
  const updated = assets.map((asset) =>
    asset.key === changedKey
      ? { ...asset, allocation: clamp(Math.round(nextAllocation), 0, 100) }
      : { ...asset },
  );
  const reduceOrder: Record<AssetKey, AssetKey[]> = {
    stocks: ["cash", "bonds"],
    bonds: ["cash", "stocks"],
    cash: ["bonds", "stocks"],
  };

  let total = updated.reduce((sum, asset) => sum + asset.allocation, 0);

  if (total > 100) {
    let overflow = total - 100;

    for (const keyToReduce of reduceOrder[changedKey]) {
      const asset = updated.find((candidate) => candidate.key === keyToReduce);
      if (!asset || overflow <= 0) continue;

      const reduction = Math.min(asset.allocation, overflow);
      asset.allocation -= reduction;
      overflow -= reduction;
    }
  }

  total = updated.reduce((sum, asset) => sum + asset.allocation, 0);

  if (total < 100) {
    const balancingKey: AssetKey = changedKey === "cash" ? "stocks" : "cash";
    const balancingAsset = updated.find((asset) => asset.key === balancingKey);
    if (balancingAsset) balancingAsset.allocation += 100 - total;
  }

  return updated;
}

function calculatePlan(args: {
  age: number;
  currentSavings: number;
  desiredFireAge: number | null;
  monthlyContribution: number | null;
  contributionStopMode: ContributionStopMode;
  contributionStopAge: number;
  annualSpending: number | null;
  withdrawalRate: number;
  inflationRate: number;
  assets: AssetInput[];
}): Plan {
  const safeWithdrawalRatePct = Math.max(args.withdrawalRate, 0.1);
  const annualContribution = 0;
  const currentAge = clamp(args.age, 0, MAX_AGE);
  const maxYearsByAge = Math.max(MAX_AGE - currentAge, 0);
  const accumulationHorizon = Math.min(MAX_ACCUMULATION_YEARS, maxYearsByAge);
  const desiredFireAge =
    args.desiredFireAge === null
      ? null
      : clamp(Math.round(args.desiredFireAge), currentAge, MAX_AGE);
  const desiredYearsToRetirement =
    desiredFireAge === null ? null : desiredFireAge - currentAge;
  const totalAllocation =
    args.assets.reduce((total, asset) => total + asset.allocation, 0) || 100;
  const effectiveReturnPct =
    args.assets.reduce(
      (total, asset) =>
        total + (asset.allocation / totalAllocation) * asset.returnRate,
      0,
    ) / 100;
  const effectiveReturn = effectiveReturnPct * 100;
  const inflationRatePct = Math.max(args.inflationRate, 0);
  const initialBalance = Math.max(args.currentSavings, 0);
  const contributionYears =
    args.contributionStopMode === STOP_CONTRIBUTING_AT_AGE
      ? Math.max(
          clamp(args.contributionStopAge, currentAge, MAX_AGE) - currentAge,
          0,
        )
      : undefined;

  let calculatedField: Plan["calculatedField"];
  let monthlyContribution = Math.max(args.monthlyContribution ?? 0, 0);
  let expectedAnnualExpenses = Math.max(args.annualSpending ?? 0, 0);
  let accumulationTimeline: AccumulationRecord[];
  let yearsToRetirement: number;
  let fireReachable: boolean;

  if (
    args.monthlyContribution === null &&
    args.annualSpending !== null &&
    desiredYearsToRetirement !== null
  ) {
    calculatedField = "Monthly Contributions";
    yearsToRetirement = desiredYearsToRetirement;
    const solved = solveMonthlyContribution({
      yearsToRetirement,
      expectedAnnualExpenses,
      annualContribution,
      initialBalance,
      annualReturnPct: effectiveReturn,
      inflationRatePct,
      withdrawalRatePct: safeWithdrawalRatePct,
      contributionYears,
    });
    monthlyContribution = solved.monthlyContribution;
    accumulationTimeline = solved.timeline;
    const futureTarget = futureValue(
      retirementTarget(expectedAnnualExpenses, safeWithdrawalRatePct),
      inflationRatePct,
      yearsToRetirement,
    );
    fireReachable =
      accumulationTimeline[accumulationTimeline.length - 1].endingBalance >=
      futureTarget;
  } else if (
    args.annualSpending === null &&
    args.monthlyContribution !== null &&
    desiredYearsToRetirement !== null
  ) {
    calculatedField = "Expected Annual Expenses";
    yearsToRetirement = desiredYearsToRetirement;
    const solved = solveExpectedAnnualExpenses({
      yearsToRetirement,
      monthlyContribution,
      annualContribution,
      initialBalance,
      annualReturnPct: effectiveReturn,
      inflationRatePct,
      withdrawalRatePct: safeWithdrawalRatePct,
      contributionYears,
    });
    expectedAnnualExpenses = solved.expectedAnnualExpenses;
    accumulationTimeline = solved.timeline;
    fireReachable = expectedAnnualExpenses > 0;
  } else {
    calculatedField = "Years to Retirement";
    const todayFireTarget = retirementTarget(
      expectedAnnualExpenses,
      safeWithdrawalRatePct,
    );
    const fullTimeline = projectAccumulationTimeline({
      initialBalance,
      monthlyContribution,
      annualContribution,
      annualReturnPct: effectiveReturn,
      years: accumulationHorizon,
      contributionYears,
    });

    const reachedRecord = fullTimeline.find((record) => {
      const futureTarget = futureValue(
        todayFireTarget,
        inflationRatePct,
        record.year,
      );
      return record.endingBalance >= futureTarget;
    });

    if (reachedRecord) {
      yearsToRetirement = reachedRecord.year;
      fireReachable = true;
      accumulationTimeline = fullTimeline.slice(0, yearsToRetirement + 1);
    } else {
      yearsToRetirement = accumulationHorizon;
      fireReachable = false;
      accumulationTimeline = fullTimeline;
    }
  }

  const annualSavings = monthlyContribution * 12 + annualContribution;
  const todayFireTarget = retirementTarget(
    expectedAnnualExpenses,
    safeWithdrawalRatePct,
  );
  const futureFireTarget = futureValue(
    todayFireTarget,
    inflationRatePct,
    yearsToRetirement,
  );
  const portfolioAtRetirement =
    accumulationTimeline[accumulationTimeline.length - 1]?.endingBalance ??
    initialBalance;

  const projection: ProjectionPoint[] = [];

  for (const record of accumulationTimeline) {
    const contributions = initialBalance + record.rollingContribution;
    projection.push({
      year: record.year,
      age: currentAge + record.year,
      phase: "Saving",
      portfolio: record.endingBalance,
      contributions,
      growth: Math.max(record.endingBalance - contributions, 0),
      withdrawals: 0,
      realWithdrawals: 0,
      annualWithdrawal: 0,
      annualWithdrawalYear: record.year,
    });
  }

  let portfolio = portfolioAtRetirement;
  const contributions =
    initialBalance +
    (accumulationTimeline[accumulationTimeline.length - 1]
      ?.rollingContribution ?? 0);
  let contributionBucket = Math.min(contributions, portfolioAtRetirement);
  let growthBucket = Math.max(portfolioAtRetirement - contributionBucket, 0);
  let cumulativeWithdrawals = 0;
  let cumulativeRealWithdrawals = 0;
  let yearsFunded = 0;
  const maxDrawdownYears = fireReachable
    ? Math.min(
        MAX_DRAWDOWN_YEARS,
        Math.max(MAX_AGE - (currentAge + yearsToRetirement), 0),
      )
    : 0;

  for (
    let drawdownYear = 1;
    drawdownYear <= maxDrawdownYears;
    drawdownYear += 1
  ) {
    const absoluteYear = yearsToRetirement + drawdownYear - 1;
    const plannedWithdrawal =
      expectedAnnualExpenses * inflationFactor(inflationRatePct, absoluteYear);
    const actualWithdrawal = Math.min(portfolio, plannedWithdrawal);
    const growthWithdrawal = Math.min(growthBucket, actualWithdrawal);
    const contributionWithdrawal = actualWithdrawal - growthWithdrawal;

    growthBucket -= growthWithdrawal;
    contributionBucket = Math.max(
      contributionBucket - contributionWithdrawal,
      0,
    );
    portfolio = contributionBucket + growthBucket;
    cumulativeWithdrawals += actualWithdrawal;
    cumulativeRealWithdrawals += todayValue(
      actualWithdrawal,
      inflationRatePct,
      absoluteYear,
    );
    const balanceBeforeGrowth = portfolio;
    portfolio *= 1 + effectiveReturnPct;
    const investmentGrowth = portfolio - balanceBeforeGrowth;
    growthBucket += investmentGrowth;
    portfolio = contributionBucket + growthBucket;
    yearsFunded = drawdownYear;

    projection.push({
      year: absoluteYear + 1,
      age: currentAge + absoluteYear + 1,
      phase: "Retired",
      portfolio,
      contributions: contributionBucket,
      growth: growthBucket,
      withdrawals: cumulativeWithdrawals,
      realWithdrawals: cumulativeRealWithdrawals,
      annualWithdrawal: actualWithdrawal,
      annualWithdrawalYear: absoluteYear,
    });

    if (actualWithdrawal < plannedWithdrawal || portfolio <= 0) break;
  }

  const warning = fireReachable
    ? null
    : "With these current inputs, FIRE will not be reached.";

  return {
    calculatedField,
    fireReachable,
    warning,
    todayFireTarget,
    futureFireTarget,
    annualSavings,
    monthlyContribution,
    annualSpending: expectedAnnualExpenses,
    retirementAge: currentAge + yearsToRetirement,
    yearsToRetirement,
    portfolioAtRetirement,
    yearsFunded,
    effectiveReturn,
    projection,
  };
}

function Field(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  prefix?: string;
  suffix?: string;
  help?: string;
}) {
  return (
    <label className="field">
      <span className="field-label">
        {props.label}
        {props.help ? (
          <span className="help">
            <HelpCircle size={15} />
            <span className="help-text">{props.help}</span>
          </span>
        ) : null}
      </span>
      <span className="field-control">
        {props.prefix ? (
          <span className="field-affix">{props.prefix}</span>
        ) : null}
        <input
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
          inputMode="decimal"
        />
        {props.suffix ? (
          <span className="field-affix">{props.suffix}</span>
        ) : null}
      </span>
    </label>
  );
}

function SegmentedControl(props: {
  value: DisplayMode;
  onChange: (value: DisplayMode) => void;
}) {
  return (
    <div className="segmented-control" aria-label="Dollar display mode">
      {DISPLAY_MODES.map((mode) => (
        <button
          key={mode}
          type="button"
          className={props.value === mode ? "active" : ""}
          onClick={() => props.onChange(mode)}
        >
          {mode}
        </button>
      ))}
    </div>
  );
}

function ChartModeToggle(props: {
  value: ChartMode;
  onChange: (value: ChartMode) => void;
}) {
  return (
    <div className="chart-mode-toggle" aria-label="Projection chart view">
      {CHART_MODES.map((mode) => (
        <button
          key={mode}
          type="button"
          className={props.value === mode ? "active" : ""}
          onClick={() => props.onChange(mode)}
        >
          {mode === STANDARD_CHART ? (
            <TrendingUp size={16} aria-hidden="true" />
          ) : (
            <BarChart3 size={16} aria-hidden="true" />
          )}
          <span>{mode}</span>
        </button>
      ))}
    </div>
  );
}

function ContributionStopToggle(props: {
  value: ContributionStopMode;
  onChange: (value: ContributionStopMode) => void;
}) {
  const options: ContributionStopMode[] = [
    STOP_CONTRIBUTING_AT_FIRE,
    STOP_CONTRIBUTING_AT_AGE,
  ];

  return (
    <div className="segmented-control" aria-label="Contribution stop mode">
      {options.map((mode) => (
        <button
          key={mode}
          type="button"
          className={props.value === mode ? "active" : ""}
          onClick={() => props.onChange(mode)}
        >
          {mode}
        </button>
      ))}
    </div>
  );
}

function Panel(props: {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="panel">
      <p className="eyebrow">{props.eyebrow}</p>
      <h2>{props.title}</h2>
      <div className="panel-body">{props.children}</div>
    </section>
  );
}

function Stat(props: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="stat">
      <span className="stat-icon">{props.icon}</span>
      <strong>{props.value}</strong>
      <span>{props.label}</span>
    </div>
  );
}

function AssetRow(props: {
  asset: AssetInput;
  onAllocationChange: (value: number) => void;
  onReturnChange: (value: number) => void;
}) {
  return (
    <div className="asset-row">
      <div className="asset-heading">
        <strong>{props.asset.name}</strong>
      </div>

      <label className="slider-row">
        <span>Allocation</span>
        <b>{props.asset.allocation}%</b>
        <input
          type="range"
          min="0"
          max="100"
          value={props.asset.allocation}
          onChange={(event) =>
            props.onAllocationChange(Number(event.target.value))
          }
        />
      </label>

      <label className="mini-field">
        <span>Growth rate</span>
        <input
          value={props.asset.returnRate}
          onChange={(event) =>
            props.onReturnChange(
              numberFromInput(event.target.value, props.asset.returnRate),
            )
          }
          inputMode="decimal"
        />
        <span>%</span>
      </label>
    </div>
  );
}

type TooltipEntry = {
  dataKey: string;
  value: number;
  payload: ProjectionPoint;
  name?: string;
};

function ProjectionTooltip(props: {
  active?: boolean;
  payload?: TooltipEntry[];
  chartMode: ChartMode;
  displayMode: DisplayMode;
}) {
  if (!props.active || !props.payload?.length) return null;

  const point = props.payload[0]?.payload as ProjectionPoint;
  const details = props.payload.filter((entry) =>
    [
      "contributionShade",
      "growthShade",
      "withdrawals",
      "withdrawalBar",
    ].includes(entry.dataKey),
  );
  const total = point.portfolio;

  return (
    <div
      className={
        props.chartMode === BAR_CHART
          ? "chart-tooltip bar-chart-tooltip"
          : "chart-tooltip"
      }
    >
      <p className="tooltip-title">
        Age {point.age} - {point.phase}
      </p>
      <div className="tooltip-total">
        <span>Total</span>
        <strong>{money(total)}</strong>
      </div>
      {details.map((entry) => {
        const label =
          entry.dataKey === "contributionShade"
            ? "Contributions"
            : entry.dataKey === "growthShade"
              ? "Growth"
              : "Spending";
        return (
          <div key={entry.dataKey} className="tooltip-line">
            <span className={`tooltip-marker ${entry.dataKey}`} />
            <span>{label}</span>
            <strong>{money(Math.abs(entry.value))}</strong>
          </div>
        );
      })}
      {point.annualWithdrawal > 0 &&
      props.displayMode === DISPLAY_NOMINAL_DOLLARS ? (
        <div className="tooltip-line">
          <span className="tooltip-marker annualWithdrawal" />
          <span>Annual draw</span>
          <strong>{money(point.annualWithdrawal)}</strong>
        </div>
      ) : null}
    </div>
  );
}

export default function App() {
  const [age, setAge] = useState("23");
  const [currentSavings, setCurrentSavings] = useState("936");
  const [monthlyContribution, setMonthlyContribution] = useState("411"); // 3618, 4118, 4618
  const [annualSpending, setAnnualSpending] = useState("70000");
  const [withdrawalRate, setWithdrawalRate] = useState("3.5");
  const [inflationRate, setInflationRate] = useState("3");
  const [desiredFireAge, setDesiredFireAge] = useState("");
  const [displayMode, setDisplayMode] = useState<DisplayMode>(
    DISPLAY_TODAYS_DOLLARS,
  );
  const [chartMode, setChartMode] = useState<ChartMode>(STANDARD_CHART);
  const [contributionStopMode, setContributionStopMode] =
    useState<ContributionStopMode>(STOP_CONTRIBUTING_AT_FIRE);
  const [contributionStopAge, setContributionStopAge] = useState("60");
  const [assets, setAssets] = useState<AssetInput[]>([
    { key: "stocks", name: "Stocks / ETFs", allocation: 100, returnRate: 10 },
    { key: "bonds", name: "Savings / Bonds", allocation: 0, returnRate: 4 },
    { key: "cash", name: "Cash", allocation: 0, returnRate: 0 },
  ]);

  const plan = useMemo(
    () =>
      calculatePlan({
        age: clamp(Math.round(numberFromInput(age, 30)), 0, MAX_AGE),
        currentSavings: numberFromInput(currentSavings),
        desiredFireAge: optionalNumberFromInput(desiredFireAge),
        monthlyContribution: optionalNumberFromInput(monthlyContribution),
        contributionStopMode,
        contributionStopAge: clamp(
          Math.round(
            numberFromInput(contributionStopAge, numberFromInput(age, 30)),
          ),
          0,
          120,
        ),
        annualSpending: optionalNumberFromInput(annualSpending),
        withdrawalRate: numberFromInput(withdrawalRate, 4),
        inflationRate: numberFromInput(inflationRate, 3),
        assets,
      }),
    [
      age,
      currentSavings,
      monthlyContribution,
      desiredFireAge,
      contributionStopMode,
      contributionStopAge,
      annualSpending,
      withdrawalRate,
      inflationRate,
      assets,
    ],
  );

  const chartData = useMemo(() => {
    const inflation = numberFromInput(inflationRate, 3);
    return plan.projection.map((point) => ({
      ...point,
      portfolio: displayAmount(
        point.portfolio,
        displayMode,
        inflation,
        point.year,
      ),
      contributionShade: displayAmount(
        Math.min(point.contributions, point.portfolio),
        displayMode,
        inflation,
        point.year,
      ),
      growthShade: displayAmount(
        Math.max(
          point.portfolio - Math.min(point.contributions, point.portfolio),
          0,
        ),
        displayMode,
        inflation,
        point.year,
      ),
      withdrawals:
        displayMode === DISPLAY_TODAYS_DOLLARS
          ? point.realWithdrawals
          : displayAmount(
              point.withdrawals,
              displayMode,
              inflation,
              point.year,
            ),
      withdrawalBar:
        displayMode === DISPLAY_TODAYS_DOLLARS
          ? -point.realWithdrawals
          : -displayAmount(
              point.withdrawals,
              displayMode,
              inflation,
              point.year,
            ),
      annualWithdrawal: displayAmount(
        point.annualWithdrawal,
        displayMode,
        inflation,
        point.annualWithdrawalYear,
      ),
      fireTarget: displayAmount(
        plan.futureFireTarget,
        displayMode,
        inflation,
        plan.yearsToRetirement,
      ),
      retirementLine:
        point.year === plan.yearsToRetirement ? point.portfolio : null,
    }));
  }, [displayMode, inflationRate, plan]);

  const totalAllocation = assets.reduce(
    (total, asset) => total + asset.allocation,
    0,
  );
  const inflationRateNumber = numberFromInput(inflationRate, 3);
  const displayedFireTarget = displayAmount(
    plan.futureFireTarget,
    displayMode,
    inflationRateNumber,
    plan.yearsToRetirement,
  );
  const displayedPortfolioAtRetirement = displayAmount(
    plan.portfolioAtRetirement,
    displayMode,
    inflationRateNumber,
    plan.yearsToRetirement,
  );
  const calculatedValue =
    plan.calculatedField === "Monthly Contributions"
      ? money(plan.monthlyContribution, 2)
      : plan.calculatedField === "Expected Annual Expenses"
        ? money(plan.annualSpending, 2)
        : `${plan.fireReachable ? plan.yearsToRetirement : `>${plan.yearsToRetirement}`} years`;

  function updateAsset(key: AssetKey, changes: Partial<AssetInput>) {
    setAssets((current) =>
      current.map((asset) =>
        asset.key === key ? { ...asset, ...changes } : asset,
      ),
    );
  }

  function updateAllocation(key: AssetKey, allocation: number) {
    setAssets((current) => rebalanceAllocations(current, key, allocation));
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <span className="brand-mark">
            <Calculator size={18} />
            Financial Independence, Retire Early (FIRE)
          </span>
          <h1>Retirement Calculator</h1>
        </div>
      </header>

      <section className="calculator-grid" aria-label="Calculator inputs">
        <div className="left-stack">
          <Panel eyebrow="Today" title="Your situation">
            <Field label="Age" value={age} onChange={setAge} />
            <Field
              label="Current savings"
              value={currentSavings}
              onChange={setCurrentSavings}
              prefix="$"
            />
            <Field
              label="Saving monthly"
              value={monthlyContribution}
              onChange={setMonthlyContribution}
              prefix="$"
              help="Leave this blank to calculate the monthly savings needed for your desired FIRE age. Assumption: each monthly contribution is invested at the start of the month."
            />
          </Panel>

          <Panel eyebrow="Later" title="Your retirement">
            <Field
              label="Annual spending"
              value={annualSpending}
              onChange={setAnnualSpending}
              prefix="$"
              help="Leave this blank to calculate the annual spending level supported by your savings and desired FIRE age."
            />
            <Field
              label="Withdrawal rate"
              value={withdrawalRate}
              onChange={setWithdrawalRate}
              suffix="%"
            />
            <Field
              label="Inflation"
              value={inflationRate}
              onChange={setInflationRate}
              suffix="%"
              help="Used to inflate your future FIRE target and retirement withdrawals. Today's dollars reverses this inflation for display."
            />
            <details className="advanced-investments advanced-settings">
              <summary>
                <SlidersHorizontal size={17} />
                Advanced Settings
              </summary>

              <div className="advanced-settings-body">
                <Field
                  label="Desired FIRE age"
                  value={desiredFireAge}
                  onChange={setDesiredFireAge}
                  help="Used when monthly savings or annual spending is left blank."
                />
                <div className="display-mode-row">
                  <span>Contribute until</span>
                  <ContributionStopToggle
                    value={contributionStopMode}
                    onChange={setContributionStopMode}
                  />
                </div>
                {contributionStopMode === STOP_CONTRIBUTING_AT_AGE ? (
                  <Field
                    label="Stop age"
                    value={contributionStopAge}
                    onChange={setContributionStopAge}
                  />
                ) : null}
                <div className="display-mode-row">
                  <span className="row-label-with-help">
                    Display
                    <span className="help">
                      <HelpCircle size={15} />
                      <span className="help-text">
                        Today's dollars adjust future values for inflation so
                        they are shown in current purchasing power. Nominal
                        dollars show the actual future dollar amounts without
                        adjusting for inflation.
                      </span>
                    </span>
                  </span>
                  <SegmentedControl
                    value={displayMode}
                    onChange={setDisplayMode}
                  />
                </div>
              </div>
            </details>
          </Panel>
        </div>

        <Panel eyebrow="The plan" title="Your return assumption">
          <div className="asset-list compact">
            {assets
              .filter((asset) => asset.key === "stocks")
              .map((asset) => (
                <AssetRow
                  key={asset.key}
                  asset={asset}
                  onAllocationChange={(allocation) =>
                    updateAllocation(asset.key, allocation)
                  }
                  onReturnChange={(returnRate) =>
                    updateAsset(asset.key, { returnRate })
                  }
                />
              ))}
          </div>

          <details className="advanced-investments">
            <summary>
              <SlidersHorizontal size={17} />
              Advanced investments
            </summary>
            <div className="asset-list">
              {assets
                .filter((asset) => asset.key !== "stocks")
                .map((asset) => (
                  <AssetRow
                    key={asset.key}
                    asset={asset}
                    onAllocationChange={(allocation) =>
                      updateAllocation(asset.key, allocation)
                    }
                    onReturnChange={(returnRate) =>
                      updateAsset(asset.key, { returnRate })
                    }
                  />
                ))}
            </div>
          </details>
          <div
            className={
              totalAllocation === 100 ? "return-note" : "return-note warning"
            }
          >
            <strong>
              Effective overall rate of return:{" "}
              {plan.effectiveReturn.toFixed(2)}%
            </strong>
            <span>
              Allocation total: {totalAllocation}%. This must equal 100%, so
              changing one allocation automatically rebalances the others.
            </span>
          </div>
        </Panel>
      </section>

      <section className="results-band" aria-label="Calculator results">
        <Stat
          label={`Your FIRE target (${displayMode})`}
          value={money(displayedFireTarget, 2)}
          icon={<DollarSign size={22} />}
        />
        <Stat
          label={
            plan.fireReachable ? "Retirement age" : "Projected through age"
          }
          value={String(plan.retirementAge)}
          icon={<TrendingUp size={24} />}
        />
        <Stat
          label="Annual savings"
          value={money(plan.annualSavings, 2)}
          icon={<PiggyBank size={22} />}
        />
        <Stat
          label={`Calculated ${plan.calculatedField}`}
          value={calculatedValue}
          icon={<Calculator size={22} />}
        />
      </section>

      {plan.warning ? (
        <section className="warning-banner" role="alert">
          <strong>{plan.warning}</strong>
          <span>
            The graph still projects the current path through age {MAX_AGE};
            adjust savings, spending, returns, or timing to make FIRE reachable.
          </span>
        </section>
      ) : null}

      <section className="projection-card">
        <p className="eyebrow">The journey ahead</p>
        <div className="projection-heading">
          <h2>Your FIRE projection</h2>
        </div>

        <div className="chart-wrap">
          <div
            className={
              chartMode === BAR_CHART
                ? "chart-stage bar-chart-stage"
                : "chart-stage"
            }
            style={
              chartMode === BAR_CHART
                ? { minWidth: `${Math.max(880, chartData.length * 34)}px` }
                : undefined
            }
          >
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={chartData}
                margin={{ top: 28, right: 22, bottom: 22, left: 8 }}
                barCategoryGap={chartMode === BAR_CHART ? "18%" : undefined}
                barGap={chartMode === BAR_CHART ? 0 : undefined}
              >
                <CartesianGrid stroke="#edf0fb" vertical={false} />
                <XAxis
                  dataKey="age"
                  tickLine={false}
                  axisLine={false}
                  minTickGap={28}
                  label={{
                    value: "Age",
                    position: "insideBottom",
                    offset: -10,
                    fill: "#001a52",
                    fontSize: 12,
                  }}
                />
                <YAxis
                  orientation="right"
                  tickFormatter={compactMoney}
                  tickLine={false}
                  axisLine={false}
                  width={58}
                />
                <Tooltip
                  content={
                    <ProjectionTooltip
                      chartMode={chartMode}
                      displayMode={displayMode}
                    />
                  }
                />
                <Legend
                  verticalAlign="bottom"
                  iconType="circle"
                  wrapperStyle={{ paddingTop: 24 }}
                />
                {chartMode === BAR_CHART ? (
                  <ReferenceLine y={0} stroke="#d7dcea" />
                ) : null}
                <ReferenceLine
                  y={displayedFireTarget}
                  stroke="#147a52"
                  strokeDasharray="3 3"
                  label={{
                    value: `Goal: ${compactMoney(displayedFireTarget)}`,
                    position: "insideTopLeft",
                    fill: "#147a52",
                  }}
                />
                <ReferenceLine
                  x={plan.retirementAge}
                  stroke="#d7d7df"
                  label={{
                    value: plan.fireReachable
                      ? `Retire at ${plan.retirementAge}`
                      : `Projected to ${plan.retirementAge}`,
                    position: "top",
                    fill: "#5130ee",
                  }}
                />

                {chartMode === STANDARD_CHART ? (
                  <>
                    <Area
                      type="monotone"
                      dataKey="contributionShade"
                      name="Contributions"
                      stackId="portfolio"
                      stroke="#326fc9"
                      fill="#326fc9"
                      fillOpacity={0.32}
                      strokeWidth={2}
                      dot={false}
                    />
                    <Area
                      type="monotone"
                      dataKey="growthShade"
                      name="Growth"
                      stackId="portfolio"
                      stroke="#6b7f14"
                      fill="#6b7f14"
                      fillOpacity={0.24}
                      strokeWidth={2}
                      dot={false}
                    />
                    <Area
                      type="monotone"
                      dataKey="withdrawals"
                      name="Withdrawal"
                      stroke="#d85b2a"
                      fill="#d85b2a"
                      fillOpacity={0.18}
                      strokeWidth={2}
                      dot={false}
                    />
                  </>
                ) : (
                  <>
                    <Bar
                      dataKey="contributionShade"
                      name="Contributions"
                      stackId="assets"
                      fill="#326fc9"
                      radius={[10, 10, 0, 0]}
                      maxBarSize={32}
                    />
                    <Bar
                      dataKey="growthShade"
                      name="Growth"
                      stackId="assets"
                      fill="#97a836"
                      radius={[10, 10, 0, 0]}
                      maxBarSize={32}
                    />
                    <Bar
                      dataKey="withdrawalBar"
                      name="Spending"
                      fill="#d85b2a"
                      radius={[0, 0, 10, 10]}
                      maxBarSize={32}
                    />
                  </>
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="projection-summary">
          <div>
            <BarChart3 size={18} />
            <span>
              {plan.fireReachable
                ? `${plan.yearsToRetirement} years until target`
                : `Not reached by age ${MAX_AGE}`}
            </span>
          </div>
          <div>
            <DollarSign size={18} />
            <span>
              {money(displayedPortfolioAtRetirement)} projected at retirement
            </span>
          </div>
          <div>
            <Percent size={18} />
            <span>
              {plan.yearsFunded >= MAX_DRAWDOWN_YEARS
                ? `${MAX_DRAWDOWN_YEARS}+`
                : plan.yearsFunded}{" "}
              drawdown years shown
            </span>
          </div>
        </div>
      </section>
    </main>
  );
}
