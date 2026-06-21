import { getAccessToken } from "@/lib/api";
import { BACKEND_URL } from "@/shared/config/env";

export interface SecondmentRequest {
  id: number;
  employee_detail: {
    id: number;
    personnel_number: string;
    first_name: string;
    last_name: string;
    middle_name: string | null;
    full_name: string;
    rank: string | null;
    photo_url?: string;
  };
  from_division_detail: {
    id: number;
    name: string;
    division_type: string;
  };
  to_division_detail: {
    id: number;
    name: string;
    division_type: string;
  };
  start_date: string;
  end_date: string;
  reason: string;
  status: "pending" | "approved" | "rejected";
}

export async function fetchIncomingSecondmentRequests() {
  const endpoint = "/api/secondments/secondment-requests/incoming/";
  const url = `${BACKEND_URL}${endpoint}`;

  const token = await getAccessToken();
  const headers: HeadersInit = {
    accept: "application/json",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(url, { headers, cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

async function postAction(id: number, action: "approve" | "reject") {
  const endpoint = `/api/secondments/secondment-requests/${id}/${action}/`;
  const url = `${BACKEND_URL}${endpoint}`;
  const token = await getAccessToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    accept: "application/json",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(url, { method: "POST", headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

export const approveSecondmentRequest = (id: number) =>
  postAction(id, "approve");
export const rejectSecondmentRequest = (id: number) => postAction(id, "reject");
