"use client";

import { useState } from "react";
import type { ActionResult } from "@/lib/action-result";
import type { ServerRegistration } from "@/lib/server-registration";
import {
  SERVER_LOCATIONS,
  SERVER_LOCATION_LABELS,
  SERVER_LOCATION_FLAGS,
  effectiveServerLocation,
  type ServerLocation,
} from "@/lib/server-locations";
import { ServerRegistrationForm } from "./server-registration-form";

type BoundAction = (prevState: ActionResult | null, formData: FormData) => Promise<ActionResult>;

export interface GroupedServerEntry {
  licenseId: string;
  licenseKey: string;
  registration: ServerRegistration;
  verified: boolean;
  action: BoundAction;
}

interface ServerRegistrationsGroupedProps {
  entries: GroupedServerEntry[];
  /** A license with no registration yet, if one exists -- the only valid target for
   * "+ Add server" / "+ Add here". Adding a genuinely new server beyond a user's
   * existing licenses needs issuance, which is out of scope here. */
  addTarget: { licenseId: string; action: BoundAction } | null;
}

type GroupKey = ServerLocation | "unspecified";

function mostRecentGroup(entries: GroupedServerEntry[]): GroupKey | null {
  if (entries.length === 0) return null;
  const newest = entries.reduce((a, b) => (b.registration.updatedAt > a.registration.updatedAt ? b : a));
  return effectiveServerLocation(newest.registration.location, newest.registration.serverLocation);
}

export function ServerRegistrationsGrouped({ entries, addTarget }: ServerRegistrationsGroupedProps) {
  const [openGroup, setOpenGroup] = useState<GroupKey | null>(() => mostRecentGroup(entries));
  const [editingLicenseId, setEditingLicenseId] = useState<string | null>(null);
  const [addingInGroup, setAddingInGroup] = useState<GroupKey | null>(null);

  const byGroup = new Map<GroupKey, GroupedServerEntry[]>();
  for (const entry of entries) {
    const key = effectiveServerLocation(entry.registration.location, entry.registration.serverLocation);
    byGroup.set(key, [...(byGroup.get(key) ?? []), entry]);
  }

  const unspecified = byGroup.get("unspecified") ?? [];
  const groupKeys: GroupKey[] = [...SERVER_LOCATIONS, ...(unspecified.length ? (["unspecified"] as const) : [])];

  return (
    <div>
      {groupKeys.map((key) => {
        const groupEntries = byGroup.get(key) ?? [];
        const label = key === "unspecified" ? "Unspecified location" : SERVER_LOCATION_LABELS[key];
        const isOpen = openGroup === key;
        const isAdding = addingInGroup === key;
        const Flag = key !== "unspecified" ? SERVER_LOCATION_FLAGS[key] : null;

        if (groupEntries.length === 0) {
          return (
            <div className="srv-grp" key={key}>
              <div className="srv-ghead empty">
                <span className="srv-pin dim">📍</span>
                {Flag && <Flag className="srv-flag dim" />}
                <span className="srv-gname dim">{label} Servers</span>
                <span className="srv-gcount zero">0 Added</span>
                <span className="srv-gsum none">No server registered here yet</span>
                {addTarget && key !== "unspecified" && (
                  <button
                    type="button"
                    className="srv-gadd"
                    onClick={() => {
                      setAddingInGroup(key);
                      setOpenGroup(key);
                    }}
                  >
                    ＋ Add here
                  </button>
                )}
                {!addTarget && <span className="srv-gsub">Each server needs its own licence.</span>}
              </div>
              {isAdding && addTarget && key !== "unspecified" && (
                <div className="srv-grows">
                  <div className="srv-detail">
                    <ServerRegistrationForm
                      action={addTarget.action}
                      value={null}
                      defaultLocation={key}
                      onSaved={() => setAddingInGroup(null)}
                      onCancel={() => setAddingInGroup(null)}
                    />
                  </div>
                </div>
              )}
            </div>
          );
        }

        const verifiedCount = groupEntries.filter((e) => e.verified).length;
        const registeredCount = groupEntries.length - verifiedCount;
        const summary = [
          verifiedCount ? `${verifiedCount} Verified` : null,
          registeredCount ? `${registeredCount} Registered` : null,
        ]
          .filter(Boolean)
          .join(" · ");

        return (
          <div className="srv-grp" key={key}>
            <button type="button" className={`srv-ghead${isOpen ? " open" : ""}`} onClick={() => setOpenGroup(isOpen ? null : key)}>
              <span className="srv-pin">📍</span>
              {Flag && <Flag className="srv-flag" />}
              <span className="srv-gname">{label} Servers</span>
              {groupEntries.length >= 2 && <span className="srv-gcount">{groupEntries.length} Added</span>}
              <span className="srv-gsum">{summary}</span>
              <span className="srv-chev">{isOpen ? "▾" : "▸"}</span>
            </button>
            {isOpen && (
              <div className="srv-grows">
                {groupEntries.map((entry) => {
                  const isEditing = editingLicenseId === entry.licenseId;
                  if (isEditing) {
                    return (
                      <div className="srv-detail" key={entry.licenseId}>
                        <div className="srv-dtop">
                          <span className="srv-dn">{entry.registration.serverName}</span>
                        </div>
                        <ServerRegistrationForm
                          action={entry.action}
                          value={entry.registration}
                          onSaved={() => setEditingLicenseId(null)}
                          onCancel={() => setEditingLicenseId(null)}
                        />
                      </div>
                    );
                  }
                  return (
                    <button
                      type="button"
                      className="srv-srow"
                      key={entry.licenseId}
                      onClick={() => setEditingLicenseId(entry.licenseId)}
                    >
                      <span className="srv-ic">🖥</span>
                      <span className="srv-sname">{entry.registration.serverName}</span>
                      <span className="srv-sprov">
                        {entry.registration.vpsProvider}
                        {entry.registration.vpsProviderOther ? ` · ${entry.registration.vpsProviderOther}` : ""}
                      </span>
                      <span className="srv-sip">{entry.registration.declaredIp}</span>
                      <span className={`st ${entry.verified ? "ver" : "reg"}`} style={{ flex: "0 0 96px", justifyContent: "center" }}>
                        <span className="d" />
                        {entry.verified ? "Verified" : "Registered"}
                      </span>
                    </button>
                  );
                })}
                {isAdding && addTarget && (
                  <div className="srv-detail">
                    <ServerRegistrationForm
                      action={addTarget.action}
                      value={null}
                      defaultLocation={key === "unspecified" ? undefined : key}
                      onSaved={() => setAddingInGroup(null)}
                      onCancel={() => setAddingInGroup(null)}
                    />
                  </div>
                )}
                {addTarget && key !== "unspecified" && !isAdding && (
                  <button
                    type="button"
                    className="srv-gadd"
                    style={{ marginTop: 10 }}
                    onClick={() => setAddingInGroup(key)}
                  >
                    ＋ Add here
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
