import { useEffect, useMemo, useRef, useState } from "react";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  ReferenceLine,
  Rectangle,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { BarShapeProps } from "recharts/types/cartesian/Bar";
import {
  BarChart3,
  Calculator,
  ChartNoAxesCombined,
  DollarSign,
  HelpCircle,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  PiggyBank,
  SlidersHorizontal,
  Sun,
  TrendingUp,
} from "lucide-react";
import "./App.css";

const DEFAULT_FINAL_CHART_AGE = 85;
const MAX_SUPPORTED_AGE = 150;
const MAX_ACCUMULATION_YEARS = MAX_SUPPORTED_AGE;
const MAX_DRAWDOWN_YEARS = MAX_SUPPORTED_AGE;
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
const BAR_GAP_PX = 2;
const PROJECTION_LEGEND_ITEMS = [
  { label: "Contributions", color: "#18b6ff" },
  { label: "Growth", color: "#20bf75" },
  { label: "Drawdown", color: "#ff4c9a" },
] as const;
const STOP_CONTRIBUTING_AT_FIRE = "FIRE goal";
const STOP_CONTRIBUTING_AT_AGE = "Specific age";
const THEME_STORAGE_KEY = "fire-calculator-theme";

type AssetKey = "stocks" | "bonds" | "cash";
type DisplayMode = (typeof DISPLAY_MODES)[number];
type ChartMode = (typeof CHART_MODES)[number];
type ThemeMode = "light" | "dark";
type ContributionStopMode =
  | typeof STOP_CONTRIBUTING_AT_FIRE
  | typeof STOP_CONTRIBUTING_AT_AGE;

function BarShape(props: BarShapeProps & { gap?: number }) {
  const gap = props.gap ?? BAR_GAP_PX;
  const x = Math.floor(props.x + gap / 2);
  const right = Math.ceil(props.x + props.width - gap / 2);

  return <Rectangle {...props} x={x} width={Math.max(right - x, 1)} />;
}

function ActiveBar(props: BarShapeProps) {
  return <BarShape {...props} />;
}

type AssetInput = {
  key: AssetKey;
  name: string;
  currentValue: string;
  returnRate: string;
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
  finalChartAge: number;
  effectiveReturn: number;
  projection: ProjectionPoint[];
};

type AccumulationRecord = {
  year: number;
  endingBalance: number;
  rollingContribution: number;
  assetBalances: ProjectedAssetBalance[];
};

type ProjectedAssetBalance = {
  key: AssetKey;
  balance: number;
  returnRate: number;
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

function decimalInput(value: string, decimalPlaces: number): string {
  const isNegative = value.trim().startsWith("-");
  const numeric = value.replace(/[^\d.]/g, "");
  const [integer = "", ...decimalParts] = numeric.split(".");
  const decimal = decimalParts.join("").slice(0, decimalPlaces);
  const sign = isNegative ? "-" : "";

  if (value.includes(".")) return `${sign}${integer || "0"}.${decimal}`;
  return `${sign}${integer}`;
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

function assetsIncludeStocks(assets: ProjectedAssetBalance[]): boolean {
  return assets.some((asset) => asset.key === "stocks");
}

function shouldAssetReceiveContributions(
  asset: ProjectedAssetBalance,
  assets: ProjectedAssetBalance[],
): boolean {
  return asset.key === "stocks" || !assetsIncludeStocks(assets);
}

function growAssetsForOneYear(
  assets: ProjectedAssetBalance[],
): ProjectedAssetBalance[] {
  return assets.map((asset) => ({
    ...asset,
    balance: growBalanceForOneYear({
      startingBalance: asset.balance,
      monthlyContribution: 0,
      annualContribution: 0,
      annualReturnPct: asset.returnRate,
    }),
  }));
}

function addContributionToAssets(
  assets: ProjectedAssetBalance[],
  contribution: number,
): ProjectedAssetBalance[] {
  return assets.map((asset) =>
    shouldAssetReceiveContributions(asset, assets)
      ? { ...asset, balance: asset.balance + contribution }
      : asset,
  );
}

function withdrawFromAssets(
  assets: ProjectedAssetBalance[],
  withdrawal: number,
): ProjectedAssetBalance[] {
  const totalBalance = assets.reduce(
    (total, asset) => total + asset.balance,
    0,
  );
  if (totalBalance <= 0 || withdrawal <= 0) return assets;

  return assets.map((asset) => ({
    ...asset,
    balance: Math.max(
      asset.balance - withdrawal * (asset.balance / totalBalance),
      0,
    ),
  }));
}

function projectAccumulationTimeline(args: {
  assets: ProjectedAssetBalance[];
  monthlyContribution: number;
  annualContribution: number;
  years: number;
  contributionYears?: number;
}): AccumulationRecord[] {
  const initialAssets = args.assets.map((asset) => ({ ...asset }));
  const records: AccumulationRecord[] = [
    {
      year: 0,
      endingBalance: initialAssets.reduce(
        (total, asset) => total + asset.balance,
        0,
      ),
      rollingContribution: 0,
      assetBalances: initialAssets,
    },
  ];

  let assetBalances = initialAssets;
  let rollingContribution = 0;

  for (let year = 1; year <= args.years; year += 1) {
    const shouldContribute =
      args.contributionYears === undefined || year <= args.contributionYears;
    const monthlyContribution = shouldContribute ? args.monthlyContribution : 0;
    const annualContribution = shouldContribute ? args.annualContribution : 0;
    const totalContribution = annualContribution + monthlyContribution * 12;
    rollingContribution += totalContribution;
    assetBalances = assetBalances.map((asset) => {
      return {
        ...asset,
        balance: growBalanceForOneYear({
          startingBalance: asset.balance,
          monthlyContribution: shouldAssetReceiveContributions(
            asset,
            assetBalances,
          )
            ? monthlyContribution
            : 0,
          annualContribution: shouldAssetReceiveContributions(
            asset,
            assetBalances,
          )
            ? annualContribution
            : 0,
          annualReturnPct: asset.returnRate,
        }),
      };
    });

    records.push({
      year,
      endingBalance: assetBalances.reduce(
        (total, asset) => total + asset.balance,
        0,
      ),
      rollingContribution,
      assetBalances: assetBalances.map((asset) => ({ ...asset })),
    });
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
  assets: ProjectedAssetBalance[];
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
      assets: args.assets,
      monthlyContribution,
      annualContribution: args.annualContribution,
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
  assets: ProjectedAssetBalance[];
  inflationRatePct: number;
  withdrawalRatePct: number;
  contributionYears?: number;
}): { expectedAnnualExpenses: number; timeline: AccumulationRecord[] } {
  const timeline = projectAccumulationTimeline({
    assets: args.assets,
    monthlyContribution: args.monthlyContribution,
    annualContribution: args.annualContribution,
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
  finalChartAge: number;
  assets: AssetInput[];
}): Plan {
  const safeWithdrawalRatePct = Math.max(args.withdrawalRate, 0.1);
  const annualContribution = 0;
  const currentAge = clamp(args.age, 0, MAX_SUPPORTED_AGE);
  const finalChartAge = clamp(
    Math.round(args.finalChartAge),
    currentAge,
    MAX_SUPPORTED_AGE,
  );
  const maxYearsByAge = Math.max(finalChartAge - currentAge, 0);
  const accumulationHorizon = Math.min(MAX_ACCUMULATION_YEARS, maxYearsByAge);
  const desiredFireAge =
    args.desiredFireAge === null
      ? null
      : clamp(Math.round(args.desiredFireAge), currentAge, finalChartAge);
  const desiredYearsToRetirement =
    desiredFireAge === null ? null : desiredFireAge - currentAge;
  const assetBalances = args.assets.map((asset) => ({
    ...asset,
    balance: Math.max(numberFromInput(asset.currentValue), 0),
    returnRate: numberFromInput(asset.returnRate),
  }));
  const projectedAssetBalances: ProjectedAssetBalance[] = assetBalances.map(
    (asset) => ({
      key: asset.key,
      balance: asset.balance,
      returnRate: asset.returnRate,
    }),
  );
  const totalCurrentInvestments = assetBalances.reduce(
    (total, asset) => total + asset.balance,
    0,
  );
  const fallbackReturn =
    assetBalances.find((asset) => asset.key === "stocks")?.returnRate ?? 0;
  const effectiveReturnPct =
    totalCurrentInvestments > 0
      ? assetBalances.reduce(
          (total, asset) =>
            total +
            (asset.balance / totalCurrentInvestments) * asset.returnRate,
          0,
        ) / 100
      : fallbackReturn / 100;
  const effectiveReturn = effectiveReturnPct * 100;
  const inflationRatePct = Math.max(args.inflationRate, 0);
  const initialBalance = Math.max(args.currentSavings, 0);
  const contributionYears =
    args.contributionStopMode === STOP_CONTRIBUTING_AT_AGE
      ? Math.max(
          clamp(args.contributionStopAge, currentAge, finalChartAge) -
            currentAge,
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
      assets: projectedAssetBalances,
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
      assets: projectedAssetBalances,
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
      assets: projectedAssetBalances,
      monthlyContribution,
      annualContribution,
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

  let retirementAssetBalances =
    accumulationTimeline[accumulationTimeline.length - 1]?.assetBalances.map(
      (asset) => ({ ...asset }),
    ) ?? projectedAssetBalances.map((asset) => ({ ...asset }));
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
        Math.max(finalChartAge - (currentAge + yearsToRetirement), 0),
      )
    : 0;

  for (
    let drawdownYear = 1;
    drawdownYear <= maxDrawdownYears;
    drawdownYear += 1
  ) {
    const absoluteYear = yearsToRetirement + drawdownYear - 1;
    const shouldContributeThisYear =
      contributionYears !== undefined && absoluteYear < contributionYears;
    const postFireContribution = shouldContributeThisYear ? annualSavings : 0;

    if (postFireContribution > 0) {
      contributionBucket += postFireContribution;
      retirementAssetBalances = addContributionToAssets(
        retirementAssetBalances,
        postFireContribution,
      );
      portfolio += postFireContribution;
    }

    const plannedWithdrawal =
      expectedAnnualExpenses * inflationFactor(inflationRatePct, absoluteYear);
    const actualWithdrawal = Math.min(portfolio, plannedWithdrawal);
    retirementAssetBalances = withdrawFromAssets(
      retirementAssetBalances,
      actualWithdrawal,
    );
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
    retirementAssetBalances = growAssetsForOneYear(retirementAssetBalances);
    portfolio = retirementAssetBalances.reduce(
      (total, asset) => total + asset.balance,
      0,
    );
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
    finalChartAge,
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
  onBlur?: () => void;
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
          aria-label={props.label}
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
          onBlur={props.onBlur}
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
            <ChartNoAxesCombined size={16} aria-hidden="true" />
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

function Panel(props: { title: string; children: React.ReactNode }) {
  return (
    <section className="panel">
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
  showCurrentValue?: boolean;
  onCurrentValueChange: (value: string) => void;
  onReturnChange: (value: string) => void;
}) {
  return (
    <div className="asset-row">
      <div className="asset-heading">
        <strong>{props.asset.name}</strong>
      </div>

      {props.showCurrentValue ? (
        <label className="mini-field money-field">
          <span>Current Savings</span>
          <span className="field-affix">$</span>
          <input
            aria-label={`${props.asset.name} current investments`}
            value={props.asset.currentValue}
            onChange={(event) => props.onCurrentValueChange(event.target.value)}
            inputMode="decimal"
          />
        </label>
      ) : null}

      <label className="mini-field">
        <span>Nominal annual return</span>
        <input
          value={props.asset.returnRate}
          onChange={(event) =>
            props.onReturnChange(decimalInput(event.target.value, 2))
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

function ProjectionLegend() {
  return (
    <ul className="recharts-default-legend projection-legend">
      {PROJECTION_LEGEND_ITEMS.map((item) => (
        <li key={item.label} className="recharts-legend-item">
          <span
            className="recharts-legend-icon"
            style={{
              display: "inline-block",
              width: 10,
              height: 10,
              marginRight: 8,
              borderRadius: "999px",
              backgroundColor: item.color,
            }}
          />
          <span>{item.label}</span>
        </li>
      ))}
    </ul>
  );
}

export default function App() {
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    if (typeof window === "undefined") return "light";
    return window.localStorage.getItem(THEME_STORAGE_KEY) === "dark"
      ? "dark"
      : "light";
  });
  const [age, setAge] = useState("23");
  const [monthlyContribution, setMonthlyContribution] = useState("411"); // 3618, 4118, 4618
  const [annualSpending, setAnnualSpending] = useState("70000");
  const [withdrawalRate, setWithdrawalRate] = useState("4.5");
  const [inflationRate, setInflationRate] = useState("3");
  const [desiredFireAge, setDesiredFireAge] = useState("");
  const [displayMode, setDisplayMode] = useState<DisplayMode>(
    DISPLAY_TODAYS_DOLLARS,
  );
  const [chartMode, setChartMode] = useState<ChartMode>(STANDARD_CHART);
  const [controlsOpen, setControlsOpen] = useState(true);
  const [controlsPanelHeight, setControlsPanelHeight] = useState<number | null>(
    null,
  );
  const [finalChartAge, setFinalChartAge] = useState(
    String(DEFAULT_FINAL_CHART_AGE),
  );
  const [contributionStopMode, setContributionStopMode] =
    useState<ContributionStopMode>(STOP_CONTRIBUTING_AT_FIRE);
  const [contributionStopAge, setContributionStopAge] = useState("");
  const hasInitializedContributionStopAge = useRef(false);
  const [assets, setAssets] = useState<AssetInput[]>([
    {
      key: "stocks",
      name: "Stocks",
      currentValue: "936",
      returnRate: "10",
    },
    {
      key: "bonds",
      name: "Savings / Bonds",
      currentValue: "0",
      returnRate: "3",
    },
    { key: "cash", name: "Cash", currentValue: "0", returnRate: "0" },
  ]);
  const stockAsset = assets.find((asset) => asset.key === "stocks");
  const bondsAsset = assets.find((asset) => asset.key === "bonds");
  const cashAsset = assets.find((asset) => asset.key === "cash");
  const currentInvestments = assets.reduce(
    (total, asset) => total + Math.max(numberFromInput(asset.currentValue), 0),
    0,
  );
  const savingsAndCash =
    Math.max(numberFromInput(bondsAsset?.currentValue ?? "0"), 0) +
    Math.max(numberFromInput(cashAsset?.currentValue ?? "0"), 0);
  const currentAgeInput = String(
    clamp(Math.round(numberFromInput(age, 30)), 0, MAX_SUPPORTED_AGE),
  );

  const handleContributionStopModeChange = (mode: ContributionStopMode) => {
    setContributionStopMode(mode);
    if (
      mode === STOP_CONTRIBUTING_AT_AGE &&
      !hasInitializedContributionStopAge.current
    ) {
      setContributionStopAge(currentAgeInput);
      hasInitializedContributionStopAge.current = true;
    }
  };

  const handleContributionStopAgeBlur = () => {
    const stopAge = optionalNumberFromInput(contributionStopAge);
    const currentAge = numberFromInput(currentAgeInput, 30);

    if (stopAge === null || stopAge < currentAge) {
      setContributionStopAge(currentAgeInput);
    }
  };

  const plan = useMemo(
    () =>
      calculatePlan({
        age: clamp(Math.round(numberFromInput(age, 30)), 0, MAX_SUPPORTED_AGE),
        currentSavings: currentInvestments,
        desiredFireAge: optionalNumberFromInput(desiredFireAge),
        monthlyContribution: optionalNumberFromInput(monthlyContribution),
        contributionStopMode,
        contributionStopAge: clamp(
          Math.round(
            numberFromInput(contributionStopAge, numberFromInput(age, 30)),
          ),
          0,
          MAX_SUPPORTED_AGE,
        ),
        annualSpending: optionalNumberFromInput(annualSpending),
        withdrawalRate: numberFromInput(withdrawalRate, 4),
        inflationRate: numberFromInput(inflationRate, 3),
        finalChartAge: numberFromInput(finalChartAge, DEFAULT_FINAL_CHART_AGE),
        assets,
      }),
    [
      age,
      currentInvestments,
      monthlyContribution,
      desiredFireAge,
      contributionStopMode,
      contributionStopAge,
      annualSpending,
      withdrawalRate,
      inflationRate,
      finalChartAge,
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
          ? point.realWithdrawals
          : displayAmount(
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

  const inflationRateNumber = numberFromInput(inflationRate, 3);
  const displayedFireTarget = displayAmount(
    plan.futureFireTarget,
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

  const calculatorLayoutRef = useRef<HTMLDivElement>(null);
  const projectionCardRef = useRef<HTMLElement>(null);
  const isDarkMode = themeMode === "dark";

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
    window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
  }, [themeMode]);

  useEffect(() => {
    const calculatorLayout = calculatorLayoutRef.current;
    const projectionCard = projectionCardRef.current;
    if (
      !calculatorLayout ||
      !projectionCard ||
      typeof ResizeObserver === "undefined"
    )
      return;

    const updateControlsPanelHeight = () => {
      const layoutTop = calculatorLayout.getBoundingClientRect().top;
      const projectionBottom = projectionCard.getBoundingClientRect().bottom;
      setControlsPanelHeight(projectionBottom - layoutTop);
    };
    const observer = new ResizeObserver(updateControlsPanelHeight);

    updateControlsPanelHeight();
    observer.observe(calculatorLayout);
    observer.observe(projectionCard);
    window.addEventListener("resize", updateControlsPanelHeight);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateControlsPanelHeight);
    };
  }, [chartMode, chartData.length, plan.warning]);

  function updateAsset(key: AssetKey, changes: Partial<AssetInput>) {
    setAssets((current) =>
      current.map((asset) =>
        asset.key === key ? { ...asset, ...changes } : asset,
      ),
    );
  }

  return (
    <main className={`app-shell theme-${themeMode}`}>
      <div className="motion-backdrop" aria-hidden="true">
        <span className="ribbon ribbon-one" />
        <span className="ribbon ribbon-two" />
        <span className="ribbon ribbon-three" />
        <span className="coin coin-one">$</span>
        <span className="coin coin-two">%</span>
        <span className="coin coin-three">+</span>
      </div>

      <header className="topbar">
        <div className="topbar-content">
          <div className="brand-row">
            <span className="brand-mark">
              <Calculator size={18} />
              FIRE Calculator
            </span>
            <button
              type="button"
              className="theme-toggle"
              aria-label={`Switch to ${isDarkMode ? "light" : "dark"} mode`}
              aria-pressed={isDarkMode}
              onClick={() =>
                setThemeMode((current) =>
                  current === "dark" ? "light" : "dark",
                )
              }
            >
              {isDarkMode ? (
                <Sun size={18} aria-hidden="true" />
              ) : (
                <Moon size={18} aria-hidden="true" />
              )}
              <span>{isDarkMode ? "Light mode" : "Dark mode"}</span>
            </button>
          </div>
          <h1>Financial Independence Retire Early</h1>
          <p className="hero-copy">
            Tune your savings, returns, spending, and timeline to view your
            potential retirement path.
          </p>
        </div>
        <div className="hero-orbit" aria-hidden="true">
          <span className="orbit-ring" />
          <span className="orbit-core">
            <TrendingUp size={34} />
          </span>
          <span className="orbit-dot orbit-dot-one" />
          <span className="orbit-dot orbit-dot-two" />
        </div>
      </header>

      <div
        ref={calculatorLayoutRef}
        className={
          controlsOpen ? "calculator-layout" : "calculator-layout is-collapsed"
        }
        style={
          controlsPanelHeight
            ? ({
                "--controls-panel-height": `${controlsPanelHeight}px`,
              } as React.CSSProperties)
            : undefined
        }
      >
        <aside className="controls-sidebar" aria-label="Calculator controls">
          <button
            type="button"
            className="controls-toggle"
            aria-expanded={controlsOpen}
            onClick={() => setControlsOpen((isOpen) => !isOpen)}
          >
            {controlsOpen ? (
              <PanelLeftClose size={18} aria-hidden="true" />
            ) : (
              <PanelLeftOpen size={18} aria-hidden="true" />
            )}
            <span>{controlsOpen ? "Hide controls" : "Show controls"}</span>
          </button>

          <div className="control-panel-content">
            <Panel title="Today">
              <Field label="Age" value={age} onChange={setAge} />
              <Field
                label="Stocks"
                value={stockAsset?.currentValue ?? ""}
                onChange={(currentValue) =>
                  updateAsset("stocks", { currentValue })
                }
                prefix="$"
              />
              <details className="today-breakdown">
                <summary>
                  <span>
                    <PiggyBank size={16} aria-hidden="true" />
                    Savings and Cash
                  </span>
                  <strong>{money(savingsAndCash)}</strong>
                </summary>
                <div className="today-breakdown-body">
                  <Field
                    label="Savings"
                    value={bondsAsset?.currentValue ?? ""}
                    onChange={(currentValue) =>
                      updateAsset("bonds", { currentValue })
                    }
                    prefix="$"
                  />
                  <Field
                    label="Cash"
                    value={cashAsset?.currentValue ?? ""}
                    onChange={(currentValue) =>
                      updateAsset("cash", { currentValue })
                    }
                    prefix="$"
                  />
                </div>
              </details>
              <Field
                label="Saving monthly"
                value={monthlyContribution}
                onChange={setMonthlyContribution}
                prefix="$"
                help={[
                  "Leave this blank to calculate the monthly savings needed for your desired FIRE age.",
                  "Assumption: each monthly contribution is invested at the start of the month.",
                ].join("\n\n")}
              />
            </Panel>

            <Panel title="Assumptions">
              <div className="asset-list compact">
                {assets
                  .filter((asset) => asset.key === "stocks")
                  .map((asset) => (
                    <AssetRow
                      key={asset.key}
                      asset={asset}
                      onCurrentValueChange={(currentValue) =>
                        updateAsset(asset.key, { currentValue })
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
                        onCurrentValueChange={(currentValue) =>
                          updateAsset(asset.key, { currentValue })
                        }
                        onReturnChange={(returnRate) =>
                          updateAsset(asset.key, { returnRate })
                        }
                      />
                    ))}
                </div>
                <div className="return-note">
                  <strong>
                    Effective nominal annual return:{" "}
                    {plan.effectiveReturn.toFixed(2)}%
                  </strong>
                  <span>
                    Current portfolio total across all categories:{" "}
                    {money(currentInvestments)}
                  </span>
                </div>
              </details>
            </Panel>

            <Panel title="Retirement">
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
                      onChange={handleContributionStopModeChange}
                    />
                  </div>
                  {contributionStopMode === STOP_CONTRIBUTING_AT_AGE ? (
                    <Field
                      label="Stop age"
                      value={contributionStopAge}
                      onChange={setContributionStopAge}
                      onBlur={handleContributionStopAgeBlur}
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

            <Panel title="Chart Controls">
              <Field
                label="Final age"
                value={finalChartAge}
                onChange={setFinalChartAge}
                help={`The projection can display through age ${MAX_SUPPORTED_AGE}.`}
              />
            </Panel>
          </div>
        </aside>

        <div className="results-column">
          <section className="results-band" aria-label="Calculator results">
            <Stat
              label={`Your FIRE target (${displayMode})`}
              value={money(displayedFireTarget, 0)}
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
                The graph still projects the current path through age{" "}
                {plan.finalChartAge}. Adjust savings, spending, returns, timing,
                or chart range to make FIRE reachable.
              </span>
            </section>
          ) : null}

          <section className="projection-card" ref={projectionCardRef}>
            <div className="chart-confetti" aria-hidden="true">
              <span />
              <span />
              <span />
              <span />
            </div>
            <div className="projection-heading">
              <div>
                <h2>FIRE Projection</h2>
              </div>
              <ChartModeToggle value={chartMode} onChange={setChartMode} />
            </div>

            <div className="chart-wrap">
              <div
                className={
                  chartMode === BAR_CHART
                    ? "chart-stage bar-chart-stage"
                    : "chart-stage"
                }
              >
                <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                  <ComposedChart
                    data={chartData}
                    margin={{ top: 28, right: 22, bottom: 22, left: 8 }}
                    barCategoryGap={chartMode === BAR_CHART ? 0 : undefined}
                    barGap={chartMode === BAR_CHART ? 0 : undefined}
                  >
                    <defs>
                      <linearGradient
                        id="contributionGradient"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="0%"
                          stopColor="#18b6ff"
                          stopOpacity="0.88"
                        />
                        <stop
                          offset="100%"
                          stopColor="#5130ee"
                          stopOpacity="0.22"
                        />
                      </linearGradient>
                      <linearGradient
                        id="growthGradient"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="0%"
                          stopColor="#35d399"
                          stopOpacity="0.86"
                        />
                        <stop
                          offset="100%"
                          stopColor="#ffe45c"
                          stopOpacity="0.26"
                        />
                      </linearGradient>
                      <linearGradient
                        id="withdrawalGradient"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="0%"
                          stopColor="#ff4c9a"
                          stopOpacity="0.76"
                        />
                        <stop
                          offset="100%"
                          stopColor="#ff8a3d"
                          stopOpacity="0.2"
                        />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      stroke={isDarkMode ? "#263550" : "#dfe9ff"}
                      vertical={false}
                    />
                    <XAxis
                      dataKey="age"
                      tickLine={false}
                      axisLine={false}
                      minTickGap={28}
                      label={{
                        value: "Age",
                        position: "insideBottom",
                        offset: -10,
                        fill: isDarkMode ? "#8ec5ff" : "#5130ee",
                        fontSize: 12,
                        fontWeight: 800,
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
                      content={<ProjectionLegend />}
                      wrapperStyle={{ paddingTop: 24 }}
                    />
                    {chartMode === BAR_CHART ? (
                      <ReferenceLine
                        y={0}
                        stroke={isDarkMode ? "#344461" : "#cfd8ff"}
                      />
                    ) : null}
                    <ReferenceLine
                      y={displayedFireTarget}
                      stroke="#20bf75"
                      strokeDasharray="7 5"
                      strokeWidth={2}
                      label={{
                        value: `Goal: ${compactMoney(displayedFireTarget)}`,
                        position: "insideTopLeft",
                        fill: isDarkMode ? "#5ee0b4" : "#008b70",
                        fontWeight: 800,
                        dy: -30,
                      }}
                    />
                    <ReferenceLine
                      x={plan.retirementAge}
                      stroke="#ff4c9a"
                      strokeDasharray="5 5"
                      strokeWidth={2}
                      label={{
                        value: plan.fireReachable
                          ? `Retire at ${plan.retirementAge}`
                          : `Projected to ${plan.retirementAge}`,
                        position: "top",
                        fill: isDarkMode ? "#ff8fca" : "#eb2f87",
                        fontWeight: 800,
                      }}
                    />

                    {chartMode === STANDARD_CHART ? (
                      <>
                        <Area
                          type="monotone"
                          dataKey="contributionShade"
                          name="Contributions"
                          stackId="portfolio"
                          stroke="#18b6ff"
                          fill="url(#contributionGradient)"
                          fillOpacity={1}
                          strokeWidth={3}
                          dot={false}
                          isAnimationActive={true}
                          animationDuration={850}
                          animationEasing="ease-out"
                          activeDot={{ r: 6, stroke: "#fff", strokeWidth: 3 }}
                        />
                        <Area
                          type="monotone"
                          dataKey="growthShade"
                          name="Growth"
                          stackId="portfolio"
                          stroke="#20bf75"
                          fill="url(#growthGradient)"
                          fillOpacity={1}
                          strokeWidth={3}
                          dot={false}
                          isAnimationActive={true}
                          animationDuration={850}
                          animationEasing="ease-out"
                          activeDot={{ r: 6, stroke: "#fff", strokeWidth: 3 }}
                        />
                        <Area
                          type="monotone"
                          dataKey="withdrawals"
                          name="Drawdown"
                          stroke="#ff4c9a"
                          fill="url(#withdrawalGradient)"
                          fillOpacity={1}
                          strokeWidth={3}
                          dot={false}
                          isAnimationActive={true}
                          animationDuration={850}
                          animationEasing="ease-out"
                          activeDot={{ r: 6, stroke: "#fff", strokeWidth: 3 }}
                        />
                      </>
                    ) : (
                      <>
                        <Bar
                          dataKey="withdrawalBar"
                          name="Drawdown"
                          stackId="assets"
                          fill="#ff4c9a"
                          radius={[0, 0, 4, 4]}
                          shape={BarShape}
                          activeBar={ActiveBar}
                          isAnimationActive={false}
                        />
                        <Bar
                          dataKey="contributionShade"
                          name="Contributions"
                          stackId="assets"
                          fill="#18b6ff"
                          radius={[0, 0, 0, 0]}
                          shape={BarShape}
                          activeBar={ActiveBar}
                          isAnimationActive={false}
                        />
                        <Bar
                          dataKey="growthShade"
                          name="Growth"
                          stackId="assets"
                          fill="#20bf75"
                          radius={[4, 4, 0, 0]}
                          shape={BarShape}
                          activeBar={ActiveBar}
                          isAnimationActive={false}
                        />
                      </>
                    )}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="projection-summary" aria-label="Projection summary">
              <div>
                <TrendingUp size={18} />
                <span>{plan.yearsToRetirement} years to FIRE</span>
              </div>
              <div>
                <DollarSign size={18} />
                <span>{money(plan.portfolioAtRetirement)} at retirement</span>
              </div>
              <div>
                <PiggyBank size={18} />
                <span>{plan.yearsFunded || 0} retirement years mapped</span>
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
