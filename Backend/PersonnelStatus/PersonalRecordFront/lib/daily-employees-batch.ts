export const DAILY_EMPLOYEE_BATCH_SIZE = 200;

export interface DailyEmployee {
  id: string;
  full_name: string;
  rank_code: string;
  division_id?: number;
  position_level?: number | null;
}

export interface DailyEmployeesResponse {
  results: DailyEmployee[];
}

/** Keep the API's division limit while loading every division in a large tree. */
export async function loadDailyEmployees(
  divisionIds: readonly number[],
  fetchBatch: (ids: number[]) => Promise<DailyEmployeesResponse>,
): Promise<DailyEmployeesResponse> {
  const uniqueIds = [...new Set(divisionIds)];
  const batches: number[][] = [];
  for (let offset = 0; offset < uniqueIds.length; offset += DAILY_EMPLOYEE_BATCH_SIZE) {
    batches.push(uniqueIds.slice(offset, offset + DAILY_EMPLOYEE_BATCH_SIZE));
  }
  const responses: DailyEmployeesResponse[] = [];
  let next = 0;
  // A large tree should not create a request for every division or an
  // unbounded burst of requests. Preserve batch order when responses finish.
  await Promise.all(Array.from({ length: Math.min(3, batches.length) }, async () => {
    while (next < batches.length) {
      const index = next++;
      responses[index] = await fetchBatch(batches[index]);
    }
  }));
  const employees = new Map<string, DailyEmployee>();
  for (const response of responses) {
    for (const employee of response.results) {
      if (!employees.has(employee.id)) employees.set(employee.id, employee);
    }
  }
  const results = [...employees.values()];
  if (batches.length <= 1) return { results };
  return { results: results.sort((a, b) =>
    (a.position_level ?? Number.MAX_SAFE_INTEGER) - (b.position_level ?? Number.MAX_SAFE_INTEGER)
    || a.full_name.localeCompare(b.full_name, "ru")
    || Number(a.id) - Number(b.id),
  ) };
}
