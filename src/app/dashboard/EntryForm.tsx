"use client";

import { useState, useRef } from "react";
import { addEntry } from "./actions";

export default function EntryForm() {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  async function clientAction(formData: FormData) {
    setLoading(true);
    setError(null);
    const result = await addEntry(formData);
    if (result?.error) {
      setError(result.error);
      setLoading(false);
    } else {
      formRef.current?.reset();
      setLoading(false);
    }
  }

  return (
    <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
      <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">Add Savings Entry</h2>
      <form ref={formRef} action={clientAction} className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Amount</label>
          <input 
            type="number" 
            name="amount" 
            step="0.01" 
            required 
            className="w-full px-3 py-2 border rounded focus:ring-1 focus:ring-blue-500 outline-none"
            placeholder="0.00"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Note</label>
          <input 
            type="text" 
            name="note" 
            required 
            className="w-full px-3 py-2 border rounded focus:ring-1 focus:ring-blue-500 outline-none"
            placeholder="What is this for?"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Date</label>
          <input 
            type="date" 
            name="date" 
            required 
            defaultValue={new Date().toISOString().split('T')[0]}
            className="w-full px-3 py-2 border rounded focus:ring-1 focus:ring-blue-500 outline-none"
          />
        </div>
        <button 
          type="submit" 
          disabled={loading}
          className="w-full bg-blue-600 text-white py-2 rounded font-medium hover:bg-blue-700 transition disabled:opacity-50"
        >
          {loading ? "Adding..." : "Add Entry"}
        </button>
        {error && <p className="text-red-500 text-xs mt-2">{error}</p>}
      </form>
    </div>
  );
}
