import math
import tkinter as tk
from tkinter import ttk, messagebox
from typing import Any, Dict, List, Optional, Tuple

# TODO - Add increasing contributions
# Ex. Increase monthly or annual contributions each year by a percentage,
# by a dollar amount, or up to some maximum.


# ----------------------------
# Constants
# ----------------------------

ANNUAL_WITHDRAWAL_START_OF_YEAR = "Annual withdrawal at start of year"
MONTHLY_WITHDRAWALS = "Monthly withdrawals"

WITHDRAWAL_TIMINGS = [
    ANNUAL_WITHDRAWAL_START_OF_YEAR,
    MONTHLY_WITHDRAWALS,
]

DISPLAY_TODAYS_DOLLARS = "Display today's purchasing-power dollars"
DISPLAY_FUTURE_DOLLARS = "Display nominal future dollars"

DISPLAY_MODES = [
    DISPLAY_TODAYS_DOLLARS,
    DISPLAY_FUTURE_DOLLARS,
]

MAX_ACCUMULATION_YEARS = 100
MAX_DRAWDOWN_YEARS = 100
MAX_REQUIRED_CONTRIBUTION_BEFORE_ERROR = 1_000_000

YEARS_TO_RETIREMENT_LABEL = "Years to Retirement"
EXPECTED_ANNUAL_EXPENSES_LABEL = "Expected Annual Expenses (Today)"
MONTHLY_CONTRIBUTION_LABEL = "Monthly Contributions"
ANNUAL_CONTRIBUTION_LABEL = "Annual Contributions"
CURRENT_PORTFOLIO_LABEL = "Current Portfolio Value"
ANNUAL_RETURN_LABEL = "Annual Return %"
INFLATION_RATE_LABEL = "Inflation Rate %"
WITHDRAWAL_RATE_LABEL = "Withdrawal Rate %"


# ----------------------------
# Validation helpers
# ----------------------------

def validate_withdrawal_timing(withdrawal_timing: str) -> None:
    if withdrawal_timing not in WITHDRAWAL_TIMINGS:
        raise ValueError("Invalid withdrawal timing selected.")


def validate_display_mode(display_mode: str) -> None:
    if display_mode not in DISPLAY_MODES:
        raise ValueError("Invalid display mode selected.")


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
    return expected_annual_expenses / withdrawal_rate


def cumulative_inflation_factor(
    *,
    inflation_rate_pct: float,
    year: int,
) -> float:
    inflation_rate = inflation_rate_pct / 100
    return (1 + inflation_rate) ** year


def future_value(
    *,
    today_value: float,
    inflation_rate_pct: float,
    year: int,
) -> float:
    return today_value * cumulative_inflation_factor(
        inflation_rate_pct=inflation_rate_pct,
        year=year,
    )


def today_value(
    *,
    future_value_amount: float,
    inflation_rate_pct: float,
    year: int,
) -> float:
    return future_value_amount / cumulative_inflation_factor(
        inflation_rate_pct=inflation_rate_pct,
        year=year,
    )


def display_value(
    *,
    value: float,
    display_mode: str,
    inflation_rate_pct: float,
    year: int,
) -> float:
    if display_mode == DISPLAY_FUTURE_DOLLARS:
        return value

    if display_mode == DISPLAY_TODAYS_DOLLARS:
        return today_value(
            future_value_amount=value,
            inflation_rate_pct=inflation_rate_pct,
            year=year,
        )

    raise ValueError("Invalid display mode selected.")


def grow_balance_for_one_year(
    *,
    starting_balance: float,
    monthly_contribution: float,
    annual_contribution: float,
    annual_return_pct: float,
) -> float:
    """
    Returns the nominal portfolio value after one year.

    Annual contributions are invested once at the start of the year.
    Monthly contributions are invested at the start of each month.
    The monthly growth multiplier compounds to the configured annual return.
    """
    annual_return_rate = annual_return_pct / 100
    monthly_growth_multiplier = (1 + annual_return_rate) ** (1 / 12)

    balance = starting_balance + annual_contribution

    for _ in range(12):
        balance += monthly_contribution
        balance *= monthly_growth_multiplier

    return balance


def project_accumulation_timeline(
    *,
    initial_balance: float,
    monthly_contribution: float,
    annual_contribution: float,
    annual_return_pct: float,
    inflation_rate_pct: float,
    years: int,
) -> List[Dict[str, float]]:
    """
    Returns year-by-year nominal accumulation values.

    Year 0 is the starting balance. Each later year shows:
      - starting balance
      - rolling contributions
      - annual investment growth
      - cumulative net growth
      - ending balance

    Inflation is tracked separately for display conversion. It does not reduce
    the nominal portfolio balance. Rolling contributions are nominal dollars
    actually contributed and are not inflation-adjusted in the timeline.
    """
    records = [
        {
            "year": 0,
            "cumulative_inflation_factor": 1.0,
            "starting_balance": initial_balance,
            "monthly_contribution": 0.0,
            "annual_contribution": 0.0,
            "total_contribution": 0.0,
            "rolling_contribution": 0.0,
            "investment_growth": 0.0,
            "cumulative_net_growth": 0.0,
            "ending_balance": initial_balance,
            "real_ending_balance": initial_balance,
        }
    ]

    balance = initial_balance
    rolling_contribution = 0.0

    for year in range(1, years + 1):
        starting_balance = balance
        total_monthly_contributions = monthly_contribution * 12
        total_contribution = annual_contribution + total_monthly_contributions
        rolling_contribution += total_contribution

        ending_balance = grow_balance_for_one_year(
            starting_balance=starting_balance,
            monthly_contribution=monthly_contribution,
            annual_contribution=annual_contribution,
            annual_return_pct=annual_return_pct,
        )

        investment_growth = ending_balance - starting_balance - total_contribution
        cumulative_net_growth = ending_balance - initial_balance - rolling_contribution
        inflation_factor = cumulative_inflation_factor(
            inflation_rate_pct=inflation_rate_pct,
            year=year,
        )
        real_ending_balance = ending_balance / inflation_factor

        records.append(
            {
                "year": float(year),
                "cumulative_inflation_factor": inflation_factor,
                "starting_balance": starting_balance,
                "monthly_contribution": monthly_contribution,
                "annual_contribution": annual_contribution,
                "total_contribution": total_contribution,
                "rolling_contribution": rolling_contribution,
                "investment_growth": investment_growth,
                "cumulative_net_growth": cumulative_net_growth,
                "ending_balance": ending_balance,
                "real_ending_balance": real_ending_balance,
            }
        )

        balance = ending_balance

    return records


def solve_years_to_retirement(
    *,
    expected_annual_expenses: float,
    monthly_contribution: float,
    annual_contribution: float,
    initial_balance: float,
    annual_return_pct: float,
    inflation_rate_pct: float,
    withdrawal_rate_pct: float,
) -> Tuple[int, List[Dict[str, float]]]:
    """
    Calculates how many whole years it will take to reach the retirement target.
    """
    timeline = project_accumulation_timeline(
        initial_balance=initial_balance,
        monthly_contribution=monthly_contribution,
        annual_contribution=annual_contribution,
        annual_return_pct=annual_return_pct,
        inflation_rate_pct=inflation_rate_pct,
        years=MAX_ACCUMULATION_YEARS,
    )

    today_target = retirement_target(
        expected_annual_expenses=expected_annual_expenses,
        withdrawal_rate_pct=withdrawal_rate_pct,
    )

    for record in timeline:
        year = int(record["year"])
        future_target = future_value(
            today_value=today_target,
            inflation_rate_pct=inflation_rate_pct,
            year=year,
        )

        if record["ending_balance"] >= future_target:
            return year, timeline[: year + 1]

    raise ValueError(f"Target is not reached within {MAX_ACCUMULATION_YEARS} years.")


def solve_expected_annual_expenses(
    *,
    years_to_retirement: int,
    monthly_contribution: float,
    annual_contribution: float,
    initial_balance: float,
    annual_return_pct: float,
    inflation_rate_pct: float,
    withdrawal_rate_pct: float,
) -> Tuple[float, List[Dict[str, float]]]:
    """
    Calculates how much annual spending the future portfolio can support.
    """

    withdrawal_rate = withdrawal_rate_pct / 100

    timeline = project_accumulation_timeline(
        initial_balance=initial_balance,
        monthly_contribution=monthly_contribution,
        annual_contribution=annual_contribution,
        annual_return_pct=annual_return_pct,
        inflation_rate_pct=inflation_rate_pct,
        years=years_to_retirement,
    )

    nominal_portfolio = timeline[-1]["ending_balance"]
    real_portfolio = today_value(
        future_value_amount=nominal_portfolio,
        inflation_rate_pct=inflation_rate_pct,
        year=years_to_retirement,
    )

    expected_annual_expenses = real_portfolio * withdrawal_rate

    return expected_annual_expenses, timeline


def solve_monthly_contribution(
    *,
    years_to_retirement: int,
    expected_annual_expenses: float,
    annual_contribution: float,
    initial_balance: float,
    annual_return_pct: float,
    inflation_rate_pct: float,
    withdrawal_rate_pct: float,
) -> Tuple[float, List[Dict[str, float]]]:
    """
    Calculates the monthly contribution needed to retire in the given number
    of years while treating annual_contribution as a fixed yearly lump sum.
    """
    today_target = retirement_target(
        expected_annual_expenses=expected_annual_expenses,
        withdrawal_rate_pct=withdrawal_rate_pct,
    )
    future_target = future_value(
        today_value=today_target,
        inflation_rate_pct=inflation_rate_pct,
        year=years_to_retirement,
    )

    def timeline_for_monthly_contribution(
        monthly_contribution: float,
    ) -> List[Dict[str, float]]:
        return project_accumulation_timeline(
            initial_balance=initial_balance,
            monthly_contribution=monthly_contribution,
            annual_contribution=annual_contribution,
            annual_return_pct=annual_return_pct,
            inflation_rate_pct=inflation_rate_pct,
            years=years_to_retirement,
        )

    # If the current balance and fixed annual contributions can reach the target,
    # then the required monthly contribution is $0.
    zero_monthly_timeline = timeline_for_monthly_contribution(0)

    if zero_monthly_timeline[-1]["ending_balance"] >= future_target:
        return 0.0, zero_monthly_timeline

    low = 0.0
    high = max(25.0, expected_annual_expenses / 12)

    def final_balance_for_monthly_contribution(monthly_contribution: float) -> float:
        timeline = timeline_for_monthly_contribution(monthly_contribution)
        return timeline[-1]["ending_balance"]

    while final_balance_for_monthly_contribution(high) < future_target:
        high *= 2

        if high > MAX_REQUIRED_CONTRIBUTION_BEFORE_ERROR:
            raise ValueError("Required monthly contribution is too high to calculate.")

    for _ in range(100):
        mid = (low + high) / 2

        if final_balance_for_monthly_contribution(mid) >= future_target:
            high = mid
        else:
            low = mid

    monthly_contribution = high
    return monthly_contribution, timeline_for_monthly_contribution(monthly_contribution)


def project_drawdown_timeline(
    *,
    starting_balance: float,
    expected_annual_expenses: float,
    annual_return_pct: float,
    inflation_rate_pct: float,
    retirement_start_year: int,
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

    Portfolio balances stay nominal. Inflation changes the nominal withdrawal
    needed to represent the user's expenses in each future year.
    """

    annual_return_rate = annual_return_pct / 100

    records = [
        {
            "year": 0,
            "absolute_year": float(retirement_start_year),
            "cumulative_inflation_factor": cumulative_inflation_factor(
                inflation_rate_pct=inflation_rate_pct,
                year=retirement_start_year,
            ),
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

    for year in range(1, MAX_DRAWDOWN_YEARS + 1):
        absolute_year = retirement_start_year + year - 1
        inflation_factor = cumulative_inflation_factor(
            inflation_rate_pct=inflation_rate_pct,
            year=absolute_year,
        )
        starting_balance_for_year = balance
        base_withdrawal = expected_annual_expenses
        planned_withdrawal = expected_annual_expenses * inflation_factor
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
                "absolute_year": float(absolute_year),
                "cumulative_inflation_factor": inflation_factor,
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

    return {
        "years_until_broke": None,
        "never_broke": True,
        "withdrawal_timing": withdrawal_timing,
        "timeline": records,
    }


def solve_retirement_plan(
    *,
    years_to_retirement: Optional[float],
    expected_annual_expenses: Optional[float],
    monthly_contribution: Optional[float],
    annual_contribution: float,
    initial_balance: float,
    annual_return_pct: float,
    withdrawal_rate_pct: float,
    inflation_rate_pct: float,
    display_mode: str,
    withdrawal_timing: str,
) -> Dict[str, Any]:
    """
    Provide exactly 2 of these 3 values:

      - years_to_retirement
      - expected_annual_expenses
      - monthly_contribution

    Leave the unknown value as None, and this function calculates it.
    Annual contribution is a separate fixed yearly lump-sum input.
    """
    validate_withdrawal_timing(withdrawal_timing)
    validate_display_mode(display_mode)

    core_values = {
        "years_to_retirement": years_to_retirement,
        "expected_annual_expenses": expected_annual_expenses,
        "monthly_contribution": monthly_contribution,
    }

    provided_count = sum(value is not None for value in core_values.values())

    if provided_count != 2:
        raise ValueError(
            "Enter exactly 2 of these 3 fields: Years to Retirement, "
            "Expected Annual Expenses (Today), Monthly Contributions. Leave "
            "the value you want calculated blank."
        )

    if initial_balance < 0:
        raise ValueError("Current portfolio value cannot be negative.")

    if annual_return_pct <= 0:
        raise ValueError("Annual return must be greater than 0%.")

    if withdrawal_rate_pct <= 0:
        raise ValueError("Withdrawal rate must be greater than 0.")

    if inflation_rate_pct < 0:
        raise ValueError("Inflation rate cannot be negative.")

    if annual_contribution < 0:
        raise ValueError("Annual contributions cannot be negative.")

    if years_to_retirement is not None:
        years_to_retirement = convert_to_years(years_to_retirement)

    if expected_annual_expenses is not None and expected_annual_expenses <= 0:
        raise ValueError("Expected annual expenses must be greater than 0.")

    if monthly_contribution is not None and monthly_contribution < 0:
        raise ValueError("Monthly contributions cannot be negative.")

    if monthly_contribution is None and years_to_retirement is not None:
        if years_to_retirement <= 0:
            raise ValueError("Expected years to retirement must be greater than 0.")

    if (
        expected_annual_expenses is None
        and initial_balance == 0
        and monthly_contribution == 0
        and annual_contribution == 0
    ):
        raise ValueError("Expected annual expenses must be greater than 0.")

    calculated_field = ""

    if years_to_retirement is None:
        calculated_field = "Years to Retirement"

        years_to_retirement, accumulation_timeline = solve_years_to_retirement(
            expected_annual_expenses=expected_annual_expenses,
            monthly_contribution=monthly_contribution,
            annual_contribution=annual_contribution,
            initial_balance=initial_balance,
            annual_return_pct=annual_return_pct,
            inflation_rate_pct=inflation_rate_pct,
            withdrawal_rate_pct=withdrawal_rate_pct,
        )

    elif expected_annual_expenses is None:
        calculated_field = "Expected Annual Expenses"

        expected_annual_expenses, accumulation_timeline = (
            solve_expected_annual_expenses(
                years_to_retirement=years_to_retirement,
                monthly_contribution=monthly_contribution,
                annual_contribution=annual_contribution,
                initial_balance=initial_balance,
                annual_return_pct=annual_return_pct,
                inflation_rate_pct=inflation_rate_pct,
                withdrawal_rate_pct=withdrawal_rate_pct,
            )
        )

    else:
        calculated_field = "Monthly Contributions"

        monthly_contribution, accumulation_timeline = solve_monthly_contribution(
            years_to_retirement=years_to_retirement,
            expected_annual_expenses=expected_annual_expenses,
            annual_contribution=annual_contribution,
            initial_balance=initial_balance,
            annual_return_pct=annual_return_pct,
            inflation_rate_pct=inflation_rate_pct,
            withdrawal_rate_pct=withdrawal_rate_pct,
        )

    total_annual_contributions = monthly_contribution * 12 + annual_contribution
    nominal_portfolio_at_retirement = accumulation_timeline[-1]["ending_balance"]
    retirement_inflation_factor = cumulative_inflation_factor(
        inflation_rate_pct=inflation_rate_pct,
        year=years_to_retirement,
    )
    real_portfolio_at_retirement = today_value(
        future_value_amount=nominal_portfolio_at_retirement,
        inflation_rate_pct=inflation_rate_pct,
        year=years_to_retirement,
    )
    today_target = retirement_target(
        expected_annual_expenses=expected_annual_expenses,
        withdrawal_rate_pct=withdrawal_rate_pct,
    )
    future_retirement_expenses = future_value(
        today_value=expected_annual_expenses,
        inflation_rate_pct=inflation_rate_pct,
        year=years_to_retirement,
    )
    future_target = future_value(
        today_value=today_target,
        inflation_rate_pct=inflation_rate_pct,
        year=years_to_retirement,
    )

    displayed_expected_annual_expenses = display_value(
        value=future_retirement_expenses,
        display_mode=display_mode,
        inflation_rate_pct=inflation_rate_pct,
        year=years_to_retirement,
    )
    displayed_target = display_value(
        value=future_target,
        display_mode=display_mode,
        inflation_rate_pct=inflation_rate_pct,
        year=years_to_retirement,
    )
    displayed_portfolio_at_retirement = display_value(
        value=nominal_portfolio_at_retirement,
        display_mode=display_mode,
        inflation_rate_pct=inflation_rate_pct,
        year=years_to_retirement,
    )

    drawdown = project_drawdown_timeline(
        starting_balance=nominal_portfolio_at_retirement,
        expected_annual_expenses=expected_annual_expenses,
        annual_return_pct=annual_return_pct,
        inflation_rate_pct=inflation_rate_pct,
        retirement_start_year=years_to_retirement,
        withdrawal_timing=withdrawal_timing,
    )

    return {
        "calculated_field": calculated_field,
        "years_to_retirement": float(years_to_retirement),
        "expected_annual_expenses": float(expected_annual_expenses),
        "future_first_year_withdrawal": float(future_retirement_expenses),
        "displayed_expected_annual_expenses": displayed_expected_annual_expenses,
        "displayed_first_year_withdrawal": displayed_expected_annual_expenses,
        "monthly_contribution": float(monthly_contribution),
        "annual_contribution": float(annual_contribution),
        "total_annual_contributions": float(total_annual_contributions),
        "monthly_expenses": float(expected_annual_expenses) / 12,
        "displayed_monthly_expenses": displayed_expected_annual_expenses / 12,
        "displayed_first_month_withdrawal": displayed_expected_annual_expenses / 12,
        "today_target_portfolio": today_target,
        "future_target_portfolio": future_target,
        "displayed_target_portfolio": displayed_target,
        "nominal_portfolio_at_retirement": nominal_portfolio_at_retirement,
        "real_portfolio_at_retirement": real_portfolio_at_retirement,
        "displayed_portfolio_at_retirement": displayed_portfolio_at_retirement,
        "retirement_inflation_factor": retirement_inflation_factor,
        "withdrawal_timing": withdrawal_timing,
        "display_mode": display_mode,
        "inflation_rate_pct": inflation_rate_pct,
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
    *,
    max_rows: int = 50,
) -> str:
    rows = [
        "Accumulation projection:",
        (
            "Year | Accu. Inflation | Start Balance | Rolling Contrib. | "
            "Growth | Net Growth | End Balance | End Balance (Today $)"
        ),
        (
            "-----|-----------------|---------------|------------------|"
            "--------|------------|-------------|----------------------"
        ),
    ]

    visible_records = timeline[:max_rows]

    for record in visible_records:
        year = int(record["year"])
        factor = record["cumulative_inflation_factor"]

        rows.append(
            f"{year:>4} | "
            f"{factor:>15.3f} | "
            f"{money(record['starting_balance']):>13} | "
            f"{money(record['rolling_contribution']):>16} | "
            f"{money(record['investment_growth']):>6} | "
            f"{money(record['cumulative_net_growth']):>10} | "
            f"{money(record['ending_balance']):>11} | "
            f"{money(record['real_ending_balance']):>20}"
        )

    if len(timeline) > max_rows:
        rows.append(f"... showing first {max_rows} of {len(timeline)} rows")

    return "\n".join(rows)

def format_drawdown_timeline(
    drawdown: Dict[str, Any],
    *,
    display_mode: str,
    inflation_rate_pct: float,
    max_rows: int = 50,
) -> str:
    timeline = drawdown["timeline"]

    rows = [
        f"Retirement drawdown projection ({display_mode.lower()}):",
        (
            "Year | Start Inflation Factor | Start Balance | Planned Withdrawal | "
            "Actual Withdrawal | Growth | End Balance | Shortfall"
        ),
        (
            "-----|------------------------|---------------|-------------------|"
            "-------------------|--------|-------------|----------"
        ),
    ]

    visible_records = timeline[:max_rows]

    for record in visible_records:
        drawdown_year = int(record["year"])
        absolute_year = int(record["absolute_year"])
        end_year = absolute_year if drawdown_year == 0 else absolute_year + 1
        factor = record["cumulative_inflation_factor"]

        def shown(value: float, value_year: int) -> str:
            return money(
                display_value(
                    value=value,
                    display_mode=display_mode,
                    inflation_rate_pct=inflation_rate_pct,
                    year=value_year,
                )
            )

        rows.append(
            f"{drawdown_year:>4} | "
            f"{factor:>22.3f} | "
            f"{shown(record['starting_balance'], absolute_year):>13} | "
            f"{shown(record['planned_withdrawal'], absolute_year):>17} | "
            f"{shown(record['actual_withdrawal'], absolute_year):>17} | "
            f"{shown(record['investment_growth'], end_year):>6} | "
            f"{shown(record['ending_balance'], end_year):>11} | "
            f"{shown(record['shortfall'], absolute_year):>8}"
        )

    if len(timeline) > max_rows:
        rows.append(f"... showing first {max_rows} of {len(timeline)} rows")

    return "\n".join(rows)


# ----------------------------
# Simple GUI
# ----------------------------


class ToolTip:
    def __init__(self, widget, text: str):
        self.widget = widget
        self.text = text
        self.tip_window = None

        widget.bind("<Enter>", self.show)
        widget.bind("<Leave>", self.hide)

    def show(self, _event=None):
        if self.tip_window or not self.text:
            return

        x = self.widget.winfo_rootx() + 20
        y = self.widget.winfo_rooty() + 20

        self.tip_window = tk.Toplevel(self.widget)
        self.tip_window.wm_overrideredirect(True)
        self.tip_window.wm_geometry(f"+{x}+{y}")

        label = tk.Label(
            self.tip_window,
            text=self.text,
            justify="left",
            background="#ffffe0",
            relief="solid",
            borderwidth=1,
            padx=8,
            pady=6,
        )
        label.pack()

    def hide(self, _event=None):
        if self.tip_window:
            self.tip_window.destroy()
            self.tip_window = None


class RetirementCalculatorGUI:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.root.title("Early Retirement Calculator")
        self.root.resizable(True, True)
        self.root.grid_rowconfigure(0, weight=1)
        self.root.grid_columnconfigure(0, weight=1)

        self.inputs = {}

        fields = [
            (YEARS_TO_RETIREMENT_LABEL, ""),
            (EXPECTED_ANNUAL_EXPENSES_LABEL, "70000"),
            (ANNUAL_CONTRIBUTION_LABEL, "1500"),
            (MONTHLY_CONTRIBUTION_LABEL, "2368"),  # 2368, 2868, 3368
            (CURRENT_PORTFOLIO_LABEL, "936"),
            (ANNUAL_RETURN_LABEL, "10"),
            (INFLATION_RATE_LABEL, "3"),
            (WITHDRAWAL_RATE_LABEL, "3.5"),
        ]

        frame = ttk.Frame(root, padding=16)
        frame.grid(row=0, column=0, sticky="nsew")
        frame.grid_columnconfigure(1, weight=1)

        instructions = (
            "Enter exactly 2 of the first 3 fields and leave 1 blank.\n"
            "Annual Contributions is a fixed yearly lump-sum input and can be 0.\n"
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
            if row in [2, 6]:
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

            label_frame = ttk.Frame(frame)
            label_frame.grid(row=row_offset, column=0, sticky="w", pady=4)

            ttk.Label(label_frame, text=label).pack(side="left")

            if label in (MONTHLY_CONTRIBUTION_LABEL, ANNUAL_CONTRIBUTION_LABEL):
                help_label = tk.Label(
                    label_frame,
                    text=" ?",
                    cursor="hand2",
                    fg="blue",
                )
                help_label.pack(side="left")

                label_text = "Assumption: Annual contributions are invested at the start of each year."
                if label == MONTHLY_CONTRIBUTION_LABEL:
                    label_text = "Assumption: Monthly contributions are invested at the start of each month."

                ToolTip(help_label, label_text)

            entry = ttk.Entry(frame, width=28)
            entry.insert(0, default)
            entry.grid(row=row_offset, column=1, pady=4, sticky="ew")

            self.inputs[label] = entry

        withdrawal_timing_row = row_offset + 1

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

        display_mode_row = withdrawal_timing_row + 1

        ttk.Label(frame, text="Display Mode").grid(
            row=display_mode_row,
            column=0,
            sticky="w",
            pady=4,
        )

        self.display_mode = tk.StringVar(value=DISPLAY_TODAYS_DOLLARS)

        display_mode_dropdown = ttk.Combobox(
            frame,
            textvariable=self.display_mode,
            values=DISPLAY_MODES,
            state="readonly",
            width=26,
        )
        display_mode_dropdown.grid(
            row=display_mode_row,
            column=1,
            pady=4,
            sticky="ew",
        )

        button_row = display_mode_row + 1

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
        frame.grid_rowconfigure(button_row + 1, weight=1)
        self.result.grid(row=button_row + 1, column=0, columnspan=2, sticky="nsew")

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
                years_to_retirement=self.get_optional_float(YEARS_TO_RETIREMENT_LABEL),
                expected_annual_expenses=self.get_optional_float(
                    EXPECTED_ANNUAL_EXPENSES_LABEL
                ),
                monthly_contribution=self.get_optional_float(MONTHLY_CONTRIBUTION_LABEL),
                annual_contribution=self.get_required_float(ANNUAL_CONTRIBUTION_LABEL),
                initial_balance=self.get_required_float(CURRENT_PORTFOLIO_LABEL),
                annual_return_pct=self.get_required_float(ANNUAL_RETURN_LABEL),
                withdrawal_rate_pct=self.get_required_float(WITHDRAWAL_RATE_LABEL),
                inflation_rate_pct=self.get_required_float(INFLATION_RATE_LABEL),
                display_mode=self.display_mode.get(),
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
                    f"Calculated expected annual expenses (today): "
                    f"{money(summary['expected_annual_expenses'])}"
                )
            else:
                calculated_line = (
                    f"Calculated monthly contributions: "
                    f"{money(summary['monthly_contribution'])}"
                )

            drawdown = summary["drawdown"]

            if drawdown["years_until_broke"] is None:
                broke_line = f"Years until broke: more than {MAX_DRAWDOWN_YEARS} years"
            else:
                broke_line = f"Years until broke: {drawdown['years_until_broke']}"

            accumulation_text = format_accumulation_timeline(
                summary["accumulation_timeline"],
            )
            drawdown_text = format_drawdown_timeline(
                drawdown,
                display_mode=summary["display_mode"],
                inflation_rate_pct=summary["inflation_rate_pct"],
            )

            output = (
                f"{calculated_line}\n\n"
                f"Withdrawal timing: {summary['withdrawal_timing']}\n"
                f"Drawdown display mode: {summary['display_mode']}\n"
                f"Inflation factor at retirement: {summary['retirement_inflation_factor']:.3f}\n"
                f"Years to retirement: {summary['years_to_retirement']:.0f}\n"
                f"Expected annual expenses: {money(summary['displayed_expected_annual_expenses'])}\n"
                f"First-year retirement withdrawal: {money(summary['displayed_first_year_withdrawal'])}\n"
                f"Monthly contributions: {money(summary['monthly_contribution'])}\n"
                f"Annual contributions: {money(summary['annual_contribution'])}\n"
                f"Total annual contributions: {money(summary['total_annual_contributions'])}\n"
                f"Monthly expenses: {money(summary['displayed_monthly_expenses'])}\n"
                f"First-month retirement withdrawal: {money(summary['displayed_first_month_withdrawal'])}\n"
                f"Retirement target: {money(summary['displayed_target_portfolio'])}\n"
                f"Projected portfolio at retirement: {money(summary['displayed_portfolio_at_retirement'])}\n"
                f"{broke_line}\n\n"
                f"{accumulation_text}\n\n"
                f"{drawdown_text}\n"
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
