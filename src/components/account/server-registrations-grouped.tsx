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
  /** Row identity for this list: which row is open for editing, and the React key. Was
   * licenseId, which stops identifying a server once license_id is nullable -- two
   * licence-less servers would share a key and collapse. */
  registrationId: string;
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
  /** Where "Get another licence" points when addTarget is null. The same
   * config.telegramChannelUrl the page's locked state already uses for "Upgrade to
   * Paid" -- passed in rather than read here so there is one source for the route. */
  upgradeUrl: string;
}

type GroupKey = ServerLocation | "unspecified";

/** Shown in the add-button slot when the user has no spare licence to register against.
 * One server (one IP) per licence is the commercial rule, not a limitation (coxwell,
 * 2026-09-12): server_registrations has unique(license_id), so a second submit for a
 * licence that already has a server would edit that server rather than add one. This
 * replaced a dim one-line note that only ever rendered on the *empty* location groups,
 * which meant a client with a single server never saw any explanation inside the group
 * they were actually looking at -- they just saw the Add button disappear. */
function NeedsAnotherLicence({ upgradeUrl, inFooter = false }: { upgradeUrl: string; inFooter?: boolean }) {
  return (
    <div className={`srv-glic${inFooter ? " footer" : ""}`}>
      <span className="srv-glic-h">Each server needs its own licence</span>
      <span className="srv-glic-b">
        One licence covers one server (one IP). To register another server, add a licence.
      </span>
      <a className="srv-glic-a" href={upgradeUrl} target="_blank" rel="noopener noreferrer">
        <span className="srv-gadd-icon">＋</span> Get another licence
      </a>
    </div>
  );
}

function mostRecentGroup(entries: GroupedServerEntry[]): GroupKey | null {
  if (entries.length === 0) return null;
  const newest = entries.reduce((a, b) => (b.registration.updatedAt > a.registration.updatedAt ? b : a));
  return effectiveServerLocation(newest.registration.location, newest.registration.serverLocation);
}

export function ServerRegistrationsGrouped({ entries, addTarget, upgradeUrl }: ServerRegistrationsGroupedProps) {
  const [openGroup, setOpenGroup] = useState<GroupKey | null>(() => mostRecentGroup(entries));
  const [editingServerId, setEditingServerId] = useState<string | null>(null);
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
                    <span className="srv-gadd-icon">＋</span> Add here
                  </button>
                )}
                {!addTarget && key !== "unspecified" && <NeedsAnotherLicence upgradeUrl={upgradeUrl} />}
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

        return (
          <div className="srv-grp" key={key}>
            <button type="button" className={`srv-ghead${isOpen ? " open" : ""}`} onClick={() => setOpenGroup(isOpen ? null : key)}>
              <span className="srv-pin">📍</span>
              {Flag && <Flag className="srv-flag" />}
              <span className="srv-gname">{label} Servers</span>
              {groupEntries.length >= 2 && <span className="srv-gcount">{groupEntries.length} Added</span>}
              <span className="srv-gsum">
                {verifiedCount > 0 && <span className="srv-gsum-item">{verifiedCount} Verified</span>}
                {verifiedCount > 0 && registeredCount > 0 && <span className="srv-gsum-sep"> · </span>}
                {registeredCount > 0 && <span className="srv-gsum-item reg">{registeredCount} Registered</span>}
              </span>
              <span className="srv-chev">{isOpen ? "▾" : "▸"}</span>
            </button>
            {isOpen && (
              <div className="srv-grows">
                {groupEntries.map((entry) => {
                  const isEditing = editingServerId === entry.registrationId;
                  if (isEditing) {
                    return (
                      <div className="srv-detail" key={entry.registrationId}>
                        <div className="srv-dtop">
                          <span className="srv-dn">{entry.registration.serverName}</span>
                        </div>
                        <ServerRegistrationForm
                          action={entry.action}
                          value={entry.registration}
                          onSaved={() => setEditingServerId(null)}
                          onCancel={() => setEditingServerId(null)}
                        />
                      </div>
                    );
                  }
                  return (
                    <button
                      type="button"
                      className="srv-srow"
                      key={entry.registrationId}
                      onClick={() => setEditingServerId(entry.registrationId)}
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
                    <span className="srv-gadd-icon">＋</span> Add here
                  </button>
                )}
                {!addTarget && key !== "unspecified" && (
                  <NeedsAnotherLicence upgradeUrl={upgradeUrl} inFooter />
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
