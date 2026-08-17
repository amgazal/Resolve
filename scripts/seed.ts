/**
 * Loads the starter catalog into Supabase.
 *
 *   SUPABASE_URL=... SUPABASE_SECRET_KEY=... npm run seed
 *
 * Uses a privileged server key, so it bypasses RLS — which is why it lives
 * in scripts/ and is never imported by the app. Keep that key out of browser
 * environment variables and out of version control. Legacy projects can use
 * SUPABASE_SERVICE_ROLE_KEY instead.
 *
 * Bootstrap/dev-reset only. Run this after the schema exists and before
 * creating real support sessions. Once a project has session history, this
 * script refuses to continue because diagnoses and troubleshooting steps are
 * not versioned yet; rewriting them would make old history misleading.
 */

import { createClient } from "@supabase/supabase-js";
import { CATEGORIES } from "../src/data/categories";
import { DIAGNOSES } from "../src/data/diagnoses";
import { TREES } from "../src/data/trees";

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("Set SUPABASE_URL and SUPABASE_SECRET_KEY before seeding (or use the legacy SUPABASE_SERVICE_ROLE_KEY).");
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });

async function main() {
  // ------------------------------------------------------------ org
  const { data: org, error: orgError } = await db
    .from("organizations")
    .upsert({ name: "Northgate Group", slug: "northgate" }, { onConflict: "slug" })
    .select("id")
    .single();
  if (orgError) throw orgError;
  const orgId = org.id as string;

  // This seed intentionally stops once real diagnostic history exists.
  // Troubleshooting steps are shared definitions in this version, so deleting
  // and recreating them after use would either violate FK protections or, if
  // those protections changed later, rewrite the meaning of old sessions.
  const { count: historyCount, error: historyError } = await db
    .from("diagnostic_sessions")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId);
  if (historyError) throw historyError;
  if ((historyCount ?? 0) > 0) {
    throw new Error(
      "Refusing to seed: this organization already has diagnostic history. " +
      "Use migrations/admin authoring for live changes instead of reseeding.",
    );
  }

  // ------------------------------------------------------ diagnoses
  const dxIds: Record<string, string> = {};
  for (const [key, d] of Object.entries(DIAGNOSES)) {
    const { data, error } = await db
      .from("diagnoses")
      .upsert({
        org_id: orgId, key, title: d.title, short_label: d.short,
        node_label: d.node, default_priority: d.priority,
      }, { onConflict: "org_id,key" })
      .select("id")
      .single();
    if (error) throw error;
    dxIds[key] = data.id;

    const { error: deleteStepsError } = await db
      .from("troubleshooting_steps")
      .delete()
      .eq("diagnosis_id", data.id);
    if (deleteStepsError) throw deleteStepsError;

    const { error: stepError } = await db.from("troubleshooting_steps").insert(
      d.steps.map(([title, detail], i) => ({
        diagnosis_id: data.id, position: i + 1, title, detail,
      }))
    );
    if (stepError) throw stepError;
  }

  // ------------------------------------------ categories and trees
  for (const [i, c] of CATEGORIES.entries()) {
    const { data: cat, error: catError } = await db
      .from("diagnostic_categories")
      .upsert({
        org_id: orgId, slug: c.slug, label: c.label, short_label: c.shortLabel,
        hint: c.hint, icon: c.icon, position: i,
      }, { onConflict: "org_id,slug" })
      .select("id")
      .single();
    if (catError) throw catError;

    const spec = TREES[c.slug];
    if (!spec) continue;

    // Publish a new version rather than editing the current one.
    const { data: versions, error: versionsError } = await db
      .from("diagnostic_trees").select("version").eq("category_id", cat.id);
    if (versionsError) throw versionsError;
    const nextVersion = Math.max(0, ...(versions ?? []).map((v: { version: number }) => v.version)) + 1;

    const { error: archiveError } = await db.from("diagnostic_trees")
      .update({ status: "archived" }).eq("category_id", cat.id).eq("status", "published");
    if (archiveError) throw archiveError;

    const { error: draftDeleteError } = await db.from("diagnostic_trees")
      .delete().eq("category_id", cat.id).eq("status", "draft");
    if (draftDeleteError) throw draftDeleteError;

    const { data: tree, error: treeError } = await db
      .from("diagnostic_trees")
      .insert({
        category_id: cat.id, version: nextVersion, status: "published",
        root_label: spec.rootLabel, published_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (treeError) throw treeError;

    // Pass one: every node, so options can point forward as well as back.
    const nodeIds: Record<string, string> = {};
    const nodeEntries = Object.entries(spec.nodes);
    const { data: insertedNodes, error: nodeError } = await db
      .from("diagnostic_nodes")
      .insert(nodeEntries.map(([key, n], pos) => ({
        tree_id: tree.id, key, question: n[0],
        fact_label: n[1], short_label: n[2], position: pos,
      })))
      .select("id, key");
    if (nodeError) throw nodeError;
    for (const n of insertedNodes) nodeIds[n.key] = n.id;

    // Pass two: wire the answers.
    const options = nodeEntries.flatMap(([key, n]) =>
      n[3].map(([label, factValue, target], pos) => ({
        node_id: nodeIds[key]!,
        label,
        fact_value: factValue,
        position: pos,
        next_node_id: target.startsWith("node:") ? nodeIds[target.slice(5)]! : null,
        diagnosis_id: target.startsWith("dx:") ? dxIds[target.slice(3)]! : null,
      }))
    );
    const { error: optionError } = await db.from("diagnostic_options").insert(options);
    if (optionError) throw optionError;

    const { error: rootError } = await db
      .from("diagnostic_trees")
      .update({ root_node_id: nodeIds[spec.root]! })
      .eq("id", tree.id);
    if (rootError) throw rootError;

    console.log(`  ${c.label} — v${nextVersion}, ${insertedNodes.length} questions`);
  }

  console.log("\nSeeded.");
  console.log("Create accounts in Supabase Auth, then promote one:");
  console.log(`  update users set role = 'admin' where email = 'you@example.com';`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
