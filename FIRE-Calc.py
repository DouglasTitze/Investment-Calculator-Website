import math
import tkinter as tk
from tkinter import ttk, messagebox
from typing import Any, Dict, List, Optional, Tuple

# TODO - Add increasing contributions
# Ex. Increase percentage contribution each year up to some maximum,
# or increase by some dollar amount per year, etc.
# TODO - Make contributions into two splits, monthly and yearly lump sum, so you can contribute 10k at the beginning of the year and then x amount monthly


# ----------------------------
# Constants
# ----------------------------

LUMP_SUM_START_OF_YEAR = "Lump sum at start of year"
DOLLAR_COST_AVERAGE_MONTHLY = "Dollar cost average monthly"

CONTRIBUTION_TIMINGS = [
    LUMP_SUM_START_OF_YEAR,
    DOLLAR_COST_AVERAGE_MONTHLY,
]

ANNUAL_WITHDRAWAL_START_OF_YEAR = "Annual withdrawal at start of year"
MONTHLY_WITHDRAWALS = "Monthly withdrawals"

WITHDRAWAL_TIMINGS = [
    ANNUAL_WITHDRAWAL_START_OF_YEAR,
    MONTHLY_WITHDRAWALS,
]

MAX_ACCUMULATION_YEARS = 100
MAX_DRAWDOWN_YEARS = 100
MAX_REQUIRED_CONTRIBUTION_BEFORE_ERROR = 1_000_000


# ----------------------------
# Validation helpers
# ----------------------------

def validate_contribution_timing(contribution_timing: str) -> None:
    if contribution_timing not in CONTRIBUTION_TIMINGS:
        raise ValueError("Invalid contribution timing selected.")


def validate_withdrawal_timing(withdrawal_timing: str) -> None:
    if withdrawal_timing not in WITHDRAWAL_TIMINGS:
        raise ValueError("Invalid withdrawal timing selected.")


def convert_to_years(years: float) -> int:
    """
    This model is intentionally year-by-year, so provided years must be whole years.
    """
    if years < 0:
        raise ValueError("Years to retirement cannot be negative.")

    rounded_years = int(round(years))

    if not math.isclose(years, rounded_years, abs_tol=1e-9):
        raise ValueError("Years to retirement must be a whole number.")

    return rounded_years


# ----------------------------
# Core calculator logic
# ----------------------------


def retirement_target(
    *,
    expected_annual_expenses: float,
    withdrawal_rate_pct: float,
) -> float:
    """
    Returns the total amount of money needed for retirement.
    """
    withdrawal_rate = withdrawal_rate_pct / 100

    if withdrawal_rate <= 0:
        raise ValueError("Withdrawal rate must be greater than 0.")

    return expected_annual_expenses / withdrawal_rate


def grow_balance_for_one_year(
    *,
    starting_balance: float,
    annual_savings: float,
    annual_return_pct: float,
    contribution_timing: str,
) -> float:
    """
    Returns the portfolio value after one year.

    Lump-sum Growth = (START_X + INVESTMENTS) * GROWTH_RATE

    Dollar-cost-average Growth:
        Savings are split into 12 monthly investments.
        Growth is applied month-by-month.
    """
    validate_contribution_timing(contribution_timing)

    if starting_balance < 0:
        raise ValueError("Current portfolio value cannot be negative.")

    if annual_savings < 0:
        raise ValueError("Annual savings cannot be negative.")

    annual_return_rate = annual_return_pct / 100

    if annual_return_rate <= 0:
        raise ValueError("Annual return must be greater than 0%.")

    if contribution_timing == LUMP_SUM_START_OF_YEAR:
        annual_growth_multiplier = 1 + annual_return_rate
        return (starting_balance + annual_savings) * annual_growth_multiplier

    elif contribution_timing == DOLLAR_COST_AVERAGE_MONTHLY:
        monthly_savings = annual_savings / 12

        # Effective monthly growth makes 12 months equal the annual return.
        monthly_growth_multiplier = (1 + annual_return_rate) ** (1 / 12)

        balance = starting_balance

        for _ in range(12):
            # Contribution is invested at the start of each month.
            balance += monthly_savings
            balance *= monthly_growth_multiplier

        return balance

    else:
        raise ValueError("Other contribution types are not implemented")


def project_accumulation_timeline(
    *,
    initial_balance: float,
    annual_savings: float,
    annual_return_pct: float,
    contribution_timing: str,
    years: int,
    target: Optional[float] = None,
) -> List[Dict[str, float]]:
    """
    Returns year-by-year accumulation values.

    Year 0 is the starting balance.
    Each later year shows:
      - starting balance
      - contributions
      - investment growth
      - ending balance
    """
    validate_contribution_timing(contribution_timing)

    if years < 0:
        raise ValueError("Years cannot be negative.")

    if initial_balance < 0:
        raise ValueError("Current portfolio value cannot be negative.")

    if annual_savings < 0:
        raise ValueError("Annual savings cannot be negative.")

    records = [
        {
            "year": 0,
            "starting_balance": initial_balance,
            "annual_contribution": 0.0,
            "investment_growth": 0.0,
            "ending_balance": initial_balance,
        }
    ]

    balance = initial_balance

    for year in range(1, years + 1):
        starting_balance = balance

        ending_balance = grow_balance_for_one_year(
            starting_balance=starting_balance,
            annual_savings=annual_savings,
            annual_return_pct=annual_return_pct,
            contribution_timing=contribution_timing,
        )

        investment_growth = ending_balance - starting_balance - annual_savings

        records.append(
            {
                "year": float(year),
                "starting_balance": starting_balance,
                "annual_contribution": annual_savings,
                "investment_growth": investment_growth,
                "ending_balance": ending_balance,
            }
        )

        balance = ending_balance

        if target is not None and balance >= target:
            break

    return records


def solve_years_to_retirement(
    *,
    expected_annual_expenses: float,
    annual_savings: float,
    initial_balance: float,
    annual_return_pct: float,
    withdrawal_rate_pct: float,
    contribution_timing: str,
) -> Tuple[int, List[Dict[str, float]]]:
    """
    Calculates how many whole years it will take to reach the retirement target.
    """
    if expected_annual_expenses <= 0:
        raise ValueError("Expected annual expenses must be greater than 0.")

    if annual_savings < 0:
        raise ValueError("Annual savings cannot be negative.")

    target = retirement_target(
        expected_annual_expenses=expected_annual_expenses,
        withdrawal_rate_pct=withdrawal_rate_pct,
    )

    timeline = project_accumulation_timeline(
        initial_balance=initial_balance,
        annual_savings=annual_savings,
        annual_return_pct=annual_return_pct,
        contribution_timing=contribution_timing,
        years=MAX_ACCUMULATION_YEARS,
        target=target,
    )

    final_record = timeline[-1]

    if final_record["ending_balance"] >= target:
        return int(final_record["year"]), timeline

    raise ValueError(f"Target is not reached within {MAX_ACCUMULATION_YEARS} years.")


def solve_expected_annual_expenses(
    *,
    years_to_retirement: float,
    annual_savings: float,
    initial_balance: float,
    annual_return_pct: float,
    withdrawal_rate_pct: float,
    contribution_timing: str,
) -> Tuple[float, List[Dict[str, float]]]:
    """
    Calculates how much annual spending the future portfolio can support.
    """
    years = convert_to_years(years_to_retirement)

    withdrawal_rate = withdrawal_rate_pct / 100

    if withdrawal_rate <= 0:
        raise ValueError("Withdrawal rate must be greater than 0.")

    timeline = project_accumulation_timeline(
        initial_balance=initial_balance,
        annual_savings=annual_savings,
        annual_return_pct=annual_return_pct,
        contribution_timing=contribution_timing,
        years=years,
    )

    future_balance = timeline[-1]["ending_balance"]

    expected_annual_expenses = future_balance * withdrawal_rate

    return expected_annual_expenses, timeline


def solve_annual_savings(
    *,
    years_to_retirement: float,
    expected_annual_expenses: float,
    initial_balance: float,
    annual_return_pct: float,
    withdrawal_rate_pct: float,
    contribution_timing: str,
) -> Tuple[float, List[Dict[str, float]]]:
    """
    Calculates the annual savings needed to retire in the given number of years.

    Uses binary search because lump-sum and dollar-cost-average contribution timing
    produce different year-by-year values.
    """
    years = convert_to_years(years_to_retirement)

    if expected_annual_expenses <= 0:
        raise ValueError("Expected annual expenses must be greater than 0.")

    if years <= 0:
        raise ValueError("Expected years to retirement must be greater than 0.")

    target = retirement_target(
        expected_annual_expenses=expected_annual_expenses,
        withdrawal_rate_pct=withdrawal_rate_pct,
    )

    def timeline_for_savings(savings: float) -> List[Dict[str, float]]:
        return project_accumulation_timeline(
            initial_balance=initial_balance,
            annual_savings=savings,
            annual_return_pct=annual_return_pct,
            contribution_timing=contribution_timing,
            years=years,
        )

    # If the current balance can grow to the target without further contributions,
    # then the required annual savings is $0.
    zero_savings_timeline = timeline_for_savings(0)

    if zero_savings_timeline[-1]["ending_balance"] >= target:
        return 0.0, zero_savings_timeline

    low = 0.0
    high = max(25.0, expected_annual_expenses)

    while timeline_for_savings(high)[-1]["ending_balance"] < target:
        high *= 2

        if high > MAX_REQUIRED_CONTRIBUTION_BEFORE_ERROR:
            raise ValueError("Required annual savings is too high to calculate.")

    # 100 iterations is an arbitrary number just to allow binary search to complete
    for _ in range(100):
        mid = (low + high) / 2

        if timeline_for_savings(mid)[-1]["ending_balance"] >= target:
            high = mid
        else:
            low = mid

    annual_savings = high
    timeline = timeline_for_savings(annual_savings)

    return annual_savings, timeline


def project_drawdown_timeline(
    *,
    starting_balance: float,
    expected_annual_expenses: float,
    annual_return_pct: float,
    inflation_rate_pct: float,
    withdrawal_timing: str,
) -> Dict[str, Any]:
    """
    Returns a year-by-year retirement drawdown timeline.

    Annual withdrawal model:
      1. Withdraw the full year's expenses at the beginning of the year.
      2. Apply investment growth to the remaining balance.

    Monthly withdrawal model:
      1. Withdraw expected_annual_expenses / 12 at the beginning of each month.
      2. Apply monthly investment growth after each withdrawal.

    Inflation increases the planned withdrawal amount each year.
    """

    validate_withdrawal_timing(withdrawal_timing)

    if starting_balance < 0:
        raise ValueError("Starting balance cannot be negative.")

    if expected_annual_expenses <= 0:
        raise ValueError("Expected annual expenses must be greater than 0.")

    annual_return_rate = annual_return_pct / 100
    inflation_rate = inflation_rate_pct / 100

    if annual_return_rate <= -1:
        raise ValueError("Annual return must be greater than -100%.")

    if inflation_rate < 0:
        raise ValueError("Inflation rate cannot be negative.")

    records = [
        {
            "year": 0,
            "starting_balance": starting_balance,
            "base_withdrawal": 0.0,
            "inflation_adjustment": 0.0,
            "planned_withdrawal": 0.0,
            "actual_withdrawal": 0.0,
            "investment_growth": 0.0,
            "ending_balance": starting_balance,
            "shortfall": 0.0,
        }
    ]

    balance = starting_balance
    annual_expenses = expected_annual_expenses

    for year in range(1, MAX_DRAWDOWN_YEARS + 1):
        starting_balance_for_year = balance
        base_withdrawal = expected_annual_expenses
        planned_withdrawal = annual_expenses
        inflation_adjustment = planned_withdrawal - base_withdrawal

        actual_withdrawal = 0.0
        investment_growth = 0.0
        shortfall = 0.0

        if withdrawal_timing == ANNUAL_WITHDRAWAL_START_OF_YEAR:
            # Full annual withdrawal happens first, so the withdrawn money
            # receives no investment return that year.
            actual_withdrawal = min(balance, planned_withdrawal)
            shortfall = planned_withdrawal - actual_withdrawal

            balance -= actual_withdrawal

            balance_before_growth = balance
            balance *= 1 + annual_return_rate
            investment_growth = balance - balance_before_growth

        elif withdrawal_timing == MONTHLY_WITHDRAWALS:
            monthly_withdrawal = planned_withdrawal / 12

            # Effective monthly growth makes 12 months equal the annual return.
            monthly_growth_multiplier = (1 + annual_return_rate) ** (1 / 12)

            for _ in range(12):
                actual_monthly_withdrawal = min(balance, monthly_withdrawal)
                monthly_shortfall = monthly_withdrawal - actual_monthly_withdrawal

                actual_withdrawal += actual_monthly_withdrawal
                shortfall += monthly_shortfall

                balance -= actual_monthly_withdrawal

                if monthly_shortfall > 0:
                    balance = 0.0
                    break

                balance_before_growth = balance
                balance *= monthly_growth_multiplier
                investment_growth += balance - balance_before_growth

        else:
            raise ValueError("Other withdrawal types are not implemented.")

        if balance < 0:
            balance = 0.0

        records.append(
            {
                "year": float(year),
                "starting_balance": starting_balance_for_year,
                "base_withdrawal": base_withdrawal,
                "inflation_adjustment": inflation_adjustment,
                "planned_withdrawal": planned_withdrawal,
                "actual_withdrawal": actual_withdrawal,
                "investment_growth": investment_growth,
                "ending_balance": balance,
                "shortfall": shortfall,
            }
        )

        if shortfall > 0 or balance <= 0:
            return {
                "years_until_broke": year,
                "never_broke": False,
                "withdrawal_timing": withdrawal_timing,
                "timeline": records,
            }

        # Next year's expenses increase with inflation.
        annual_expenses *= 1 + inflation_rate

    return {
        "years_until_broke": None,
        "never_broke": False,
        "withdrawal_timing": withdrawal_timing,
        "timeline": records,
    }


def solve_retirement_plan(
    *,
    years_to_retirement: Optional[float],
    expected_annual_expenses: Optional[float],
    annual_savings: Optional[float],
    initial_balance: float,
    annual_return_pct: float,
    withdrawal_rate_pct: float,
    inflation_rate_pct: float,
    contribution_timing: str,
    withdrawal_timing: str,
) -> Dict[str, Any]:
    """
    Provide exactly 2 of these 3 values:

      - years_to_retirement
      - expected_annual_expenses
      - annual_savings

    Leave the unknown value as None, and this function calculates it.
    """
    validate_contribution_timing(contribution_timing)
    validate_withdrawal_timing(withdrawal_timing)

    core_values = {
        "years_to_retirement": years_to_retirement,
        "expected_annual_expenses": expected_annual_expenses,
        "annual_savings": annual_savings,
    }

    provided_count = sum(value is not None for value in core_values.values())

    if provided_count != 2:
        raise ValueError(
            "Enter exactly 2 of these 3 fields: Years to Retirement, "
            "Expected Annual Expenses, Annual Savings. Leave the value "
            "you want calculated blank."
        )

    if initial_balance < 0:
        raise ValueError("Current portfolio value cannot be negative.")

    if annual_return_pct <= -100:
        raise ValueError("Annual return must be greater than -100%.")

    if withdrawal_rate_pct <= 0:
        raise ValueError("Withdrawal rate must be greater than 0.")

    if inflation_rate_pct < 0:
        raise ValueError("Inflation rate cannot be negative.")

    calculated_field = ""

    if years_to_retirement is None:
        calculated_field = "Years to Retirement"

        years_to_retirement, accumulation_timeline = solve_years_to_retirement(
            expected_annual_expenses=expected_annual_expenses,
            annual_savings=annual_savings,
            initial_balance=initial_balance,
            annual_return_pct=annual_return_pct,
            withdrawal_rate_pct=withdrawal_rate_pct,
            contribution_timing=contribution_timing,
        )

    elif expected_annual_expenses is None:
        calculated_field = "Expected Annual Expenses"

        expected_annual_expenses, accumulation_timeline = (
            solve_expected_annual_expenses(
                years_to_retirement=years_to_retirement,
                annual_savings=annual_savings,
                initial_balance=initial_balance,
                annual_return_pct=annual_return_pct,
                withdrawal_rate_pct=withdrawal_rate_pct,
                contribution_timing=contribution_timing,
            )
        )

    else:
        calculated_field = "Annual Savings"

        annual_savings, accumulation_timeline = solve_annual_savings(
            years_to_retirement=years_to_retirement,
            expected_annual_expenses=expected_annual_expenses,
            initial_balance=initial_balance,
            annual_return_pct=annual_return_pct,
            withdrawal_rate_pct=withdrawal_rate_pct,
            contribution_timing=contribution_timing,
        )

    portfolio_at_retirement = accumulation_timeline[-1]["ending_balance"]

    target = retirement_target(
        expected_annual_expenses=expected_annual_expenses,
        withdrawal_rate_pct=withdrawal_rate_pct,
    )

    drawdown = project_drawdown_timeline(
        starting_balance=portfolio_at_retirement,
        expected_annual_expenses=expected_annual_expenses,
        annual_return_pct=annual_return_pct,
        inflation_rate_pct=inflation_rate_pct,
        withdrawal_timing=withdrawal_timing,
    )

    return {
        "calculated_field": calculated_field,
        "years_to_retirement": float(years_to_retirement),
        "expected_annual_expenses": float(expected_annual_expenses),
        "annual_savings": float(annual_savings),
        "monthly_expenses": float(expected_annual_expenses) / 12,
        "monthly_savings": float(annual_savings) / 12,
        "target_portfolio": target,
        "portfolio_at_retirement": portfolio_at_retirement,
        "contribution_timing": contribution_timing,
        "withdrawal_timing": withdrawal_timing,
        "accumulation_timeline": accumulation_timeline,
        "drawdown": drawdown,
    }


# ----------------------------
# Formatting helpers
# ----------------------------

def money(value: float) -> str:
    return f"${value:,.0f}"


def format_accumulation_timeline(
    timeline: List[Dict[str, float]],
    max_rows: int = 50,
) -> str:
    rows = [
        "Accumulation projection:",
        "Year | Start Balance | Contributions | Growth | End Balance",
        "-----|---------------|---------------|--------|------------",
    ]

    visible_records = timeline[:max_rows]

    for record in visible_records:
        rows.append(
            f"{int(record['year']):>4} | "
            f"{money(record['starting_balance']):>13} | "
            f"{money(record['annual_contribution']):>13} | "
            f"{money(record['investment_growth']):>6} | "
            f"{money(record['ending_balance']):>11}"
        )

    if len(timeline) > max_rows:
        rows.append(f"... showing first {max_rows} of {len(timeline)} rows")

    return "\n".join(rows)


def format_drawdown_timeline(
    drawdown: Dict[str, Any],
    max_rows: int = 50,
) -> str:
    timeline = drawdown["timeline"]

    rows = [
        "Retirement drawdown projection:",
        (
            "Year | Start Balance | Base Withdrawal | Inflation Adj. | "
            "Planned Withdrawal | Actual Withdrawal | Growth | End Balance | Shortfall"
        ),
        (
            "-----|---------------|-----------------|----------------|"
            "-------------------|-------------------|--------|-------------|----------"
        ),
    ]

    visible_records = timeline[:max_rows]

    for record in visible_records:
        rows.append(
            f"{int(record['year']):>4} | "
            f"{money(record['starting_balance']):>13} | "
            f"{money(record['base_withdrawal']):>15} | "
            f"{money(record['inflation_adjustment']):>14} | "
            f"{money(record['planned_withdrawal']):>17} | "
            f"{money(record['actual_withdrawal']):>17} | "
            f"{money(record['investment_growth']):>6} | "
            f"{money(record['ending_balance']):>11} | "
            f"{money(record['shortfall']):>8}"
        )

    if len(timeline) > max_rows:
        rows.append(f"... showing first {max_rows} of {len(timeline)} rows")

    return "\n".join(rows)


# ----------------------------
# Simple GUI
# ----------------------------

class RetirementCalculatorGUI:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.root.title("Early Retirement Calculator")
        self.root.resizable(False, False)

        self.inputs = {}

        fields = [
            ("Years to Retirement", ""),
            ("Expected Annual Expenses", "70000"),
            ("Annual Savings", "459"),
            ("Current Portfolio Value", "936"),
            ("Annual Return %", "10"),
            ("Inflation Rate %", "3"),
            ("Withdrawal Rate %", "3.5"),
        ]

        frame = ttk.Frame(root, padding=16)
        frame.grid(row=0, column=0)

        instructions = (
            "Enter exactly 2 of the first 3 fields and leave 1 blank.\n"
            "The blank field will be calculated."
        )

        ttk.Label(frame, text=instructions, wraplength=560).grid(
            row=0,
            column=0,
            columnspan=2,
            sticky="w",
            pady=(0, 12),
        )

        row_offset = 0

        for row, (label, default) in enumerate(fields, start=1):
            if row in [2, 5]:
                row_offset += 1
                ttk.Label(frame, text="").grid(
                    row=row_offset,
                    column=0,
                    sticky="w",
                    pady=4,
                )
                ttk.Label(frame, text="").grid(
                    row=row_offset,
                    column=1,
                    sticky="w",
                    pady=4,
                )

            row_offset += 1

            ttk.Label(frame, text=label).grid(
                row=row_offset,
                column=0,
                sticky="w",
                pady=4,
            )

            entry = ttk.Entry(frame, width=28)
            entry.insert(0, default)
            entry.grid(row=row_offset, column=1, pady=4, sticky="ew")

            self.inputs[label] = entry

        contribution_timing_row = row_offset + 1

        ttk.Label(frame, text="Contribution Timing").grid(
            row=contribution_timing_row,
            column=0,
            sticky="w",
            pady=4,
        )

        self.contribution_timing = tk.StringVar(value=LUMP_SUM_START_OF_YEAR)

        contribution_dropdown = ttk.Combobox(
            frame,
            textvariable=self.contribution_timing,
            values=CONTRIBUTION_TIMINGS,
            state="readonly",
            width=26,
        )
        contribution_dropdown.grid(
            row=contribution_timing_row,
            column=1,
            pady=4,
            sticky="ew",
        )

        withdrawal_timing_row = contribution_timing_row + 1

        ttk.Label(frame, text="Withdrawal Timing").grid(
            row=withdrawal_timing_row,
            column=0,
            sticky="w",
            pady=4,
        )

        self.withdrawal_timing = tk.StringVar(value=ANNUAL_WITHDRAWAL_START_OF_YEAR)

        withdrawal_dropdown = ttk.Combobox(
            frame,
            textvariable=self.withdrawal_timing,
            values=WITHDRAWAL_TIMINGS,
            state="readonly",
            width=26,
        )
        withdrawal_dropdown.grid(
            row=withdrawal_timing_row,
            column=1,
            pady=4,
            sticky="ew",
        )

        button_row = withdrawal_timing_row + 1

        ttk.Button(frame, text="Calculate", command=self.calculate).grid(
            row=button_row,
            column=0,
            columnspan=2,
            pady=12,
            sticky="ew",
        )

        self.result = tk.Text(
            frame,
            width=118,
            height=34,
            wrap="none",
            font=("Courier", 10),
        )
        self.result.grid(row=button_row + 1, column=0, columnspan=2)

    def get_required_float(self, label: str) -> float:
        value = self.inputs[label].get().replace(",", "").strip()

        if value == "":
            raise ValueError(f"{label} is required.")

        return float(value)

    def get_optional_float(self, label: str) -> Optional[float]:
        value = self.inputs[label].get().replace(",", "").strip()

        if value == "":
            return None

        return float(value)

    def calculate(self):
        try:
            summary = solve_retirement_plan(
                years_to_retirement=self.get_optional_float("Years to Retirement"),
                expected_annual_expenses=self.get_optional_float(
                    "Expected Annual Expenses"
                ),
                annual_savings=self.get_optional_float("Annual Savings"),
                initial_balance=self.get_required_float("Current Portfolio Value"),
                annual_return_pct=self.get_required_float("Annual Return %"),
                withdrawal_rate_pct=self.get_required_float("Withdrawal Rate %"),
                inflation_rate_pct=self.get_required_float("Inflation Rate %"),
                contribution_timing=self.contribution_timing.get(),
                withdrawal_timing=self.withdrawal_timing.get(),
            )

            calculated_field = summary["calculated_field"]

            if calculated_field == "Years to Retirement":
                calculated_line = (
                    f"Calculated years to retirement: "
                    f"{summary['years_to_retirement']:.0f} years"
                )
            elif calculated_field == "Expected Annual Expenses":
                calculated_line = (
                    f"Calculated expected annual expenses: "
                    f"{money(summary['expected_annual_expenses'])}"
                )
            else:
                calculated_line = (
                    f"Calculated annual savings: {money(summary['annual_savings'])}"
                )

            drawdown = summary["drawdown"]

            if drawdown["years_until_broke"] is None:
                broke_line = f"Years until broke: more than {MAX_DRAWDOWN_YEARS} years"
            else:
                broke_line = f"Years until broke: {drawdown['years_until_broke']}"

            output = (
                f"{calculated_line}\n\n"
                f"Contribution timing: {summary['contribution_timing']}\n"
                f"Withdrawal timing: {summary['withdrawal_timing']}\n"
                f"Years to retirement: {summary['years_to_retirement']:.0f}\n"
                f"Expected annual expenses: {money(summary['expected_annual_expenses'])}\n"
                f"Annual savings: {money(summary['annual_savings'])}\n"
                f"Monthly expenses: {money(summary['monthly_expenses'])}\n"
                f"Monthly savings: {money(summary['monthly_savings'])}\n"
                f"Target portfolio: {money(summary['target_portfolio'])}\n"
                f"Projected portfolio at retirement: {money(summary['portfolio_at_retirement'])}\n"
                f"{broke_line}\n\n"
                f"{format_accumulation_timeline(summary['accumulation_timeline'])}\n\n"
                f"{format_drawdown_timeline(drawdown)}\n"
            )

            self.result.delete("1.0", tk.END)
            self.result.insert(tk.END, output)

        except ValueError as error:
            messagebox.showerror("Invalid input", str(error))


def main():
    root = tk.Tk()
    RetirementCalculatorGUI(root)
    root.mainloop()


if __name__ == "__main__":
    main()
