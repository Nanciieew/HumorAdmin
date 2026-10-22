import { US_STATES } from "@/lib/us-states";

export function StateSelect({ value, disabled = false, id = "state_code" }: { value: string; disabled?: boolean; id?: string }) {
  return <div>
    <label htmlFor={id} className="mb-2 block text-sm font-medium">State you represent</label>
    <select id={id} name="state_code" defaultValue={value} required disabled={disabled} className="w-full rounded-xl border border-current/25 bg-background px-4 py-3">
      <option value="">Choose your state</option>
      {US_STATES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
    </select>
  </div>;
}
