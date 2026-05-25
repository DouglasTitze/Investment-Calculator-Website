import { useMemo, useState } from "react";
import {
  Area,
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
  WalletCards,
} from "lucide-react";
import "./App.css";

const MAX_ACCUMULATION_YEARS = 80;
const MAX_DRAWDOWN_YEARS = 45;
const DISPLAY_TODAYS_DOLLARS = "Today's dollars";
const DISPLAY_NOMINAL_DOLLARS = "Nominal dollars";
const DISPLAY_MODES = [DISPLAY_TODAYS_DOLLARS, DISPLAY_NOMINAL_DOLLARS] as const;
const STOP_CONTRIBUTING_AT_FIRE = "FIRE goal";
const STOP_CONTRIBUTING_AT_AGE = "Specific age";

type AssetKey = "stocks" | "bonds" | "cash";
type DisplayMode = (typeof DISPLAY_MODES)[number];
type ContributionStopMode = typeof STOP_CONTRIBUTING_AT_FIRE | typeof STOP_CONTRIBUTING_AT_AGE;

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
  annualWithdrawal: number;
};

type Plan = {
  todayFireTarget: number;
  futureFireTarget: number;
  annualSavings: number;
  retirementAge: number;
  yearsToRetirement: number;
  portfolioAtRetirement: number;
  yearsFunded: number;
  effectiveReturn: number;
  projection: ProjectionPoint[];
};

function numberFromInput(value: string, fallback = 0): number {
  const parsed = Number(value.replace(/[$,%\s,]/g, ""));
  return Number.isFinite(parsed) ? parsed : fallback;
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
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}m`;
  if (Math.abs(value) >= 1_000) return `$${Math.round(value / 1_000)}k`;
  return money(value);
}

function inflationFactor(inflationRate: number, year: number): number {
  return Math.pow(1 + Math.max(inflationRate, 0) / 100, year);
}

function displayAmount(value: number, displayMode: DisplayMode, inflationRate: number, year: number): number {
  if (displayMode === DISPLAY_NOMINAL_DOLLARS) return value;
  return value / inflationFactor(inflationRate, year);
}

function rebalanceAllocations(assets: AssetInput[], changedKey: AssetKey, nextAllocation: number): AssetInput[] {
  const updated = assets.map((asset) =>
    asset.key === changedKey ? { ...asset, allocation: clamp(Math.round(nextAllocation), 0, 100) } : { ...asset },
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
  monthlyContribution: number;
  contributionStopMode: ContributionStopMode;
  contributionStopAge: number;
  annualSpending: number;
  withdrawalRate: number;
  inflationRate: number;
  assets: AssetInput[];
}): Plan {
  const safeWithdrawalRate = Math.max(args.withdrawalRate, 0.1) / 100;
  const annualSavings = Math.max(args.monthlyContribution, 0) * 12;
  const todayFireTarget = Math.max(args.annualSpending, 0) / safeWithdrawalRate;
  const totalAllocation = args.assets.reduce((total, asset) => total + asset.allocation, 0) || 100;
  const effectiveReturn =
    args.assets.reduce((total, asset) => total + (asset.allocation / totalAllocation) * asset.returnRate, 0) / 100;
  const inflationRate = Math.max(args.inflationRate, 0) / 100;

  const projection: ProjectionPoint[] = [];
  let portfolio = Math.max(args.currentSavings, 0);
  let contributions = portfolio;
  let retirementYear = 0;
  const contributionStopAge = Math.max(args.contributionStopAge, args.age);

  projection.push({
    year: 0,
    age: args.age,
    phase: "Saving",
    portfolio,
    contributions,
    growth: 0,
    withdrawals: 0,
    annualWithdrawal: 0,
  });

  while (portfolio < todayFireTarget * Math.pow(1 + inflationRate, retirementYear) && retirementYear < MAX_ACCUMULATION_YEARS) {
    const shouldContribute =
      args.contributionStopMode === STOP_CONTRIBUTING_AT_FIRE || args.age + retirementYear < contributionStopAge;
    const annualContributionForYear = shouldContribute ? annualSavings : 0;

    retirementYear += 1;
    contributions += annualContributionForYear;
    portfolio = (portfolio + annualContributionForYear) * (1 + effectiveReturn);

    projection.push({
      year: retirementYear,
      age: args.age + retirementYear,
      phase: "Saving",
      portfolio,
      contributions,
      growth: Math.max(portfolio - contributions, 0),
      withdrawals: 0,
      annualWithdrawal: 0,
    });
  }

  const yearsToRetirement = retirementYear;
  const portfolioAtRetirement = portfolio;
  const futureFireTarget = todayFireTarget * Math.pow(1 + inflationRate, yearsToRetirement);
  let cumulativeWithdrawals = 0;
  let yearsFunded = 0;

  for (let drawdownYear = 1; drawdownYear <= MAX_DRAWDOWN_YEARS; drawdownYear += 1) {
    const absoluteYear = yearsToRetirement + drawdownYear;
    const plannedWithdrawal = args.annualSpending * Math.pow(1 + inflationRate, drawdownYear - 1);
    const actualWithdrawal = Math.min(portfolio, plannedWithdrawal);

    portfolio -= actualWithdrawal;
    cumulativeWithdrawals += actualWithdrawal;
    portfolio *= 1 + effectiveReturn;
    yearsFunded = drawdownYear;

    projection.push({
      year: absoluteYear,
      age: args.age + absoluteYear,
      phase: "Retired",
      portfolio,
      contributions,
      growth: Math.max(portfolio + cumulativeWithdrawals - contributions, 0),
      withdrawals: cumulativeWithdrawals,
      annualWithdrawal: actualWithdrawal,
    });

    if (actualWithdrawal < plannedWithdrawal || portfolio <= 1) break;
  }

  return {
    todayFireTarget,
    futureFireTarget,
    annualSavings,
    retirementAge: args.age + yearsToRetirement,
    yearsToRetirement,
    portfolioAtRetirement,
    yearsFunded,
    effectiveReturn: effectiveReturn * 100,
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
        {props.prefix ? <span className="field-affix">{props.prefix}</span> : null}
        <input value={props.value} onChange={(event) => props.onChange(event.target.value)} inputMode="decimal" />
        {props.suffix ? <span className="field-affix">{props.suffix}</span> : null}
      </span>
    </label>
  );
}

function SegmentedControl(props: { value: DisplayMode; onChange: (value: DisplayMode) => void }) {
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

function ContributionStopToggle(props: { value: ContributionStopMode; onChange: (value: ContributionStopMode) => void }) {
  const options: ContributionStopMode[] = [STOP_CONTRIBUTING_AT_FIRE, STOP_CONTRIBUTING_AT_AGE];

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

function Panel(props: { eyebrow: string; title: string; children: React.ReactNode }) {
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
          onChange={(event) => props.onAllocationChange(Number(event.target.value))}
        />
      </label>

      <label className="mini-field">
        <span>Growth rate</span>
        <input
          value={props.asset.returnRate}
          onChange={(event) => props.onReturnChange(numberFromInput(event.target.value, props.asset.returnRate))}
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

function ProjectionTooltip(props: { active?: boolean; payload?: TooltipEntry[] }) {
  if (!props.active || !props.payload?.length) return null;

  const point = props.payload[0]?.payload as ProjectionPoint;
  const values = props.payload.filter((entry) =>
    ["portfolio", "contributionShade", "growthShade", "withdrawals"].includes(entry.dataKey),
  );

  return (
    <div className="chart-tooltip">
      <p className="tooltip-title">
        Age {point.age} - {point.phase}
      </p>
      {values.map((entry) => (
        <div key={entry.dataKey} className="tooltip-line">
          <span>{entry.name ?? entry.dataKey}</span>
          <strong>{money(entry.value)}</strong>
        </div>
      ))}
      {point.annualWithdrawal > 0 ? (
        <div className="tooltip-line">
          <span>annual draw</span>
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
  const [withdrawalRate, setWithdrawalRate] = useState("10");
  const [inflationRate, setInflationRate] = useState("3");
  const [displayMode, setDisplayMode] = useState<DisplayMode>(DISPLAY_TODAYS_DOLLARS);
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
        age: clamp(Math.round(numberFromInput(age, 30)), 0, 100),
        currentSavings: numberFromInput(currentSavings),
        monthlyContribution: numberFromInput(monthlyContribution),
        contributionStopMode,
        contributionStopAge: clamp(Math.round(numberFromInput(contributionStopAge, numberFromInput(age, 30))), 0, 120),
        annualSpending: numberFromInput(annualSpending),
        withdrawalRate: numberFromInput(withdrawalRate, 4),
        inflationRate: numberFromInput(inflationRate, 3),
        assets,
      }),
    [
      age,
      currentSavings,
      monthlyContribution,
      contributionStopMode,
      contributionStopAge,
      annualSpending,
      withdrawalRate,
      inflationRate,
      assets,
    ],
  );

  const chartData = useMemo(
    () =>
      {
        const inflation = numberFromInput(inflationRate, 3);
        return plan.projection.map((point) => ({
          ...point,
          portfolio: displayAmount(point.portfolio, displayMode, inflation, point.year),
          contributionShade: displayAmount(Math.min(point.contributions, point.portfolio), displayMode, inflation, point.year),
          growthShade: displayAmount(Math.max(point.portfolio - Math.min(point.contributions, point.portfolio), 0), displayMode, inflation, point.year),
          withdrawals: displayAmount(point.withdrawals, displayMode, inflation, point.year),
          annualWithdrawal: displayAmount(point.annualWithdrawal, displayMode, inflation, point.year),
          fireTarget: displayAmount(plan.futureFireTarget, displayMode, inflation, plan.yearsToRetirement),
          retirementLine: point.year === plan.yearsToRetirement ? point.portfolio : null,
        }));
      },
    [displayMode, inflationRate, plan],
  );

  const totalAllocation = assets.reduce((total, asset) => total + asset.allocation, 0);
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

  function updateAsset(key: AssetKey, changes: Partial<AssetInput>) {
    setAssets((current) => current.map((asset) => (asset.key === key ? { ...asset, ...changes } : asset)));
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
            FIRE Planner
          </span>
          <h1>Early retirement calculator</h1>
        </div>
        <div className="currency-pill">US Dollar</div>
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
              help="Included inside the contributions line on the graph, instead of being displayed as a separate initial lump sum."
            />
            <Field
              label="Saving monthly"
              value={monthlyContribution}
              onChange={setMonthlyContribution}
              prefix="$"
              help="Assumption: each monthly contribution is invested at the start of the month, so it gets a full month of market return."
            />
          </Panel>

          <Panel eyebrow="Later" title="Your retirement">
            <Field label="Annual spending" value={annualSpending} onChange={setAnnualSpending} prefix="$" />
            <Field label="Withdrawal rate" value={withdrawalRate} onChange={setWithdrawalRate} suffix="%" />
            <Field
              label="Inflation"
              value={inflationRate}
              onChange={setInflationRate}
              suffix="%"
              help="Used to inflate your future FIRE target and retirement withdrawals. Today's dollars reverses this inflation for display."
            />
            <div className="display-mode-row">
              <span>Contribute until</span>
              <ContributionStopToggle value={contributionStopMode} onChange={setContributionStopMode} />
            </div>
            {contributionStopMode === STOP_CONTRIBUTING_AT_AGE ? (
              <Field
                label="Stop age"
                value={contributionStopAge}
                onChange={setContributionStopAge}
              />
            ) : null}
            <div className="display-mode-row">
              <span>Display</span>
              <SegmentedControl value={displayMode} onChange={setDisplayMode} />
            </div>
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
                  onAllocationChange={(allocation) => updateAllocation(asset.key, allocation)}
                  onReturnChange={(returnRate) => updateAsset(asset.key, { returnRate })}
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
                    onAllocationChange={(allocation) => updateAllocation(asset.key, allocation)}
                    onReturnChange={(returnRate) => updateAsset(asset.key, { returnRate })}
                  />
                ))}
            </div>
          </details>
          <div className={totalAllocation === 100 ? "return-note" : "return-note warning"}>
            <strong>Effective overall rate of return: {plan.effectiveReturn.toFixed(2)}%</strong>
            <span>
              Allocation total: {totalAllocation}%. This must equal 100%, so changing one allocation automatically
              rebalances the others.
            </span>
          </div>
        </Panel>
      </section>

      <section className="results-band" aria-label="Calculator results">
        <Stat label={`Your FIRE target (${displayMode})`} value={money(displayedFireTarget, 2)} icon={<WalletCards size={22} />} />
        <Stat label="Retirement age" value={String(plan.retirementAge)} icon={<TrendingUp size={24} />} />
        <Stat label="Annual savings" value={money(plan.annualSavings, 2)} icon={<PiggyBank size={22} />} />
      </section>

      <section className="projection-card">
        <p className="eyebrow">The journey ahead</p>
        <h2>Your FIRE projection</h2>

        <div className="chart-wrap">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 28, right: 22, bottom: 22, left: 8 }}>
              <CartesianGrid stroke="#edf0fb" vertical={false} />
              <XAxis
                dataKey="year"
                tickFormatter={(year) => `Y${year}`}
                tickLine={false}
                axisLine={false}
                minTickGap={28}
                label={{ value: "Years from today", position: "insideBottom", offset: -10, fill: "#001a52", fontSize: 12 }}
              />
              <YAxis orientation="right" tickFormatter={compactMoney} tickLine={false} axisLine={false} width={58} />
              <Tooltip content={<ProjectionTooltip />} />
              <Legend verticalAlign="bottom" iconType="circle" wrapperStyle={{ paddingTop: 24 }} />
              <ReferenceLine
                y={displayedFireTarget}
                stroke="#147a52"
                strokeDasharray="3 3"
                label={{ value: `Goal: ${compactMoney(displayedFireTarget)}`, position: "insideTopLeft", fill: "#147a52" }}
              />
              <ReferenceLine
                x={plan.yearsToRetirement}
                stroke="#d7d7df"
                label={{ value: `Retire at ${plan.retirementAge}`, position: "top", fill: "#5130ee" }}
              />

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

            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div className="projection-summary">
          <div>
            <BarChart3 size={18} />
            <span>{plan.yearsToRetirement} years until target</span>
          </div>
          <div>
            <DollarSign size={18} />
            <span>{money(displayedPortfolioAtRetirement)} projected at retirement</span>
          </div>
          <div>
            <Percent size={18} />
            <span>{plan.yearsFunded >= MAX_DRAWDOWN_YEARS ? `${MAX_DRAWDOWN_YEARS}+` : plan.yearsFunded} drawdown years shown</span>
          </div>
        </div>
      </section>
    </main>
  );
}
