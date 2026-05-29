"use client";

import { useState } from "react";
import { updateGoal } from "./actions";

export default function GoalForm({ initialTarget }: { initialTarget: number }) {
  const [error, setError] = useState<string | null>(null);

  async function clientAction(formData: FormData) {
    setError(null);
    const result = await updateGoal(formData);
    if (result?.error) {
      setError(result.error);
    }
  }

  return (
    <form action={clientAction} className="mt-6 pt-6 border-t border-gray-100">
      <label className="block text-xs font-semibold text-gray-500 uppercase mb-2">Update Savings Goal</label>
      <div className="flex gap-2">
        <input 
          type="number" 
          name="targetAmount" 
          step="0.01" 
          placeholder="Target Amount"
          className="flex-1 px-3 py-1 border rounded text-sm focus:ring-1 focus:ring-blue-500 outline-none"
          defaultValue={initialTarget}
        />
        <button type="submit" className="bg-gray-800 text-white px-3 py-1 rounded text-sm hover:bg-gray-900 transition">
          Set
        </button>
      </div>
      {error && <p className="text-red-500 text-xs mt-1">{error}</p>}
    </form>
  );
}
