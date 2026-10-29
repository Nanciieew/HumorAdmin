// Existing route tests isolate database behavior; the audit suite exercises real SQL.
export function auditRpcFixture(name, args) {
  if (name === 'record_generation_start' || name === 'record_generation_finish') {
    return { abortSignal: async () => ({ data: name === 'record_generation_start' ? args.p_entry.id : null, error: null }) };
  }
}
