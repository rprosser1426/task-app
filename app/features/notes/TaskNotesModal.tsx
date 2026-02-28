"use client";

import React, { useEffect, useState } from "react";
import type { TaskNote } from "./types";
import { createTaskNote, fetchTaskNotes } from "./notesApi";

type Props = {
    open: boolean;
    taskId: string | null;
    taskTitle?: string;
    onClose(): void;
    displayUserName(id: string): string;

    busy: boolean; // accepted for consistency (not required inside)
    setBusyText(text: string | null): void;

    onNotesCountChange?: (taskId: string, count: number) => void;
};

function formatDate(iso: string) {
    try {
        return new Date(iso).toLocaleString();
    } catch {
        return iso;
    }
}

export default function TaskNotesModal({
    open,
    taskId,
    taskTitle,
    onClose,
    displayUserName,
    setBusyText,
    onNotesCountChange,
}: Props) {
    const [notes, setNotes] = useState<TaskNote[]>([]);
    const [text, setText] = useState("");
    const [loadingLocal, setLoadingLocal] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);

    async function refresh() {
        if (!taskId) return;
        setError(null);
        setLoadingLocal(true);
        setBusyText("Loading notes…");
        try {
            const list = await fetchTaskNotes(taskId);
            setNotes(list);
            onNotesCountChange?.(taskId, list.length);
        } catch (e: any) {
            setError(e?.message || "Failed to load notes.");
        } finally {
            setLoadingLocal(false);
            setBusyText(null);
        }
    }

    useEffect(() => {
        if (open && taskId) {
            void refresh();
        } else {
            setNotes([]);
            setText("");
            setError(null);
            setLoadingLocal(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, taskId]);

    async function onSave() {
        if (!taskId) return;
        const v = text.trim();
        if (!v) return;

        setError(null);
        setSaved(false);
        setSaving(true);
        setBusyText("Saving note…");

        try {
            await createTaskNote(taskId, v);
            setText("");
            await refresh();

            // Optional: quick “Saved” confirmation after the overlay disappears
            setSaved(true);
            setTimeout(() => setSaved(false), 1200);
        } catch (e: any) {
            setError(e?.message || "Failed to save note.");
        } finally {
            setSaving(false);
            setBusyText(null);
        }
    }

    if (!open) return null;

    return (
        <div style={styles.backdrop} role="dialog" aria-modal="true" onClick={onClose}>
            <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
                <div style={styles.header}>
                    <div style={styles.title}>{taskTitle || "Notes"}</div>
                    <button style={styles.closeBtn} onClick={onClose} aria-label="Close">
                        ✕
                    </button>
                </div>

                {saving && (
                    <div style={styles.savingOverlay} aria-live="polite" aria-busy="true">
                        <div style={styles.savingBox}>
                            <div style={styles.savingTitle}>Saving…</div>
                            <div style={styles.savingSub}>Please wait.</div>
                        </div>
                    </div>
                )}

                {saved && !saving && (
                    <div style={styles.savedToast} aria-live="polite">
                        Saved ✅
                    </div>
                )}

                <div style={styles.body}>
                    {error && <div style={styles.error}>{error}</div>}

                    <div style={styles.history}>
                        {loadingLocal ? (
                            <div style={styles.muted}>Loading…</div>
                        ) : notes.length === 0 ? (
                            <div style={styles.muted}>No notes yet.</div>
                        ) : (
                            notes.map((n) => (
                                <div key={n.id} style={styles.noteRow}>
                                    <div style={styles.noteMeta}>
                                        <span style={styles.noteAuthor}>{displayUserName(n.author_id)}</span>
                                        <span style={styles.noteDate}>{formatDate(n.created_at)}</span>
                                    </div>
                                    <div style={styles.noteText}>{n.note}</div>
                                </div>
                            ))
                        )}
                    </div>

                    <div style={styles.composer}>
                        <textarea
                            value={text}
                            onChange={(e) => setText(e.target.value)}
                            placeholder="Write a note…"
                            style={styles.textarea}
                        />

                        <div style={styles.actions}>
                            <button
                                style={styles.btnPrimary}
                                onClick={onSave}
                                disabled={saving || !text.trim()}
                            >
                                {saving ? "Saving…" : "Save"}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

const styles: Record<string, React.CSSProperties> = {
    backdrop: {
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "grid",
        placeItems: "center",
        zIndex: 9999,
        padding: 16,
    },
    modal: {
        position: "relative",
        width: "min(720px, 96vw)",
        maxHeight: "86vh",
        overflow: "hidden",
        borderRadius: 16,
        border: "1px solid rgba(255,255,255,0.16)",
        background: "rgba(15, 23, 42, 0.98)",
        boxShadow: "0 18px 60px rgba(0,0,0,0.45)",
        color: "#e5e7eb",
        display: "grid",
        gridTemplateRows: "auto 1fr",
    },
    header: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "14px 16px",
        borderBottom: "1px solid rgba(255,255,255,0.12)",
    },
    title: { fontSize: 16, fontWeight: 900 },
    closeBtn: {
        borderRadius: 10,
        border: "1px solid rgba(255,255,255,0.18)",
        background: "rgba(255,255,255,0.08)",
        color: "#e5e7eb",
        padding: "8px 10px",
        cursor: "pointer",
        fontWeight: 800,
    },
    body: {
        padding: 16,
        display: "grid",
        gridTemplateRows: "1fr auto",
        gap: 12,
    },
    history: {
        minHeight: 180,
        maxHeight: "45vh",
        overflowY: "auto",
        padding: 12,
        borderRadius: 12,
        border: "1px solid rgba(255,255,255,0.12)",
        background: "rgba(255,255,255,0.04)",
    },
    noteRow: {
        padding: "10px 8px",
        borderBottom: "1px solid rgba(255,255,255,0.08)",
    },
    noteMeta: { display: "flex", gap: 10, alignItems: "baseline", marginBottom: 6 },
    noteAuthor: { fontWeight: 900 },
    noteDate: { fontSize: 12, opacity: 0.8 },
    noteText: { whiteSpace: "pre-wrap", lineHeight: 1.35, opacity: 0.95 },
    composer: { display: "grid", gap: 10, paddingTop: 8 },
    textarea: {
        width: "100%",
        minHeight: 90,
        resize: "vertical",
        padding: 12,
        borderRadius: 12,
        border: "1px solid rgba(255,255,255,0.18)",
        background: "rgba(0,0,0,0.22)",
        color: "#e5e7eb",
        outline: "none",
    },
    actions: { display: "flex", justifyContent: "flex-end", gap: 10 },
    btn: {
        padding: "10px 12px",
        borderRadius: 10,
        border: "1px solid rgba(255,255,255,0.18)",
        background: "rgba(255,255,255,0.08)",
        color: "#e5e7eb",
        cursor: "pointer",
        fontWeight: 700,
    },
    btnPrimary: {
        padding: "10px 12px",
        borderRadius: 10,
        border: "1px solid rgba(59,130,246,0.55)",
        background: "rgba(59,130,246,0.30)",
        color: "#e5e7eb",
        cursor: "pointer",
        fontWeight: 800,
    },
    error: {
        padding: "10px 12px",
        borderRadius: 12,
        border: "1px solid rgba(239,68,68,0.35)",
        background: "rgba(239,68,68,0.12)",
        color: "rgb(254,202,202)",
        fontWeight: 700,
    },

    savingOverlay: {
        position: "absolute",
        inset: 0,
        backgroundColor: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
    },

    savingBox: {
        backgroundColor: "rgba(10, 15, 30, 0.95)",
        border: "1px solid rgba(255,255,255,0.18)",
        borderRadius: 12,
        padding: "14px 16px",
        minWidth: 220,
        boxShadow: "0 16px 40px rgba(0,0,0,0.45)",
        textAlign: "center",
    },

    savingTitle: {
        fontSize: 16,
        fontWeight: 700,
        color: "#e5e7eb",
        marginBottom: 6,
    },

    savingSub: {
        fontSize: 13,
        color: "rgba(229,231,235,0.8)",
    },

    savedToast: {
        position: "absolute",
        right: 14,
        top: 14,
        backgroundColor: "rgba(10, 15, 30, 0.92)",
        border: "1px solid rgba(255,255,255,0.18)",
        borderRadius: 10,
        padding: "8px 10px",
        color: "#e5e7eb",
        fontSize: 13,
        zIndex: 60,
    },

    muted: { opacity: 0.8, fontSize: 13 },
};