import { validateSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { format } from "date-fns";
import Link from "next/link";
import GoalForm from "./GoalForm";
import EntryForm from "./EntryForm";

export default async function DashboardPage() {
  const user = await validateSession();
  if (!user) redirect("/auth/login");

  const entries = await prisma.entry.findMany({
    where: { userId: user.id },
    orderBy: { date: "desc" },
  });

  const goal = await prisma.goal.findUnique({
    where: { userId: user.id },
  });

  const totalSaved = entries.reduce((sum: number, entry: { amount: number }) => sum + entry.amount, 0);
  const targetAmount = goal?.targetAmount || 0;
  const progress = targetAmount > 0 ? Math.min((totalSaved / targetAmount) * 100, 100) : 0;

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-8">
      <header className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Kolo Kept</h1>
          <p className="text-gray-600">Welcome back, {user.email}</p>
        </div>
        <div className="space-x-4">
          <Link href="/settings" className="text-gray-600 hover:text-blue-600 font-medium">
            Settings
          </Link>
          <form action="/api/logout" method="POST" className="inline">
            <button type="submit" className="text-gray-600 hover:text-red-600 font-medium cursor-pointer">
              Logout
            </button>
          </form>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        {/* Stats Card */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-2">Total Saved</h2>
          <p className="text-4xl font-bold text-blue-600">${totalSaved.toLocaleString()}</p>
          
          <div className="mt-6">
            <div className="flex justify-between text-sm mb-2">
              <span className="text-gray-600 font-medium">Goal Progress</span>
              <span className="text-gray-900 font-bold">{progress.toFixed(1)}%</span>
            </div>
            <div className="w-full bg-gray-100 rounded-full h-4 overflow-hidden">
              <div 
                className="bg-blue-600 h-full rounded-full transition-all duration-500" 
                style={{ width: `${progress}%` }}
              ></div>
            </div>
            <p className="text-xs text-gray-500 mt-2">
              Target: ${targetAmount.toLocaleString()}
            </p>
          </div>

          <GoalForm initialTarget={targetAmount} />
        </div>

        {/* Add Entry Form */}
        <EntryForm />
      </div>

      {/* Entries List */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <h2 className="p-6 text-sm font-semibold text-gray-500 uppercase tracking-wider border-b border-gray-100">Recent Entries</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50">
                <th className="px-6 py-3 text-xs font-semibold text-gray-600 uppercase">Date</th>
                <th className="px-6 py-3 text-xs font-semibold text-gray-600 uppercase">Note</th>
                <th className="px-6 py-3 text-xs font-semibold text-gray-600 uppercase text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {entries.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-6 py-8 text-center text-gray-500">No entries yet. Start saving!</td>
                </tr>
              ) : (
                entries.map((entry: { id: string; amount: number; note: string; date: Date }) => (
                  <tr key={entry.id} className="hover:bg-gray-50 transition">
                    <td className="px-6 py-4 text-sm text-gray-600">{format(new Date(entry.date), 'MMM d, yyyy')}</td>
                    <td className="px-6 py-4 text-sm text-gray-900 font-medium">{entry.note}</td>
                    <td className="px-6 py-4 text-sm text-gray-900 font-bold text-right text-blue-600">${entry.amount.toLocaleString()}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
