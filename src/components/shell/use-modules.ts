"use client";

// Reading and changing the workspace's switched-on features. The session comes
// from the server layout, so after a change the page is refreshed to pick it up.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, errorMessage } from "@/lib/client/api";
import { isOn, isPartOn, MODULE_IDS, visibleTo, type ModuleId, type PartsOff } from "@/lib/workspace/modules";
import { useSession } from "./session-context";

export function useModules() {
  const { org } = useSession();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const canManage = org.role === "owner" || org.role === "admin";
  /** What's on right now, as an explicit list. */
  const current = MODULE_IDS.filter((id) => isOn(org.modules, id));
  const save = async (modules: ModuleId[] | null, industry?: string, partsOff?: PartsOff) => {
    setBusy(true);
    setError("");
    try {
      await api(`/api/v1/orgs/${org.id}/modules`, { method: "PUT", body: { modules, ...(industry ? { industry } : {}), ...(partsOff ? { partsOff } : {}) } });
      router.refresh();
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const toggle = (id: ModuleId, value: boolean) => save(value ? [...new Set([...current, id])] : current.filter((x) => x !== id));
  const partsOff = (org.partsOff ?? {}) as PartsOff;
  /** Switch one part of a module on or off. */
  const togglePart = (id: ModuleId, part: string, value: boolean) => {
    const off = new Set(partsOff[id] ?? []);
    if (value) off.delete(part);
    else off.add(part);
    return save(org.modules === null ? null : current, undefined, { ...partsOff, [id]: [...off] });
  };
  return {
    modules: org.modules,
    current,
    partsOff,
    /** On for the workspace and in this member's role. */
    on: (id: ModuleId) => visibleTo(org, id),
    partOn: (id: ModuleId, part: string) => isPartOn(partsOff, id, part),
    canManage,
    save,
    toggle,
    togglePart,
    busy,
    error,
  };
}
