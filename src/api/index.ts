/**
 * One import site for the rest of the app.
 *
 * With Supabase credentials present, every call goes to the real backend.
 * Without them, the in-memory adapter takes over so the project still runs
 * for a reviewer who just cloned it. Both satisfy the same `Api` type, so
 * swapping one for the other cannot silently change a payload shape.
 */

import type { Api } from "@/types";
import { supabaseApi, isConfigured } from "./client";
import { mockApi } from "./mockApi";

export const api: Api = isConfigured ? supabaseApi : mockApi;

/** The UI mentions this once, quietly, so nobody mistakes demo data for real data. */
export const usingLiveBackend = isConfigured;
