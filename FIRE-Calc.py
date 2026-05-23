"""
Simple Early Retirement Calculator
Inputs:
- Expected Annual Expenses
- Annual Savings
- Current Portfolio Value
- Annual Return %
- Withdrawal Rate %

Run with: python early_retirement_gui.py
"""

import math
import tkinter as tk
from tkinter import ttk, messagebox


# ----------------------------
# Core calculator logic
# ----------------------------

def retirement_target(expected_annual_expenses: float, withdrawal_rate_pct: float) -> float:
    """
    Returns the total amount of money needed for retirement
    """
    withdrawal_rate = withdrawal_rate_pct / 100

    if withdrawal_rate <= 0:
        raise ValueError("Withdrawal rate must be greater than 0.")

    return expected_annual_expenses / withdrawal_rate


def years_to_retirement(
    expected_annual_expenses: float,
    annual_savings: float,
    initial_balance: float,
    annual_return_pct: float,
    withdrawal_rate_pct: float,
) -> float:
    """
    Returns the total number of years till retirement
    """
    target = retirement_target(expected_annual_expenses, withdrawal_rate_pct)

    if initial_balance >= target:
        return 0.0

    if annual_savings <= 0:
        raise ValueError("Annual savings must be greater than 0.")

    annual_return_rate = annual_return_pct / 100

    if annual_return_rate == 0:
        return (target - initial_balance) / annual_savings

    ## *** More Readable Breakdown ***
    ## The loop is easier to read, but only returns whole years.

    #    # 0.05 becomes 1.05 for 5% annual growth
    #    annual_growth_multiplier = annual_return_rate + 1
    #    while balance < target:
    #        # Grow the current balance for one year.
    #        balance *= annual_growth_multiplier

    #        # Add this year's savings contribution.
    #        balance += annual_savings

    #        years += 1

    #    return float(years)

    numerator = target + annual_savings / annual_return_rate
    denominator = initial_balance + annual_savings / annual_return_rate

    if numerator <= 0 or denominator <= 0:
        raise ValueError("Inputs produce an invalid calculation.")

    return math.log(numerator / denominator) / math.log(1 + annual_return_rate)


def calculate_summary(
    expected_annual_expenses: float,
    annual_savings: float,
    initial_balance: float,
    annual_return_pct: float,
    withdrawal_rate_pct: float,
) -> dict:
    target = retirement_target(expected_annual_expenses, withdrawal_rate_pct)

    years = years_to_retirement(
        expected_annual_expenses,
        annual_savings,
        initial_balance,
        annual_return_pct,
        withdrawal_rate_pct,
    )

    return {
        "years": years,
        "expected_annual_expenses": expected_annual_expenses,
        "annual_savings": annual_savings,
        "monthly_expenses": expected_annual_expenses / 12,
        "monthly_savings": annual_savings / 12,
        "target_portfolio": target,
    }


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
            ("Expected Annual Expenses", "70000"),
            ("Annual Savings", "20000"),
            ("Current Portfolio Value", "0"),
            ("Annual Return %", "6"),
            ("Withdrawal Rate %", "3"),
        ]

        frame = ttk.Frame(root, padding=16)
        frame.grid(row=0, column=0)

        for row, (label, default) in enumerate(fields):
            ttk.Label(frame, text=label).grid(row=row, column=0, sticky="w", pady=4)

            entry = ttk.Entry(frame, width=20)
            entry.insert(0, default)
            entry.grid(row=row, column=1, pady=4)

            self.inputs[label] = entry

        ttk.Button(frame, text="Calculate", command=self.calculate).grid(
            row=len(fields),
            column=0,
            columnspan=2,
            pady=12,
            sticky="ew",
        )

        self.result = tk.Text(frame, width=48, height=11, wrap="word")
        self.result.grid(row=len(fields) + 1, column=0, columnspan=2)

    def get_float(self, label: str) -> float:
        value = self.inputs[label].get().replace(",", "").strip()
        return float(value)

    def calculate(self):
        try:
            summary = calculate_summary(
                expected_annual_expenses=self.get_float("Expected Annual Expenses"),
                annual_savings=self.get_float("Annual Savings"),
                initial_balance=self.get_float("Current Portfolio Value"),
                annual_return_pct=self.get_float("Annual Return %"),
                withdrawal_rate_pct=self.get_float("Withdrawal Rate %"),
            )

            output = (
                f"You can retire in {summary['years']:.1f} years.\n\n"
                f"Expected annual expenses: ${summary['expected_annual_expenses']:,.0f}\n"
                f"Annual savings: ${summary['annual_savings']:,.0f}\n"
                f"Monthly expenses: ${summary['monthly_expenses']:,.0f}\n"
                f"Monthly savings: ${summary['monthly_savings']:,.0f}\n"
                f"Target portfolio: ${summary['target_portfolio']:,.0f}\n\n"
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
